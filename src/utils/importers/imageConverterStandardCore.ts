import { C64_PALETTES } from '../c64Palettes';

import type {
  ConverterCharset,
  ConverterSettings,
  ConversionResult,
  StandardAccelerationPath,
} from './imageConverter';
import {
  computeCsfPenalty,
  computeDirectionalAlignmentBonus,
  computeHuePreservationBonus,
  hasMinimumContrast,
  isTypographicScreencode,
  MIN_PAIR_DIFF_RATIO,
} from './imageConverterHeuristics';
import {
  computeBinaryHammingDistancesJs,
  packBinaryGlyphBitplanes,
  packBinaryThresholdMap,
  popcount32,
} from './imageConverterBitPacking';
import { computeCellStructureMetrics, type CellGradientDirection } from './imageConverterCellMetrics';
import { buildGlyphAtlasMetadata, type GlyphAtlasMetadata } from './glyphAtlas';

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 200;
const GRID_WIDTH = 40;
const GRID_HEIGHT = 25;
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const PIXELS_PER_CELL = 64;
const ALIGNMENT_VALUES = [-2, -1, 0, 1, 2];
// Quality-first Standard search budgets: keep more finalists and cell-level
// alternatives so the solver can spend extra time improving the final match.
const STANDARD_SAMPLE_COUNT = 160;
const STANDARD_FINALIST_COUNT = 8;
const STANDARD_POOL_SIZE = 10;
const SCREEN_SOLVE_PASSES = 7;
const LUMA_ERROR_WEIGHT = 1.0;
const CHROMA_ERROR_WEIGHT = 2.0;
// TRUSKI3000: Edge-weighted scoring — penalize character mismatches at edge pixels
// more heavily than flat-zone mismatches.
const EDGE_MISMATCH_WEIGHT = 0.0; // TRUSKI3000: disabled pending color-selection fixes; see edge-weight experiment notes
// TRUSKI3000: Perceptual blend bonus — rewards high-frequency characters (checkerboards,
// dithers) when their fg+bg blend matches the source cell color. The eye blends alternating
// pixels spatially, so a brown/black checkerboard looks like dark-brown even though each
// pixel is "wrong". Scale bonus by character spatialFrequency so solid blocks get no bonus.
// The blend quality reduces the CSF penalty: when a high-frequency glyph's blend matches
// the source well, its spatial frequency is the mechanism for correct perceived color, not
// unwanted noise. BLEND_CSF_RELIEF controls how much blend quality offsets the CSF penalty
// (1.0 = perfect blend fully cancels CSF; >1.0 = perfect blend creates a net bonus).
const BLEND_CSF_RELIEF = 1.5;
// Controls how quickly blend quality decays with blend error. Higher = stricter match required.
const BLEND_QUALITY_SHARPNESS = 48.0;
// Standalone blend match bonus: always active, independent of csfWeight.
// Rewards pairs whose perceptual blend (fg+bg mix) matches the source cell color.
// Without this, low-contrast pairs like brown+black can never compete on per-pixel
// error alone, even though their blend IS the correct perceived color.
const BLEND_MATCH_WEIGHT = 3.0;
// Coverage extremity penalty: solid blocks (0% or 100% coverage) get penalized
// in detailed cells where PETSCII character shapes should be leveraged. Without
// this, full blocks always win on per-pixel error because they show 100% of one
// color, but they produce a blocky "pixel art" look instead of textured PETSCII art.
const COVERAGE_EXTREMITY_WEIGHT = 20.0;
// TRUSKI3000: Soft contrast penalty — replaces the hard hasMinimumContrast gate.
// Low-contrast pairs (e.g. brown+black) get a penalty that scales linearly from 0
// at the threshold to SOFT_CONTRAST_PENALTY at zero contrast. This lets brown compete
// when it's the best color match, while still preferring higher-contrast alternatives.
// Controlled low-contrast wildcard system: cells with narrow luminance range
// get a small number of low-contrast fg candidates alongside the normal pool.
// This preserves pool ecology for high-contrast cells while giving low-contrast
// cells the diversity they need.
// Competitive wildcard admission: low-contrast candidates enter the pool only
// when they are within a score margin of the best normal candidate, or when
// their color-match (blend quality) advantage is clearly large. This prevents
// noise in high-contrast cells while allowing genuine low-contrast diversity.
const WILDCARD_SCORE_MARGIN = 0.15;        // must score within 15% of best normal
const WILDCARD_BLEND_QUALITY_MIN = 0.7;    // OR blend quality above this admits directly
const WILDCARD_MAX_ADMITTED = 2;           // max wildcards admitted per cell/background
const REPEAT_PENALTY = 28.0;
const CONTINUITY_PENALTY = 0.14;
const MODE_SWITCH_PENALTY = 10.0;
const MODE_SWITCH_DIFF_THRESHOLD = 3.5;
const BRIGHTNESS_DEBT_WEIGHT = 64.0;
const BRIGHTNESS_DEBT_DECAY = 0.6;
const BRIGHTNESS_DEBT_CLAMP = 0.18;
const COLOR_COHERENCE_MAX_DELTA = 18.0;
const COLOR_COHERENCE_PASSES = 3;
const EDGE_CONTINUITY_MAX_DELTA = 12.0;
const EDGE_CONTINUITY_PASSES = 3;
const ENABLE_EXPERIMENTAL_HAMMING_FAST_PATH = false;

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
  binaryMixL: Float64Array;
  binaryMixA: Float64Array;
  binaryMixB: Float64Array;
  maxPairDiff: number;
}

