// Image-to-PETSCII converter
// Ported from c64-image-to-petscii by Rob
// Uses CIE Lab perceptual color matching, saliency-weighted character
// optimization, and supports Standard, ECM, and MCM conversion modes.

import { C64_PALETTES } from '../c64Palettes';
import { mcmForegroundColor, mcmIsMulticolorCell, mcmResolveBitPairColor } from '../mcm';

// --- Color Science ---

interface Lab { L: number; a: number; b: number; }

function sRGBtoLab(r: number, g: number, b: number): Lab {
  // sRGB → linear RGB
  let rl = r / 255, gl = g / 255, bl = b / 255;
  rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
  gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
  bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;

  // linear RGB → XYZ (D65 illuminant)
  let x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
  let y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / 1.00000;
  let z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;

  // XYZ → Lab (cube-root transfer)
  const epsilon = 0.008856;
  const kappa = 903.3;
  x = x > epsilon ? Math.pow(x, 1 / 3) : (kappa * x + 16) / 116;
  y = y > epsilon ? Math.pow(y, 1 / 3) : (kappa * y + 16) / 116;
  z = z > epsilon ? Math.pow(z, 1 / 3) : (kappa * z + 16) / 116;

  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

function RGBtoHSV(color: number[]): number[] {
  const r = color[0], g = color[1], b = color[2];
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const v = max;
  const delta = max - min;

  if (max === 0) return [0, 0, 0];

  const s = delta / max;
  let h: number;

  if (delta === 0) {
    h = 0;
  } else if (r === max) {
    h = (g - b) / delta;
  } else if (g === max) {
    h = 2 + (b - r) / delta;
  } else {
    h = 4 + (r - g) / delta;
  }

  h *= 60;
  if (h < 0) h += 360;
  if (isNaN(h)) h = 0;

  return [h, s, v];
}

function HSVtoRGB(color: number[]): number[] {
  const h = color[0], s = color[1], v = color[2];
  if (s === 0) return [v, v, v];

  const sector = h / 60;
  const i = Math.floor(sector);
  const f = sector - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));

  switch (i) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

// --- Palettes ---

interface PaletteColor {
  r: number; g: number; b: number;
  L: number; a: number; B: number;
}

export interface ConverterPalette {
  id: string;
  name: string;
  hex: string[];
}

export const PALETTES: ConverterPalette[] = C64_PALETTES;

function buildPaletteColors(hex: string[]): PaletteColor[] {
  return hex.map(h => {
    const r = parseInt(h.substr(1, 2), 16);
    const g = parseInt(h.substr(3, 2), 16);
    const b = parseInt(h.substr(5, 2), 16);
    const lab = sRGBtoLab(r, g, b);
    return { r, g, b, L: lab.L, a: lab.a, B: lab.b };
  });
}

// --- Settings ---

export interface ConverterSettings {
  brightnessFactor: number;   // 0.5–2.0
  saturationFactor: number;   // 0.5–3.0
  saliencyAlpha: number;      // 0–10
  lumMatchWeight: number;     // 0–50
  paletteId: string;
  manualBgColor: number | null;  // null = auto, 0-15 = forced
  outputStandard: boolean;
  outputEcm: boolean;
  outputMcm: boolean;
}

export const CONVERTER_DEFAULTS: ConverterSettings = {
  brightnessFactor: 1.1,
  saturationFactor: 1.4,
  saliencyAlpha: 3.0,
  lumMatchWeight: 12,
  paletteId: 'colodore',
  manualBgColor: null,
  outputStandard: true,
  outputEcm: false,
  outputMcm: false,
};

export const CONVERTER_PRESETS = [
  {
    id: 'robs-favorite',
    name: "Rob's Favorite",
    ...CONVERTER_DEFAULTS,
  },
  {
    id: 'true-neutral',
    name: 'True Neutral',
    brightnessFactor: 1.0,
    saturationFactor: 1.0,
    saliencyAlpha: 0.0,
    lumMatchWeight: 0,
    paletteId: 'colodore',
    manualBgColor: null as number | null,
  },
];

// --- Results ---

export type ConverterCharset = 'upper' | 'lower';

export interface ConverterFontBits {
  upper: number[];
  lower: number[];
}

export interface ConversionResult {
  screencodes: number[];   // 1000 entries (40×25)
  colors: number[];        // 1000 entries
  backgroundColor: number;
  ecmBgColors: number[];   // ECM: 4 bg colors; Standard: empty
  bgIndices: number[];     // ECM: per-cell bg index; Standard: empty
  mcmSharedColors: number[]; // MCM: [mc1, mc2]; Standard/ECM: empty
  charset: ConverterCharset;
  mode: 'standard' | 'ecm' | 'mcm';
}

export interface ConversionOutputs {
  standard?: ConversionResult;
  ecm?: ConversionResult;
  mcm?: ConversionResult;
  previewStd?: ImageData;
  previewEcm?: ImageData;
  previewMcm?: ImageData;
}

interface CharsetConversionContext {
  ref: boolean[][];
  refSetCount: Int32Array;
  refMcm?: Uint8Array[];
  refMcmBpCount?: Int32Array[];
}

interface ModeCandidate {
  charset: ConverterCharset;
  result: PetsciiResult;
  conversion: ConversionResult;
}

interface CharsetConversionCandidates {
  context: CharsetConversionContext;
  standard?: ModeCandidate;
  ecm?: ModeCandidate;
  mcm?: ModeCandidate;
}

// --- Reference Characters from ROM font ---

function buildRefChars(fontBits: number[]): boolean[][] {
  const ref: boolean[][] = [];
  for (let ch = 0; ch < 256; ch++) {
    const char: boolean[] = [];
    for (let row = 0; row < 8; row++) {
      const byte = fontBits[ch * 8 + row];
      for (let bit = 7; bit >= 0; bit--) {
        char.push(((byte >> bit) & 1) !== 0);
      }
    }
    ref.push(char);
  }
  return ref;
}

