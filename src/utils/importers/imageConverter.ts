// Image-to-PETSCII converter
// Quality-first Standard / ECM / MCM conversion within stock ROM PETSCII.

import { C64_PALETTES } from '../c64Palettes';
import { mcmForegroundColor, mcmIsMulticolorCell, mcmResolveBitPairColor } from '../mcm';
import {
  buildAlignmentOffsets as buildStandardAlignmentOffsets,
  ConversionCancelledError,
  solveStandardOffset,
} from './imageConverterStandardCore';
import type { StandardSolvedModeCandidate } from './imageConverterStandardCore';
import {
  disposeStandardConverterWorkers,
  runStandardConversionInWorkers,
} from './imageConverterStandardWorkerPool';

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 200;
const CELL_WIDTH = 8;
const CELL_HEIGHT = 8;
const GRID_WIDTH = 40;
const GRID_HEIGHT = 25;
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const PIXELS_PER_CELL = CELL_WIDTH * CELL_HEIGHT;
const MCM_PIXELS_PER_CELL = 32;

const ECM_SAMPLE_COUNT = 96;
const MCM_SAMPLE_COUNT = 24;
const ECM_FINALIST_COUNT = 8;
const MCM_FINALIST_COUNT = 6;
const ECM_POOL_SIZE = 6;
const MCM_POOL_SIZE = 6;
const SCREEN_SOLVE_PASSES = 5;

const LUMA_ERROR_WEIGHT = 1.55;
const CHROMA_ERROR_WEIGHT = 0.85;
const REPEAT_PENALTY = 28.0;
const CONTINUITY_PENALTY = 0.14;
const MODE_SWITCH_PENALTY = 10.0;
const MODE_SWITCH_DIFF_THRESHOLD = 3.5;

// --- Color Science ---

interface PerceptualColor { L: number; a: number; b: number; }

function srgbChannelToLinear(value: number): number {
  const scaled = value / 255;
  return scaled > 0.04045 ? Math.pow((scaled + 0.055) / 1.055, 2.4) : scaled / 12.92;
}

function linearToOklab(r: number, g: number, b: number): PerceptualColor {
  const l = Math.cbrt(Math.max(0, 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b));
  const m = Math.cbrt(Math.max(0, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b));
  const s = Math.cbrt(Math.max(0, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b));

  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

function sRGBtoOklab(r: number, g: number, b: number): PerceptualColor {
  return linearToOklab(
    srgbChannelToLinear(r),
    srgbChannelToLinear(g),
    srgbChannelToLinear(b)
  );
}

function perceptualError(
  L0: number,
  a0: number,
  b0: number,
  L1: number,
  a1: number,
  b1: number
): number {
  const dL = L0 - L1;
  const da = a0 - a1;
  const db = b0 - b1;
  return LUMA_ERROR_WEIGHT * dL * dL + CHROMA_ERROR_WEIGHT * (da * da + db * db);
}

function adjustedPixelToPerceptual(
  r: number,
  g: number,
  b: number,
  settings: ConverterSettings
): PerceptualColor {
  const rl = srgbChannelToLinear(r) * settings.brightnessFactor;
  const gl = srgbChannelToLinear(g) * settings.brightnessFactor;
  const bl = srgbChannelToLinear(b) * settings.brightnessFactor;
  const oklab = linearToOklab(rl, gl, bl);
  return {
    L: oklab.L,
    a: oklab.a * settings.saturationFactor,
    b: oklab.b * settings.saturationFactor,
  };
}

// --- Palettes ---

interface PaletteColor {
  r: number;
  g: number;
  b: number;
  L: number;
  a: number;
  b2: number;
}

export interface ConverterPalette {
  id: string;
  name: string;
  hex: string[];
}

export const PALETTES: ConverterPalette[] = C64_PALETTES;

function buildPaletteColors(hex: string[]): PaletteColor[] {
  return hex.map(h => {
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    const oklab = sRGBtoOklab(r, g, b);
    return { r, g, b, L: oklab.L, a: oklab.a, b2: oklab.b };
  });
}

interface PaletteMetricData {
  pL: Float64Array;
  pA: Float64Array;
  pB: Float64Array;
  pairDiff: Float64Array;
  maxPairDiff: number;
}

function buildPaletteMetricData(palette: PaletteColor[]): PaletteMetricData {
  const pL = new Float64Array(16);
  const pA = new Float64Array(16);
  const pB = new Float64Array(16);
  const pairDiff = new Float64Array(16 * 16);
  let maxPairDiff = 0;

  for (let i = 0; i < 16; i++) {
    pL[i] = palette[i].L;
    pA[i] = palette[i].a;
    pB[i] = palette[i].b2;
  }

  for (let a = 0; a < 16; a++) {
    for (let b = 0; b < 16; b++) {
      const diff = perceptualError(pL[a], pA[a], pB[a], pL[b], pA[b], pB[b]);
      pairDiff[a * 16 + b] = diff;
      if (diff > maxPairDiff) maxPairDiff = diff;
    }
  }

  return { pL, pA, pB, pairDiff, maxPairDiff: Math.max(maxPairDiff, 1) };
}

// --- Settings ---

export interface ConverterSettings {
  brightnessFactor: number;
  saturationFactor: number;
  saliencyAlpha: number;
  lumMatchWeight: number;
  paletteId: string;
  manualBgColor: number | null;
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
export type StandardAccelerationPath = 'wasm' | 'js';

export interface ConverterFontBits {
  upper: number[];
  lower: number[];
}

export interface ConversionResult {
  screencodes: number[];
  colors: number[];
  backgroundColor: number;
  ecmBgColors: number[];
  bgIndices: number[];
  mcmSharedColors: number[];
  charset: ConverterCharset;
  mode: 'standard' | 'ecm' | 'mcm';
  accelerationBackend?: StandardAccelerationPath;
}

export interface ConversionOutputs {
  standard?: ConversionResult;
  ecm?: ConversionResult;
  mcm?: ConversionResult;
  previewStd?: ImageData;
  previewEcm?: ImageData;
  previewMcm?: ImageData;
}

interface AlignmentOffset {
  x: number;
  y: number;
}

type BitPairPositionSets = [Uint8Array, Uint8Array, Uint8Array, Uint8Array];

interface CharsetConversionContext {
  ref: Uint8Array[];
  refSetCount: Int32Array;
  setPositions: Uint8Array[];
  refMcm?: Uint8Array[];
  refMcmBpCount?: Int32Array[];
  refMcmPositions?: BitPairPositionSets[];
}

interface SourceCellData {
  weightedPixelErrors: Float32Array; // 64 * 16
  totalErrByColor: Float32Array;     // 16
  weightedPairErrors?: Float32Array; // 32 * 16
  avgL: number;
}

interface SourceAnalysis {
  cells: SourceCellData[];
  colorCounts: number[];
  rankedIndices: Int32Array;
  hBoundaryDiffs: Float32Array;
  hBoundaryMeans: Float32Array;
  vBoundaryDiffs: Float32Array;
  vBoundaryMeans: Float32Array;
}

interface FittedImage {
  width: number;
  height: number;
  baseDx: number;
  baseDy: number;
  rgba: Uint8ClampedArray;
}

interface PreprocessedFittedImage {
  width: number;
  height: number;
  baseDx: number;
  baseDy: number;
  srcL: Float32Array;
  srcA: Float32Array;
  srcB: Float32Array;
  nearestPalette: Uint8Array;
}

type ScreenCandidateVariant = 'binary' | 'mcm';

interface ScreenCandidate {
  char: number;
  fg: number;
  bg: number;
  baseError: number;
  edgeLeft: Uint8Array;
  edgeRight: Uint8Array;
  edgeTop: Uint8Array;
  edgeBottom: Uint8Array;
  repeatH: number;
  repeatV: number;
  variant: ScreenCandidateVariant;
}

interface PetsciiResult {
  screencodes: number[];
  colors: number[];
  bgIndices: number[];
  totalError: number;
}

interface SolvedModeCandidate {
  result: PetsciiResult;
  conversion: ConversionResult;
  preview: ImageData;
  error: number;
}

// --- Reference Characters from ROM font ---

function buildRefChars(fontBits: number[]): Uint8Array[] {
  const ref: Uint8Array[] = [];
  for (let ch = 0; ch < 256; ch++) {
    const char = new Uint8Array(64);
    for (let row = 0; row < 8; row++) {
      const byte = fontBits[ch * 8 + row];
      for (let bit = 7; bit >= 0; bit--) {
        char[row * 8 + (7 - bit)] = (byte >> bit) & 1;
      }
    }
    ref.push(char);
  }
  return ref;
}

function buildSetPositions(ref: Uint8Array[]): Uint8Array[] {
  return ref.map(char => {
    const positions: number[] = [];
    for (let i = 0; i < char.length; i++) {
      if (char[i]) positions.push(i);
    }
    return Uint8Array.from(positions);
  });
}

function buildRefMcmData(ref: Uint8Array[]): {
  refMcm: Uint8Array[];
  refMcmBpCount: Int32Array[];
  refMcmPositions: BitPairPositionSets[];
} {
  const refMcm: Uint8Array[] = [];
  const refMcmBpCount: Int32Array[] = [];
  const refMcmPositions: BitPairPositionSets[] = [];

  for (let ch = 0; ch < 256; ch++) {
    const bits = new Uint8Array(32);
    const counts = new Int32Array(4);
    const posLists: number[][] = [[], [], [], []];

    for (let py = 0; py < 8; py++) {
      for (let mpx = 0; mpx < 4; mpx++) {
        const left = ref[ch][py * 8 + mpx * 2];
        const right = ref[ch][py * 8 + mpx * 2 + 1];
        const bitPair = (left << 1) | right;
        const idx = py * 4 + mpx;
        bits[idx] = bitPair;
        counts[bitPair]++;
        posLists[bitPair].push(idx);
      }
    }

    refMcm.push(bits);
    refMcmBpCount.push(counts);
    refMcmPositions.push([
      Uint8Array.from(posLists[0]),
      Uint8Array.from(posLists[1]),
      Uint8Array.from(posLists[2]),
      Uint8Array.from(posLists[3]),
    ]);
  }

  return { refMcm, refMcmBpCount, refMcmPositions };
}

function buildCharsetConversionContext(fontBits: number[], includeMcm: boolean): CharsetConversionContext {
  const ref = buildRefChars(fontBits);
  const setPositions = buildSetPositions(ref);
  const refSetCount = new Int32Array(setPositions.map(positions => positions.length));
  if (!includeMcm) {
    return { ref, refSetCount, setPositions };
  }
  const { refMcm, refMcmBpCount, refMcmPositions } = buildRefMcmData(ref);
  return { ref, refSetCount, setPositions, refMcm, refMcmBpCount, refMcmPositions };
}

// --- Image Resize / Preprocessing ---

function setHighQualitySmoothing(ctx: CanvasRenderingContext2D) {
  ctx.imageSmoothingEnabled = true;
  try {
    ctx.imageSmoothingQuality = 'high';
  } catch {
    // no-op
  }
}

function fitImageToCanvas(img: HTMLImageElement): FittedImage {
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = img.width;
  baseCanvas.height = img.height;
  const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true })!;
  setHighQualitySmoothing(baseCtx);
  baseCtx.drawImage(img, 0, 0);

  const ow = img.width;
  const oh = img.height;
  let targetW = CANVAS_WIDTH;
  let targetH = Math.round((oh * CANVAS_WIDTH) / ow);
  if (targetH > CANVAS_HEIGHT) {
    targetH = CANVAS_HEIGHT;
    targetW = Math.round((ow * CANVAS_HEIGHT) / oh);
  }

  let workingCanvas = baseCanvas;
  let workingW = baseCanvas.width;
  let workingH = baseCanvas.height;

  while (workingW / 2 >= targetW && workingH / 2 >= targetH) {
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = Math.max(targetW, Math.floor(workingW / 2));
    nextCanvas.height = Math.max(targetH, Math.floor(workingH / 2));
    const nextCtx = nextCanvas.getContext('2d', { willReadFrequently: true })!;
    setHighQualitySmoothing(nextCtx);
    nextCtx.drawImage(workingCanvas, 0, 0, workingW, workingH, 0, 0, nextCanvas.width, nextCanvas.height);
    workingCanvas = nextCanvas;
    workingW = nextCanvas.width;
    workingH = nextCanvas.height;
  }

  if (workingW !== targetW || workingH !== targetH) {
    const fittedCanvas = document.createElement('canvas');
    fittedCanvas.width = targetW;
    fittedCanvas.height = targetH;
    const fittedCtx = fittedCanvas.getContext('2d', { willReadFrequently: true })!;
    setHighQualitySmoothing(fittedCtx);
    fittedCtx.drawImage(workingCanvas, 0, 0, workingW, workingH, 0, 0, targetW, targetH);
    workingCanvas = fittedCanvas;
  }

  const fittedCtx = workingCanvas.getContext('2d', { willReadFrequently: true })!;
  return {
    width: targetW,
    height: targetH,
    baseDx: Math.round((CANVAS_WIDTH - targetW) / 2),
    baseDy: Math.round((CANVAS_HEIGHT - targetH) / 2),
    rgba: fittedCtx.getImageData(0, 0, targetW, targetH).data,
  };
}