export interface CharsetConversionContext {
  ref: Uint8Array[];
  refSetCount: Int32Array;
  setPositions: Uint8Array[];
  flatPositions: Uint8Array;
  positionOffsets: Int32Array;
  packedBinaryGlyphLo: Uint32Array;
  packedBinaryGlyphHi: Uint32Array;
  glyphAtlas: GlyphAtlasMetadata;
}

export interface StandardCandidateScoringKernel {
  computeSetErrs(weightedPixelErrors: Float32Array, context: CharsetConversionContext): Float32Array;
  computeHammingDistances?(
    thresholdLo: number,
    thresholdHi: number,
    pairDiff: Float64Array,
    context: CharsetConversionContext
  ): Uint8Array;
  computeBestErrorByBackground?(
    weightedPixelErrors: Float32Array,
    totalErrByColor: Float32Array,
    avgL: number,
    avgA: number,
    avgB: number,
    detailScore: number,
    settings: {
      lumMatchWeight: number;
      csfWeight: number;
    },
    candidateScreencodes: Uint16Array,
    metrics: PaletteMetricData,
    context: CharsetConversionContext
  ): Float64Array;
  computeCandidatePoolsByBackground?(
    weightedPixelErrors: Float32Array,
    totalErrByColor: Float32Array,
    avgL: number,
    avgA: number,
    avgB: number,
    detailScore: number,
    settings: {
      lumMatchWeight: number;
      csfWeight: number;
    },
    backgrounds: number[],
    poolSize: number,
    edgeMaskLo: number,
    edgeMaskHi: number,
    edgeWeight: number,
    candidateScreencodes: Uint16Array,
    metrics: PaletteMetricData,
    context: CharsetConversionContext
  ): {
    counts: Uint8Array;
    chars: Uint8Array;
    fgs: Uint8Array;
    scores: Float64Array;
    setErrs: Float32Array;
  };
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
  avgA: number;
  avgB: number;
  saliencyWeight: number;
  detailScore: number;
  gradientDirection: CellGradientDirection;
  edgeMaskLo: number;
  edgeMaskHi: number;
  edgePixelCount: number;
  lumRange: number; // maxL - minL across cell pixels
}

interface SourceAnalysis {
  cells: SourceCellData[];
  detailScores: Float32Array;
  gradientDirections: Uint8Array;
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
  brightnessResidual: number;
  coherenceColorMask: number;
  glyphDirection: CellGradientDirection;
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

type BinaryCellScoringTables = {
  pairAdjustment: Float64Array;
  brightnessResidual: Float32Array;
  csfPenaltyByChar: Float32Array;
  blendMatchBonus: Float64Array; // per mixIndex: blend quality [0,1] — 1 = perfect match
};

export interface StandardSolvedModeCandidate {
  conversion: ConversionResult;
  error: number;
  executionPath?: StandardAccelerationPath;
  offset: AlignmentOffset;
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
  const binaryMixL = new Float64Array(65 * 16 * 16);
  const binaryMixA = new Float64Array(65 * 16 * 16);
  const binaryMixB = new Float64Array(65 * 16 * 16);
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