interface McmReferenceData {
  refMcm: Uint8Array[];
  refMcmBpCount: Int32Array[];
}

function buildRefMcmData(ref: boolean[][]): McmReferenceData {
  const refMcm: Uint8Array[] = [];
  const refMcmBpCount: Int32Array[] = [];

  for (let ch = 0; ch < 256; ch++) {
    const bits = new Uint8Array(32);
    const counts = new Int32Array(4);
    for (let py = 0; py < 8; py++) {
      for (let mpx = 0; mpx < 4; mpx++) {
        const left = ref[ch][py * 8 + mpx * 2] ? 1 : 0;
        const right = ref[ch][py * 8 + mpx * 2 + 1] ? 1 : 0;
        const bitPair = (left << 1) | right;
        const idx = py * 4 + mpx;
        bits[idx] = bitPair;
        counts[bitPair]++;
      }
    }
    refMcm.push(bits);
    refMcmBpCount.push(counts);
  }

  return { refMcm, refMcmBpCount };
}

function buildCharsetConversionContext(
  fontBits: number[],
  renderMcm: boolean
): CharsetConversionContext {
  const ref = buildRefChars(fontBits);
  const refSetCount = buildRefSetCount(ref);

  if (!renderMcm) {
    return { ref, refSetCount };
  }

  const { refMcm, refMcmBpCount } = buildRefMcmData(ref);
  return { ref, refSetCount, refMcm, refMcmBpCount };
}

function createScopedProgress(
  onProgress: ProgressCallback,
  prefix: string,
  progressStart: number,
  progressSpan: number
): ProgressCallback {
  return (stage, detail, pct) => {
    const scopedPct = progressStart + Math.round((pct / 100) * progressSpan);
    onProgress(stage, `${prefix}${detail}`.trim(), scopedPct);
  };
}

function pickBetterCandidate(
  first?: ModeCandidate,
  second?: ModeCandidate
): ModeCandidate | undefined {
  if (!first) return second;
  if (!second) return first;
  return second.result.totalError < first.result.totalError ? second : first;
}

// --- Image Resize ---

function resizeToCanvas(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 200;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 320, 200);

  const ow = img.width;
  const oh = img.height;
  let w = 320;
  let h = Math.round(oh * 320 / ow);
  if (h > 200) {
    h = 200;
    w = Math.round(ow * 200 / oh);
  }

  const dx = w < 320 ? Math.round((320 - w) / 2) : 0;
  const dy = h < 200 ? Math.round((200 - h) / 2) : 0;

  ctx.drawImage(img, 0, 0, ow, oh, dx, dy, w, h);
  return ctx.getImageData(0, 0, 320, 200);
}

// --- Color Counting (for ECM background selection) ---

function countPaletteColors(
  srcData: Uint8ClampedArray,
  palette: PaletteColor[],
  settings: ConverterSettings
): number[] {
  const counts = new Array(16).fill(0);

  for (let i = 0; i < srcData.length; i += 4) {
    let r = srcData[i] * settings.brightnessFactor;
    let g = srcData[i + 1] * settings.brightnessFactor;
    let b = srcData[i + 2] * settings.brightnessFactor;

    const hsv = RGBtoHSV([r, g, b]);
    hsv[1] *= settings.saturationFactor;
    const rgb = HSVtoRGB(hsv);
    r = Math.max(0, Math.min(255, rgb[0]));
    g = Math.max(0, Math.min(255, rgb[1]));
    b = Math.max(0, Math.min(255, rgb[2]));

    const lab = sRGBtoLab(r, g, b);
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < 16; j++) {
      const dL = lab.L - palette[j].L;
      const da = lab.a - palette[j].a;
      const db = lab.b - palette[j].B;
      const dist = dL * dL + da * da + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = j;
      }
    }
    counts[bestIdx]++;
  }

  return counts;
}

// --- Cell Complexity (for background search weighting) ---

interface CellComplexityData {
  weights: Float64Array;
  rankedIndices: Int32Array;
}

function computeCellComplexity(
  srcData: Uint8ClampedArray,
  settings: ConverterSettings
): CellComplexityData {
  const weights = new Float64Array(1000);
  const variances = new Float64Array(1000);
  let maxVariance = 0;
  const BACKGROUND_MASK_TOP_FRACTION = 0.15;
  const rankedIndices = new Int32Array(1000);

  for (let cy = 0; cy < 25; cy++) {
    for (let cx = 0; cx < 40; cx++) {
      let sum = 0, sumSq = 0;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const si = ((cy * 8 + py) * 320 + (cx * 8 + px)) * 4;
          let r = srcData[si] * settings.brightnessFactor;
          let g = srcData[si + 1] * settings.brightnessFactor;
          let b = srcData[si + 2] * settings.brightnessFactor;
          const hsv = RGBtoHSV([r, g, b]);
          hsv[1] *= settings.saturationFactor;
          const rgb = HSVtoRGB(hsv);
          r = Math.max(0, Math.min(255, rgb[0]));
          g = Math.max(0, Math.min(255, rgb[1]));
          b = Math.max(0, Math.min(255, rgb[2]));
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          sum += lum;
          sumSq += lum * lum;
        }
      }
      const mean = sum / 64;
      const variance = sumSq / 64 - mean * mean;
      const idx = cy * 40 + cx;
      variances[idx] = variance;
      if (variance > maxVariance) maxVariance = variance;
    }
  }

  if (maxVariance > 0) {
    const order = Array.from({ length: 1000 }, (_, i) => i);
    order.sort((a, b) => variances[b] - variances[a]);
    rankedIndices.set(order);
    weights.fill(0.0);
    const maskFraction = maxVariance < 5000 ? 0.10 : BACKGROUND_MASK_TOP_FRACTION;
    const keepCount = Math.max(1, Math.round(1000 * maskFraction));
    for (let i = 0; i < keepCount; i++) {
      if (variances[order[i]] > 0) weights[order[i]] = 1.0;
    }
    if (weights[order[0]] === 0) weights[order[0]] = 1.0;
  } else {
    weights.fill(1.0);
    for (let i = 0; i < rankedIndices.length; i++) rankedIndices[i] = i;
  }

  return { weights, rankedIndices };
}