function preprocessFittedImage(
  fitted: FittedImage,
  paletteMetrics: PaletteMetricData,
  settings: ConverterSettings
): PreprocessedFittedImage {
  const totalPixels = fitted.width * fitted.height;
  const srcL = new Float32Array(totalPixels);
  const srcA = new Float32Array(totalPixels);
  const srcB = new Float32Array(totalPixels);
  const nearestPalette = new Uint8Array(totalPixels);

  for (let i = 0, pixel = 0; pixel < totalPixels; i += 4, pixel++) {
    const color = adjustedPixelToPerceptual(fitted.rgba[i], fitted.rgba[i + 1], fitted.rgba[i + 2], settings);
    srcL[pixel] = color.L;
    srcA[pixel] = color.a;
    srcB[pixel] = color.b;

    let best = 0;
    let bestErr = Infinity;
    for (let c = 0; c < 16; c++) {
      const err = perceptualError(color.L, color.a, color.b, paletteMetrics.pL[c], paletteMetrics.pA[c], paletteMetrics.pB[c]);
      if (err < bestErr) {
        bestErr = err;
        best = c;
      }
    }
    nearestPalette[pixel] = best;
  }

  return {
    width: fitted.width,
    height: fitted.height,
    baseDx: fitted.baseDx,
    baseDy: fitted.baseDy,
    srcL,
    srcA,
    srcB,
    nearestPalette,
  };
}