      for (let setCount = 0; setCount <= PIXELS_PER_CELL; setCount++) {
        const mixIndex = (setCount * 16 + b) * 16 + a;
        const bgWeight = PIXELS_PER_CELL - setCount;
        binaryMixL[mixIndex] = (setCount * pL[a] + bgWeight * pL[b]) / PIXELS_PER_CELL;
        binaryMixA[mixIndex] = (setCount * pA[a] + bgWeight * pA[b]) / PIXELS_PER_CELL;
        binaryMixB[mixIndex] = (setCount * pB[a] + bgWeight * pB[b]) / PIXELS_PER_CELL;
      }
    }
  }

  return {
    pL,
    pA,
    pB,
    pairDiff,
    binaryMixL,
    binaryMixA,
    binaryMixB,
    maxPairDiff: Math.max(maxPairDiff, 1),
  };
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
  const { packedBinaryGlyphLo, packedBinaryGlyphHi } = packBinaryGlyphBitplanes(ref);
  return {
    ref,
    refSetCount,
    setPositions,
    flatPositions: Uint8Array.from(allPositions),
    positionOffsets,
    packedBinaryGlyphLo,
    packedBinaryGlyphHi,
    glyphAtlas: buildGlyphAtlasMetadata(ref),
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

  const structureMetrics = computeCellStructureMetrics(srcL);
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
      let minL = Infinity;
      let maxL = -Infinity;

      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const p = py * 8 + px;
          const pixelIndex = (cy * 8 + py) * CANVAS_WIDTH + (cx * 8 + px);
          pixelIndices[p] = pixelIndex;
          const pxL = srcL[pixelIndex];
          meanL += pxL;
          meanA += srcA[pixelIndex];
          meanB += srcB[pixelIndex];
          lumSum += pxL;
          lumSqSum += pxL * pxL;
          if (pxL < minL) minL = pxL;
          if (pxL > maxL) maxL = pxL;
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
      let saliencyTotal = 0;
      for (let p = 0; p < PIXELS_PER_CELL; p++) {
        const pixelIndex = pixelIndices[p];
        saliencyTotal += weights[p];
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

      // Compute per-pixel edge importance via Sobel magnitude, pack into bitmask
      let edgeMaskLo = 0;
      let edgeMaskHi = 0;
      let edgePixelCount = 0;
      {
        const sobelMag = new Float32Array(PIXELS_PER_CELL);
        let maxMag = 0;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const p = py * 8 + px;
            const x = cx * 8 + px;
            const y = cy * 8 + py;
            const idx = y * CANVAS_WIDTH + x;
            const lC = srcL[idx];
            const lN = py > 0 ? srcL[idx - CANVAS_WIDTH] : lC;
            const lS = py < 7 ? srcL[idx + CANVAS_WIDTH] : lC;
            const lW = px > 0 ? srcL[idx - 1] : lC;
            const lE = px < 7 ? srcL[idx + 1] : lC;
            const gx = lE - lW;
            const gy = lS - lN;
            const mag = Math.sqrt(gx * gx + gy * gy);
            sobelMag[p] = mag;
            if (mag > maxMag) maxMag = mag;
          }
        }
        if (maxMag > 0) {
          const edgeThreshold = maxMag * 0.3;
          for (let p = 0; p < 64; p++) {
            if (sobelMag[p] >= edgeThreshold) {
              edgePixelCount++;
              if (p < 32) {
                edgeMaskLo |= 1 << p;
              } else {
                edgeMaskHi |= 1 << (p - 32);
              }
            }
          }
        }
      }
      edgeMaskLo = edgeMaskLo >>> 0;
      edgeMaskHi = edgeMaskHi >>> 0;

      cells[cellIndex] = {
        weightedPixelErrors,
        totalErrByColor,
        avgL: meanL,
        avgA: meanA,
        avgB: meanB,
        saliencyWeight: saliencyTotal / PIXELS_PER_CELL,
        detailScore: structureMetrics.detailScores[cellIndex],
        gradientDirection: structureMetrics.gradientDirections[cellIndex] as CellGradientDirection,
        edgeMaskLo,
        edgeMaskHi,
        edgePixelCount,
        lumRange: maxL - minL,
      };
    }
  }

  const order = Array.from({ length: CELL_COUNT }, (_, index) => index);
  order.sort((a, b) => variances[b] - variances[a]);

  return {
    cells,
    detailScores: structureMetrics.detailScores,
    gradientDirections: structureMetrics.gradientDirections,
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

function buildBinaryCoherenceColorMask(mask: Uint8Array, bg: number, fg: number): number {
  let hasBg = false;
  let hasFg = false;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) hasFg = true;
    else hasBg = true;
    if (hasBg && hasFg) break;
  }

  let coherenceColorMask = 0;
  if (hasBg) coherenceColorMask |= 1 << bg;
  if (hasFg) coherenceColorMask |= 1 << fg;
  return coherenceColorMask;
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
  glyphDirection: CellGradientDirection,
  baseError: number,
  brightnessResidual: number,
  pairDiff: Float64Array,
  maxPairDiff: number
): ScreenCandidate {
  const edges = buildBinaryEdges(mask, bg, fg);
  const coherenceColorMask = buildBinaryCoherenceColorMask(mask, bg, fg);
  return {
    char,
    fg,
    bg,
    baseError,
    brightnessResidual,
    coherenceColorMask,
    glyphDirection,
    ...edges,
    repeatH: computeSelfTileScale(edges.edgeRight, edges.edgeLeft, pairDiff, maxPairDiff),
    repeatV: computeSelfTileScale(edges.edgeBottom, edges.edgeTop, pairDiff, maxPairDiff),
  };
}

// --- Reusable setErr buffer (safe: callers use result synchronously before next call) ---

const _reusableSetErrs = new Float32Array(256 * 16);
const _reusableBinaryHamming = new Uint8Array(256);
const _reusableBinaryPairAdjustment = new Float64Array((PIXELS_PER_CELL + 1) * 16 * 16);
const _reusableBinaryBrightnessResidual = new Float32Array((PIXELS_PER_CELL + 1) * 16 * 16);
const _reusableBinaryCsfPenalty = new Float32Array(256);
const _reusableBlendMatchBonus = new Float64Array((PIXELS_PER_CELL + 1) * 16 * 16);
const _candidateScreencodeCache = new Map<string, Uint16Array>();
const _foregroundCandidateCache = new WeakMap<PaletteMetricData, Map<number, Uint8Array[]>>();

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

function binaryMixIndex(setCount: number, bg: number, fg: number): number {
  return (setCount * 16 + bg) * 16 + fg;
}

function getCandidateScreencodes(includeTypographic: boolean): Uint16Array {
  const cacheKey = includeTypographic ? 'all' : 'filtered';
  const cached = _candidateScreencodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const screencodes: number[] = [];
  for (let ch = 0; ch < 256; ch++) {
    if (!includeTypographic && isTypographicScreencode(ch)) continue;
    screencodes.push(ch);
  }

  const built = Uint16Array.from(screencodes);
  _candidateScreencodeCache.set(cacheKey, built);
  return built;
}

function getForegroundCandidatesByBackground(
  metrics: PaletteMetricData
): Uint8Array[] {
  const cachedByLimit = _foregroundCandidateCache.get(metrics);
  if (cachedByLimit?.has(16)) {
    return cachedByLimit.get(16)!;
  }

  const foregroundsByBackground = Array.from({ length: 16 }, (_, bg) => {
    const foregrounds: number[] = [];
    for (let fg = 0; fg < 16; fg++) {
      if (fg === bg) continue;
      if (!hasMinimumContrast(metrics, fg, bg)) continue;
      foregrounds.push(fg);
    }
    return Uint8Array.from(foregrounds);
  });

  const nextByLimit = cachedByLimit ?? new Map<number, Uint8Array[]>();
  nextByLimit.set(16, foregroundsByBackground);
  if (!cachedByLimit) {
    _foregroundCandidateCache.set(metrics, nextByLimit);
  }
  return foregroundsByBackground;
}