// --- Core PETSCII Character Matching ---

interface PetsciiResult {
  screencodes: number[];
  colors: number[];
  bgIndices: number[];
  totalError: number;
}

interface PreparedCellData {
  chunkL: Float64Array;
  chunkA: Float64Array;
  chunkBv: Float64Array;
  weights: Float64Array;
  srcAvgL: number;
  mcmL?: Float64Array;
  mcmA?: Float64Array;
  mcmBv?: Float64Array;
  mcmWeights?: Float64Array;
}

interface PaletteLabArrays {
  pL: Float64Array;
  pA: Float64Array;
  pB: Float64Array;
}

function buildPaletteLabArrays(palette: PaletteColor[]): PaletteLabArrays {
  const pL = new Float64Array(16);
  const pA = new Float64Array(16);
  const pB = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    pL[i] = palette[i].L;
    pA[i] = palette[i].a;
    pB[i] = palette[i].B;
  }
  return { pL, pA, pB };
}

function buildRefSetCount(ref: boolean[][]): Int32Array {
  const refSetCount = new Int32Array(ref.length);
  for (let ch = 0; ch < ref.length; ch++) {
    let n = 0;
    for (let p = 0; p < 64; p++) {
      if (ref[ch][p]) n++;
    }
    refSetCount[ch] = n;
  }
  return refSetCount;
}

function prepareCellData(
  srcData: Uint8ClampedArray,
  cx: number,
  cy: number,
  settings: ConverterSettings,
  includeMcm: boolean
): PreparedCellData {
  const chunkR = new Float64Array(64);
  const chunkG = new Float64Array(64);
  const chunkB_ = new Float64Array(64);

  for (let py = 0; py < 8; py++) {
    for (let px = 0; px < 8; px++) {
      const si = ((cy * 8 + py) * 320 + (cx * 8 + px)) * 4;
      const ci = py * 8 + px;
      chunkR[ci] = srcData[si];
      chunkG[ci] = srcData[si + 1];
      chunkB_[ci] = srcData[si + 2];
    }
  }

  for (let ci = 0; ci < 64; ci++) {
    let r = chunkR[ci] * settings.brightnessFactor;
    let g = chunkG[ci] * settings.brightnessFactor;
    let b = chunkB_[ci] * settings.brightnessFactor;
    const hsv = RGBtoHSV([r, g, b]);
    hsv[1] *= settings.saturationFactor;
    const rgb = HSVtoRGB(hsv);
    chunkR[ci] = Math.max(0, Math.min(255, rgb[0]));
    chunkG[ci] = Math.max(0, Math.min(255, rgb[1]));
    chunkB_[ci] = Math.max(0, Math.min(255, rgb[2]));
  }

  const chunkL = new Float64Array(64);
  const chunkA = new Float64Array(64);
  const chunkBv = new Float64Array(64);
  for (let p = 0; p < 64; p++) {
    const lab = sRGBtoLab(chunkR[p], chunkG[p], chunkB_[p]);
    chunkL[p] = lab.L;
    chunkA[p] = lab.a;
    chunkBv[p] = lab.b;
  }

  const weights = new Float64Array(64);
  const alpha = settings.saliencyAlpha;
  if (alpha > 0) {
    let meanL = 0;
    let meanA2 = 0;
    let meanB2 = 0;
    for (let p = 0; p < 64; p++) {
      meanL += chunkL[p];
      meanA2 += chunkA[p];
      meanB2 += chunkBv[p];
    }
    meanL /= 64;
    meanA2 /= 64;
    meanB2 /= 64;

    let maxDev = 0;
    for (let p = 0; p < 64; p++) {
      const dL = chunkL[p] - meanL;
      const da = chunkA[p] - meanA2;
      const db = chunkBv[p] - meanB2;
      const dev = Math.sqrt(dL * dL + da * da + db * db);
      weights[p] = dev;
      if (dev > maxDev) maxDev = dev;
    }

    if (maxDev > 0) {
      for (let p = 0; p < 64; p++) {
        weights[p] = 1.0 + alpha * (weights[p] / maxDev);
      }
    } else {
      weights.fill(1.0);
    }
  } else {
    weights.fill(1.0);
  }

  let srcAvgL = 0;
  for (let p = 0; p < 64; p++) srcAvgL += chunkL[p];
  srcAvgL /= 64;

  if (!includeMcm) {
    return { chunkL, chunkA, chunkBv, weights, srcAvgL };
  }

  const mcmL = new Float64Array(32);
  const mcmA = new Float64Array(32);
  const mcmBv = new Float64Array(32);
  const mcmWeights = new Float64Array(32);
  for (let py = 0; py < 8; py++) {
    for (let mpx = 0; mpx < 4; mpx++) {
      const p0 = py * 8 + mpx * 2;
      const p1 = p0 + 1;
      const mi = py * 4 + mpx;
      mcmL[mi] = (chunkL[p0] + chunkL[p1]) * 0.5;
      mcmA[mi] = (chunkA[p0] + chunkA[p1]) * 0.5;
      mcmBv[mi] = (chunkBv[p0] + chunkBv[p1]) * 0.5;
      mcmWeights[mi] = (weights[p0] + weights[p1]) * 0.5;
    }
  }

  return { chunkL, chunkA, chunkBv, weights, srcAvgL, mcmL, mcmA, mcmBv, mcmWeights };
}