function analyzeAlignedSourceImage(
  preprocessed: PreprocessedFittedImage,
  paletteMetrics: PaletteMetricData,
  settings: ConverterSettings,
  includeMcm: boolean,
  offsetX: number,
  offsetY: number
): SourceAnalysis {
  const srcL = new Float32Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  const srcA = new Float32Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  const srcB = new Float32Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  const colorCounts = new Array(16).fill(0);

  const dx = preprocessed.baseDx + offsetX;
  const dy = preprocessed.baseDy + offsetY;
  const destX0 = Math.max(0, dx);
  const destY0 = Math.max(0, dy);
  const destX1 = Math.min(CANVAS_WIDTH, dx + preprocessed.width);
  const destY1 = Math.min(CANVAS_HEIGHT, dy + preprocessed.height);
  const copyWidth = Math.max(0, destX1 - destX0);
  const copyHeight = Math.max(0, destY1 - destY0);

  colorCounts[0] = CANVAS_WIDTH * CANVAS_HEIGHT - (copyWidth * copyHeight);

  if (copyWidth > 0 && copyHeight > 0) {
    const srcX0 = destX0 - dx;
    const srcY0 = destY0 - dy;
    for (let row = 0; row < copyHeight; row++) {
      const srcBase = (srcY0 + row) * preprocessed.width + srcX0;
      const destBase = (destY0 + row) * CANVAS_WIDTH + destX0;
      srcL.set(preprocessed.srcL.subarray(srcBase, srcBase + copyWidth), destBase);
      srcA.set(preprocessed.srcA.subarray(srcBase, srcBase + copyWidth), destBase);
      srcB.set(preprocessed.srcB.subarray(srcBase, srcBase + copyWidth), destBase);
      for (let x = 0; x < copyWidth; x++) {
        colorCounts[preprocessed.nearestPalette[srcBase + x]]++;
      }
    }
  }

  const hBoundaryDiffs = new Float32Array(GRID_HEIGHT * (GRID_WIDTH - 1) * 8);
  const hBoundaryMeans = new Float32Array(GRID_HEIGHT * (GRID_WIDTH - 1));
  for (let cy = 0; cy < GRID_HEIGHT; cy++) {
    for (let cx = 0; cx < GRID_WIDTH - 1; cx++) {
      const edgeIndex = cy * (GRID_WIDTH - 1) + cx;
      let sum = 0;
      for (let row = 0; row < 8; row++) {
        const leftPixel = (cy * 8 + row) * CANVAS_WIDTH + (cx * 8 + 7);
        const rightPixel = leftPixel + 1;
        const diff = perceptualError(
          srcL[leftPixel], srcA[leftPixel], srcB[leftPixel],
          srcL[rightPixel], srcA[rightPixel], srcB[rightPixel]
        );
        hBoundaryDiffs[edgeIndex * 8 + row] = diff;
        sum += diff;
      }
      hBoundaryMeans[edgeIndex] = sum / 8;
    }
  }

  const vBoundaryDiffs = new Float32Array((GRID_HEIGHT - 1) * GRID_WIDTH * 8);
  const vBoundaryMeans = new Float32Array((GRID_HEIGHT - 1) * GRID_WIDTH);
  for (let cy = 0; cy < GRID_HEIGHT - 1; cy++) {
    for (let cx = 0; cx < GRID_WIDTH; cx++) {
      const edgeIndex = cy * GRID_WIDTH + cx;
      let sum = 0;
      for (let col = 0; col < 8; col++) {
        const topPixel = (cy * 8 + 7) * CANVAS_WIDTH + (cx * 8 + col);
        const bottomPixel = topPixel + CANVAS_WIDTH;
        const diff = perceptualError(
          srcL[topPixel], srcA[topPixel], srcB[topPixel],
          srcL[bottomPixel], srcA[bottomPixel], srcB[bottomPixel]
        );
        vBoundaryDiffs[edgeIndex * 8 + col] = diff;
        sum += diff;
      }
      vBoundaryMeans[edgeIndex] = sum / 8;
    }
  }

  const cells = new Array<SourceCellData>(CELL_COUNT);
  const variances = new Float64Array(CELL_COUNT);

  for (let cy = 0; cy < GRID_HEIGHT; cy++) {
    for (let cx = 0; cx < GRID_WIDTH; cx++) {
      const cellIndex = cy * GRID_WIDTH + cx;
      const pixelIndices = new Int32Array(PIXELS_PER_CELL);

      let meanL = 0;
      let meanA = 0;
      let meanB = 0;
      let lumSum = 0;
      let lumSqSum = 0;

      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const p = py * 8 + px;
          const pixelIndex = (cy * 8 + py) * CANVAS_WIDTH + (cx * 8 + px);
          pixelIndices[p] = pixelIndex;
          meanL += srcL[pixelIndex];
          meanA += srcA[pixelIndex];
          meanB += srcB[pixelIndex];
          lumSum += srcL[pixelIndex];
          lumSqSum += srcL[pixelIndex] * srcL[pixelIndex];
        }
      }

      meanL /= PIXELS_PER_CELL;
      meanA /= PIXELS_PER_CELL;
      meanB /= PIXELS_PER_CELL;
      const variance = lumSqSum / PIXELS_PER_CELL - (lumSum / PIXELS_PER_CELL) ** 2;
      variances[cellIndex] = variance;

      const weights = new Float32Array(PIXELS_PER_CELL);
      if (settings.saliencyAlpha > 0) {
        let maxDev = 0;
        for (let p = 0; p < PIXELS_PER_CELL; p++) {
          const pixelIndex = pixelIndices[p];
          const dev = Math.sqrt(
            perceptualError(srcL[pixelIndex], srcA[pixelIndex], srcB[pixelIndex], meanL, meanA, meanB)
          );
          weights[p] = dev;
          if (dev > maxDev) maxDev = dev;
        }
        if (maxDev > 0) {
          for (let p = 0; p < PIXELS_PER_CELL; p++) {
            weights[p] = 1 + settings.saliencyAlpha * (weights[p] / maxDev);
          }
        } else {
          weights.fill(1);
        }
      } else {
        weights.fill(1);
      }

      const weightedPixelErrors = new Float32Array(PIXELS_PER_CELL * 16);
      const totalErrByColor = new Float32Array(16);
      for (let p = 0; p < PIXELS_PER_CELL; p++) {
        const pixelIndex = pixelIndices[p];
        const base = p * 16;
        for (let c = 0; c < 16; c++) {
          const err = weights[p] * perceptualError(
            srcL[pixelIndex], srcA[pixelIndex], srcB[pixelIndex],
            paletteMetrics.pL[c], paletteMetrics.pA[c], paletteMetrics.pB[c]
          );
          weightedPixelErrors[base + c] = err;
          totalErrByColor[c] += err;
        }
      }

      let weightedPairErrors: Float32Array | undefined;
      if (includeMcm) {
        weightedPairErrors = new Float32Array(MCM_PIXELS_PER_CELL * 16);
        for (let py = 0; py < 8; py++) {
          for (let mpx = 0; mpx < 4; mpx++) {
            const p0 = py * 8 + mpx * 2;
            const p1 = p0 + 1;
            const pairIndex = py * 4 + mpx;
            const source0 = pixelIndices[p0];
            const source1 = pixelIndices[p1];
            const pairL = (srcL[source0] + srcL[source1]) * 0.5;
            const pairA = (srcA[source0] + srcA[source1]) * 0.5;
            const pairB = (srcB[source0] + srcB[source1]) * 0.5;
            const pairWeight = (weights[p0] + weights[p1]) * 0.5;
            const base = pairIndex * 16;
            for (let c = 0; c < 16; c++) {
              weightedPairErrors[base + c] = pairWeight * perceptualError(
                pairL, pairA, pairB,
                paletteMetrics.pL[c], paletteMetrics.pA[c], paletteMetrics.pB[c]
              );
            }
          }
        }
      }

      cells[cellIndex] = {
        weightedPixelErrors,
        totalErrByColor,
        weightedPairErrors,
        avgL: meanL,
      };
    }
  }

  const order = Array.from({ length: CELL_COUNT }, (_, index) => index);
  order.sort((a, b) => variances[b] - variances[a]);
  const rankedIndices = Int32Array.from(order);

  return {
    cells,
    colorCounts,
    rankedIndices,
    hBoundaryDiffs,
    hBoundaryMeans,
    vBoundaryDiffs,
    vBoundaryMeans,
  };
}

// --- Search helpers ---

function createScopedProgress(
  onProgress: ProgressCallback,
  progressStart: number,
  progressSpan: number
): ProgressCallback {
  return (stage, detail, pct) => {
    const scopedPct = progressStart + Math.round((pct / 100) * progressSpan);
    onProgress(stage, detail, scopedPct);
  };
}

export { ConversionCancelledError } from './imageConverterStandardCore';
export { disposeStandardConverterWorkers } from './imageConverterStandardWorkerPool';

function throwIfCancelled(shouldCancel?: () => boolean) {
  if (shouldCancel?.()) {
    throw new ConversionCancelledError();
  }
}

async function yieldToUI(shouldCancel?: () => boolean): Promise<void> {
  throwIfCancelled(shouldCancel);
  await new Promise(resolve => setTimeout(resolve, 0));
  throwIfCancelled(shouldCancel);
}

function insertTopCandidate(pool: ScreenCandidate[], candidate: ScreenCandidate, limit: number) {
  const existing = pool.findIndex(
    entry =>
      entry.char === candidate.char &&
      entry.fg === candidate.fg &&
      entry.bg === candidate.bg &&
      entry.variant === candidate.variant
  );
  if (existing >= 0) {
    if (candidate.baseError >= pool[existing].baseError) {
      return;
    }
    pool.splice(existing, 1);
  } else if (pool.length >= limit && candidate.baseError >= pool[pool.length - 1].baseError) {
    return;
  }

  let insertAt = pool.length;
  while (insertAt > 0 && candidate.baseError < pool[insertAt - 1].baseError) {
    insertAt--;
  }
  pool.splice(insertAt, 0, candidate);
  if (pool.length > limit) {
    pool.length = limit;
  }
}