function buildBinaryCellScoringTables(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings
): BinaryCellScoringTables {
  for (let ch = 0; ch < 256; ch++) {
    _reusableBinaryCsfPenalty[ch] = computeCsfPenalty(
      cell.detailScore,
      context.glyphAtlas.spatialFrequency[ch],
      settings.csfWeight
    );
  }

  for (let setCount = 0; setCount <= PIXELS_PER_CELL; setCount++) {
    for (let bg = 0; bg < 16; bg++) {
      for (let fg = 0; fg < 16; fg++) {
        const index = binaryMixIndex(setCount, bg, fg);
        const lumDiff = cell.avgL - metrics.binaryMixL[index];
        _reusableBinaryBrightnessResidual[index] = lumDiff;

        _reusableBinaryPairAdjustment[index] =
          settings.lumMatchWeight * lumDiff * lumDiff -
          computeHuePreservationBonus(
            cell.avgA,
            cell.avgB,
            metrics.binaryMixA[index],
            metrics.binaryMixB[index]
          );

        // TRUSKI3000: Blend match quality — how close is the perceptual blend
        // of this setCount/bg/fg combo to the source cell's average color?
        // Stored as quality in [0,1]: 1 = perfect match, 0 = poor match.
        // Used to reduce CSF penalty for high-frequency characters whose blend is correct.
        const dL = cell.avgL - metrics.binaryMixL[index];
        const dA = cell.avgA - metrics.binaryMixA[index];
        const dB = cell.avgB - metrics.binaryMixB[index];
        const blendError = dL * dL + dA * dA + dB * dB;
        const blendQuality = 1 / (1 + blendError * BLEND_QUALITY_SHARPNESS);
        _reusableBlendMatchBonus[index] = blendQuality;

        // Standalone blend bonus: good blend match reduces pair error regardless of csfWeight
        _reusableBinaryPairAdjustment[index] -= BLEND_MATCH_WEIGHT * blendQuality;
      }
    }
  }

  return {
    pairAdjustment: _reusableBinaryPairAdjustment,
    brightnessResidual: _reusableBinaryBrightnessResidual,
    csfPenaltyByChar: _reusableBinaryCsfPenalty,
    blendMatchBonus: _reusableBlendMatchBonus,
  };
}

function canUseBinaryHammingPath(
  settings: ConverterSettings,
  scoringKernel?: StandardCandidateScoringKernel
): boolean {
  return Boolean(
    ENABLE_EXPERIMENTAL_HAMMING_FAST_PATH &&
    scoringKernel?.computeHammingDistances &&
    settings.saliencyAlpha === 0 &&
    settings.csfWeight === 0 &&
    settings.lumMatchWeight === 0
  );
}

function computeBinaryHammingDistances(
  cell: SourceCellData,
  fg: number,
  bg: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  scoringKernel?: StandardCandidateScoringKernel
): Uint8Array {
  const [thresholdLo, thresholdHi] = packBinaryThresholdMap(cell.weightedPixelErrors, fg, bg);
  if (scoringKernel?.computeHammingDistances) {
    return scoringKernel.computeHammingDistances(thresholdLo, thresholdHi, metrics.pairDiff, context);
  }
  return computeBinaryHammingDistancesJs(
    thresholdLo,
    thresholdHi,
    context.packedBinaryGlyphLo,
    context.packedBinaryGlyphHi,
    _reusableBinaryHamming
  );
}