function buildPreparedCells(
  srcData: Uint8ClampedArray,
  settings: ConverterSettings,
  includeMcm: boolean
): PreparedCellData[] {
  const preparedCells = new Array<PreparedCellData>(1000);
  for (let cy = 0; cy < 25; cy++) {
    for (let cx = 0; cx < 40; cx++) {
      const idx = cy * 40 + cx;
      preparedCells[idx] = prepareCellData(srcData, cx, cy, settings, includeMcm);
    }
  }
  return preparedCells;
}

function buildSampleCellWeights(
  cellWeights: Float64Array,
  rankedIndices: Int32Array,
  sampleCount: number
): Float64Array {
  const sampleWeights = new Float64Array(cellWeights.length);
  let selected = 0;

  for (let i = 0; i < rankedIndices.length && selected < sampleCount; i++) {
    const idx = rankedIndices[i];
    if (cellWeights[idx] > 0) {
      sampleWeights[idx] = cellWeights[idx];
      selected++;
    }
  }

  if (selected === 0) {
    const fallbackCount = Math.min(sampleCount, rankedIndices.length);
    for (let i = 0; i < fallbackCount; i++) {
      sampleWeights[rankedIndices[i]] = 1.0;
    }
  }

  return sampleWeights;
}

function findOptimalPetscii(
  mode: 'standard' | 'ecm',
  preparedCells: PreparedCellData[],
  paletteLab: PaletteLabArrays,
  ref: boolean[][],
  refSetCount: Int32Array,
  bgOverride: number | undefined,
  ecmBgs: number[],
  settings: ConverterSettings,
  cellWeights: Float64Array | null,
  skipZeroWeightCells: boolean = false
): PetsciiResult {
  const screencodes: number[] = [];
  const colors: number[] = [];
  const bgIndices: number[] = [];
  let totalError = 0;

  const charLimit = mode === 'ecm' ? 64 : ref.length;
  const REPEAT_PENALTY = 50.0;
  const { pL, pA, pB } = paletteLab;

  const prevRow = new Int32Array(40).fill(-1);
  const currRow = new Int32Array(40).fill(-1);

  for (let cy = 0; cy < 25; cy++) {
    prevRow.set(currRow);
    currRow.fill(-1);

    for (let cx = 0; cx < 40; cx++) {
      const cellIdx = cy * 40 + cx;
      if (skipZeroWeightCells && cellWeights && cellWeights[cellIdx] === 0) {
        continue;
      }
      const { chunkL, chunkA, chunkBv, weights, srcAvgL } = preparedCells[cellIdx];

      // Background candidates
      let bgCandidates: number[];
      if (bgOverride !== undefined) {
        bgCandidates = [bgOverride];
      } else if (mode === 'ecm') {
        bgCandidates = ecmBgs;
      } else {
        bgCandidates = [0];
      }

      // Brute-force: all chars × all fg colors, scored by Lab error
      let bestError = Infinity;
      let bestChar = 0;
      let bestFg = 0;
      let bestBgIdx = 0;

      for (let bi = 0; bi < bgCandidates.length; bi++) {
        const bgCol = bgCandidates[bi];
        const bgLabL = pL[bgCol], bgLabA = pA[bgCol], bgLabB = pB[bgCol];

        for (let ch = 0; ch < charLimit; ch++) {
          // Background error (weighted Lab distance for unset pixels)
          let bgError = 0;
          for (let p = 0; p < 64; p++) {
            if (!ref[ch][p]) {
              const dL = chunkL[p] - bgLabL;
              const da = chunkA[p] - bgLabA;
              const db = chunkBv[p] - bgLabB;
              bgError += weights[p] * (dL * dL + da * da + db * db);
            }
          }

          // Early exit: bg error alone exceeds best total
          if (bgError >= bestError) continue;

          // Try all 16 foreground colors
          for (let f = 0; f < 16; f++) {
            if (f === bgCol) continue;
            const fgLabL = pL[f], fgLabA = pA[f], fgLabB = pB[f];
            let fgError = 0;

            for (let p = 0; p < 64; p++) {
              if (ref[ch][p]) {
                const dL = chunkL[p] - fgLabL;
                const da = chunkA[p] - fgLabA;
                const db = chunkBv[p] - fgLabB;
                fgError += weights[p] * (dL * dL + da * da + db * db);
              }
            }

            // Luminance matching penalty
            const nSet = refSetCount[ch];
            const renderedAvgL = (nSet * pL[f] + (64 - nSet) * pL[bgCol]) / 64;
            const lumDiff = srcAvgL - renderedAvgL;
            const lumPenalty = settings.lumMatchWeight * lumDiff * lumDiff;

            // Neighbor repeat penalty
            let repeatPen = 0;
            if (cx > 0 && ch === currRow[cx - 1]) repeatPen += REPEAT_PENALTY;
            if (ch === prevRow[cx]) repeatPen += REPEAT_PENALTY;

            const total = bgError + fgError + lumPenalty + repeatPen;

            if (total < bestError) {
              bestError = total;
              bestChar = ch;
              bestFg = f;
              bestBgIdx = bi;
            }
          }
        }
      }

      totalError += (cellWeights ? cellWeights[cellIdx] : 1) * bestError;
      currRow[cx] = bestChar;

      screencodes.push(bestChar);
      colors.push(bestFg);
      bgIndices.push(bestBgIdx);
    }
  }

  return { screencodes, colors, bgIndices, totalError };
}