function buildBinaryEdges(mask: Uint8Array, bg: number, fg: number): Pick<ScreenCandidate, 'edgeLeft' | 'edgeRight' | 'edgeTop' | 'edgeBottom'> {
  const edgeLeft = new Uint8Array(8);
  const edgeRight = new Uint8Array(8);
  const edgeTop = new Uint8Array(8);
  const edgeBottom = new Uint8Array(8);

  for (let i = 0; i < 8; i++) {
    edgeLeft[i] = mask[i * 8] ? fg : bg;
    edgeRight[i] = mask[i * 8 + 7] ? fg : bg;
    edgeTop[i] = mask[i] ? fg : bg;
    edgeBottom[i] = mask[56 + i] ? fg : bg;
  }

  return { edgeLeft, edgeRight, edgeTop, edgeBottom };
}

function buildMcmEdges(bits: Uint8Array, bg: number, mc1: number, mc2: number, fg: number): Pick<ScreenCandidate, 'edgeLeft' | 'edgeRight' | 'edgeTop' | 'edgeBottom'> {
  const edgeLeft = new Uint8Array(8);
  const edgeRight = new Uint8Array(8);
  const edgeTop = new Uint8Array(8);
  const edgeBottom = new Uint8Array(8);

  const resolve = (bitPair: number) => (
    bitPair === 0 ? bg : bitPair === 1 ? mc1 : bitPair === 2 ? mc2 : fg
  );

  for (let row = 0; row < 8; row++) {
    const leftColor = resolve(bits[row * 4]);
    const rightColor = resolve(bits[row * 4 + 3]);
    edgeLeft[row] = leftColor;
    edgeRight[row] = rightColor;
  }

  for (let mpx = 0; mpx < 4; mpx++) {
    const topColor = resolve(bits[mpx]);
    const bottomColor = resolve(bits[28 + mpx]);
    edgeTop[mpx * 2] = topColor;
    edgeTop[mpx * 2 + 1] = topColor;
    edgeBottom[mpx * 2] = bottomColor;
    edgeBottom[mpx * 2 + 1] = bottomColor;
  }

  return { edgeLeft, edgeRight, edgeTop, edgeBottom };
}

function computeSelfTileScale(
  first: Uint8Array,
  second: Uint8Array,
  pairDiff: Float64Array,
  maxPairDiff: number
): number {
  let total = 0;
  for (let i = 0; i < first.length; i++) {
    total += pairDiff[first[i] * 16 + second[i]];
  }
  return total / (first.length * maxPairDiff);
}

function makeBinaryCandidate(
  mask: Uint8Array,
  char: number,
  bg: number,
  fg: number,
  baseError: number,
  pairDiff: Float64Array,
  maxPairDiff: number
): ScreenCandidate {
  const edges = buildBinaryEdges(mask, bg, fg);
  return {
    char,
    fg,
    bg,
    baseError,
    ...edges,
    repeatH: computeSelfTileScale(edges.edgeRight, edges.edgeLeft, pairDiff, maxPairDiff),
    repeatV: computeSelfTileScale(edges.edgeBottom, edges.edgeTop, pairDiff, maxPairDiff),
    variant: 'binary',
  };
}

function makeMcmCandidate(
  bits: Uint8Array,
  char: number,
  colorRam: number,
  bg: number,
  mc1: number,
  mc2: number,
  baseError: number,
  pairDiff: Float64Array,
  maxPairDiff: number
): ScreenCandidate {
  const fg = mcmForegroundColor(colorRam);
  const edges = buildMcmEdges(bits, bg, mc1, mc2, fg);
  return {
    char,
    fg: colorRam,
    bg,
    baseError,
    ...edges,
    repeatH: computeSelfTileScale(edges.edgeRight, edges.edgeLeft, pairDiff, maxPairDiff),
    repeatV: computeSelfTileScale(edges.edgeBottom, edges.edgeTop, pairDiff, maxPairDiff),
    variant: 'mcm',
  };
}

function buildBackgroundColorList(): number[] {
  return Array.from({ length: 16 }, (_, color) => color);
}

function buildEcmBackgroundSets(manualBg: number | null): number[][] {
  const sets: number[][] = [];
  const colors = buildBackgroundColorList();
  if (manualBg !== null) {
    const remaining = colors.filter(color => color !== manualBg);
    for (let a = 0; a < remaining.length - 2; a++) {
      for (let b = a + 1; b < remaining.length - 1; b++) {
        for (let c = b + 1; c < remaining.length; c++) {
          sets.push([manualBg, remaining[a], remaining[b], remaining[c]]);
        }
      }
    }
    return sets;
  }

  for (let a = 0; a < colors.length - 3; a++) {
    for (let b = a + 1; b < colors.length - 2; b++) {
      for (let c = b + 1; c < colors.length - 1; c++) {
        for (let d = c + 1; d < colors.length; d++) {
          sets.push([colors[a], colors[b], colors[c], colors[d]]);
        }
      }
    }
  }

  return sets;
}

function buildMcmTriples(manualBg: number | null): [number, number, number][] {
  const triples: [number, number, number][] = [];
  const colors = buildBackgroundColorList();

  for (let bg = 0; bg < 16; bg++) {
    if (manualBg !== null && bg !== manualBg) continue;
    for (let mc1 = 0; mc1 < 16; mc1++) {
      if (mc1 === bg) continue;
      for (let mc2 = 0; mc2 < 16; mc2++) {
        if (mc2 === bg || mc2 === mc1) continue;
        triples.push([bg, mc1, mc2]);
      }
    }
  }

  return triples;
}

function getSampleIndices(rankedIndices: Int32Array, count: number): number[] {
  return Array.from(rankedIndices.slice(0, Math.min(count, rankedIndices.length)));
}

function hBoundaryOffset(cy: number, cx: number): number {
  return (cy * (GRID_WIDTH - 1) + cx) * 8;
}

function hBoundaryMeanOffset(cy: number, cx: number): number {
  return cy * (GRID_WIDTH - 1) + cx;
}

function vBoundaryOffset(cy: number, cx: number): number {
  return (cy * GRID_WIDTH + cx) * 8;
}

function vBoundaryMeanOffset(cy: number, cx: number): number {
  return cy * GRID_WIDTH + cx;
}

function buildBinaryBestErrorByBackground(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number,
  fgLimit: number
): Float64Array {
  const best = new Float64Array(16);
  best.fill(Infinity);
  const setErr = new Float64Array(16);

  for (let ch = 0; ch < charLimit; ch++) {
    setErr.fill(0);
    const positions = context.setPositions[ch];
    for (let i = 0; i < positions.length; i++) {
      const base = positions[i] * 16;
      for (let color = 0; color < 16; color++) {
        setErr[color] += cell.weightedPixelErrors[base + color];
      }
    }

    const nSet = context.refSetCount[ch];
    for (let bg = 0; bg < 16; bg++) {
      const bgErr = cell.totalErrByColor[bg] - setErr[bg];
      if (bgErr >= best[bg]) continue;
      for (let fg = 0; fg < fgLimit; fg++) {
        if (fg === bg) continue;
        const renderedAvgL = (nSet * metrics.pL[fg] + (PIXELS_PER_CELL - nSet) * metrics.pL[bg]) / PIXELS_PER_CELL;
        const lumDiff = cell.avgL - renderedAvgL;
        const total = bgErr + setErr[fg] + settings.lumMatchWeight * lumDiff * lumDiff;
        if (total < best[bg]) best[bg] = total;
      }
    }
  }

  return best;
}

