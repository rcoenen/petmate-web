import { C64_PALETTES } from '../c64Palettes';

import type {
  ConverterCharset,
  ConverterSettings,
  ConversionResult,
  StandardAccelerationPath,
} from './imageConverter';

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 200;
const GRID_WIDTH = 40;
const GRID_HEIGHT = 25;
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const PIXELS_PER_CELL = 64;
const ALIGNMENT_VALUES = [-2, -1, 0, 1, 2];
const STANDARD_SAMPLE_COUNT = 96;
const STANDARD_FINALIST_COUNT = 4;
const STANDARD_POOL_SIZE = 6;
const SCREEN_SOLVE_PASSES = 5;
const LUMA_ERROR_WEIGHT = 1.55;
const CHROMA_ERROR_WEIGHT = 0.85;
const REPEAT_PENALTY = 28.0;
const CONTINUITY_PENALTY = 0.14;
const MODE_SWITCH_PENALTY = 10.0;
const MODE_SWITCH_DIFF_THRESHOLD = 3.5;

export interface AlignmentOffset {
  x: number;
  y: number;
}

export interface PaletteColor {
  r: number;
  g: number;
  b: number;
  L: number;
  a: number;
  b2: number;
}

export interface PaletteMetricData {
  pL: Float64Array;
  pA: Float64Array;
  pB: Float64Array;
  pairDiff: Float64Array;
  maxPairDiff: number;
}

export interface CharsetConversionContext {
  ref: Uint8Array[];
  refSetCount: Int32Array;
  setPositions: Uint8Array[];
  flatPositions: Uint8Array;
  positionOffsets: Int32Array;
}

export interface StandardCandidateScoringKernel {
  computeSetErrs(weightedPixelErrors: Float32Array, context: CharsetConversionContext): Float32Array;
}

export interface StandardPreprocessedImage {
  width: number;
  height: number;
  baseDx: number;
  baseDy: number;
  srcL: Float32Array;
  srcA: Float32Array;
  srcB: Float32Array;
  nearestPalette: Uint8Array;
}

interface SourceCellData {
  weightedPixelErrors: Float32Array;
  totalErrByColor: Float32Array;
  avgL: number;
}

interface SourceAnalysis {
  cells: SourceCellData[];
  rankedIndices: Int32Array;
  hBoundaryDiffs: Float32Array;
  hBoundaryMeans: Float32Array;
  vBoundaryDiffs: Float32Array;
  vBoundaryMeans: Float32Array;
}

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
}

interface PetsciiResult {
  screencodes: number[];
  colors: number[];
  bgIndices: number[];
  totalError: number;
}

export interface StandardSolvedModeCandidate {
  conversion: ConversionResult;
  error: number;
  executionPath?: StandardAccelerationPath;
}

export type ProgressCallback = (stage: string, detail: string, pct: number) => void;

// --- Color science ---

function srgbChannelToLinear(value: number): number {
  const scaled = value / 255;
  return scaled > 0.04045 ? Math.pow((scaled + 0.055) / 1.055, 2.4) : scaled / 12.92;
}