function buildBinaryBestErrorByBackground(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  scoringKernel?: StandardCandidateScoringKernel
): Float64Array {
  const candidateScreencodes = getCandidateScreencodes(settings.includeTypographic);
  if (scoringKernel?.computeBestErrorByBackground) {
    return scoringKernel.computeBestErrorByBackground(
      cell.weightedPixelErrors,
      cell.totalErrByColor,
      cell.avgL,
      cell.avgA,
      cell.avgB,
      cell.detailScore,
      {
        lumMatchWeight: settings.lumMatchWeight,
        csfWeight: settings.csfWeight,
      },
      candidateScreencodes,
      metrics,
      context
    );
  }

  const best = new Float64Array(16);
  best.fill(Infinity);
  const foregroundsByBackground = getForegroundCandidatesByBackground(metrics);
  const scoringTables = buildBinaryCellScoringTables(cell, context, metrics, settings);

  // Coarse-only coverage extremity: penalize backgrounds that force extreme
  // coverage ratios (near 0% or 100%) in cells. Scaled by luminance distance
  // between cell average and background color — when bg is far from the cell's
  // brightness, the converter is forced into near-solid blocks, killing PETSCII
  // character diversity. Dark images (small lumDistance to bg=0) are unaffected.
  // This does NOT affect pool building or per-cell solving.
  const covBgWeight = new Float64Array(16);
  for (let bg = 0; bg < 16; bg++) {
    const lumDistance = Math.abs(cell.avgL - metrics.pL[bg]);
    covBgWeight[bg] = COVERAGE_EXTREMITY_WEIGHT * lumDistance;
  }

  if (canUseBinaryHammingPath(settings, scoringKernel)) {
    for (let bg = 0; bg < 16; bg++) {
      const covW = covBgWeight[bg];
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const hammingDistances = computeBinaryHammingDistances(cell, fg, bg, context, metrics, scoringKernel);
        for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
          const ch = candidateScreencodes[charIndex];
          const nSet = context.refSetCount[ch];
          const mixIndex = binaryMixIndex(nSet, bg, fg);
          const covRatio = nSet / PIXELS_PER_CELL;
          const extremity = (2 * covRatio - 1) * (2 * covRatio - 1);
          const total = hammingDistances[ch] + scoringTables.pairAdjustment[mixIndex] + covW * extremity;
          if (total < best[bg]) best[bg] = total;
        }
      }
    }
    return best;
  }

  const setErrMatrix = computeSetErrMatrix(cell, context, scoringKernel);

  for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
    const ch = candidateScreencodes[charIndex];
    const rowBase = ch * 16;
    const nSet = context.refSetCount[ch];
    const csfPenalty = scoringTables.csfPenaltyByChar[ch];
    const covRatio = nSet / PIXELS_PER_CELL;
    const extremity = (2 * covRatio - 1) * (2 * covRatio - 1);
    for (let bg = 0; bg < 16; bg++) {
      const bgErr = cell.totalErrByColor[bg] - setErrMatrix[rowBase + bg];
      if (bgErr >= best[bg]) continue;
      const covPenalty = covBgWeight[bg] * extremity;
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const mixIndex = binaryMixIndex(nSet, bg, fg);
        const total =
          bgErr +
          setErrMatrix[rowBase + fg] +
          csfPenalty +
          scoringTables.pairAdjustment[mixIndex] +
          covPenalty;
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
  const candidateScreencodes = getCandidateScreencodes(settings.includeTypographic);
  const foregroundsByBackground = getForegroundCandidatesByBackground(metrics);
  const scoringTables = buildBinaryCellScoringTables(cell, context, metrics, settings);

  // Scale edge penalty by cell detail — flat cells (detailScore ~0) get no edge penalty,
  // high-detail cells get full penalty. This prevents degrading flat-zone color matching.
  const edgeWeight = EDGE_MISMATCH_WEIGHT * cell.detailScore;
  const hasEdges = cell.edgePixelCount > 0 && edgeWeight > 0.01;
  const eMaskLo = cell.edgeMaskLo;
  const eMaskHi = cell.edgeMaskHi;

  if (canUseBinaryHammingPath(settings, scoringKernel)) {
    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const pool = pools[bi];
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const hammingDistances = computeBinaryHammingDistances(cell, fg, bg, context, metrics, scoringKernel);

        let thresholdLo = 0, thresholdHi = 0;
        if (hasEdges) {
          [thresholdLo, thresholdHi] = packBinaryThresholdMap(cell.weightedPixelErrors, fg, bg);
        }

        for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
          const ch = candidateScreencodes[charIndex];
          const mixIndex = binaryMixIndex(context.refSetCount[ch], bg, fg);
          let total = hammingDistances[ch] + scoringTables.pairAdjustment[mixIndex];

          if (hasEdges) {
            const mismatchLo = (context.packedBinaryGlyphLo[ch] ^ thresholdLo) >>> 0;
            const mismatchHi = (context.packedBinaryGlyphHi[ch] ^ thresholdHi) >>> 0;
            const edgeMismatches =
              popcount32((mismatchLo & eMaskLo) >>> 0) +
              popcount32((mismatchHi & eMaskHi) >>> 0);
            total += edgeWeight * edgeMismatches;
          }

          // TRUSKI3000: Net CSF/blend term — blend quality reduces the CSF penalty.
          // When a high-frequency glyph's blend matches the source, its spatial
          // frequency is the mechanism for correct perceived color, not noise.
          const sf = context.glyphAtlas.spatialFrequency[ch];
          if (sf > 0.1) {
            const blendQuality = scoringTables.blendMatchBonus[mixIndex];
            const csfBase = settings.csfWeight * sf * Math.max(0, 1 - cell.detailScore);
            total += csfBase * (1 - BLEND_CSF_RELIEF * blendQuality);
          }

          if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
            insertTopCandidate(
              pool,
              makeBinaryCandidate(
                context.ref[ch],
                ch,
                bg,
                fg,
                context.glyphAtlas.dominantDirection[ch] as CellGradientDirection,
                total,
                scoringTables.brightnessResidual[mixIndex],
                metrics.pairDiff,
                metrics.maxPairDiff
              ),
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
      pools[bi] = [makeBinaryCandidate(
        context.ref[32],
        32,
        bg,
        fg,
        context.glyphAtlas.dominantDirection[32] as CellGradientDirection,
        Infinity,
        0,
        metrics.pairDiff,
        metrics.maxPairDiff
      )];
    }

    return pools;
  }

  let setErrMatrix: Float32Array;
  if (scoringKernel?.computeCandidatePoolsByBackground) {
    const wasmPools = scoringKernel.computeCandidatePoolsByBackground(
      cell.weightedPixelErrors,
      cell.totalErrByColor,
      cell.avgL,
      cell.avgA,
      cell.avgB,
      cell.detailScore,
      {
        lumMatchWeight: settings.lumMatchWeight,
        csfWeight: settings.csfWeight,
      },
      backgrounds,
      poolSize,
      eMaskLo,
      eMaskHi,
      edgeWeight,
      candidateScreencodes,
      metrics,
      context
    );
    setErrMatrix = wasmPools.setErrs;

    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const pool = pools[bi];
      const count = Math.min(poolSize, wasmPools.counts[bi] ?? 0);
      const base = bi * 16;
      for (let slot = 0; slot < count; slot++) {
        const ch = wasmPools.chars[base + slot] ?? 0;
        const fg = wasmPools.fgs[base + slot] ?? 0;
        const total = wasmPools.scores[base + slot] ?? Infinity;
        const mixIndex = binaryMixIndex(context.refSetCount[ch], bg, fg);
        pool.push(
          makeBinaryCandidate(
            context.ref[ch],
            ch,
            bg,
            fg,
            context.glyphAtlas.dominantDirection[ch] as CellGradientDirection,
            total,
            scoringTables.brightnessResidual[mixIndex],
            metrics.pairDiff,
            metrics.maxPairDiff
          )
        );
      }
    }
  } else {
    setErrMatrix = computeSetErrMatrix(cell, context, scoringKernel);

    for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
      const ch = candidateScreencodes[charIndex];
      const rowBase = ch * 16;
      const nSet = context.refSetCount[ch];
      const sfCh = context.glyphAtlas.spatialFrequency[ch];
      // For low-frequency characters (solid blocks, quarter-fills), use the precomputed
      // CSF penalty directly. For high-frequency characters, compute the net CSF/blend
      // term inline so that blend quality can reduce or negate the penalty.
      const csfPenalty = sfCh <= 0.1 ? scoringTables.csfPenaltyByChar[ch] : 0;
      const csfBase = sfCh > 0.1 ? settings.csfWeight * sfCh * Math.max(0, 1 - cell.detailScore) : 0;

      for (let bi = 0; bi < backgrounds.length; bi++) {
        const bg = backgrounds[bi];
        const pool = pools[bi];
        const worst = pool.length >= poolSize ? pool[pool.length - 1].baseError : Infinity;
        const bgErr = cell.totalErrByColor[bg] - setErrMatrix[rowBase + bg];
        if (bgErr >= worst) continue;

        const foregrounds = foregroundsByBackground[bg];
        for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
          const fg = foregrounds[fgIndex];
          const mixIndex = binaryMixIndex(nSet, bg, fg);
          let total =
            bgErr +
            setErrMatrix[rowBase + fg] +
            csfPenalty +
            scoringTables.pairAdjustment[mixIndex];

          // TRUSKI3000: Edge-weighted penalty for set-error path
          if (hasEdges) {
            const [tLo, tHi] = packBinaryThresholdMap(cell.weightedPixelErrors, fg, bg);
            const mLo = (context.packedBinaryGlyphLo[ch] ^ tLo) >>> 0;
            const mHi = (context.packedBinaryGlyphHi[ch] ^ tHi) >>> 0;
            const edgeMismatches =
              popcount32((mLo & eMaskLo) >>> 0) +
              popcount32((mHi & eMaskHi) >>> 0);
            total += edgeWeight * edgeMismatches;
          }

          // TRUSKI3000: Net CSF/blend term for set-error path — blend quality
          // reduces the CSF penalty so dithering characters can win when their
          // perceptual blend matches the source color.
          if (sfCh > 0.1) {
            const blendQuality = scoringTables.blendMatchBonus[mixIndex];
            total += csfBase * (1 - BLEND_CSF_RELIEF * blendQuality);
          }

          if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
            insertTopCandidate(
              pool,
              makeBinaryCandidate(
                context.ref[ch],
                ch,
                bg,
                fg,
                context.glyphAtlas.dominantDirection[ch] as CellGradientDirection,
                total,
                scoringTables.brightnessResidual[mixIndex],
                metrics.pairDiff,
                metrics.maxPairDiff
              ),
              poolSize
            );
          }
        }
      }
    }
  }

  // Competitive wildcard admission: score low-contrast fg candidates and admit
  // only those that are competitive with the best normal candidate or have
  // clearly superior color-match (blend quality).
  for (let bi = 0; bi < backgrounds.length; bi++) {
    const bg = backgrounds[bi];
    const pool = pools[bi];
    const bestNormal = pool.length > 0 ? pool[0].baseError : Infinity;
    const scoreThreshold = bestNormal * (1 + WILDCARD_SCORE_MARGIN);
    let admitted = 0;

    for (let fg = 0; fg < 16 && admitted < WILDCARD_MAX_ADMITTED; fg++) {
      if (fg === bg) continue;
      if (hasMinimumContrast(metrics, fg, bg)) continue; // already in main pass

      for (let charIndex = 0; charIndex < candidateScreencodes.length && admitted < WILDCARD_MAX_ADMITTED; charIndex++) {
        const ch = candidateScreencodes[charIndex];
        const rowBase = ch * 16;
        const nSet = context.refSetCount[ch];
        const sfCh = context.glyphAtlas.spatialFrequency[ch];
        const csfPenalty = sfCh <= 0.1 ? scoringTables.csfPenaltyByChar[ch] : 0;
        const csfBase = sfCh > 0.1 ? settings.csfWeight * sfCh * Math.max(0, 1 - cell.detailScore) : 0;

        const bgErr = cell.totalErrByColor[bg] - setErrMatrix[rowBase + bg];
        if (bgErr >= scoreThreshold) continue;

        const mixIndex = binaryMixIndex(nSet, bg, fg);
        let total =
          bgErr +
          setErrMatrix[rowBase + fg] +
          csfPenalty +
          scoringTables.pairAdjustment[mixIndex];

        if (hasEdges) {
          const [tLo, tHi] = packBinaryThresholdMap(cell.weightedPixelErrors, fg, bg);
          const mLo = (context.packedBinaryGlyphLo[ch] ^ tLo) >>> 0;
          const mHi = (context.packedBinaryGlyphHi[ch] ^ tHi) >>> 0;
          const edgeMismatches =
            popcount32((mLo & eMaskLo) >>> 0) +
            popcount32((mHi & eMaskHi) >>> 0);
          total += edgeWeight * edgeMismatches;
        }

        if (sfCh > 0.1) {
          const blendQuality = scoringTables.blendMatchBonus[mixIndex];
          total += csfBase * (1 - BLEND_CSF_RELIEF * blendQuality);
        }

        // Admission criteria: competitive score OR strong blend quality
        const blendQuality = scoringTables.blendMatchBonus[mixIndex];
        const isCompetitive = total <= scoreThreshold;
        const hasColorAdvantage = blendQuality >= WILDCARD_BLEND_QUALITY_MIN;
        if (!isCompetitive && !hasColorAdvantage) continue;

        if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
          insertTopCandidate(
            pool,
            makeBinaryCandidate(
              context.ref[ch],
              ch,
              bg,
              fg,
              context.glyphAtlas.dominantDirection[ch] as CellGradientDirection,
              total,
              scoringTables.brightnessResidual[mixIndex],
              metrics.pairDiff,
              metrics.maxPairDiff
            ),
            poolSize
          );
          admitted++;
        }
      }
    }
  }

  for (let bi = 0; bi < backgrounds.length; bi++) {
    if (pools[bi].length > 0) continue;
    const bg = backgrounds[bi] ?? 0;
    const fg = bg === 0 ? 1 : 0;
    pools[bi] = [makeBinaryCandidate(
      context.ref[32],
      32,
      bg,
      fg,
      context.glyphAtlas.dominantDirection[32] as CellGradientDirection,
      Infinity,
      0,
      metrics.pairDiff,
      metrics.maxPairDiff
    )];
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

function clampBrightnessDebt(value: number): number {
  return Math.max(-BRIGHTNESS_DEBT_CLAMP, Math.min(BRIGHTNESS_DEBT_CLAMP, value));
}

function countMaskBits(mask: number): number {
  let value = mask >>> 0;
  let count = 0;
  while (value !== 0) {
    value &= value - 1;
    count++;
  }
  return count;
}

function seedSelectionWithBrightnessDebt(
  candidatePools: ScreenCandidate[][]
): { selectedIndices: Int32Array; selected: ScreenCandidate[] } {
  const selectedIndices = new Int32Array(CELL_COUNT);
  const selected = new Array<ScreenCandidate>(CELL_COUNT);
  const verticalDebt = new Float32Array(GRID_WIDTH);

  for (let cy = 0; cy < GRID_HEIGHT; cy++) {
    let horizontalDebt = 0;
    for (let cx = 0; cx < GRID_WIDTH; cx++) {
      const cellIndex = cy * GRID_WIDTH + cx;
      const pool = candidatePools[cellIndex];
      let bestIdx = 0;
      let bestCost = Infinity;

      for (let candidateIndex = 0; candidateIndex < pool.length; candidateIndex++) {
        const candidate = pool[candidateIndex];
        const debtAfter = clampBrightnessDebt(horizontalDebt + verticalDebt[cx] + candidate.brightnessResidual);
        const cost = candidate.baseError + BRIGHTNESS_DEBT_WEIGHT * debtAfter * debtAfter;
        if (cost < bestCost) {
          bestCost = cost;
          bestIdx = candidateIndex;
        }
      }

      const chosen = pool[bestIdx];
      selectedIndices[cellIndex] = bestIdx;
      selected[cellIndex] = chosen;
      horizontalDebt = clampBrightnessDebt((horizontalDebt + chosen.brightnessResidual) * BRIGHTNESS_DEBT_DECAY);
      verticalDebt[cx] = clampBrightnessDebt((verticalDebt[cx] + chosen.brightnessResidual) * BRIGHTNESS_DEBT_DECAY);
    }
  }

  return { selectedIndices, selected };
}

function computeCellCost(
  cellIndex: number,
  candidate: ScreenCandidate,
  selected: ScreenCandidate[],
  metrics: PaletteMetricData,
  analysis: SourceAnalysis
): number {
  const cx = cellIndex % GRID_WIDTH;
  const cy = Math.floor(cellIndex / GRID_WIDTH);
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

  return cost;
}

function buildNeighborCoherenceMask(selected: ScreenCandidate[], cellIndex: number): number {
  const cx = cellIndex % GRID_WIDTH;
  const cy = Math.floor(cellIndex / GRID_WIDTH);
  let mask = 0;

  if (cx > 0) mask |= selected[cellIndex - 1].coherenceColorMask;
  if (cx < GRID_WIDTH - 1) mask |= selected[cellIndex + 1].coherenceColorMask;
  if (cy > 0) mask |= selected[cellIndex - GRID_WIDTH].coherenceColorMask;
  if (cy < GRID_HEIGHT - 1) mask |= selected[cellIndex + GRID_WIDTH].coherenceColorMask;

  return mask;
}

function runColorCoherencePass(
  candidatePools: ScreenCandidate[][],
  selectedIndices: Int32Array,
  selected: ScreenCandidate[],
  analysis: SourceAnalysis,
  metrics: PaletteMetricData
) {
  for (let pass = 0; pass < COLOR_COHERENCE_PASSES; pass++) {
    for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex++) {
      const neighborMask = buildNeighborCoherenceMask(selected, cellIndex);
      if (neighborMask === 0) continue;

      const current = selected[cellIndex];
      const currentMissing = countMaskBits(current.coherenceColorMask & ~neighborMask);
      if (currentMissing === 0) continue;

      const currentCost = computeCellCost(cellIndex, current, selected, metrics, analysis);
      let bestIdx = selectedIndices[cellIndex];
      let bestCost = currentCost;
      let bestMissing = currentMissing;

      for (let candidateIndex = 0; candidateIndex < candidatePools[cellIndex].length; candidateIndex++) {
        if (candidateIndex === selectedIndices[cellIndex]) continue;
        const candidate = candidatePools[cellIndex][candidateIndex];
        if ((candidate.coherenceColorMask & neighborMask) === 0) continue;

        const candidateMissing = countMaskBits(candidate.coherenceColorMask & ~neighborMask);
        if (candidateMissing >= bestMissing) continue;

        const cost = computeCellCost(cellIndex, candidate, selected, metrics, analysis);
        if (cost <= currentCost + COLOR_COHERENCE_MAX_DELTA && (candidateMissing < bestMissing || cost < bestCost)) {
          bestIdx = candidateIndex;
          bestCost = cost;
          bestMissing = candidateMissing;
        }
      }

      if (bestIdx !== selectedIndices[cellIndex]) {
        selectedIndices[cellIndex] = bestIdx;
        selected[cellIndex] = candidatePools[cellIndex][bestIdx];
      }
    }
  }
}