function buildBinaryCandidatePool(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number,
  backgrounds: number[],
  fgLimit: number,
  poolSize: number
): ScreenCandidate[] {
  const pool: ScreenCandidate[] = [];
  const setErr = new Float64Array(16);

  for (let ch = 0; ch < charLimit; ch++) {
    setErr.fill(0);
    const positions = context.setPositions[ch];
    for (let i = 0; i < positions.length; i++) {
      const base = positions[i] * 16;
      for (let color = 0; color < 16; color++) {
        setErr[color] += cell.weightedPixelErrors[base + color];
      }
    }

    const nSet = context.refSetCount[ch];
    const worst = pool.length >= poolSize ? pool[pool.length - 1].baseError : Infinity;

    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const bgErr = cell.totalErrByColor[bg] - setErr[bg];
      if (bgErr >= worst) continue;

      for (let fg = 0; fg < fgLimit; fg++) {
        if (fg === bg) continue;
        const renderedAvgL = (nSet * metrics.pL[fg] + (PIXELS_PER_CELL - nSet) * metrics.pL[bg]) / PIXELS_PER_CELL;
        const lumDiff = cell.avgL - renderedAvgL;
        const total = bgErr + setErr[fg] + settings.lumMatchWeight * lumDiff * lumDiff;
        if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
          insertTopCandidate(pool, makeBinaryCandidate(context.ref[ch], ch, bg, fg, total, metrics.pairDiff, metrics.maxPairDiff), poolSize);
        }
      }
    }
  }

  if (pool.length > 0) return pool;
  const bg = backgrounds[0] ?? 0;
  const fg = bg === 0 ? 1 : 0;
  return [makeBinaryCandidate(context.ref[32], 32, bg, fg, Infinity, metrics.pairDiff, metrics.maxPairDiff)];
}

interface McmSampleSummary {
  hiresSetErrByChar: Float32Array; // 256 * 16
  mcmBpErrByChar: Float32Array;    // 256 * 4 * 16
  avgL: number;
  totalErrByColor: Float32Array;
}

function buildMcmSampleSummary(cell: SourceCellData, context: CharsetConversionContext): McmSampleSummary {
  const hiresSetErrByChar = new Float32Array(256 * 16);
  const mcmBpErrByChar = new Float32Array(256 * 4 * 16);

  for (let ch = 0; ch < 256; ch++) {
    const setPositions = context.setPositions[ch];
    for (let i = 0; i < setPositions.length; i++) {
      const base = setPositions[i] * 16;
      const out = ch * 16;
      for (let color = 0; color < 16; color++) {
        hiresSetErrByChar[out + color] += cell.weightedPixelErrors[base + color];
      }
    }

    const bpPositions = context.refMcmPositions![ch];
    for (let bp = 0; bp < 4; bp++) {
      const positions = bpPositions[bp];
      const out = (ch * 4 + bp) * 16;
      for (let i = 0; i < positions.length; i++) {
        const base = positions[i] * 16;
        for (let color = 0; color < 16; color++) {
          mcmBpErrByChar[out + color] += cell.weightedPairErrors![base + color];
        }
      }
    }
  }

  return {
    hiresSetErrByChar,
    mcmBpErrByChar,
    avgL: cell.avgL,
    totalErrByColor: cell.totalErrByColor,
  };
}

function scoreMcmTripleOnSample(
  summary: McmSampleSummary,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  bg: number,
  mc1: number,
  mc2: number
): number {
  let best = Infinity;

  for (let ch = 0; ch < 256; ch++) {
    const hiresBase = ch * 16;
    const bgErr = summary.totalErrByColor[bg] - summary.hiresSetErrByChar[hiresBase + bg];
    if (bgErr < best) {
      const nSet = context.refSetCount[ch];
      for (let fg = 0; fg < 8; fg++) {
        if (fg === bg) continue;
        const renderedAvgL = (nSet * metrics.pL[fg] + (PIXELS_PER_CELL - nSet) * metrics.pL[bg]) / PIXELS_PER_CELL;
        const lumDiff = summary.avgL - renderedAvgL;
        const total = bgErr + summary.hiresSetErrByChar[hiresBase + fg] + settings.lumMatchWeight * lumDiff * lumDiff;
        if (total < best) best = total;
      }
    }

    const bpBase = ch * 64;
    const fixedErr =
      summary.mcmBpErrByChar[bpBase + bg] +
      summary.mcmBpErrByChar[bpBase + 16 + mc1] +
      summary.mcmBpErrByChar[bpBase + 32 + mc2];

    if (2 * fixedErr < best) {
      const counts = context.refMcmBpCount![ch];
      const bp3Base = bpBase + 48;
      for (let fg = 0; fg < 8; fg++) {
        const renderedAvgL =
          (counts[0] * metrics.pL[bg] +
           counts[1] * metrics.pL[mc1] +
           counts[2] * metrics.pL[mc2] +
           counts[3] * metrics.pL[fg]) / MCM_PIXELS_PER_CELL;
        const lumDiff = summary.avgL - renderedAvgL;
        const total = 2 * (fixedErr + summary.mcmBpErrByChar[bp3Base + fg]) +
          settings.lumMatchWeight * lumDiff * lumDiff;
        if (total < best) best = total;
      }
    }
  }

  return best;
}

function buildMcmCandidatePool(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  bg: number,
  mc1: number,
  mc2: number,
  poolSize: number
): ScreenCandidate[] {
  const pool: ScreenCandidate[] = [];
  const setErr = new Float64Array(16);
  const fgErr = new Float64Array(8);

  for (let ch = 0; ch < 256; ch++) {
    setErr.fill(0);
    const setPositions = context.setPositions[ch];
    for (let i = 0; i < setPositions.length; i++) {
      const base = setPositions[i] * 16;
      for (let color = 0; color < 16; color++) {
        setErr[color] += cell.weightedPixelErrors[base + color];
      }
    }

    const bgErr = cell.totalErrByColor[bg] - setErr[bg];
    if (pool.length < poolSize || bgErr < pool[pool.length - 1].baseError) {
      const nSet = context.refSetCount[ch];
      for (let fg = 0; fg < 8; fg++) {
        if (fg === bg) continue;
        const renderedAvgL = (nSet * metrics.pL[fg] + (PIXELS_PER_CELL - nSet) * metrics.pL[bg]) / PIXELS_PER_CELL;
        const lumDiff = cell.avgL - renderedAvgL;
        const total = bgErr + setErr[fg] + settings.lumMatchWeight * lumDiff * lumDiff;
        if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
          insertTopCandidate(pool, makeBinaryCandidate(context.ref[ch], ch, bg, fg, total, metrics.pairDiff, metrics.maxPairDiff), poolSize);
        }
      }
    }

    fgErr.fill(0);
    const bpPositions = context.refMcmPositions![ch];
    let fixedErr = 0;
    for (let i = 0; i < bpPositions[0].length; i++) fixedErr += cell.weightedPairErrors![bpPositions[0][i] * 16 + bg];
    for (let i = 0; i < bpPositions[1].length; i++) fixedErr += cell.weightedPairErrors![bpPositions[1][i] * 16 + mc1];
    for (let i = 0; i < bpPositions[2].length; i++) fixedErr += cell.weightedPairErrors![bpPositions[2][i] * 16 + mc2];
    for (let i = 0; i < bpPositions[3].length; i++) {
      const base = bpPositions[3][i] * 16;
      for (let fg = 0; fg < 8; fg++) {
        fgErr[fg] += cell.weightedPairErrors![base + fg];
      }
    }

    if (pool.length < poolSize || 2 * fixedErr < pool[pool.length - 1].baseError) {
      const counts = context.refMcmBpCount![ch];
      for (let fg = 0; fg < 8; fg++) {
        const renderedAvgL =
          (counts[0] * metrics.pL[bg] +
           counts[1] * metrics.pL[mc1] +
           counts[2] * metrics.pL[mc2] +
           counts[3] * metrics.pL[fg]) / MCM_PIXELS_PER_CELL;
        const lumDiff = cell.avgL - renderedAvgL;
        const total = 2 * (fixedErr + fgErr[fg]) + settings.lumMatchWeight * lumDiff * lumDiff;
        if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
          insertTopCandidate(pool, makeMcmCandidate(context.refMcm![ch], ch, fg | 8, bg, mc1, mc2, total, metrics.pairDiff, metrics.maxPairDiff), poolSize);
        }
      }
    }
  }

  if (pool.length > 0) return pool;
  const fallbackFg = bg === 0 ? 1 : 0;
  return [makeBinaryCandidate(context.ref[32], 32, bg, fallbackFg, Infinity, metrics.pairDiff, metrics.maxPairDiff)];
}