function linearToOklab(r: number, g: number, b: number) {
  const l = Math.cbrt(Math.max(0, 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b));
  const m = Math.cbrt(Math.max(0, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b));
  const s = Math.cbrt(Math.max(0, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b));

  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

function sRGBtoOklab(r: number, g: number, b: number) {
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

// --- Public helpers used by main thread + workers ---

export function buildPaletteColorsById(paletteId: string): PaletteColor[] {
  const paletteDef = C64_PALETTES.find(p => p.id === paletteId) ?? C64_PALETTES[0];
  return paletteDef.hex.map(h => {
    const r = parseInt(h.slice(1, 3), 16);
    const g = parseInt(h.slice(3, 5), 16);
    const b = parseInt(h.slice(5, 7), 16);
    const oklab = sRGBtoOklab(r, g, b);
    return { r, g, b, L: oklab.L, a: oklab.a, b2: oklab.b };
  });
}

export function buildPaletteMetricData(palette: PaletteColor[]): PaletteMetricData {
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

export function buildCharsetConversionContext(fontBits: number[]): CharsetConversionContext {
  const ref: Uint8Array[] = [];
  const setPositions: Uint8Array[] = [];
  const allPositions: number[] = [];
  const positionOffsets = new Int32Array(257);

  for (let ch = 0; ch < 256; ch++) {
    positionOffsets[ch] = allPositions.length;
    const char = new Uint8Array(64);
    const positions: number[] = [];
    for (let row = 0; row < 8; row++) {
      const byte = fontBits[ch * 8 + row];
      for (let bit = 7; bit >= 0; bit--) {
        const value = (byte >> bit) & 1;
        const index = row * 8 + (7 - bit);
        char[index] = value;
        if (value) {
          positions.push(index);
          allPositions.push(index);
        }
      }
    }
    ref.push(char);
    setPositions.push(Uint8Array.from(positions));
  }
  positionOffsets[256] = allPositions.length;

  const refSetCount = new Int32Array(setPositions.map(positions => positions.length));
  return {
    ref,
    refSetCount,
    setPositions,
    flatPositions: Uint8Array.from(allPositions),
    positionOffsets,
  };
}

export function buildAlignmentOffsets(): AlignmentOffset[] {
  const offsets: AlignmentOffset[] = [];
  for (const y of ALIGNMENT_VALUES) {
    for (const x of ALIGNMENT_VALUES) {
      offsets.push({ x, y });
    }
  }
  offsets.sort((a, b) => (Math.abs(a.x) + Math.abs(a.y)) - (Math.abs(b.x) + Math.abs(b.y)));
  return offsets;
}

export class ConversionCancelledError extends Error {
  constructor() {
    super('Image conversion cancelled');
    this.name = 'ConversionCancelledError';
  }
}

export function throwIfCancelled(shouldCancel?: () => boolean) {
  if (shouldCancel?.()) {
    throw new ConversionCancelledError();
  }
}

export async function yieldToUI(shouldCancel?: () => boolean): Promise<void> {
  throwIfCancelled(shouldCancel);
  await new Promise(resolve => setTimeout(resolve, 0));
  throwIfCancelled(shouldCancel);
}

export function createScopedProgress(
  onProgress: ProgressCallback,
  progressStart: number,
  progressSpan: number
): ProgressCallback {
  return (stage, detail, pct) => {
    const scopedPct = progressStart + Math.round((pct / 100) * progressSpan);
    onProgress(stage, detail, scopedPct);
  };
}

// --- Source analysis ---

export function analyzeAlignedSourceImage(
  preprocessed: StandardPreprocessedImage,
  paletteMetrics: PaletteMetricData,
  settings: ConverterSettings,
  offsetX: number,
  offsetY: number
): SourceAnalysis {
  const srcL = new Float32Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  const srcA = new Float32Array(CANVAS_WIDTH * CANVAS_HEIGHT);
  const srcB = new Float32Array(CANVAS_WIDTH * CANVAS_HEIGHT);

  const dx = preprocessed.baseDx + offsetX;
  const dy = preprocessed.baseDy + offsetY;
  const destX0 = Math.max(0, dx);
  const destY0 = Math.max(0, dy);
  const destX1 = Math.min(CANVAS_WIDTH, dx + preprocessed.width);
  const destY1 = Math.min(CANVAS_HEIGHT, dy + preprocessed.height);
  const copyWidth = Math.max(0, destX1 - destX0);
  const copyHeight = Math.max(0, destY1 - destY0);

  if (copyWidth > 0 && copyHeight > 0) {
    const srcX0 = destX0 - dx;
    const srcY0 = destY0 - dy;
    for (let row = 0; row < copyHeight; row++) {
      const srcBase = (srcY0 + row) * preprocessed.width + srcX0;
      const destBase = (destY0 + row) * CANVAS_WIDTH + destX0;
      srcL.set(preprocessed.srcL.subarray(srcBase, srcBase + copyWidth), destBase);
      srcA.set(preprocessed.srcA.subarray(srcBase, srcBase + copyWidth), destBase);
      srcB.set(preprocessed.srcB.subarray(srcBase, srcBase + copyWidth), destBase);
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

      cells[cellIndex] = {
        weightedPixelErrors,
        totalErrByColor,
        avgL: meanL,
      };
    }
  }

  const order = Array.from({ length: CELL_COUNT }, (_, index) => index);
  order.sort((a, b) => variances[b] - variances[a]);

  return {
    cells,
    rankedIndices: Int32Array.from(order),
    hBoundaryDiffs,
    hBoundaryMeans,
    vBoundaryDiffs,
    vBoundaryMeans,
  };
}

// --- Standard solving ---

function buildBackgroundColorList(): number[] {
  return Array.from({ length: 16 }, (_, color) => color);
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

function getSampleIndices(rankedIndices: Int32Array, count: number): number[] {
  return Array.from(rankedIndices.slice(0, Math.min(count, rankedIndices.length)));
}

function insertTopCandidate(pool: ScreenCandidate[], candidate: ScreenCandidate, limit: number) {
  const existing = pool.findIndex(
    entry =>
      entry.char === candidate.char &&
      entry.fg === candidate.fg &&
      entry.bg === candidate.bg
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

function buildBinaryEdges(mask: Uint8Array, bg: number, fg: number) {
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
  };
}

// --- Reusable setErr buffer (safe: callers use result synchronously before next call) ---

const _reusableSetErrs = new Float32Array(256 * 16);

function computeSetErrMatrixJs(
  weightedPixelErrors: Float32Array,
  context: CharsetConversionContext
): Float32Array {
  _reusableSetErrs.fill(0);
  const { flatPositions, positionOffsets } = context;

  for (let ch = 0; ch < 256; ch++) {
    const start = positionOffsets[ch];
    const end = positionOffsets[ch + 1];
    const rowBase = ch << 4;
    for (let i = start; i < end; i++) {
      const base = flatPositions[i] << 4;
      for (let color = 0; color < 16; color++) {
        _reusableSetErrs[rowBase + color] += weightedPixelErrors[base + color];
      }
    }
  }

  return _reusableSetErrs;
}

function computeSetErrMatrix(
  cell: SourceCellData,
  context: CharsetConversionContext,
  scoringKernel?: StandardCandidateScoringKernel
): Float32Array {
  return scoringKernel
    ? scoringKernel.computeSetErrs(cell.weightedPixelErrors, context)
    : computeSetErrMatrixJs(cell.weightedPixelErrors, context);
}

function buildBinaryBestErrorByBackground(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  scoringKernel?: StandardCandidateScoringKernel
): Float64Array {
  const best = new Float64Array(16);
  best.fill(Infinity);
  const setErrMatrix = computeSetErrMatrix(cell, context, scoringKernel);

  for (let ch = 0; ch < 256; ch++) {
    const rowBase = ch * 16;
    const nSet = context.refSetCount[ch];
    for (let bg = 0; bg < 16; bg++) {
      const bgErr = cell.totalErrByColor[bg] - setErrMatrix[rowBase + bg];
      if (bgErr >= best[bg]) continue;
      for (let fg = 0; fg < 16; fg++) {
        if (fg === bg) continue;
        const renderedAvgL = (nSet * metrics.pL[fg] + (PIXELS_PER_CELL - nSet) * metrics.pL[bg]) / PIXELS_PER_CELL;
        const lumDiff = cell.avgL - renderedAvgL;
        const total = bgErr + setErrMatrix[rowBase + fg] + settings.lumMatchWeight * lumDiff * lumDiff;
        if (total < best[bg]) best[bg] = total;
      }
    }
  }

  return best;
}

function buildBinaryCandidatePoolsForCell(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  backgrounds: number[],
  poolSize: number,
  scoringKernel?: StandardCandidateScoringKernel
): ScreenCandidate[][] {
  const pools = backgrounds.map(() => [] as ScreenCandidate[]);
  const setErrMatrix = computeSetErrMatrix(cell, context, scoringKernel);

  for (let ch = 0; ch < 256; ch++) {
    const rowBase = ch * 16;
    const nSet = context.refSetCount[ch];

    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const pool = pools[bi];
      const worst = pool.length >= poolSize ? pool[pool.length - 1].baseError : Infinity;
      const bgErr = cell.totalErrByColor[bg] - setErrMatrix[rowBase + bg];
      if (bgErr >= worst) continue;

      for (let fg = 0; fg < 16; fg++) {
        if (fg === bg) continue;
        const renderedAvgL = (nSet * metrics.pL[fg] + (PIXELS_PER_CELL - nSet) * metrics.pL[bg]) / PIXELS_PER_CELL;
        const lumDiff = cell.avgL - renderedAvgL;
        const total = bgErr + setErrMatrix[rowBase + fg] + settings.lumMatchWeight * lumDiff * lumDiff;
        if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
          insertTopCandidate(
            pool,
            makeBinaryCandidate(context.ref[ch], ch, bg, fg, total, metrics.pairDiff, metrics.maxPairDiff),
            poolSize
          );
        }
      }
    }
  }

  for (let bi = 0; bi < backgrounds.length; bi++) {
    if (pools[bi].length > 0) continue;
    const bg = backgrounds[bi] ?? 0;
    const fg = bg === 0 ? 1 : 0;
    pools[bi] = [makeBinaryCandidate(context.ref[32], 32, bg, fg, Infinity, metrics.pairDiff, metrics.maxPairDiff)];
  }

  return pools;
}

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

  let edgePenalty = 0;
  for (let i = 0; i < 8; i++) {
    const rendered = metrics.pairDiff[firstEdge[i] * 16 + secondEdge[i]];
    const desired = boundaryDiffs[boundaryBase + i];
    const delta = rendered - desired;
    edgePenalty += delta * delta;
  }

  let repeatPenalty = 0;
  if (leftOrTop.char === rightOrBottom.char) {
    const scale = horizontal
      ? (leftOrTop.repeatH + rightOrBottom.repeatH) * 0.5
      : (leftOrTop.repeatV + rightOrBottom.repeatV) * 0.5;
    repeatPenalty = REPEAT_PENALTY * scale;
  }

  return CONTINUITY_PENALTY * (edgePenalty / 8) + repeatPenalty;
}

async function solveScreen(
  candidatePools: ScreenCandidate[][],
  analysis: SourceAnalysis,
  metrics: PaletteMetricData,
  shouldCancel?: () => boolean
): Promise<PetsciiResult> {
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
        if (cost >= bestCost) continue;

        if (cx > 0) {
          cost += computeNeighborPenalty(selected[cellIndex - 1], candidate, metrics, analysis, cy, cx - 1, true);
          if (cost >= bestCost) continue;
        }
        if (cx < GRID_WIDTH - 1) {
          cost += computeNeighborPenalty(candidate, selected[cellIndex + 1], metrics, analysis, cy, cx, true);
          if (cost >= bestCost) continue;
        }
        if (cy > 0) {
          cost += computeNeighborPenalty(selected[cellIndex - GRID_WIDTH], candidate, metrics, analysis, cy - 1, cx, false);
          if (cost >= bestCost) continue;
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

  return { screencodes, colors, bgIndices, totalError };
}

async function buildBinaryCandidatePoolsByBackground(
  cells: SourceCellData[],
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  backgrounds: number[],
  scoringKernel?: StandardCandidateScoringKernel,
  shouldCancel?: () => boolean
): Promise<ScreenCandidate[][][]> {
  const candidatePoolsByBackground = backgrounds.map(() => new Array<ScreenCandidate[]>(cells.length));
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    const cellPools = buildBinaryCandidatePoolsForCell(
      cells[cellIndex], context, metrics, settings, backgrounds, STANDARD_POOL_SIZE, scoringKernel
    );
    for (let bi = 0; bi < backgrounds.length; bi++) {
      candidatePoolsByBackground[bi][cellIndex] = cellPools[bi];
    }
    if ((cellIndex & 127) === 0) {
      await yieldToUI(shouldCancel);
    }
  }
  return candidatePoolsByBackground;
}

async function solveStandardCharsetForAnalysis(
  analysis: SourceAnalysis,
  settings: ConverterSettings,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  charset: ConverterCharset,
  scoringKernel?: StandardCandidateScoringKernel,
  onProgress?: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<StandardSolvedModeCandidate> {
  const backgroundColors = settings.manualBgColor !== null ? [settings.manualBgColor] : buildBackgroundColorList();
  const sampleIndices = getSampleIndices(analysis.rankedIndices, STANDARD_SAMPLE_COUNT);
  const coarseScores = new Float64Array(16);

  const tCoarse0 = performance.now();
  for (const cellIndex of sampleIndices) {
    const bestByBg = buildBinaryBestErrorByBackground(
      analysis.cells[cellIndex],
      context,
      metrics,
      settings,
      scoringKernel
    );
    for (let bg = 0; bg < 16; bg++) coarseScores[bg] += bestByBg[bg];
  }
  const tCoarse1 = performance.now();

  const finalists = backgroundColors
    .map(bg => ({ bg, score: coarseScores[bg] }))
    .sort((a, b) => a.score - b.score)
    .slice(0, Math.min(STANDARD_FINALIST_COUNT, backgroundColors.length));

  const finalistBackgrounds = finalists.map(finalist => finalist.bg);
  const tPool0 = performance.now();
  const candidatePoolsByBackground = await buildBinaryCandidatePoolsByBackground(
    analysis.cells,
    context,
    metrics,
    settings,
    finalistBackgrounds,
    scoringKernel,
    shouldCancel
  );
  const tPool1 = performance.now();

  let best: StandardSolvedModeCandidate | undefined;
  let solveTime = 0;
  for (let index = 0; index < finalists.length; index++) {
    const bg = finalists[index].bg;
    onProgress?.(
      'Converting',
      `Standard background ${bg} (${index + 1}/${finalists.length})`,
      Math.round((index / Math.max(1, finalists.length)) * 100)
    );
    await yieldToUI(shouldCancel);

    const candidatePools = candidatePoolsByBackground[index];
    const tSolve0 = performance.now();
    const solved = await solveScreen(candidatePools, analysis, metrics, shouldCancel);
    solveTime += performance.now() - tSolve0;
    const conversion: ConversionResult = {
      screencodes: solved.screencodes,
      colors: solved.colors,
      backgroundColor: bg,
      ecmBgColors: [],
      bgIndices: [],
      mcmSharedColors: [],
      charset,
      mode: 'standard',
    };
    const candidate: StandardSolvedModeCandidate = {
      conversion,
      error: solved.totalError,
    };
    if (!best || candidate.error < best.error) {
      best = candidate;
    }
  }

  console.log(
    `[TruSkii3000]   stages: coarse=${(tCoarse1 - tCoarse0).toFixed(1)}ms ` +
    `pools=${(tPool1 - tPool0).toFixed(1)}ms solve=${solveTime.toFixed(1)}ms`
  );

  return best!;
}

export async function solveStandardCombo(
  preprocessed: StandardPreprocessedImage,
  settings: ConverterSettings,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  charset: ConverterCharset,
  offset: AlignmentOffset,
  scoringKernel?: StandardCandidateScoringKernel,
  onProgress?: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<StandardSolvedModeCandidate> {
  const t0 = performance.now();
  const analysis = analyzeAlignedSourceImage(preprocessed, metrics, settings, offset.x, offset.y);
  const t1 = performance.now();
  const result = await solveStandardCharsetForAnalysis(
    analysis,
    settings,
    context,
    metrics,
    charset,
    scoringKernel,
    onProgress,
    shouldCancel
  );
  const t2 = performance.now();
  console.log(
    `[TruSkii3000] combo ${charset} (${offset.x},${offset.y}): ` +
    `analyze=${(t1 - t0).toFixed(1)}ms solve=${(t2 - t1).toFixed(1)}ms total=${(t2 - t0).toFixed(1)}ms`
  );
  return result;
}

export async function solveStandardOffset(
  preprocessed: StandardPreprocessedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  metrics: PaletteMetricData,
  offset: AlignmentOffset,
  scoringKernel?: StandardCandidateScoringKernel,
  shouldCancel?: () => boolean
): Promise<StandardSolvedModeCandidate> {
  const analysis = analyzeAlignedSourceImage(preprocessed, metrics, settings, offset.x, offset.y);
  let best: StandardSolvedModeCandidate | undefined;

  for (const charset of ['upper', 'lower'] as const) {
    const candidate = await solveStandardCharsetForAnalysis(
      analysis,
      settings,
      contexts[charset],
      metrics,
      charset,
      scoringKernel,
      undefined,
      shouldCancel
    );
    if (!best || candidate.error < best.error) {
      best = candidate;
    }
  }

  return best!;
}