function runEdgeContinuityPass(
  candidatePools: ScreenCandidate[][],
  selectedIndices: Int32Array,
  selected: ScreenCandidate[],
  analysis: SourceAnalysis,
  metrics: PaletteMetricData
) {
  for (let pass = 0; pass < EDGE_CONTINUITY_PASSES; pass++) {
    for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex++) {
      const cell = analysis.cells[cellIndex];
      const current = selected[cellIndex];
      const currentAlignment = computeDirectionalAlignmentBonus(
        cell.detailScore,
        cell.gradientDirection,
        current.glyphDirection
      );
      if (currentAlignment <= 0 && cell.detailScore < 0.45) continue;

      const currentRawCost = computeCellCost(cellIndex, current, selected, metrics, analysis);
      let bestIdx = selectedIndices[cellIndex];
      let bestAlignment = currentAlignment;
      let bestAdjustedCost = currentRawCost - currentAlignment;

      for (let candidateIndex = 0; candidateIndex < candidatePools[cellIndex].length; candidateIndex++) {
        if (candidateIndex === selectedIndices[cellIndex]) continue;
        const candidate = candidatePools[cellIndex][candidateIndex];
        const candidateAlignment = computeDirectionalAlignmentBonus(
          cell.detailScore,
          cell.gradientDirection,
          candidate.glyphDirection
        );
        if (candidateAlignment <= bestAlignment) continue;

        const candidateRawCost = computeCellCost(cellIndex, candidate, selected, metrics, analysis);
        if (candidateRawCost > currentRawCost + EDGE_CONTINUITY_MAX_DELTA) continue;

        const candidateAdjustedCost = candidateRawCost - candidateAlignment;
        if (candidateAdjustedCost < bestAdjustedCost) {
          bestIdx = candidateIndex;
          bestAlignment = candidateAlignment;
          bestAdjustedCost = candidateAdjustedCost;
        }
      }

      if (bestIdx !== selectedIndices[cellIndex]) {
        selectedIndices[cellIndex] = bestIdx;
        selected[cellIndex] = candidatePools[cellIndex][bestIdx];
      }
    }
  }
}