// --- Screen-level solving ---

function computeNeighborPenalty(
  leftOrTop: ScreenCandidate,
  rightOrBottom: ScreenCandidate,
  metrics: PaletteMetricData,
  analysis: SourceAnalysis,
  boundaryCy: number,
  boundaryCx: number,
  horizontal: boolean
): number {
  const firstEdge = horizontal ? leftOrTop.edgeRight : leftOrTop.edgeBottom;
  const secondEdge = horizontal ? rightOrBottom.edgeLeft : rightOrBottom.edgeTop;
  const boundaryBase = horizontal
    ? hBoundaryOffset(boundaryCy, boundaryCx)
    : vBoundaryOffset(boundaryCy, boundaryCx);
  const boundaryDiffs = horizontal ? analysis.hBoundaryDiffs : analysis.vBoundaryDiffs;
  const boundaryMean = horizontal
    ? analysis.hBoundaryMeans[hBoundaryMeanOffset(boundaryCy, boundaryCx)]
    : analysis.vBoundaryMeans[vBoundaryMeanOffset(boundaryCy, boundaryCx)];

  let edgePenalty = 0;
  for (let i = 0; i < 8; i++) {
    const rendered = metrics.pairDiff[firstEdge[i] * 16 + secondEdge[i]];
    const desired = boundaryDiffs[boundaryBase + i];
    const delta = rendered - desired;
    edgePenalty += delta * delta;
  }

  let repeatPenalty = 0;
  if (leftOrTop.char === rightOrBottom.char && leftOrTop.variant === rightOrBottom.variant) {
    const scale = horizontal
      ? (leftOrTop.repeatH + rightOrBottom.repeatH) * 0.5
      : (leftOrTop.repeatV + rightOrBottom.repeatV) * 0.5;
    repeatPenalty = REPEAT_PENALTY * scale;
  }

  let modePenalty = 0;
  if (leftOrTop.variant !== rightOrBottom.variant) {
    const smoothness = Math.max(0, 1 - boundaryMean / MODE_SWITCH_DIFF_THRESHOLD);
    modePenalty = MODE_SWITCH_PENALTY * smoothness;
  }

  return CONTINUITY_PENALTY * (edgePenalty / 8) + repeatPenalty + modePenalty;
}

async function solveScreen(
  candidatePools: ScreenCandidate[][],
  analysis: SourceAnalysis,
  metrics: PaletteMetricData,
  shouldCancel?: () => boolean
): Promise<PetsciiResult & { selected: ScreenCandidate[] }> {
  const selectedIndices = new Int32Array(CELL_COUNT);
  const selected = new Array<ScreenCandidate>(CELL_COUNT);

  for (let i = 0; i < CELL_COUNT; i++) {
    selectedIndices[i] = 0;
    selected[i] = candidatePools[i][0];
  }

  for (let pass = 0; pass < SCREEN_SOLVE_PASSES; pass++) {
    let changed = false;
    const start = pass % 2 === 0 ? 0 : CELL_COUNT - 1;
    const end = pass % 2 === 0 ? CELL_COUNT : -1;
    const step = pass % 2 === 0 ? 1 : -1;
    let visitCount = 0;

    for (let cellIndex = start; cellIndex !== end; cellIndex += step) {
      const cx = cellIndex % GRID_WIDTH;
      const cy = Math.floor(cellIndex / GRID_WIDTH);
      const pool = candidatePools[cellIndex];
      let bestIdx = selectedIndices[cellIndex];
      let bestCost = Infinity;

      for (let candidateIndex = 0; candidateIndex < pool.length; candidateIndex++) {
        const candidate = pool[candidateIndex];
        let cost = candidate.baseError;

        if (cx > 0) {
          cost += computeNeighborPenalty(selected[cellIndex - 1], candidate, metrics, analysis, cy, cx - 1, true);
        }
        if (cx < GRID_WIDTH - 1) {
          cost += computeNeighborPenalty(candidate, selected[cellIndex + 1], metrics, analysis, cy, cx, true);
        }
        if (cy > 0) {
          cost += computeNeighborPenalty(selected[cellIndex - GRID_WIDTH], candidate, metrics, analysis, cy - 1, cx, false);
        }
        if (cy < GRID_HEIGHT - 1) {
          cost += computeNeighborPenalty(candidate, selected[cellIndex + GRID_WIDTH], metrics, analysis, cy, cx, false);
        }

        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = candidateIndex;
        }
      }

      if (bestIdx !== selectedIndices[cellIndex]) {
        selectedIndices[cellIndex] = bestIdx;
        selected[cellIndex] = pool[bestIdx];
        changed = true;
      }

      visitCount++;
      if ((visitCount & 127) === 0) {
        await yieldToUI(shouldCancel);
      }
    }
    if (!changed) break;
    await yieldToUI(shouldCancel);
  }

  const screencodes = new Array<number>(CELL_COUNT);
  const colors = new Array<number>(CELL_COUNT);
  const bgIndices = new Array<number>(CELL_COUNT).fill(0);
  let totalError = 0;

  for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex++) {
    const candidate = selected[cellIndex];
    screencodes[cellIndex] = candidate.char;
    colors[cellIndex] = candidate.fg;
    totalError += candidate.baseError;

    const cx = cellIndex % GRID_WIDTH;
    const cy = Math.floor(cellIndex / GRID_WIDTH);
    if (cx > 0) {
      totalError += computeNeighborPenalty(selected[cellIndex - 1], candidate, metrics, analysis, cy, cx - 1, true);
    }
    if (cy > 0) {
      totalError += computeNeighborPenalty(selected[cellIndex - GRID_WIDTH], candidate, metrics, analysis, cy - 1, cx, false);
    }
    if ((cellIndex & 255) === 0) {
      await yieldToUI(shouldCancel);
    }
  }

  return { screencodes, colors, bgIndices, totalError, selected };
}

// --- Mode solving ---

async function buildBinaryCandidatePools(
  cells: SourceCellData[],
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number,
  backgrounds: number[],
  fgLimit: number,
  poolSize: number,
  shouldCancel?: () => boolean
): Promise<ScreenCandidate[][]> {
  const candidatePools = new Array<ScreenCandidate[]>(cells.length);
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    candidatePools[cellIndex] = buildBinaryCandidatePool(
      cells[cellIndex], context, metrics, settings, charLimit, backgrounds, fgLimit, poolSize
    );
    if ((cellIndex & 127) === 0) {
      await yieldToUI(shouldCancel);
    }
  }
  return candidatePools;
}

async function buildMcmCandidatePools(
  cells: SourceCellData[],
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  bg: number,
  mc1: number,
  mc2: number,
  poolSize: number,
  shouldCancel?: () => boolean
): Promise<ScreenCandidate[][]> {
  const candidatePools = new Array<ScreenCandidate[]>(cells.length);
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    candidatePools[cellIndex] = buildMcmCandidatePool(
      cells[cellIndex], context, metrics, settings, bg, mc1, mc2, poolSize
    );
    if ((cellIndex & 127) === 0) {
      await yieldToUI(shouldCancel);
    }
  }
  return candidatePools;
}

function pickBetterModeCandidate(
  current: SolvedModeCandidate | undefined,
  next: SolvedModeCandidate
): SolvedModeCandidate {
  if (!current) return next;
  return next.error < current.error ? next : current;
}

function chooseOrderedEcmBackgrounds(
  backgrounds: number[],
  selected: ScreenCandidate[],
  manualBgColor: number | null
): number[] {
  if (manualBgColor !== null && backgrounds.includes(manualBgColor)) {
    return [manualBgColor, ...backgrounds.filter(color => color !== manualBgColor)];
  }
  const usage = new Map<number, number>();
  backgrounds.forEach(color => usage.set(color, 0));
  selected.forEach(candidate => usage.set(candidate.bg, (usage.get(candidate.bg) ?? 0) + 1));
  return backgrounds.slice().sort((a, b) => {
    const diff = (usage.get(b) ?? 0) - (usage.get(a) ?? 0);
    return diff !== 0 ? diff : a - b;
  });
}