function findOptimalPetsciiMcm(
  preparedCells: PreparedCellData[],
  paletteLab: PaletteLabArrays,
  ref: boolean[][],
  refSetCount: Int32Array,
  refMcm: Uint8Array[],
  refMcmBpCount: Int32Array[],
  mcmBg: number,
  mcmMc1: number,
  mcmMc2: number,
  settings: ConverterSettings,
  cellWeights: Float64Array | null,
  disableRepeatPenalty: boolean = false
): PetsciiResult {
  const screencodes = new Array<number>(1000).fill(32);
  const colors = new Array<number>(1000).fill(0);
  const bgIndices: number[] = [];
  let totalError = 0;
  const { pL, pA, pB } = paletteLab;

  const REPEAT_PENALTY = 50.0;
  const useRepeatPenalty = !disableRepeatPenalty;
  const prevRow = new Int32Array(40).fill(-1);
  const currRow = new Int32Array(40).fill(-1);

  for (let cy = 0; cy < 25; cy++) {
    prevRow.set(currRow);
    currRow.fill(-1);

    for (let cx = 0; cx < 40; cx++) {
      const cellIdx = cy * 40 + cx;
      if (disableRepeatPenalty && cellWeights && cellWeights[cellIdx] === 0) {
        continue;
      }

      const { chunkL, chunkA, chunkBv, weights, srcAvgL, mcmL, mcmA, mcmBv, mcmWeights } = preparedCells[cellIdx];

      let bestMcmErr = Infinity;
      let bestMcmChar = 0;
      let bestMcmFg = 0;

      for (let ch = 0; ch < refMcm.length; ch++) {
        const bits = refMcm[ch];
        const counts = refMcmBpCount[ch];
        let fixedErr = 0;

        for (let p = 0; p < 32; p++) {
          const bitPair = bits[p];
          if (bitPair === 3) continue;
          const col = bitPair === 0 ? mcmBg : bitPair === 1 ? mcmMc1 : mcmMc2;
          const dL = mcmL![p] - pL[col];
          const da = mcmA![p] - pA[col];
          const db = mcmBv![p] - pB[col];
          fixedErr += mcmWeights![p] * (dL * dL + da * da + db * db);
        }

        if (2 * fixedErr >= bestMcmErr) continue;

        for (let fg = 0; fg < 8; fg++) {
          let fgErr = 0;
          for (let p = 0; p < 32; p++) {
            if (bits[p] !== 3) continue;
            const dL = mcmL![p] - pL[fg];
            const da = mcmA![p] - pA[fg];
            const db = mcmBv![p] - pB[fg];
            fgErr += mcmWeights![p] * (dL * dL + da * da + db * db);
          }

          const colorErr = 2 * (fixedErr + fgErr);
          const renderedAvgL =
            (counts[0] * pL[mcmBg] +
             counts[1] * pL[mcmMc1] +
             counts[2] * pL[mcmMc2] +
             counts[3] * pL[fg]) / 32;
          const lumDiff = srcAvgL - renderedAvgL;
          const lumPenalty = settings.lumMatchWeight * lumDiff * lumDiff;

          let repeatPen = 0;
          if (useRepeatPenalty) {
            if (cx > 0 && ch === currRow[cx - 1]) repeatPen += REPEAT_PENALTY;
            if (ch === prevRow[cx]) repeatPen += REPEAT_PENALTY;
          }

          const total = colorErr + lumPenalty + repeatPen;
          if (total < bestMcmErr) {
            bestMcmErr = total;
            bestMcmChar = ch;
            bestMcmFg = fg;
          }
        }
      }

      let bestHiresErr = Infinity;
      let bestHiresChar = 0;
      let bestHiresFg = 0;

      for (let ch = 0; ch < ref.length; ch++) {
        let bgErr = 0;
        for (let p = 0; p < 64; p++) {
          if (!ref[ch][p]) {
            const dL = chunkL[p] - pL[mcmBg];
            const da = chunkA[p] - pA[mcmBg];
            const db = chunkBv[p] - pB[mcmBg];
            bgErr += weights[p] * (dL * dL + da * da + db * db);
          }
        }

        if (bgErr >= bestHiresErr) continue;

        for (let fg = 0; fg < 8; fg++) {
          if (fg === mcmBg) continue;
          let fgErr = 0;
          for (let p = 0; p < 64; p++) {
            if (ref[ch][p]) {
              const dL = chunkL[p] - pL[fg];
              const da = chunkA[p] - pA[fg];
              const db = chunkBv[p] - pB[fg];
              fgErr += weights[p] * (dL * dL + da * da + db * db);
            }
          }

          const nSet = refSetCount[ch];
          const renderedAvgL = (nSet * pL[fg] + (64 - nSet) * pL[mcmBg]) / 64;
          const lumDiff = srcAvgL - renderedAvgL;
          const lumPenalty = settings.lumMatchWeight * lumDiff * lumDiff;

          let repeatPen = 0;
          if (useRepeatPenalty) {
            if (cx > 0 && ch === currRow[cx - 1]) repeatPen += REPEAT_PENALTY;
            if (ch === prevRow[cx]) repeatPen += REPEAT_PENALTY;
          }

          const total = bgErr + fgErr + lumPenalty + repeatPen;
          if (total < bestHiresErr) {
            bestHiresErr = total;
            bestHiresChar = ch;
            bestHiresFg = fg;
          }
        }
      }

      const useMcm = bestMcmErr < bestHiresErr;
      const bestErr = useMcm ? bestMcmErr : bestHiresErr;
      const bestChar = useMcm ? bestMcmChar : bestHiresChar;
      const bestColorRam = useMcm ? (bestMcmFg | 8) : bestHiresFg;

      totalError += (cellWeights ? cellWeights[cellIdx] : 1) * bestErr;
      currRow[cx] = bestChar;
      screencodes[cellIdx] = bestChar;
      colors[cellIdx] = bestColorRam;
    }
  }

  return { screencodes, colors, bgIndices, totalError };
}