async function solveScreen(
  candidatePools: ScreenCandidate[][],
  analysis: SourceAnalysis,
  metrics: PaletteMetricData,
  shouldCancel?: () => boolean
): Promise<PetsciiResult> {
  const seededSelection = seedSelectionWithBrightnessDebt(candidatePools);
  const selectedIndices = seededSelection.selectedIndices;
  const selected = seededSelection.selected;

  for (let pass = 0; pass < SCREEN_SOLVE_PASSES; pass++) {
    let changed = false;
    const start = pass % 2 === 0 ? 0 : CELL_COUNT - 1;
    const end = pass % 2 === 0 ? CELL_COUNT : -1;
    const step = pass % 2 === 0 ? 1 : -1;
    let visitCount = 0;

    for (let cellIndex = start; cellIndex !== end; cellIndex += step) {
      const pool = candidatePools[cellIndex];
      let bestIdx = selectedIndices[cellIndex];
      let bestCost = Infinity;

      for (let candidateIndex = 0; candidateIndex < pool.length; candidateIndex++) {
        const candidate = pool[candidateIndex];
        const cost = computeCellCost(cellIndex, candidate, selected, metrics, analysis);

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

  runColorCoherencePass(candidatePools, selectedIndices, selected, analysis, metrics);
  runEdgeContinuityPass(candidatePools, selectedIndices, selected, analysis, metrics);

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
      offset: { x: 0, y: 0 },
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
  return {
    ...result,
    offset,
  };
}

export async function solveStandardOffset(
  preprocessed: StandardPreprocessedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  metrics: PaletteMetricData,
  offset: AlignmentOffset,
  scoringKernel?: StandardCandidateScoringKernel,
  shouldCancel?: () => boolean,
  onProgress?: ProgressCallback
): Promise<StandardSolvedModeCandidate> {
  const analysis = analyzeAlignedSourceImage(preprocessed, metrics, settings, offset.x, offset.y);
  let best: StandardSolvedModeCandidate | undefined;

  for (const [charsetIndex, charset] of (['upper', 'lower'] as const).entries()) {
    const charsetProgress = onProgress
      ? createScopedProgress(
          (stage, detail, pct) => onProgress(stage, `${charset.toUpperCase()}${detail ? ` - ${detail}` : ''}`, pct),
          charsetIndex * 50,
          50
        )
      : undefined;
    const candidate = await solveStandardCharsetForAnalysis(
      analysis,
      settings,
      contexts[charset],
      metrics,
      charset,
      scoringKernel,
      charsetProgress,
      shouldCancel
    );
    candidate.offset = offset;
    if (!best || candidate.error < best.error) {
      best = candidate;
    }
  }

  return best!;
}