async function solveEcmForCombo(
  analysis: SourceAnalysis,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  palette: PaletteColor[],
  onProgress: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate> {
  const backgroundSets = buildEcmBackgroundSets(settings.manualBgColor);
  const sampleIndices = getSampleIndices(analysis.rankedIndices, ECM_SAMPLE_COUNT);
  const sampleBestByCell = sampleIndices.map(cellIndex =>
    buildBinaryBestErrorByBackground(analysis.cells[cellIndex], context, metrics, settings, 64, 16)
  );

  const rankedSets = backgroundSets.map(set => {
    let score = 0;
    for (let i = 0; i < sampleBestByCell.length; i++) {
      const perBg = sampleBestByCell[i];
      score += Math.min(perBg[set[0]], perBg[set[1]], perBg[set[2]], perBg[set[3]]);
    }
    return { set, score };
  }).sort((a, b) => a.score - b.score)
    .slice(0, Math.min(ECM_FINALIST_COUNT, backgroundSets.length));

  let best: SolvedModeCandidate | undefined;
  for (let index = 0; index < rankedSets.length; index++) {
    const set = rankedSets[index].set;
    onProgress('Converting', `ECM backgrounds ${set.join(',')} (${index + 1}/${rankedSets.length})`, Math.round((index / Math.max(1, rankedSets.length)) * 100));
    await yieldToUI(shouldCancel);

    const candidatePools = await buildBinaryCandidatePools(
      analysis.cells, context, metrics, settings, 64, set, 16, ECM_POOL_SIZE, shouldCancel
    );
    const solved = await solveScreen(candidatePools, analysis, metrics, shouldCancel);
    const orderedBgs = chooseOrderedEcmBackgrounds(set, solved.selected, settings.manualBgColor);
    const bgMap = new Map<number, number>();
    orderedBgs.forEach((color, bgIndex) => bgMap.set(color, bgIndex));
    const bgIndices = solved.selected.map(candidate => bgMap.get(candidate.bg) ?? 0);

    const conversion: ConversionResult = {
      screencodes: solved.screencodes,
      colors: solved.colors,
      backgroundColor: orderedBgs[0],
      ecmBgColors: orderedBgs,
      bgIndices,
      mcmSharedColors: [],
      charset: 'upper',
      mode: 'ecm',
    };
    best = pickBetterModeCandidate(best, {
      result: { ...solved, bgIndices },
      conversion,
      preview: renderPreview({ ...solved, bgIndices }, palette, context.ref, orderedBgs[0], orderedBgs, 'ecm'),
      error: solved.totalError,
    });
  }

  return best!;
}

async function solveMcmForCombo(
  analysis: SourceAnalysis,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  palette: PaletteColor[],
  onProgress: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate> {
  const sampleIndices = getSampleIndices(analysis.rankedIndices, MCM_SAMPLE_COUNT);
  const sampleSummaries = sampleIndices.map(cellIndex => buildMcmSampleSummary(analysis.cells[cellIndex], context));
  const triples = buildMcmTriples(settings.manualBgColor);
  const rankedTriples = new Array<{ triple: [number, number, number]; score: number }>(triples.length);

  for (let tripleIndex = 0; tripleIndex < triples.length; tripleIndex++) {
    const [bg, mc1, mc2] = triples[tripleIndex];
    let score = 0;
    for (let sample = 0; sample < sampleSummaries.length; sample++) {
      score += scoreMcmTripleOnSample(sampleSummaries[sample], context, metrics, settings, bg, mc1, mc2);
    }
    rankedTriples[tripleIndex] = { triple: [bg, mc1, mc2], score };
    if (tripleIndex % 96 === 0) {
      onProgress(
        'MCM globals',
        `Coarse ${tripleIndex + 1} of ${triples.length} (bg=${bg}, mc1=${mc1}, mc2=${mc2})`,
        Math.round((tripleIndex / Math.max(1, triples.length)) * 100)
      );
      await yieldToUI(shouldCancel);
    }
  }

  rankedTriples.sort((a, b) => a.score - b.score);
  rankedTriples.length = Math.min(MCM_FINALIST_COUNT, rankedTriples.length);

  let best: SolvedModeCandidate | undefined;
  for (let finalistIndex = 0; finalistIndex < rankedTriples.length; finalistIndex++) {
    const [bg, mc1, mc2] = rankedTriples[finalistIndex].triple;
    onProgress(
      'Converting',
      `MCM bg=${bg}, mc1=${mc1}, mc2=${mc2} (${finalistIndex + 1}/${rankedTriples.length})`,
      Math.round((finalistIndex / Math.max(1, rankedTriples.length)) * 100)
    );
    await yieldToUI(shouldCancel);

    const candidatePools = await buildMcmCandidatePools(
      analysis.cells, context, metrics, settings, bg, mc1, mc2, MCM_POOL_SIZE, shouldCancel
    );
    const solved = await solveScreen(candidatePools, analysis, metrics, shouldCancel);
    const conversion: ConversionResult = {
      screencodes: solved.screencodes,
      colors: solved.colors,
      backgroundColor: bg,
      ecmBgColors: [],
      bgIndices: [],
      mcmSharedColors: [mc1, mc2],
      charset: 'upper',
      mode: 'mcm',
    };
    best = pickBetterModeCandidate(best, {
      result: solved,
      conversion,
      preview: renderMcmPreview(solved, palette, context.ref, context.refMcm!, bg, mc1, mc2),
      error: solved.totalError,
    });
  }

  return best!;
}

// --- Preview Rendering ---

function renderPreview(
  result: PetsciiResult,
  palette: PaletteColor[],
  ref: Uint8Array[],
  bgColor: number,
  ecmBgs: number[],
  mode: 'standard' | 'ecm'
): ImageData {
  const imageData = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
  const data = imageData.data;

  for (let cy = 0; cy < GRID_HEIGHT; cy++) {
    for (let cx = 0; cx < GRID_WIDTH; cx++) {
      const cellIndex = cy * GRID_WIDTH + cx;
      const ch = result.screencodes[cellIndex];
      const fg = result.colors[cellIndex];
      const bg = mode === 'ecm' ? ecmBgs[result.bgIndices[cellIndex]] : bgColor;
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const colorIndex = ref[ch][py * 8 + px] ? fg : bg;
          const offset = ((cy * 8 + py) * CANVAS_WIDTH + (cx * 8 + px)) * 4;
          data[offset] = palette[colorIndex].r;
          data[offset + 1] = palette[colorIndex].g;
          data[offset + 2] = palette[colorIndex].b;
          data[offset + 3] = 255;
        }
      }
    }
  }

  return imageData;
}

function renderMcmPreview(
  result: PetsciiResult,
  palette: PaletteColor[],
  ref: Uint8Array[],
  refMcm: Uint8Array[],
  bg: number,
  mc1: number,
  mc2: number
): ImageData {
  const imageData = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
  const data = imageData.data;

  for (let cy = 0; cy < GRID_HEIGHT; cy++) {
    for (let cx = 0; cx < GRID_WIDTH; cx++) {
      const cellIndex = cy * GRID_WIDTH + cx;
      const ch = result.screencodes[cellIndex];
      const colorRam = result.colors[cellIndex];
      if (mcmIsMulticolorCell(colorRam)) {
        const fg = mcmForegroundColor(colorRam);
        const bits = refMcm[ch];
        for (let py = 0; py < 8; py++) {
          for (let mpx = 0; mpx < 4; mpx++) {
            const bitPair = bits[py * 4 + mpx];
            const colorIndex = mcmResolveBitPairColor(bitPair, bg, mc1, mc2, fg);
            for (let dx = 0; dx < 2; dx++) {
              const offset = ((cy * 8 + py) * CANVAS_WIDTH + (cx * 8 + mpx * 2 + dx)) * 4;
              data[offset] = palette[colorIndex].r;
              data[offset + 1] = palette[colorIndex].g;
              data[offset + 2] = palette[colorIndex].b;
              data[offset + 3] = 255;
            }
          }
        }
      } else {
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const colorIndex = ref[ch][py * 8 + px] ? colorRam : bg;
            const offset = ((cy * 8 + py) * CANVAS_WIDTH + (cx * 8 + px)) * 4;
            data[offset] = palette[colorIndex].r;
            data[offset + 1] = palette[colorIndex].g;
            data[offset + 2] = palette[colorIndex].b;
            data[offset + 3] = 255;
          }
        }
      }
    }
  }

  return imageData;
}
// --- Mode orchestration ---