function buildMcmShortlist(colorCounts: number[], bestBg: number): number[] {
  const sorted = colorCounts
    .map((count, idx) => ({ count, idx }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.idx - b.idx));

  let shortlist = sorted.slice(0, 8).map(entry => entry.idx);
  if (!shortlist.includes(bestBg)) {
    if (shortlist.length >= 8) {
      shortlist[7] = bestBg;
    } else {
      shortlist.push(bestBg);
    }
  }

  shortlist = shortlist.filter((value, index) => shortlist.indexOf(value) === index);
  for (let color = 0; color < 16 && shortlist.length < 3; color++) {
    if (!shortlist.includes(color)) shortlist.push(color);
  }

  return shortlist;
}

function fallbackMcmGlobals(bestBg: number): { mcmBg: number; mcmMc1: number; mcmMc2: number } {
  const extras = Array.from({ length: 16 }, (_, color) => color).filter(color => color !== bestBg);
  return {
    mcmBg: bestBg,
    mcmMc1: extras[0] ?? 1,
    mcmMc2: extras[1] ?? 2,
  };
}

async function findOptimalMcmGlobalColors(
  preparedCells: PreparedCellData[],
  paletteLab: PaletteLabArrays,
  ref: boolean[][],
  refSetCount: Int32Array,
  refMcm: Uint8Array[],
  refMcmBpCount: Int32Array[],
  colorCounts: number[],
  bestBg: number,
  settings: ConverterSettings,
  cellWeights: Float64Array,
  rankedIndices: Int32Array,
  onProgress: ProgressCallback,
  progressStart: number,
  progressSpan: number
): Promise<{ mcmBg: number; mcmMc1: number; mcmMc2: number }> {
  const MCM_COARSE_SAMPLE_SIZE = 48;
  const MCM_FINALIST_COUNT = 24;
  const candidates = buildMcmShortlist(colorCounts, bestBg);
  const triples: [number, number, number][] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = 0; j < candidates.length; j++) {
      if (j === i) continue;
      for (let k = 0; k < candidates.length; k++) {
        if (k === i || k === j) continue;
        triples.push([candidates[i], candidates[j], candidates[k]]);
      }
    }
  }

  if (triples.length === 0) {
    return fallbackMcmGlobals(bestBg);
  }

  const finalists = new Array<{ triple: [number, number, number]; totalError: number }>();
  if (triples.length > MCM_FINALIST_COUNT) {
    const sampleWeights = buildSampleCellWeights(cellWeights, rankedIndices, MCM_COARSE_SAMPLE_SIZE);
    const coarseSpan = Math.max(1, Math.round(progressSpan * 0.65));
    for (let idx = 0; idx < triples.length; idx++) {
      const triple = triples[idx];
      const pct = progressStart + Math.round((idx / triples.length) * coarseSpan);
      onProgress(
        'MCM globals',
        `Coarse ${idx + 1} of ${triples.length} (bg=${triple[0]}, mc1=${triple[1]}, mc2=${triple[2]})`,
        pct
      );
      await yieldToUI();
      const result = findOptimalPetsciiMcm(
        preparedCells,
        paletteLab,
        ref,
        refSetCount,
        refMcm,
        refMcmBpCount,
        triple[0],
        triple[1],
        triple[2],
        settings,
        sampleWeights,
        true
      );
      finalists.push({ triple, totalError: result.totalError });
    }

    finalists.sort((a, b) => a.totalError - b.totalError);
    finalists.length = Math.min(MCM_FINALIST_COUNT, finalists.length);
  } else {
    for (let idx = 0; idx < triples.length; idx++) {
      finalists.push({ triple: triples[idx], totalError: Infinity });
    }
  }

  let best = finalists[0].triple;
  let bestErr = Infinity;
  const coarseSpan = triples.length > MCM_FINALIST_COUNT ? Math.max(1, Math.round(progressSpan * 0.65)) : 0;
  const refineSpan = progressSpan - coarseSpan;
  for (let idx = 0; idx < finalists.length; idx++) {
    const triple = finalists[idx].triple;
    const pct = progressStart + coarseSpan + Math.round((idx / finalists.length) * Math.max(refineSpan, 1));
    onProgress(
      'MCM globals',
      `Refine ${idx + 1} of ${finalists.length} (bg=${triple[0]}, mc1=${triple[1]}, mc2=${triple[2]})`,
      pct
    );
    await yieldToUI();
    const result = findOptimalPetsciiMcm(
      preparedCells,
      paletteLab,
      ref,
      refSetCount,
      refMcm,
      refMcmBpCount,
      triple[0],
      triple[1],
      triple[2],
      settings,
      cellWeights,
      true
    );
    if (result.totalError < bestErr) {
      bestErr = result.totalError;
      best = triple;
    }
  }

  return {
    mcmBg: best[0],
    mcmMc1: best[1],
    mcmMc2: best[2],
  };
}

interface SharedConversionInputs {
  paletteLab: PaletteLabArrays;
  colorCounts: number[];
  settings: ConverterSettings;
  preparedCells: PreparedCellData[];
  renderStandard: boolean;
  renderEcm: boolean;
  renderMcm: boolean;
  cellWeights: Float64Array | null;
  rankedIndices: Int32Array | null;
}

