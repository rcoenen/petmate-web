// Image-to-PETSCII converter
// Ported from c64-image-to-petscii by Rob
// Uses CIE Lab perceptual color matching, saliency-weighted character
// optimization, and supports Standard (256 chars) and ECM (64 chars, 4 bg) modes.

import { C64_PALETTES } from '../c64Palettes';

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
}

export const CONVERTER_DEFAULTS: ConverterSettings = {
  brightnessFactor: 1.1,
  saturationFactor: 1.4,
  saliencyAlpha: 3.0,
  lumMatchWeight: 12,
  paletteId: 'colodore',
  manualBgColor: null,
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

export interface ConversionResult {
  screencodes: number[];   // 1000 entries (40×25)
  colors: number[];        // 1000 entries
  backgroundColor: number;
  ecmBgColors: number[];   // ECM: 4 bg colors; Standard: empty
  bgIndices: number[];     // ECM: per-cell bg index; Standard: empty
  mode: 'standard' | 'ecm';
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

function computeCellComplexity(
  srcData: Uint8ClampedArray,
  settings: ConverterSettings
): Float64Array {
  const weights = new Float64Array(1000);
  const variances = new Float64Array(1000);
  let maxVariance = 0;
  const BACKGROUND_MASK_TOP_FRACTION = 0.15;

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
    weights.fill(0.0);
    const maskFraction = maxVariance < 5000 ? 0.10 : BACKGROUND_MASK_TOP_FRACTION;
    const keepCount = Math.max(1, Math.round(1000 * maskFraction));
    for (let i = 0; i < keepCount; i++) {
      if (variances[order[i]] > 0) weights[order[i]] = 1.0;
    }
    if (weights[order[0]] === 0) weights[order[0]] = 1.0;
  } else {
    weights.fill(1.0);
  }

  return weights;
}

// --- Core PETSCII Character Matching ---

interface PetsciiResult {
  screencodes: number[];
  colors: number[];
  bgIndices: number[];
  totalError: number;
}

function findOptimalPetscii(
  mode: 'standard' | 'ecm',
  srcData: Uint8ClampedArray,
  palette: PaletteColor[],
  ref: boolean[][],
  bgOverride: number | undefined,
  ecmBgs: number[],
  settings: ConverterSettings,
  cellWeights: Float64Array | null
): PetsciiResult {
  const screencodes: number[] = [];
  const colors: number[] = [];
  const bgIndices: number[] = [];
  let totalError = 0;

  const charLimit = mode === 'ecm' ? 64 : ref.length;
  const REPEAT_PENALTY = 50.0;

  // Precompute palette Lab as flat arrays for fast access
  const pL = new Float64Array(16);
  const pA = new Float64Array(16);
  const pB = new Float64Array(16);
  for (let i = 0; i < 16; i++) {
    pL[i] = palette[i].L;
    pA[i] = palette[i].a;
    pB[i] = palette[i].B;
  }

  // Precompute set-pixel count per character
  const refSetCount = new Int32Array(charLimit);
  for (let ch = 0; ch < charLimit; ch++) {
    let n = 0;
    for (let p = 0; p < 64; p++) { if (ref[ch][p]) n++; }
    refSetCount[ch] = n;
  }

  const prevRow = new Int32Array(40).fill(-1);
  const currRow = new Int32Array(40).fill(-1);

  for (let cy = 0; cy < 25; cy++) {
    prevRow.set(currRow);
    currRow.fill(-1);

    for (let cx = 0; cx < 40; cx++) {
      // Read 64 source pixels for this 8×8 cell
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

      // Apply brightness + saturation adjustment
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

      // Convert to Lab
      const chunkL = new Float64Array(64);
      const chunkA = new Float64Array(64);
      const chunkBv = new Float64Array(64);
      for (let p = 0; p < 64; p++) {
        const lab = sRGBtoLab(chunkR[p], chunkG[p], chunkB_[p]);
        chunkL[p] = lab.L;
        chunkA[p] = lab.a;
        chunkBv[p] = lab.b;
      }

      // Per-pixel saliency weights
      const weights = new Float64Array(64);
      const alpha = settings.saliencyAlpha;
      if (alpha > 0) {
        let meanL = 0, meanA2 = 0, meanB2 = 0;
        for (let p = 0; p < 64; p++) {
          meanL += chunkL[p]; meanA2 += chunkA[p]; meanB2 += chunkBv[p];
        }
        meanL /= 64; meanA2 /= 64; meanB2 /= 64;

        let maxDev = 0;
        for (let p = 0; p < 64; p++) {
          const dL = chunkL[p] - meanL, da = chunkA[p] - meanA2, db = chunkBv[p] - meanB2;
          const dev = Math.sqrt(dL * dL + da * da + db * db);
          weights[p] = dev;
          if (dev > maxDev) maxDev = dev;
        }

        if (maxDev > 0) {
          for (let p = 0; p < 64; p++) {
            weights[p] = 1.0 + alpha * (weights[p] / maxDev);
          }
        } else {
          for (let p = 0; p < 64; p++) weights[p] = 1.0;
        }
      } else {
        for (let p = 0; p < 64; p++) weights[p] = 1.0;
      }

      // Source cell average luminance (Lab L, 0–100)
      let srcAvgL = 0;
      for (let p = 0; p < 64; p++) srcAvgL += chunkL[p];
      srcAvgL /= 64;

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

      totalError += (cellWeights ? cellWeights[cy * 40 + cx] : 1) * bestError;
      currRow[cx] = bestChar;

      screencodes.push(bestChar);
      colors.push(bestFg);
      bgIndices.push(bestBgIdx);
    }
  }

  return { screencodes, colors, bgIndices, totalError };
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

// --- Top-level Orchestrator ---

export type ProgressCallback = (stage: string, detail: string, pct: number) => void;

function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function convertImage(
  img: HTMLImageElement,
  settings: ConverterSettings,
  fontBits: number[],
  onProgress: ProgressCallback
): Promise<{
  standard: ConversionResult;
  ecm: ConversionResult;
  previewStd: ImageData;
  previewEcm: ImageData;
}> {
  const paletteData = PALETTES.find(p => p.id === settings.paletteId) || PALETTES[0];
  const palette = buildPaletteColors(paletteData.hex);
  const ref = buildRefChars(fontBits);

  // Step 1: Resize image to 320×200
  onProgress('Resizing', 'Preparing canvas...', 0);
  const imageData = resizeToCanvas(img);
  const srcData = imageData.data;

  // Step 2: Count palette colors (for ECM background selection)
  onProgress('Mapping colors', 'Finding nearest C64 colors...', 5);
  await yieldToUI();
  const colorCounts = countPaletteColors(srcData, palette, settings);

  // Step 3: Compute cell complexity (for background search weighting)
  onProgress('Analyzing', 'Computing cell complexity...', 10);
  await yieldToUI();
  const cellWeights = computeCellComplexity(srcData, settings);

  // Step 4: Find optimal background color
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
        'standard', srcData, palette, ref, candidate, [], settings, cellWeights
      );
      if (result.totalError < bestErr) {
        bestErr = result.totalError;
        bestBg = candidate;
      }
    }
  }

  // Step 5: Select ECM backgrounds (top 4 by frequency)
  const sorted = colorCounts
    .map((count, idx) => ({ count, idx }))
    .sort((a, b) => b.count - a.count);
  const ecmBgs = sorted.slice(0, 4).map(s => s.idx);
  // Ensure brute-force winner is included
  if (!ecmBgs.includes(bestBg)) {
    ecmBgs[3] = bestBg;
  }
  // Move winner to position 0
  const winnerIdx = ecmBgs.indexOf(bestBg);
  if (winnerIdx > 0) {
    ecmBgs.splice(winnerIdx, 1);
    ecmBgs.unshift(bestBg);
  }

  // Step 6: Standard conversion (256 chars, single bg)
  onProgress('Converting', 'Standard mode (256 chars)...', 45);
  await yieldToUI();
  const stdResult = findOptimalPetscii(
    'standard', srcData, palette, ref, bestBg, [], settings, null
  );

  // Step 7: ECM conversion (64 chars, 4 bg colors)
  onProgress('Converting', 'ECM mode (64 chars, 4 backgrounds)...', 70);
  await yieldToUI();
  const ecmResult = findOptimalPetscii(
    'ecm', srcData, palette, ref, undefined, ecmBgs, settings, null
  );

  // Step 8: Render previews
  onProgress('Rendering', 'Generating previews...', 90);
  await yieldToUI();
  const previewStd = renderPreview(stdResult, palette, ref, bestBg, [], 'standard');
  const previewEcm = renderPreview(ecmResult, palette, ref, bestBg, ecmBgs, 'ecm');

  onProgress('Done', '', 100);

  return {
    standard: {
      screencodes: stdResult.screencodes,
      colors: stdResult.colors,
      backgroundColor: bestBg,
      ecmBgColors: [],
      bgIndices: [],
      mode: 'standard',
    },
    ecm: {
      screencodes: ecmResult.screencodes,
      colors: ecmResult.colors,
      backgroundColor: ecmBgs[0],
      ecmBgColors: ecmBgs,
      bgIndices: ecmResult.bgIndices,
      mode: 'ecm',
    },
    previewStd,
    previewEcm,
  };
}