export type ProgressCallback = (stage: string, detail: string, pct: number) => void;
export type StandardBackendCallback = (backend: StandardAccelerationPath) => void;

function toSolvedModeCandidate(
  candidate: StandardSolvedModeCandidate,
  palette: PaletteColor[],
  contexts: Record<ConverterCharset, CharsetConversionContext>
): SolvedModeCandidate {
  const result: PetsciiResult = {
    screencodes: candidate.conversion.screencodes,
    colors: candidate.conversion.colors,
    bgIndices: [],
    totalError: candidate.error,
  };
  const context = contexts[candidate.conversion.charset];
  return {
    result,
    conversion: {
      ...candidate.conversion,
      accelerationBackend: candidate.executionPath,
    },
    preview: renderPreview(result, palette, context.ref, candidate.conversion.backgroundColor, [], 'standard'),
    error: candidate.error,
  };
}

async function solveStandardAcrossCombosSequential(
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  palette: PaletteColor[],
  metrics: PaletteMetricData,
  onProgress: ProgressCallback,
  onStandardBackend?: StandardBackendCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate | undefined> {
  const offsets = buildStandardAlignmentOffsets();
  let best: StandardSolvedModeCandidate | undefined;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  onStandardBackend?.('js');
  onProgress('Alignment', `STANDARD 0 of ${offsets.length}`, 0);

  for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex++) {
    const offset = offsets[offsetIndex];
    await yieldToUI(shouldCancel);
    const solved = await solveStandardOffset(
      preprocessed,
      settings,
      contexts as any,
      metrics as any,
      offset,
      undefined,
      shouldCancel
    );
    solved.executionPath = 'js';
    if (!best || solved.error < best.error) {
      best = solved;
    }
    onProgress(
      'Alignment',
      `STANDARD ${offsetIndex + 1} of ${offsets.length}`,
      Math.round(((offsetIndex + 1) / Math.max(1, offsets.length)) * 100)
    );
  }

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
  console.info('[TruSkii3000] Standard conversion finished.', {
    backend: 'js',
    alignments: offsets.length,
    elapsedMs: Math.round(elapsedMs),
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
  });

  return best ? toSolvedModeCandidate(best, palette, contexts) : undefined;
}

async function solveStandardAcrossCombos(
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  palette: PaletteColor[],
  metrics: PaletteMetricData,
  fontBitsByCharset: ConverterFontBits,
  onProgress: ProgressCallback,
  onStandardBackend?: StandardBackendCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate | undefined> {
  try {
    const workerSolved = await runStandardConversionInWorkers(
      preprocessed as any,
      settings,
      fontBitsByCharset,
      onProgress,
      onStandardBackend,
      shouldCancel
    );
    if (workerSolved) {
      return toSolvedModeCandidate(workerSolved, palette, contexts);
    }
  } catch (error) {
    if (error instanceof ConversionCancelledError) {
      throw error;
    }
    console.warn('Standard worker acceleration failed; falling back to the single-threaded path.', error);
    disposeStandardConverterWorkers();
  }

  return await solveStandardAcrossCombosSequential(
    preprocessed,
    settings,
    contexts,
    palette,
    metrics,
    onProgress,
    onStandardBackend,
    shouldCancel
  );
}

async function solveModeAcrossCombos(
  mode: 'standard' | 'ecm' | 'mcm',
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  palette: PaletteColor[],
  metrics: PaletteMetricData,
  fontBitsByCharset: ConverterFontBits,
  onProgress: ProgressCallback,
  onStandardBackend?: StandardBackendCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate | undefined> {
  if (mode === 'standard') {
    return await solveStandardAcrossCombos(
      preprocessed,
      settings,
      contexts,
      palette,
      metrics,
      fontBitsByCharset,
      onProgress,
      onStandardBackend,
      shouldCancel
    );
  }

  const offsets = buildStandardAlignmentOffsets();
  const combos: { charset: ConverterCharset; offset: AlignmentOffset }[] = [];
  for (const offset of offsets) {
    combos.push({ charset: 'upper', offset });
    combos.push({ charset: 'lower', offset });
  }

  let best: SolvedModeCandidate | undefined;
  for (let comboIndex = 0; comboIndex < combos.length; comboIndex++) {
    const combo = combos[comboIndex];
    const comboPct = Math.round((comboIndex / Math.max(1, combos.length)) * 100);
    onProgress(
      'Alignment',
      `${mode.toUpperCase()} ${combo.charset} align (${combo.offset.x}, ${combo.offset.y}) ${comboIndex + 1} of ${combos.length}`,
      comboPct
    );
    await yieldToUI(shouldCancel);

    throwIfCancelled(shouldCancel);
    const analysis = analyzeAlignedSourceImage(preprocessed, metrics, settings, mode === 'mcm', combo.offset.x, combo.offset.y);
    throwIfCancelled(shouldCancel);
    const scopedProgress = createScopedProgress(onProgress, comboPct, Math.max(1, Math.ceil(100 / combos.length)));
    const context = contexts[combo.charset];

    let solved: SolvedModeCandidate | undefined;
    if (mode === 'ecm') {
      solved = await solveEcmForCombo(analysis, context, metrics, settings, palette, scopedProgress, shouldCancel);
    } else {
      solved = await solveMcmForCombo(analysis, context, metrics, settings, palette, scopedProgress, shouldCancel);
    }

    if (solved) {
      solved.conversion.charset = combo.charset;
      best = pickBetterModeCandidate(best, solved);
    }
  }

  return best;
}

// --- Top-level Orchestrator ---

export async function convertImage(
  img: HTMLImageElement,
  settings: ConverterSettings,
  fontBitsByCharset: ConverterFontBits,
  onProgress: ProgressCallback,
  onStandardBackend?: StandardBackendCallback,
  shouldCancel?: () => boolean
): Promise<ConversionOutputs> {
  const paletteData = PALETTES.find(p => p.id === settings.paletteId) || PALETTES[0];
  const palette = buildPaletteColors(paletteData.hex);
  const metrics = buildPaletteMetricData(palette);
  onProgress('Preparing', 'TruSkii3000 preprocessing source image...', 0);
  await yieldToUI(shouldCancel);
  const fitted = fitImageToCanvas(img);
  throwIfCancelled(shouldCancel);
  const preprocessed = preprocessFittedImage(fitted, metrics, settings);
  throwIfCancelled(shouldCancel);

  const contexts: Record<ConverterCharset, CharsetConversionContext> = {
    upper: buildCharsetConversionContext(fontBitsByCharset.upper, settings.outputMcm),
    lower: buildCharsetConversionContext(fontBitsByCharset.lower, settings.outputMcm),
  };

  const outputs: ConversionOutputs = {};
  const activeModes: Array<'standard' | 'ecm' | 'mcm'> = [];
  if (settings.outputStandard) activeModes.push('standard');
  if (settings.outputEcm) activeModes.push('ecm');
  if (settings.outputMcm) activeModes.push('mcm');

  for (let modeIndex = 0; modeIndex < activeModes.length; modeIndex++) {
    const mode = activeModes[modeIndex];
    const modeStart = Math.round((modeIndex / activeModes.length) * 100);
    const modeSpan = Math.max(1, Math.round(100 / activeModes.length));
    const scopedProgress = createScopedProgress(onProgress, modeStart, modeSpan);
    const solved = await solveModeAcrossCombos(
      mode,
      preprocessed,
      settings,
      contexts,
      palette,
      metrics,
      fontBitsByCharset,
      scopedProgress,
      mode === 'standard' ? onStandardBackend : undefined,
      shouldCancel
    );
    if (!solved) continue;

    if (mode === 'standard') {
      outputs.standard = solved.conversion;
      outputs.previewStd = solved.preview;
    } else if (mode === 'ecm') {
      outputs.ecm = solved.conversion;
      outputs.previewEcm = solved.preview;
    } else {
      outputs.mcm = solved.conversion;
      outputs.previewMcm = solved.preview;
    }
  }

  onProgress('Done', '', 100);
  return outputs;
}