async function convertForCharset(
  charset: ConverterCharset,
  context: CharsetConversionContext,
  shared: SharedConversionInputs,
  onProgress: ProgressCallback
): Promise<CharsetConversionCandidates> {
  const { paletteLab, colorCounts, settings, preparedCells, renderStandard, renderEcm, renderMcm, cellWeights, rankedIndices } = shared;
  const { ref, refSetCount, refMcm, refMcmBpCount } = context;

  let bestBg: number;
  if (settings.manualBgColor !== null) {
    bestBg = settings.manualBgColor;
    onProgress('Background', `Using manual color ${bestBg}`, 15);
  } else {
    bestBg = 0;
    let bestErr = Infinity;
    for (let candidate = 0; candidate < 16; candidate++) {
      onProgress('Background', `Testing ${candidate + 1} of 16...`, 15 + Math.round((candidate / 16) * 25));
      await yieldToUI();
      const result = findOptimalPetscii(
        'standard', preparedCells, paletteLab, ref, refSetCount, candidate, [], settings, cellWeights, true
      );
      if (result.totalError < bestErr) {
        bestErr = result.totalError;
        bestBg = candidate;
      }
    }
  }

  let ecmBgs: number[] = [];
  if (renderEcm) {
    const sorted = colorCounts
      .map((count, idx) => ({ count, idx }))
      .sort((a, b) => b.count - a.count);
    ecmBgs = sorted.slice(0, 4).map(s => s.idx);
    if (!ecmBgs.includes(bestBg)) {
      ecmBgs[3] = bestBg;
    }
    const winnerIdx = ecmBgs.indexOf(bestBg);
    if (winnerIdx > 0) {
      ecmBgs.splice(winnerIdx, 1);
      ecmBgs.unshift(bestBg);
    }
  }

  let mcmBg: number | undefined;
  let mcmMc1: number | undefined;
  let mcmMc2: number | undefined;
  if (renderMcm && refMcm && refMcmBpCount && cellWeights && rankedIndices) {
    const globals = await findOptimalMcmGlobalColors(
      preparedCells,
      paletteLab,
      ref,
      refSetCount,
      refMcm,
      refMcmBpCount,
      colorCounts,
      bestBg,
      settings,
      cellWeights,
      rankedIndices,
      onProgress,
      40,
      20
    );
    mcmBg = globals.mcmBg;
    mcmMc1 = globals.mcmMc1;
    mcmMc2 = globals.mcmMc2;
  }

  let standard: ModeCandidate | undefined;
  let ecm: ModeCandidate | undefined;
  let mcm: ModeCandidate | undefined;

  if (renderStandard) {
    onProgress('Converting', 'Standard mode (256 chars)...', 60);
    await yieldToUI();
    const result = findOptimalPetscii(
      'standard', preparedCells, paletteLab, ref, refSetCount, bestBg, [], settings, null
    );
    standard = {
      charset,
      result,
      conversion: {
        screencodes: result.screencodes,
        colors: result.colors,
        backgroundColor: bestBg,
        ecmBgColors: [],
        bgIndices: [],
        mcmSharedColors: [],
        charset,
        mode: 'standard',
      },
    };
  }

  if (renderEcm) {
    onProgress('Converting', 'ECM mode (64 chars, 4 backgrounds)...', 74);
    await yieldToUI();
    const result = findOptimalPetscii(
      'ecm', preparedCells, paletteLab, ref, refSetCount, undefined, ecmBgs, settings, null
    );
    ecm = {
      charset,
      result,
      conversion: {
        screencodes: result.screencodes,
        colors: result.colors,
        backgroundColor: ecmBgs[0],
        ecmBgColors: ecmBgs,
        bgIndices: result.bgIndices,
        mcmSharedColors: [],
        charset,
        mode: 'ecm',
      },
    };
  }

  if (renderMcm && refMcm && refMcmBpCount && mcmBg !== undefined && mcmMc1 !== undefined && mcmMc2 !== undefined) {
    onProgress('Converting', 'MCM mode (mixed hires/multicolor)...', 86);
    await yieldToUI();
    const result = findOptimalPetsciiMcm(
      preparedCells,
      paletteLab,
      ref,
      refSetCount,
      refMcm,
      refMcmBpCount,
      mcmBg,
      mcmMc1,
      mcmMc2,
      settings,
      null
    );
    mcm = {
      charset,
      result,
      conversion: {
        screencodes: result.screencodes,
        colors: result.colors,
        backgroundColor: mcmBg,
        ecmBgColors: [],
        bgIndices: [],
        mcmSharedColors: [mcmMc1, mcmMc2],
        charset,
        mode: 'mcm',
      },
    };
  }

  return { context, standard, ecm, mcm };
}

// --- Preview Rendering ---

function renderPreview(
  result: PetsciiResult,
  palette: PaletteColor[],
  ref: boolean[][],
  bgColor: number,
  ecmBgs: number[],
  mode: 'standard' | 'ecm'
): ImageData {
  const imageData = new ImageData(320, 200);
  const data = imageData.data;

  for (let cy = 0; cy < 25; cy++) {
    for (let cx = 0; cx < 40; cx++) {
      const cellIdx = cy * 40 + cx;
      const ch = result.screencodes[cellIdx];
      const fg = result.colors[cellIdx];
      const bg = mode === 'ecm' ? ecmBgs[result.bgIndices[cellIdx]] : bgColor;

      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const pi = py * 8 + px;
          const colIdx = ref[ch][pi] ? fg : bg;
          const di = ((cy * 8 + py) * 320 + (cx * 8 + px)) * 4;
          data[di] = palette[colIdx].r;
          data[di + 1] = palette[colIdx].g;
          data[di + 2] = palette[colIdx].b;
          data[di + 3] = 255;
        }
      }
    }
  }

  return imageData;
}

function renderMcmPreview(
  result: PetsciiResult,
  palette: PaletteColor[],
  ref: boolean[][],
  refMcm: Uint8Array[],
  mcmBg: number,
  mcmMc1: number,
  mcmMc2: number
): ImageData {
  const imageData = new ImageData(320, 200);
  const data = imageData.data;

  for (let cy = 0; cy < 25; cy++) {
    for (let cx = 0; cx < 40; cx++) {
      const cellIdx = cy * 40 + cx;
      const ch = result.screencodes[cellIdx];
      const colorRam = result.colors[cellIdx];

      if (mcmIsMulticolorCell(colorRam)) {
        const fg = mcmForegroundColor(colorRam);
        const bits = refMcm[ch];
        for (let py = 0; py < 8; py++) {
          for (let mpx = 0; mpx < 4; mpx++) {
            const bitPair = bits[py * 4 + mpx];
            const colorIdx = mcmResolveBitPairColor(bitPair, mcmBg, mcmMc1, mcmMc2, fg);
            const x0 = mpx * 2;
            for (let dx = 0; dx < 2; dx++) {
              const di = ((cy * 8 + py) * 320 + (cx * 8 + x0 + dx)) * 4;
              data[di] = palette[colorIdx].r;
              data[di + 1] = palette[colorIdx].g;
              data[di + 2] = palette[colorIdx].b;
              data[di + 3] = 255;
            }
          }
        }
      } else {
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const pi = py * 8 + px;
            const colorIdx = ref[ch][pi] ? colorRam : mcmBg;
            const di = ((cy * 8 + py) * 320 + (cx * 8 + px)) * 4;
            data[di] = palette[colorIdx].r;
            data[di + 1] = palette[colorIdx].g;
            data[di + 2] = palette[colorIdx].b;
            data[di + 3] = 255;
          }
        }
      }
    }
  }

  return imageData;
}

// --- Top-level Orchestrator ---

export type ProgressCallback = (stage: string, detail: string, pct: number) => void;

function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function convertImage(
  img: HTMLImageElement,
  settings: ConverterSettings,
  fontBitsByCharset: ConverterFontBits,
  onProgress: ProgressCallback
): Promise<ConversionOutputs> {
  const paletteData = PALETTES.find(p => p.id === settings.paletteId) || PALETTES[0];
  const palette = buildPaletteColors(paletteData.hex);
  const paletteLab = buildPaletteLabArrays(palette);
  const renderStandard = settings.outputStandard;
  const renderEcm = settings.outputEcm;
  const renderMcm = settings.outputMcm;

  // Step 1: Resize image to 320×200
  onProgress('Resizing', 'Preparing canvas...', 0);
  const imageData = resizeToCanvas(img);
  const srcData = imageData.data;

  const needsColorCounts = renderEcm || renderMcm;
  const colorCounts = new Array(16).fill(0);
  if (needsColorCounts) {
    onProgress('Mapping colors', 'Finding nearest C64 colors...', 5);
    await yieldToUI();
    const counts = countPaletteColors(srcData, palette, settings);
    for (let i = 0; i < counts.length; i++) colorCounts[i] = counts[i];
  }

  const needsCellWeights = settings.manualBgColor === null || renderMcm;
  let cellWeights: Float64Array | null = null;
  let rankedIndices: Int32Array | null = null;
  if (needsCellWeights) {
    onProgress('Analyzing', 'Computing cell complexity...', 10);
    await yieldToUI();
    const complexity = computeCellComplexity(srcData, settings);
    cellWeights = complexity.weights;
    rankedIndices = complexity.rankedIndices;
  }

  onProgress('Analyzing', 'Preparing cell data...', 12);
  await yieldToUI();
  const preparedCells = buildPreparedCells(srcData, settings, renderMcm);

  const sharedInputs: SharedConversionInputs = {
    paletteLab,
    colorCounts,
    settings,
    preparedCells,
    renderStandard,
    renderEcm,
    renderMcm,
    cellWeights,
    rankedIndices,
  };

  const upperContext = buildCharsetConversionContext(fontBitsByCharset.upper, renderMcm);
  const lowerContext = buildCharsetConversionContext(fontBitsByCharset.lower, renderMcm);

  const upperCandidates = await convertForCharset(
    'upper',
    upperContext,
    sharedInputs,
    createScopedProgress(onProgress, 'Upper ROM: ', 12, 40)
  );
  const lowerCandidates = await convertForCharset(
    'lower',
    lowerContext,
    sharedInputs,
    createScopedProgress(onProgress, 'Lower ROM: ', 52, 40)
  );

  const bestStandard = pickBetterCandidate(upperCandidates.standard, lowerCandidates.standard);
  const bestEcm = pickBetterCandidate(upperCandidates.ecm, lowerCandidates.ecm);
  const bestMcm = pickBetterCandidate(upperCandidates.mcm, lowerCandidates.mcm);
  const contextsByCharset: Record<ConverterCharset, CharsetConversionContext> = {
    upper: upperCandidates.context,
    lower: lowerCandidates.context,
  };

  const outputs: ConversionOutputs = {};
  if (bestStandard || bestEcm || bestMcm) {
    onProgress('Rendering', 'Generating previews...', 94);
    await yieldToUI();
  }
  if (bestStandard) {
    const context = contextsByCharset[bestStandard.charset];
    outputs.standard = bestStandard.conversion;
    outputs.previewStd = renderPreview(
      bestStandard.result,
      palette,
      context.ref,
      bestStandard.conversion.backgroundColor,
      [],
      'standard'
    );
  }
  if (bestEcm) {
    const context = contextsByCharset[bestEcm.charset];
    outputs.ecm = bestEcm.conversion;
    outputs.previewEcm = renderPreview(
      bestEcm.result,
      palette,
      context.ref,
      bestEcm.conversion.backgroundColor,
      bestEcm.conversion.ecmBgColors,
      'ecm'
    );
  }
  if (bestMcm) {
    const context = contextsByCharset[bestMcm.charset];
    outputs.mcm = bestMcm.conversion;
    outputs.previewMcm = renderMcmPreview(
      bestMcm.result,
      palette,
      context.ref,
      context.refMcm!,
      bestMcm.conversion.backgroundColor,
      bestMcm.conversion.mcmSharedColors[0],
      bestMcm.conversion.mcmSharedColors[1]
    );
  }

  onProgress('Done', '', 100);
  return outputs;
}
