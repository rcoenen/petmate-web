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
import type { StandardCandidateScoringKernel } from './imageConverterBinaryWasm';
import {
  disposeStandardConverterWorkers,
  runStandardConversionInWorkers,
  setStandardWorkerAccelerationMode,
} from './imageConverterStandardWorkerPool';
import {
  disposeModeConverterWorkers,
  runModeConversionInWorkers,
  setModeWorkerAccelerationMode,
} from './imageConverterModeWorkerPool';
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
  computeMcmHammingDistancesJs,
  packBinaryGlyphBitplanes,
  packBinaryThresholdMap,
  packMcmGlyphSymbolMasks,
  packMcmThresholdMasks,
  popcount32,
  type PackedMcmGlyphMasks,
} from './imageConverterBitPacking';
import { computeCellStructureMetrics, type CellGradientDirection } from './imageConverterCellMetrics';
import { buildGlyphAtlasMetadata, type GlyphAtlasMetadata } from './glyphAtlas';

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 200;
const CELL_WIDTH = 8;
const CELL_HEIGHT = 8;
const GRID_WIDTH = 40;
const GRID_HEIGHT = 25;
const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
const PIXELS_PER_CELL = CELL_WIDTH * CELL_HEIGHT;
const MCM_PIXELS_PER_CELL = 32;

// Quality-first search budgets. These intentionally spend more time to let
// ECM/MCM explore more global color sets and per-cell alternatives.
const ECM_SAMPLE_COUNT = 192;
const MCM_SAMPLE_COUNT = 64;
const ECM_FINALIST_COUNT = 16;
const MCM_FINALIST_COUNT = 12;
const ECM_POOL_SIZE = 10;
const MCM_POOL_SIZE = 10;
const SCREEN_SOLVE_PASSES = 7;

const LUMA_ERROR_WEIGHT = 1.0;
const CHROMA_ERROR_WEIGHT = 1.0;
// TRUSKI3000: Edge-weighted scoring — penalize character mismatches at edge pixels
// more heavily than flat-zone mismatches. This steers character selection toward
// glyphs whose shapes align with source edges/contours.
const EDGE_MISMATCH_WEIGHT = 0.0; // TRUSKI3000: disabled pending color-selection fixes; see edge-weight experiment notes
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
const ECM_REGISTER_RESOLVE_PASSES = 4;
const ECM_REGISTER_KMEANS_ITERATIONS = 4;
const ECM_REGISTER_RESOLVE_ERROR_SCALE = 64.0;
const MCM_HIRES_COLOR_PENALTY_WEIGHT = 0;
const MCM_MULTICOLOR_USAGE_BONUS_WEIGHT = 0;
const ENABLE_EXPERIMENTAL_HAMMING_FAST_PATH = false;
const ENABLE_MCM_CELL_STATE_REUSE = true;

// --- Reusable WASM solve buffers (shared by ECM/MCM solveScreen) ---
const _ecmSolveCounts = new Uint8Array(CELL_COUNT);
const _ecmSolveChars = new Uint8Array(CELL_COUNT * 16);
const _ecmSolveFgs = new Uint8Array(CELL_COUNT * 16);
const _ecmSolveBaseErrors = new Float64Array(CELL_COUNT * 16);
const _ecmSolveBrightnessResiduals = new Float64Array(CELL_COUNT * 16);
const _ecmSolveRepeatH = new Float64Array(CELL_COUNT * 16);
const _ecmSolveRepeatV = new Float64Array(CELL_COUNT * 16);
const _ecmSolveCoherenceColorMasks = new Uint16Array(CELL_COUNT * 16);
const _ecmSolveGlyphDirections = new Uint8Array(CELL_COUNT * 16);
const _ecmSolveEdgeLeft = new Uint8Array(CELL_COUNT * 16 * 8);
const _ecmSolveEdgeRight = new Uint8Array(CELL_COUNT * 16 * 8);
const _ecmSolveEdgeTop = new Uint8Array(CELL_COUNT * 16 * 8);
const _ecmSolveEdgeBottom = new Uint8Array(CELL_COUNT * 16 * 8);

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

export interface PaletteColor {
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

export function buildPaletteColorsById(paletteId: string): PaletteColor[] {
  const paletteDef = PALETTES.find(p => p.id === paletteId) ?? PALETTES[0];
  return buildPaletteColors(paletteDef.hex);
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

// --- Settings ---

export interface ConverterSettings {
  brightnessFactor: number;
  saturationFactor: number;
  saliencyAlpha: number;
  lumMatchWeight: number;
  csfWeight: number;
  includeTypographic: boolean;
  accelerationMode: ConverterAccelerationMode;
  paletteId: string;
  manualBgColor: number | null;
  outputStandard: boolean;
  outputEcm: boolean;
  outputMcm: boolean;
}

export type ConverterAccelerationMode = 'wasm' | 'js';
export const CONVERTER_DEFAULTS: ConverterSettings = {
  brightnessFactor: 1.0,
  saturationFactor: 1.0,
  saliencyAlpha: 2.0,
  lumMatchWeight: 4,
  csfWeight: 0,
  includeTypographic: true,
  accelerationMode: 'wasm',
  paletteId: 'colodore',
  manualBgColor: null,
  outputStandard: true,
  outputEcm: false,
  outputMcm: false,
};

export const CONVERTER_PRESETS = [
  {
    id: 'true-neutral',
    name: 'True Neutral',
    ...CONVERTER_DEFAULTS,
  },
  {
    id: 'robs-favorite',
    name: "Rob's Favorite",
    brightnessFactor: 1.1,
    saturationFactor: 1.4,
    saliencyAlpha: 3.0,
    lumMatchWeight: 12,
    csfWeight: 10,
    includeTypographic: true,
    accelerationMode: 'wasm' as ConverterAccelerationMode,
    paletteId: 'colodore',
    manualBgColor: null as number | null,
  },
];

// --- Results ---

export type ConverterCharset = 'upper' | 'lower';
export type ConverterAccelerationPath = 'wasm' | 'js';
export type StandardAccelerationPath = ConverterAccelerationPath;

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
  accelerationBackend?: ConverterAccelerationPath;
  qualityMetric?: ConversionQualityMetric;
  cellMetadata?: ConversionCellMetadata[];
}

export interface ConversionQualityMetric {
  meanDeltaE: number;
  perCellDeltaE: number[];
}

export interface ConversionCellMetadata {
  fgColor: number;
  bgColor: number;
  errorScore: number;
  detailScore: number;
  saliencyWeight: number;
  mcmCellIsHires?: boolean;
  // Color diagnostics: ideal 2-color quantization vs actual choice
  idealColor1?: number;  // palette index of best-fitting dominant color
  idealColor2?: number;  // palette index of second color
  idealError?: number;   // error if ideal pair had been used
  chosenError?: number;  // error of the actually chosen pair
  screencode?: number;   // chosen character
}

export interface ConversionOutputs {
  standard?: ConversionResult;
  ecm?: ConversionResult;
  mcm?: ConversionResult;
  previewStd?: ImageData;
  previewEcm?: ImageData;
  previewMcm?: ImageData;
}

export interface AlignmentOffset {
  x: number;
  y: number;
}

type BitPairPositionSets = [Uint8Array, Uint8Array, Uint8Array, Uint8Array];

export interface CharsetConversionContext {
  ref: Uint8Array[];
  refSetCount: Int32Array;
  setPositions: Uint8Array[];
  flatPositions: Uint8Array;
  positionOffsets: Int32Array;
  packedBinaryGlyphLo: Uint32Array;
  packedBinaryGlyphHi: Uint32Array;
  glyphAtlas: GlyphAtlasMetadata;
  refMcm?: Uint8Array[];
  refMcmBpCount?: Int32Array[];
  refMcmPositions?: BitPairPositionSets[];
  flatMcmPositions?: Uint8Array[];
  mcmPositionOffsets?: Int32Array[];
  packedMcmGlyphMasks?: PackedMcmGlyphMasks;
}

interface SourceCellData {
  weightedPixelErrors: Float32Array; // 64 * 16
  totalErrByColor: Float32Array;     // 16
  weightedPairErrors?: Float32Array; // 32 * 16
  avgL: number;
  avgA: number;
  avgB: number;
  saliencyWeight: number;
  detailScore: number;
  gradientDirection: CellGradientDirection;
  edgeMaskLo: number;
  edgeMaskHi: number;
  edgePixelCount: number;
}

interface SourceAnalysis {
  cells: SourceCellData[];
  colorCounts: number[];
  detailScores: Float32Array;
  gradientDirections: Uint8Array;
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

export interface PreprocessedFittedImage {
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
  brightnessResidual: number;
  coherenceColorMask: number;
  glyphDirection: CellGradientDirection;
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
  preview?: ImageData;
  error: number;
  offset: AlignmentOffset;
}

export interface WorkerSolvedModeCandidate {
  conversion: ConversionResult;
  error: number;
  offset: AlignmentOffset;
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

function buildFlatPositions(setPositions: Uint8Array[]): {
  flatPositions: Uint8Array;
  positionOffsets: Int32Array;
} {
  const allPositions: number[] = [];
  const positionOffsets = new Int32Array(setPositions.length + 1);
  for (let ch = 0; ch < setPositions.length; ch++) {
    positionOffsets[ch] = allPositions.length;
    const positions = setPositions[ch];
    for (let i = 0; i < positions.length; i++) {
      allPositions.push(positions[i]);
    }
  }
  positionOffsets[setPositions.length] = allPositions.length;
  return {
    flatPositions: Uint8Array.from(allPositions),
    positionOffsets,
  };
}

function buildRefMcmData(ref: Uint8Array[]): {
  refMcm: Uint8Array[];
  refMcmBpCount: Int32Array[];
  refMcmPositions: BitPairPositionSets[];
  flatMcmPositions: Uint8Array[];
  mcmPositionOffsets: Int32Array[];
} {
  const refMcm: Uint8Array[] = [];
  const refMcmBpCount: Int32Array[] = [];
  const refMcmPositions: BitPairPositionSets[] = [];
  const flatMcmPositions = [[], [], [], []] as number[][];
  const mcmPositionOffsets = Array.from({ length: 4 }, () => new Int32Array(257));

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
    for (let bp = 0; bp < 4; bp++) {
      mcmPositionOffsets[bp][ch] = flatMcmPositions[bp].length;
      for (let i = 0; i < posLists[bp].length; i++) {
        flatMcmPositions[bp].push(posLists[bp][i]);
      }
    }
  }

  for (let bp = 0; bp < 4; bp++) {
    mcmPositionOffsets[bp][256] = flatMcmPositions[bp].length;
  }

  return {
    refMcm,
    refMcmBpCount,
    refMcmPositions,
    flatMcmPositions: flatMcmPositions.map(positions => Uint8Array.from(positions)),
    mcmPositionOffsets,
  };
}

export function buildCharsetConversionContext(fontBits: number[], includeMcm: boolean): CharsetConversionContext {
  const ref = buildRefChars(fontBits);
  const setPositions = buildSetPositions(ref);
  const { flatPositions, positionOffsets } = buildFlatPositions(setPositions);
  const refSetCount = new Int32Array(setPositions.map(positions => positions.length));
  const glyphAtlas = buildGlyphAtlasMetadata(ref);
  const { packedBinaryGlyphLo, packedBinaryGlyphHi } = packBinaryGlyphBitplanes(ref);
  if (!includeMcm) {
    return {
      ref,
      refSetCount,
      setPositions,
      flatPositions,
      positionOffsets,
      packedBinaryGlyphLo,
      packedBinaryGlyphHi,
      glyphAtlas,
    };
  }
  const { refMcm, refMcmBpCount, refMcmPositions, flatMcmPositions, mcmPositionOffsets } = buildRefMcmData(ref);
  return {
    ref,
    refSetCount,
    setPositions,
    flatPositions,
    positionOffsets,
    packedBinaryGlyphLo,
    packedBinaryGlyphHi,
    glyphAtlas,
    refMcm,
    refMcmBpCount,
    refMcmPositions,
    flatMcmPositions,
    mcmPositionOffsets,
    packedMcmGlyphMasks: packMcmGlyphSymbolMasks(refMcm),
  };
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

type AlignedSourceOklab = {
  srcL: Float32Array;
  srcA: Float32Array;
  srcB: Float32Array;
};

function buildAlignedSourceOklab(
  preprocessed: PreprocessedFittedImage,
  offsetX: number,
  offsetY: number
): AlignedSourceOklab {
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

  return { srcL, srcA, srcB };
}

function analyzeAlignedSourceImage(
  preprocessed: PreprocessedFittedImage,
  paletteMetrics: PaletteMetricData,
  settings: ConverterSettings,
  includeMcm: boolean,
  offsetX: number,
  offsetY: number
): SourceAnalysis {
  const { srcL, srcA, srcB } = buildAlignedSourceOklab(preprocessed, offsetX, offsetY);
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
      for (let x = 0; x < copyWidth; x++) {
        colorCounts[preprocessed.nearestPalette[srcBase + x]]++;
      }
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
      const lumVariance = lumSqSum / PIXELS_PER_CELL - (lumSum / PIXELS_PER_CELL) ** 2;
      const chromaMagnitudeSq = meanA * meanA + meanB * meanB;
      variances[cellIndex] = lumVariance + 2.0 * chromaMagnitudeSq;

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

      // Compute per-pixel edge importance via Sobel magnitude, pack into bitmask
      let edgeMaskLo = 0;
      let edgeMaskHi = 0;
      let edgePixelCount = 0;
      {
        // Compute Sobel magnitude for each pixel; mark top fraction as edge pixels
        const sobelMag = new Float32Array(PIXELS_PER_CELL);
        let maxMag = 0;
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            const p = py * 8 + px;
            // Use central differences where possible, clamp at edges
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
        // Mark pixels above 30% of max magnitude as edge pixels
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
        weightedPairErrors,
        avgL: meanL,
        avgA: meanA,
        avgB: meanB,
        saliencyWeight: saliencyTotal / PIXELS_PER_CELL,
        detailScore: structureMetrics.detailScores[cellIndex],
        gradientDirection: structureMetrics.gradientDirections[cellIndex] as CellGradientDirection,
        edgeMaskLo,
        edgeMaskHi,
        edgePixelCount,
      };
    }
  }

  const order = Array.from({ length: CELL_COUNT }, (_, index) => index);
  order.sort((a, b) => variances[b] - variances[a]);
  const rankedIndices = Int32Array.from(order);

  return {
    cells,
    colorCounts,
    detailScores: structureMetrics.detailScores,
    gradientDirections: structureMetrics.gradientDirections,
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
    const scopedPct = progressStart + (pct / 100) * progressSpan;
    onProgress(stage, detail, scopedPct);
  };
}

function createMonotonicProgress(
  onProgress: ProgressCallback
): ProgressCallback {
  let highestPct = 0;

  return (stage, detail, pct) => {
    const boundedPct = Math.max(0, Math.min(100, Number(pct)));
    if (boundedPct > highestPct) {
      highestPct = boundedPct;
    }
    onProgress(stage, detail, Number(highestPct.toFixed(1)));
  };
}

export { ConversionCancelledError } from './imageConverterStandardCore';
export { disposeStandardConverterWorkers } from './imageConverterStandardWorkerPool';

export function setConverterAccelerationMode(mode: 'auto' | 'js' | 'wasm') {
  setStandardWorkerAccelerationMode(mode);
  setModeWorkerAccelerationMode(mode);
}

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

function buildMcmCoherenceColorMask(bits: Uint8Array, bg: number, fg: number): number {
  let hasBg = false;
  let hasFg = false;
  for (let i = 0; i < bits.length; i++) {
    const bitPair = bits[i];
    if (bitPair === 0) hasBg = true;
    if (bitPair === 3) hasFg = true;
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
  glyphDirection: CellGradientDirection,
  baseError: number,
  brightnessResidual: number,
  pairDiff: Float64Array,
  maxPairDiff: number
): ScreenCandidate {
  const fg = mcmForegroundColor(colorRam);
  const edges = buildMcmEdges(bits, bg, mc1, mc2, fg);
  const coherenceColorMask = buildMcmCoherenceColorMask(bits, bg, fg);
  return {
    char,
    fg: colorRam,
    bg,
    baseError,
    brightnessResidual,
    coherenceColorMask,
    glyphDirection,
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
  cellIndex: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number,
  fgLimit: number,
  scoringKernel?: BinaryCandidateScoringKernel
): Float64Array {
  const best = new Float64Array(16);
  best.fill(Infinity);
  const candidateScreencodes = getCandidateScreencodes(charLimit, settings.includeTypographic);
  const foregroundsByBackground = getForegroundCandidatesByBackground(metrics, fgLimit);
  const scoringTables = buildBinaryCellScoringTables(cell, context, metrics, settings, charLimit);

  if (canUseBinaryHammingPath(settings, scoringKernel)) {
    for (let bg = 0; bg < 16; bg++) {
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const hammingDistances = computeBinaryHammingDistances(cell, fg, bg, context, metrics, scoringKernel);
        for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
          const ch = candidateScreencodes[charIndex];
          const mixIndex = binaryMixIndex(context.refSetCount[ch], bg, fg);
          const total = hammingDistances[ch] + scoringTables.pairAdjustment[mixIndex];
          if (total < best[bg]) best[bg] = total;
        }
      }
    }
    return best;
  }

  const setErrMatrix = computeBinarySetErrMatrix(cell, context, scoringKernel, cellIndex);

  for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
    const ch = candidateScreencodes[charIndex];
    const setErrBase = ch * 16;
    const csfPenalty = scoringTables.csfPenaltyByChar[ch];

    const nSet = context.refSetCount[ch];
    for (let bg = 0; bg < 16; bg++) {
      const bgErr = cell.totalErrByColor[bg] - setErrMatrix[setErrBase + bg];
      if (bgErr >= best[bg]) continue;
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const mixIndex = binaryMixIndex(nSet, bg, fg);
        const total =
          bgErr +
          setErrMatrix[setErrBase + fg] +
          csfPenalty +
          scoringTables.pairAdjustment[mixIndex];
        if (total < best[bg]) best[bg] = total;
      }
    }
  }

  return best;
}

function buildBinaryCandidatePool(
  cell: SourceCellData,
  cellIndex: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number,
  backgrounds: number[],
  fgLimit: number,
  poolSize: number,
  scoringKernel?: BinaryCandidateScoringKernel
): ScreenCandidate[] {
  const pool: ScreenCandidate[] = [];
  const candidateScreencodes = getCandidateScreencodes(charLimit, settings.includeTypographic);
  const foregroundsByBackground = getForegroundCandidatesByBackground(metrics, fgLimit);
  const scoringTables = buildBinaryCellScoringTables(cell, context, metrics, settings, charLimit);

  if (canUseBinaryHammingPath(settings, scoringKernel)) {
    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const hammingDistances = computeBinaryHammingDistances(cell, fg, bg, context, metrics, scoringKernel);
        for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
          const ch = candidateScreencodes[charIndex];
          const mixIndex = binaryMixIndex(context.refSetCount[ch], bg, fg);
          const total = hammingDistances[ch] + scoringTables.pairAdjustment[mixIndex];
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

    if (pool.length > 0) return pool;
    const bg = backgrounds[0] ?? 0;
    const fg = bg === 0 ? 1 : 0;
    return [makeBinaryCandidate(
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

  const setErrMatrix = computeBinarySetErrMatrix(cell, context, scoringKernel, cellIndex);

  for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
    const ch = candidateScreencodes[charIndex];
    const setErrBase = ch * 16;
    const nSet = context.refSetCount[ch];
    const csfPenalty = scoringTables.csfPenaltyByChar[ch];
    const worst = pool.length >= poolSize ? pool[pool.length - 1].baseError : Infinity;

    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const bgErr = cell.totalErrByColor[bg] - setErrMatrix[setErrBase + bg];
      if (bgErr >= worst) continue;

      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const mixIndex = binaryMixIndex(nSet, bg, fg);
        const total =
          bgErr +
          setErrMatrix[setErrBase + fg] +
          csfPenalty +
          scoringTables.pairAdjustment[mixIndex];
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

  if (pool.length > 0) return pool;
  const bg = backgrounds[0] ?? 0;
  const fg = bg === 0 ? 1 : 0;
  return [makeBinaryCandidate(
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

interface McmSampleSummary {
  hiresSetErrByChar: Float32Array; // 256 * 16
  mcmBpErrByChar: Float32Array;    // 256 * 4 * 16
  csfPenaltyByChar: Float32Array;
  bestHiresCostByBg: Float64Array;
  avgL: number;
  avgA: number;
  avgB: number;
  totalErrByColor: Float32Array;
  detailScore: number;
  saliencyWeight: number;
}

interface McmCellScoringState {
  setErrs: Float32Array;
  bitPairErrs: Float32Array;
  csfPenaltyByChar: Float32Array;
}

type BinaryCellScoringTables = {
  pairAdjustment: Float64Array;
  brightnessResidual: Float32Array;
  csfPenaltyByChar: Float32Array;
};

type ResidentBinaryModeCell = Pick<SourceCellData, 'weightedPixelErrors'>;
type ResidentMcmModeCell = Pick<SourceCellData, 'weightedPixelErrors' | 'weightedPairErrors'>;

export interface BinaryCandidateScoringKernel {
  computeSetErrs(weightedPixelErrors: Float32Array, context: Pick<CharsetConversionContext, 'flatPositions' | 'positionOffsets'>): Float32Array;
  preloadModeCellErrors?(
    cells: ArrayLike<ResidentBinaryModeCell>
  ): void;
  computeSetErrsForModeCell?(
    cellIndex: number,
    context: Pick<CharsetConversionContext, 'flatPositions' | 'positionOffsets'>
  ): Float32Array;
  computeHammingDistances?(
    thresholdLo: number,
    thresholdHi: number,
    pairDiff: Float64Array,
    context: Pick<CharsetConversionContext, 'packedBinaryGlyphLo' | 'packedBinaryGlyphHi'>
  ): Uint8Array;
}

export interface McmCandidateScoringKernel {
  computeMatrices(
    weightedPixelErrors: Float32Array,
    weightedPairErrors: Float32Array,
    context: Pick<CharsetConversionContext, 'flatPositions' | 'positionOffsets' | 'flatMcmPositions' | 'mcmPositionOffsets'>
  ): {
    setErrs: Float32Array;
    bitPairErrs: Float32Array;
  };
  preloadModeCellErrors?(
    cells: ArrayLike<ResidentMcmModeCell>
  ): void;
  computeMatricesForModeCell?(
    cellIndex: number,
    context: Pick<CharsetConversionContext, 'flatPositions' | 'positionOffsets' | 'flatMcmPositions' | 'mcmPositionOffsets'>
  ): {
    setErrs: Float32Array;
    bitPairErrs: Float32Array;
  };
  computeHammingDistances?(
    thresholdMasks: Uint32Array,
    pairDiff: Float64Array,
    context: Pick<CharsetConversionContext, 'packedMcmGlyphMasks'>
  ): Uint8Array;
}

const ENABLE_WASM_DIAGNOSTICS = import.meta.env.DEV;
let binaryPrecisionChecksRemaining = 12;
let mcmPrecisionChecksRemaining = 12;
let binaryHammingChecksRemaining = 8;
let mcmHammingChecksRemaining = 8;
const modeParityChecksRemaining: Record<'ecm' | 'mcm', number> = { ecm: 1, mcm: 1 };

function computeBinarySetErrMatrixJs(
  cell: SourceCellData,
  context: CharsetConversionContext
): Float32Array {
  const setErr = new Float32Array(256 * 16);
  for (let ch = 0; ch < 256; ch++) {
    const positions = context.setPositions[ch];
    const outBase = ch * 16;
    for (let i = 0; i < positions.length; i++) {
      const base = positions[i] * 16;
      for (let color = 0; color < 16; color++) {
        setErr[outBase + color] = Math.fround(
          setErr[outBase + color] + cell.weightedPixelErrors[base + color]
        );
      }
    }
  }
  return setErr;
}

function computeMcmMatricesJs(
  cell: SourceCellData,
  context: CharsetConversionContext
): { setErrs: Float32Array; bitPairErrs: Float32Array } {
  const setErrs = computeBinarySetErrMatrixJs(cell, context);
  const bitPairErrs = new Float32Array(256 * 4 * 16);
  for (let ch = 0; ch < 256; ch++) {
    const bpPositions = context.refMcmPositions![ch];
    for (let bp = 0; bp < 4; bp++) {
      const positions = bpPositions[bp];
      const outBase = (ch * 4 + bp) * 16;
      for (let i = 0; i < positions.length; i++) {
        const base = positions[i] * 16;
        for (let color = 0; color < 16; color++) {
          bitPairErrs[outBase + color] = Math.fround(
            bitPairErrs[outBase + color] + cell.weightedPairErrors![base + color]
          );
        }
      }
    }
  }
  return { setErrs, bitPairErrs };
}

function logArrayDiff(label: string, reference: ArrayLike<number>, candidate: ArrayLike<number>) {
  let maxAbsDiff = 0;
  let mismatchCount = 0;
  for (let i = 0; i < reference.length; i++) {
    const absDiff = Math.abs(reference[i] - candidate[i]);
    if (absDiff > maxAbsDiff) {
      maxAbsDiff = absDiff;
    }
    if (absDiff > 1e-6) {
      mismatchCount++;
    }
  }
  console.info(`[TruSkii3000] ${label} parity`, {
    compared: reference.length,
    mismatchCount,
    maxAbsDiff,
  });
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function compareModeConversions(
  mode: 'ecm' | 'mcm',
  reference: ConversionResult,
  candidate: ConversionResult
) {
  const equal =
    reference.charset === candidate.charset &&
    reference.backgroundColor === candidate.backgroundColor &&
    arraysEqual(reference.screencodes, candidate.screencodes) &&
    arraysEqual(reference.colors, candidate.colors) &&
    arraysEqual(reference.ecmBgColors, candidate.ecmBgColors) &&
    arraysEqual(reference.bgIndices, candidate.bgIndices) &&
    arraysEqual(reference.mcmSharedColors, candidate.mcmSharedColors);

  console.info(`[TruSkii3000] ${mode.toUpperCase()} JS/WASM conversion parity`, {
    equal,
    charsetMatch: reference.charset === candidate.charset,
    backgroundMatch: reference.backgroundColor === candidate.backgroundColor,
    screencodesMatch: arraysEqual(reference.screencodes, candidate.screencodes),
    colorsMatch: arraysEqual(reference.colors, candidate.colors),
    ecmBgColorsMatch: arraysEqual(reference.ecmBgColors, candidate.ecmBgColors),
    bgIndicesMatch: arraysEqual(reference.bgIndices, candidate.bgIndices),
    mcmSharedColorsMatch: arraysEqual(reference.mcmSharedColors, candidate.mcmSharedColors),
  });
}

const _reusableBinaryHamming = new Uint8Array(256);
const _reusableMcmHamming = new Uint8Array(256);
const _reusableBinaryPairAdjustment = new Float64Array((PIXELS_PER_CELL + 1) * 16 * 16);
const _reusableBinaryBrightnessResidual = new Float32Array((PIXELS_PER_CELL + 1) * 16 * 16);
const _reusableBinaryCsfPenalty = new Float32Array(256);
const _candidateScreencodeCache = new Map<string, Uint16Array>();
const _foregroundCandidateCache = new WeakMap<PaletteMetricData, Map<string, Uint8Array[]>>();

function binaryMixIndex(setCount: number, bg: number, fg: number): number {
  return (setCount * 16 + bg) * 16 + fg;
}

function getCandidateScreencodes(charLimit: number, includeTypographic: boolean): Uint16Array {
  const cacheKey = `${charLimit}:${includeTypographic ? 1 : 0}`;
  const cached = _candidateScreencodeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const screencodes: number[] = [];
  for (let ch = 0; ch < charLimit; ch++) {
    if (!includeTypographic && isTypographicScreencode(ch)) continue;
    screencodes.push(ch);
  }

  const built = Uint16Array.from(screencodes);
  _candidateScreencodeCache.set(cacheKey, built);
  return built;
}

function getForegroundCandidatesByBackground(
  metrics: PaletteMetricData,
  fgLimit: number,
  minContrastRatio: number = MIN_PAIR_DIFF_RATIO
): Uint8Array[] {
  const cacheKey = `${fgLimit}:${minContrastRatio}`;
  const cachedByLimit = _foregroundCandidateCache.get(metrics);
  if (cachedByLimit?.has(cacheKey)) {
    return cachedByLimit.get(cacheKey)!;
  }

  const foregroundsByBackground = Array.from({ length: 16 }, (_, bg) => {
    const foregrounds: number[] = [];
    for (let fg = 0; fg < fgLimit; fg++) {
      if (fg === bg) continue;
      if (minContrastRatio > 0 && !hasMinimumContrast(metrics, fg, bg, minContrastRatio)) continue;
      foregrounds.push(fg);
    }
    return Uint8Array.from(foregrounds);
  });

  const nextByLimit = cachedByLimit ?? new Map<string, Uint8Array[]>();
  nextByLimit.set(cacheKey, foregroundsByBackground);
  if (!cachedByLimit) {
    _foregroundCandidateCache.set(metrics, nextByLimit);
  }
  return foregroundsByBackground;
}

function buildBinaryCellScoringTables(
  cell: SourceCellData,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number
): BinaryCellScoringTables {
  return buildBinarySummaryScoringTables(
    cell.avgL,
    cell.avgA,
    cell.avgB,
    cell.detailScore,
    context,
    metrics,
    settings,
    charLimit
  );
}

function buildBinarySummaryScoringTables(
  avgL: number,
  avgA: number,
  avgB: number,
  detailScore: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number
): BinaryCellScoringTables {
  for (let ch = 0; ch < charLimit; ch++) {
    _reusableBinaryCsfPenalty[ch] = computeCsfPenalty(
      detailScore,
      context.glyphAtlas.spatialFrequency[ch],
      settings.csfWeight
    );
  }

  for (let setCount = 0; setCount <= PIXELS_PER_CELL; setCount++) {
    for (let bg = 0; bg < 16; bg++) {
      for (let fg = 0; fg < 16; fg++) {
        const index = binaryMixIndex(setCount, bg, fg);
        const lumDiff = avgL - metrics.binaryMixL[index];
        _reusableBinaryBrightnessResidual[index] = lumDiff;
        _reusableBinaryPairAdjustment[index] =
          settings.lumMatchWeight * lumDiff * lumDiff -
          computeHuePreservationBonus(
            avgA,
            avgB,
            metrics.binaryMixA[index],
            metrics.binaryMixB[index]
          );
      }
    }
  }

  return {
    pairAdjustment: _reusableBinaryPairAdjustment,
    brightnessResidual: _reusableBinaryBrightnessResidual,
    csfPenaltyByChar: _reusableBinaryCsfPenalty,
  };
}

function buildOwnedBinarySummaryScoringTables(
  avgL: number,
  avgA: number,
  avgB: number,
  detailScore: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number
): BinaryCellScoringTables {
  const shared = buildBinarySummaryScoringTables(
    avgL,
    avgA,
    avgB,
    detailScore,
    context,
    metrics,
    settings,
    charLimit
  );

  return {
    pairAdjustment: Float64Array.from(shared.pairAdjustment),
    brightnessResidual: Float32Array.from(shared.brightnessResidual),
    csfPenaltyByChar: Float32Array.from(shared.csfPenaltyByChar),
  };
}

function buildCsfPenaltyByChar(
  detailScore: number,
  context: CharsetConversionContext,
  charLimit: number,
  csfWeight: number
): Float32Array {
  const penalties = new Float32Array(charLimit);
  for (let ch = 0; ch < charLimit; ch++) {
    penalties[ch] = computeCsfPenalty(
      detailScore,
      context.glyphAtlas.spatialFrequency[ch],
      csfWeight
    );
  }
  return penalties;
}

function computeBinaryMixAdjustment(
  avgL: number,
  avgA: number,
  avgB: number,
  mixIndex: number,
  metrics: PaletteMetricData,
  lumMatchWeight: number
): { pairAdjustment: number; brightnessResidual: number } {
  const brightnessResidual = avgL - metrics.binaryMixL[mixIndex];
  return {
    pairAdjustment:
      lumMatchWeight * brightnessResidual * brightnessResidual -
      computeHuePreservationBonus(
        avgA,
        avgB,
        metrics.binaryMixA[mixIndex],
        metrics.binaryMixB[mixIndex]
      ),
    brightnessResidual,
  };
}

function computeMcmColorDemand(
  detailScore: number,
  avgA: number,
  avgB: number
): number {
  const chroma = Math.hypot(avgA, avgB);
  if (chroma < 0.015) return 0;
  const chromaNeed = Math.min(1, chroma / 0.14);
  const detailAllowance = Math.max(0, 1 - detailScore / 0.8);
  return chromaNeed * detailAllowance;
}

function computeMcmHiresColorPenalty(
  detailScore: number,
  avgA: number,
  avgB: number
): number {
  return MCM_HIRES_COLOR_PENALTY_WEIGHT * computeMcmColorDemand(detailScore, avgA, avgB);
}

function computeMcmMulticolorUsageBonus(
  counts: ArrayLike<number>,
  detailScore: number,
  avgA: number,
  avgB: number
): number {
  const colorDemand = computeMcmColorDemand(detailScore, avgA, avgB);
  if (colorDemand <= 0) return 0;

  const multicolorCoverage = (counts[1] + counts[2] + counts[3]) / MCM_PIXELS_PER_CELL;
  return MCM_MULTICOLOR_USAGE_BONUS_WEIGHT * colorDemand * multicolorCoverage;
}

function buildMcmCellScoringState(
  cell: SourceCellData,
  cellIndex: number,
  context: CharsetConversionContext,
  settings: ConverterSettings,
  scoringKernel?: McmCandidateScoringKernel
): McmCellScoringState {
  const { setErrs, bitPairErrs } = computeMcmMatrices(cell, context, scoringKernel, cellIndex);
  return {
    setErrs: Float32Array.from(setErrs),
    bitPairErrs: Float32Array.from(bitPairErrs),
    csfPenaltyByChar: buildCsfPenaltyByChar(cell.detailScore, context, 256, settings.csfWeight),
  };
}

function canUseBinaryHammingPath(
  settings: ConverterSettings,
  scoringKernel?: BinaryCandidateScoringKernel
): boolean {
  return Boolean(
    ENABLE_EXPERIMENTAL_HAMMING_FAST_PATH &&
    scoringKernel?.computeHammingDistances &&
    settings.saliencyAlpha === 0 &&
    settings.csfWeight === 0 &&
    settings.lumMatchWeight === 0
  );
}

function canUseMcmHammingPath(
  settings: ConverterSettings,
  scoringKernel?: McmCandidateScoringKernel
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
  scoringKernel?: BinaryCandidateScoringKernel
): Uint8Array {
  const [thresholdLo, thresholdHi] = packBinaryThresholdMap(cell.weightedPixelErrors, fg, bg);
  if (scoringKernel?.computeHammingDistances) {
    const distances = scoringKernel.computeHammingDistances(thresholdLo, thresholdHi, metrics.pairDiff, context);
    if (ENABLE_WASM_DIAGNOSTICS && binaryHammingChecksRemaining > 0) {
      binaryHammingChecksRemaining--;
      logArrayDiff(
        'Binary Hamming distances',
        computeBinaryHammingDistancesJs(
          thresholdLo,
          thresholdHi,
          context.packedBinaryGlyphLo,
          context.packedBinaryGlyphHi
        ),
        distances
      );
    }
    return distances;
  }

  return computeBinaryHammingDistancesJs(
    thresholdLo,
    thresholdHi,
    context.packedBinaryGlyphLo,
    context.packedBinaryGlyphHi,
    _reusableBinaryHamming
  );
}

function computeMcmHammingDistances(
  cell: SourceCellData,
  bg: number,
  mc1: number,
  mc2: number,
  fg: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  scoringKernel?: McmCandidateScoringKernel
): Uint8Array {
  if (!cell.weightedPairErrors || !context.packedMcmGlyphMasks) {
    throw new Error('Missing MCM threshold data for Hamming path.');
  }

  const thresholdMasks = packMcmThresholdMasks(cell.weightedPairErrors, bg, mc1, mc2, fg);
  if (scoringKernel?.computeHammingDistances) {
    const distances = scoringKernel.computeHammingDistances(thresholdMasks, metrics.pairDiff, context);
    if (ENABLE_WASM_DIAGNOSTICS && mcmHammingChecksRemaining > 0) {
      mcmHammingChecksRemaining--;
      logArrayDiff(
        'MCM Hamming distances',
        computeMcmHammingDistancesJs(thresholdMasks, context.packedMcmGlyphMasks),
        distances
      );
    }
    return distances;
  }

  return computeMcmHammingDistancesJs(
    thresholdMasks,
    context.packedMcmGlyphMasks,
    _reusableMcmHamming
  );
}

function computeBinarySetErrMatrix(
  cell: SourceCellData,
  context: CharsetConversionContext,
  scoringKernel?: BinaryCandidateScoringKernel,
  cellIndex?: number
): Float32Array | Float64Array {
  if (scoringKernel) {
    const setErr = cellIndex !== undefined && scoringKernel.computeSetErrsForModeCell
      ? scoringKernel.computeSetErrsForModeCell(cellIndex, context)
      : scoringKernel.computeSetErrs(cell.weightedPixelErrors, context);
    if (ENABLE_WASM_DIAGNOSTICS && binaryPrecisionChecksRemaining > 0) {
      binaryPrecisionChecksRemaining--;
      logArrayDiff('Binary setErr matrix', computeBinarySetErrMatrixJs(cell, context), setErr);
    }
    return setErr;
  }

  return computeBinarySetErrMatrixJs(cell, context);
}

function computeMcmMatrices(
  cell: SourceCellData,
  context: CharsetConversionContext,
  scoringKernel?: McmCandidateScoringKernel,
  cellIndex?: number
): { setErrs: Float32Array | Float64Array; bitPairErrs: Float32Array } {
  if (scoringKernel && cell.weightedPairErrors) {
    const matrices = cellIndex !== undefined && scoringKernel.computeMatricesForModeCell
      ? scoringKernel.computeMatricesForModeCell(cellIndex, context)
      : scoringKernel.computeMatrices(cell.weightedPixelErrors, cell.weightedPairErrors, context);
    if (ENABLE_WASM_DIAGNOSTICS && mcmPrecisionChecksRemaining > 0) {
      mcmPrecisionChecksRemaining--;
      const reference = computeMcmMatricesJs(cell, context);
      logArrayDiff('MCM setErr matrix', reference.setErrs, matrices.setErrs);
      logArrayDiff('MCM bitPair matrix', reference.bitPairErrs, matrices.bitPairErrs);
    }
    return matrices;
  }

  return computeMcmMatricesJs(cell, context);
}

function buildMcmSampleSummary(
  cell: SourceCellData,
  cellIndex: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  candidateScreencodes: Uint16Array,
  foregroundsByBackground: Uint8Array[],
  scoringKernel?: McmCandidateScoringKernel
): McmSampleSummary {
  const state = buildMcmCellScoringState(cell, cellIndex, context, settings, scoringKernel);
  const binaryTables = buildOwnedBinarySummaryScoringTables(
    cell.avgL,
    cell.avgA,
    cell.avgB,
    cell.detailScore,
    context,
    metrics,
    settings,
    256
  );
  const bestHiresCostByBg = new Float64Array(16);
  bestHiresCostByBg.fill(Infinity);
  const hiresPenalty = computeMcmHiresColorPenalty(cell.detailScore, cell.avgA, cell.avgB);

  for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
    const ch = candidateScreencodes[charIndex];
    const csfPenalty = binaryTables.csfPenaltyByChar[ch];
    const hiresBase = ch * 16;
    const nSet = context.refSetCount[ch];

    for (let bg = 0; bg < 16; bg++) {
      const bgErr = cell.totalErrByColor[bg] - state.setErrs[hiresBase + bg];
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const mixIndex = binaryMixIndex(nSet, bg, fg);
        const total =
          bgErr +
          state.setErrs[hiresBase + fg] +
          csfPenalty +
          binaryTables.pairAdjustment[mixIndex] +
          hiresPenalty;
        if (total < bestHiresCostByBg[bg]) {
          bestHiresCostByBg[bg] = total;
        }
      }
    }
  }

  return {
    hiresSetErrByChar: state.setErrs,
    mcmBpErrByChar: state.bitPairErrs,
    csfPenaltyByChar: binaryTables.csfPenaltyByChar,
    bestHiresCostByBg,
    avgL: cell.avgL,
    avgA: cell.avgA,
    avgB: cell.avgB,
    totalErrByColor: cell.totalErrByColor,
    detailScore: cell.detailScore,
    saliencyWeight: cell.saliencyWeight,
  };
}

function scoreMcmTripleOnSample(
  summary: McmSampleSummary,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  candidateScreencodes: Uint16Array,
  lumMatchWeight: number,
  bg: number,
  mc1: number,
  mc2: number
): number {
  let best = summary.bestHiresCostByBg[bg];

  for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
    const ch = candidateScreencodes[charIndex];
    const csfPenalty = summary.csfPenaltyByChar[ch];
    const bpBase = ch * 64;
    const fixedErr =
      summary.mcmBpErrByChar[bpBase + bg] +
      summary.mcmBpErrByChar[bpBase + 16 + mc1] +
      summary.mcmBpErrByChar[bpBase + 32 + mc2];

    if (2 * fixedErr < best) {
      const counts = context.refMcmBpCount![ch];
      const bp3Base = bpBase + 48;
      const multicolorUsageBonus = computeMcmMulticolorUsageBonus(
        counts,
        summary.detailScore,
        summary.avgA,
        summary.avgB
      );
      for (let fg = 0; fg < 8; fg++) {
        if (counts[3] > 0 && !hasMinimumContrast(metrics, fg, bg)) continue;
        const renderedAvgL =
          (counts[0] * metrics.pL[bg] +
           counts[1] * metrics.pL[mc1] +
           counts[2] * metrics.pL[mc2] +
           counts[3] * metrics.pL[fg]) / MCM_PIXELS_PER_CELL;
        const renderedAvgA =
          (counts[0] * metrics.pA[bg] +
           counts[1] * metrics.pA[mc1] +
           counts[2] * metrics.pA[mc2] +
           counts[3] * metrics.pA[fg]) / MCM_PIXELS_PER_CELL;
        const renderedAvgB =
          (counts[0] * metrics.pB[bg] +
           counts[1] * metrics.pB[mc1] +
           counts[2] * metrics.pB[mc2] +
           counts[3] * metrics.pB[fg]) / MCM_PIXELS_PER_CELL;
        const lumDiff = summary.avgL - renderedAvgL;
        const hueBonus = computeHuePreservationBonus(summary.avgA, summary.avgB, renderedAvgA, renderedAvgB);
        const total = 2 * (fixedErr + summary.mcmBpErrByChar[bp3Base + fg]) +
          lumMatchWeight * lumDiff * lumDiff +
          csfPenalty -
          hueBonus -
          multicolorUsageBonus;
        if (total < best) best = total;
      }
    }
  }

  return best;
}

function buildMcmCandidatePool(
  cell: SourceCellData,
  state: McmCellScoringState,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  candidateScreencodes: Uint16Array,
  foregroundsByBackground: Uint8Array[],
  bg: number,
  mc1: number,
  mc2: number,
  poolSize: number
): ScreenCandidate[] {
  const pool: ScreenCandidate[] = [];
  const hiresPenalty = computeMcmHiresColorPenalty(cell.detailScore, cell.avgA, cell.avgB);

  for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
    const ch = candidateScreencodes[charIndex];
    const csfPenalty = state.csfPenaltyByChar[ch];
    const hiresBase = ch * 16;
    const bgErr = cell.totalErrByColor[bg] - state.setErrs[hiresBase + bg];
    if (pool.length < poolSize || bgErr < pool[pool.length - 1].baseError) {
      const nSet = context.refSetCount[ch];
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const mixIndex = binaryMixIndex(nSet, bg, fg);
        const adjustment = computeBinaryMixAdjustment(
          cell.avgL,
          cell.avgA,
          cell.avgB,
          mixIndex,
          metrics,
          settings.lumMatchWeight
        );
        const total =
          bgErr +
          state.setErrs[hiresBase + fg] +
          csfPenalty +
          adjustment.pairAdjustment +
          hiresPenalty;
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
              adjustment.brightnessResidual,
              metrics.pairDiff,
              metrics.maxPairDiff
            ),
            poolSize
          );
        }
      }
    }

    const bpBase = ch * 64;
    const fixedErr =
      state.bitPairErrs[bpBase + bg] +
      state.bitPairErrs[bpBase + 16 + mc1] +
      state.bitPairErrs[bpBase + 32 + mc2];

    if (pool.length < poolSize || 2 * fixedErr < pool[pool.length - 1].baseError) {
      const counts = context.refMcmBpCount![ch];
      const bp3Base = bpBase + 48;
      const multicolorUsageBonus = computeMcmMulticolorUsageBonus(
        counts,
        cell.detailScore,
        cell.avgA,
        cell.avgB
      );
      for (let fg = 0; fg < 8; fg++) {
        if (counts[3] > 0 && !hasMinimumContrast(metrics, fg, bg)) continue;
        const renderedAvgL =
          (counts[0] * metrics.pL[bg] +
           counts[1] * metrics.pL[mc1] +
           counts[2] * metrics.pL[mc2] +
           counts[3] * metrics.pL[fg]) / MCM_PIXELS_PER_CELL;
        const renderedAvgA =
          (counts[0] * metrics.pA[bg] +
           counts[1] * metrics.pA[mc1] +
           counts[2] * metrics.pA[mc2] +
           counts[3] * metrics.pA[fg]) / MCM_PIXELS_PER_CELL;
        const renderedAvgB =
          (counts[0] * metrics.pB[bg] +
           counts[1] * metrics.pB[mc1] +
           counts[2] * metrics.pB[mc2] +
           counts[3] * metrics.pB[fg]) / MCM_PIXELS_PER_CELL;
        const lumDiff = cell.avgL - renderedAvgL;
        const hueBonus = computeHuePreservationBonus(cell.avgA, cell.avgB, renderedAvgA, renderedAvgB);
        const total =
          2 * (fixedErr + state.bitPairErrs[bp3Base + fg]) +
          settings.lumMatchWeight * lumDiff * lumDiff +
          csfPenalty -
          hueBonus -
          multicolorUsageBonus;
        if (pool.length < poolSize || total < pool[pool.length - 1].baseError) {
          insertTopCandidate(
            pool,
            makeMcmCandidate(
              context.refMcm![ch],
              ch,
              fg | 8,
              bg,
              mc1,
              mc2,
              context.glyphAtlas.dominantDirection[ch] as CellGradientDirection,
              total,
              lumDiff,
              metrics.pairDiff,
              metrics.maxPairDiff
            ),
            poolSize
          );
        }
      }
    }
  }

  if (pool.length > 0) return pool;
  const fallbackFg = bg === 0 ? 1 : 0;
  return [makeBinaryCandidate(
    context.ref[32],
    32,
    bg,
    fallbackFg,
    context.glyphAtlas.dominantDirection[32] as CellGradientDirection,
    Infinity,
    0,
    metrics.pairDiff,
    metrics.maxPairDiff
  )];
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

function trySolveScreenWithKernel(
  candidatePools: ScreenCandidate[][],
  analysis: SourceAnalysis,
  wasmKernel?: StandardCandidateScoringKernel
): { selectedIndices: Int32Array; selected: ScreenCandidate[]; refinementInKernel: boolean } | null {
  if (!wasmKernel?.solveSelectionWithNeighborPasses) {
    return null;
  }

  for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex++) {
    const pool = candidatePools[cellIndex];
    const count = Math.min(pool.length, 16);
    _ecmSolveCounts[cellIndex] = count;

    for (let candidateIndex = 0; candidateIndex < count; candidateIndex++) {
      const candidate = pool[candidateIndex];
      const flatIndex = cellIndex * 16 + candidateIndex;
      const edgeBase = flatIndex * 8;
      _ecmSolveChars[flatIndex] = candidate.char;
      _ecmSolveFgs[flatIndex] = candidate.fg;
      _ecmSolveBaseErrors[flatIndex] = candidate.baseError;
      _ecmSolveBrightnessResiduals[flatIndex] = candidate.brightnessResidual;
      _ecmSolveRepeatH[flatIndex] = candidate.repeatH;
      _ecmSolveRepeatV[flatIndex] = candidate.repeatV;
      _ecmSolveCoherenceColorMasks[flatIndex] = candidate.coherenceColorMask;
      _ecmSolveGlyphDirections[flatIndex] = candidate.glyphDirection;
      _ecmSolveEdgeLeft.set(candidate.edgeLeft, edgeBase);
      _ecmSolveEdgeRight.set(candidate.edgeRight, edgeBase);
      _ecmSolveEdgeTop.set(candidate.edgeTop, edgeBase);
      _ecmSolveEdgeBottom.set(candidate.edgeBottom, edgeBase);
    }
  }

  const wasmSelectedIndices = wasmKernel.solveSelectionWithNeighborPasses(
    _ecmSolveCounts,
    _ecmSolveChars,
    _ecmSolveFgs,
    _ecmSolveBaseErrors,
    _ecmSolveBrightnessResiduals,
    _ecmSolveRepeatH,
    _ecmSolveRepeatV,
    _ecmSolveEdgeLeft,
    _ecmSolveEdgeRight,
    _ecmSolveEdgeTop,
    _ecmSolveEdgeBottom,
    analysis.hBoundaryDiffs,
    analysis.vBoundaryDiffs,
    SCREEN_SOLVE_PASSES
  );
  const refinedSelectedIndices = wasmKernel.refineSelectionWithPostPasses
    ? wasmKernel.refineSelectionWithPostPasses(
        wasmSelectedIndices,
        _ecmSolveCoherenceColorMasks,
        _ecmSolveGlyphDirections,
        analysis.detailScores,
        analysis.gradientDirections,
        COLOR_COHERENCE_PASSES,
        EDGE_CONTINUITY_PASSES
      )
    : wasmSelectedIndices;

  const selectedIndices = new Int32Array(CELL_COUNT);
  const selected = new Array<ScreenCandidate>(CELL_COUNT);
  for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex++) {
    const pool = candidatePools[cellIndex];
    const selectedIndex = Math.min(pool.length - 1, refinedSelectedIndices[cellIndex] ?? 0);
    selectedIndices[cellIndex] = selectedIndex;
    selected[cellIndex] = pool[selectedIndex];
  }

  return {
    selectedIndices,
    selected,
    refinementInKernel: Boolean(wasmKernel.refineSelectionWithPostPasses),
  };
}

async function solveScreen(
  candidatePools: ScreenCandidate[][],
  analysis: SourceAnalysis,
  metrics: PaletteMetricData,
  shouldCancel?: () => boolean,
  wasmKernel?: StandardCandidateScoringKernel
): Promise<PetsciiResult & { selected: ScreenCandidate[] }> {
  // Try WASM-accelerated solve+refine first
  const wasmResult = trySolveScreenWithKernel(candidatePools, analysis, wasmKernel);

  let selectedIndices: Int32Array;
  let selected: ScreenCandidate[];
  let refinementDone = false;

  if (wasmResult) {
    selectedIndices = wasmResult.selectedIndices;
    selected = wasmResult.selected;
    refinementDone = wasmResult.refinementInKernel;
  } else {
    // JS fallback: seed + iterative neighbor solve
    const seededSelection = seedSelectionWithBrightnessDebt(candidatePools);
    selectedIndices = seededSelection.selectedIndices;
    selected = seededSelection.selected;

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
  }

  // JS refinement passes (skipped if WASM already handled them)
  if (!refinementDone) {
    runColorCoherencePass(candidatePools, selectedIndices, selected, analysis, metrics);
    runEdgeContinuityPass(candidatePools, selectedIndices, selected, analysis, metrics);
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

function buildBinaryCandidatePoolsForCellByBackground(
  cell: SourceCellData,
  cellIndex: number,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number,
  backgrounds: number[],
  fgLimit: number,
  poolSize: number,
  scoringKernel?: BinaryCandidateScoringKernel,
  minContrastRatio: number = MIN_PAIR_DIFF_RATIO
): ScreenCandidate[][] {
  const pools = backgrounds.map(() => [] as ScreenCandidate[]);
  const candidateScreencodes = getCandidateScreencodes(charLimit, settings.includeTypographic);
  const foregroundsByBackground = getForegroundCandidatesByBackground(metrics, fgLimit, minContrastRatio);
  const scoringTables = buildBinaryCellScoringTables(cell, context, metrics, settings, charLimit);

  if (canUseBinaryHammingPath(settings, scoringKernel)) {
    const edgeWeight = EDGE_MISMATCH_WEIGHT * cell.detailScore;
    const hasEdges = cell.edgePixelCount > 0 && edgeWeight > 0.01;
    const eMaskLo = cell.edgeMaskLo;
    const eMaskHi = cell.edgeMaskHi;

    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const pool = pools[bi];
      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const hammingDistances = computeBinaryHammingDistances(cell, fg, bg, context, metrics, scoringKernel);

        // For edge-weighted scoring, compute threshold map to XOR with glyphs
        let thresholdLo = 0, thresholdHi = 0;
        if (hasEdges) {
          [thresholdLo, thresholdHi] = packBinaryThresholdMap(cell.weightedPixelErrors, fg, bg);
        }

        for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
          const ch = candidateScreencodes[charIndex];
          const mixIndex = binaryMixIndex(context.refSetCount[ch], bg, fg);
          let total = hammingDistances[ch] + scoringTables.pairAdjustment[mixIndex];

          // TRUSKI3000: Add extra penalty for mismatches at edge pixels
          if (hasEdges) {
            const mismatchLo = (context.packedBinaryGlyphLo[ch] ^ thresholdLo) >>> 0;
            const mismatchHi = (context.packedBinaryGlyphHi[ch] ^ thresholdHi) >>> 0;
            const edgeMismatches =
              popcount32((mismatchLo & eMaskLo) >>> 0) +
              popcount32((mismatchHi & eMaskHi) >>> 0);
            total += edgeWeight * edgeMismatches;
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

  const setErrMatrix = computeBinarySetErrMatrix(cell, context, scoringKernel, cellIndex);
  const edgeWeightSetErr = EDGE_MISMATCH_WEIGHT * cell.detailScore;
  const hasEdgesSetErr = cell.edgePixelCount > 0 && edgeWeightSetErr > 0.01;
  const eMaskLoSetErr = cell.edgeMaskLo;
  const eMaskHiSetErr = cell.edgeMaskHi;

  for (let charIndex = 0; charIndex < candidateScreencodes.length; charIndex++) {
    const ch = candidateScreencodes[charIndex];
    const setErrBase = ch * 16;
    const nSet = context.refSetCount[ch];
    const csfPenalty = scoringTables.csfPenaltyByChar[ch];

    for (let bi = 0; bi < backgrounds.length; bi++) {
      const bg = backgrounds[bi];
      const pool = pools[bi];
      const worst = pool.length >= poolSize ? pool[pool.length - 1].baseError : Infinity;
      const bgErr = cell.totalErrByColor[bg] - setErrMatrix[setErrBase + bg];
      if (bgErr >= worst) continue;

      const foregrounds = foregroundsByBackground[bg];
      for (let fgIndex = 0; fgIndex < foregrounds.length; fgIndex++) {
        const fg = foregrounds[fgIndex];
        const mixIndex = binaryMixIndex(nSet, bg, fg);
        let total =
          bgErr +
          setErrMatrix[setErrBase + fg] +
          csfPenalty +
          scoringTables.pairAdjustment[mixIndex];

        // TRUSKI3000: Edge-weighted penalty for set-error path
        if (hasEdgesSetErr) {
          const [tLo, tHi] = packBinaryThresholdMap(cell.weightedPixelErrors, fg, bg);
          const mLo = (context.packedBinaryGlyphLo[ch] ^ tLo) >>> 0;
          const mHi = (context.packedBinaryGlyphHi[ch] ^ tHi) >>> 0;
          const edgeMismatches =
            popcount32((mLo & eMaskLoSetErr) >>> 0) +
            popcount32((mHi & eMaskHiSetErr) >>> 0);
          total += edgeWeightSetErr * edgeMismatches;
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

async function buildBinaryCandidatePoolsByBackground(
  cells: SourceCellData[],
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  charLimit: number,
  backgrounds: number[],
  fgLimit: number,
  poolSize: number,
  scoringKernel?: BinaryCandidateScoringKernel,
  shouldCancel?: () => boolean,
  minContrastRatio: number = MIN_PAIR_DIFF_RATIO
): Promise<ScreenCandidate[][][]> {
  const candidatePoolsByBackground = backgrounds.map(() => new Array<ScreenCandidate[]>(cells.length));
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    const cellPools = buildBinaryCandidatePoolsForCellByBackground(
      cells[cellIndex], cellIndex, context, metrics, settings, charLimit, backgrounds, fgLimit, poolSize, scoringKernel, minContrastRatio
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

function mergeBinaryCandidatePoolsByBackground(
  candidatePoolsByBackground: ScreenCandidate[][][],
  backgrounds: number[],
  poolSize: number
): ScreenCandidate[][] {
  const mergedPools = new Array<ScreenCandidate[]>(CELL_COUNT);

  for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex++) {
    const pool: ScreenCandidate[] = [];
    for (let bi = 0; bi < backgrounds.length; bi++) {
      const backgroundPool = candidatePoolsByBackground[backgrounds[bi]][cellIndex];
      for (let candidateIndex = 0; candidateIndex < backgroundPool.length; candidateIndex++) {
        insertTopCandidate(pool, backgroundPool[candidateIndex], poolSize);
      }
    }
    mergedPools[cellIndex] = pool;
  }

  return mergedPools;
}

async function buildMcmCellScoringStates(
  cells: SourceCellData[],
  context: CharsetConversionContext,
  settings: ConverterSettings,
  scoringKernel: McmCandidateScoringKernel | undefined,
  shouldCancel?: () => boolean
): Promise<McmCellScoringState[]> {
  const states = new Array<McmCellScoringState>(cells.length);
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    states[cellIndex] = buildMcmCellScoringState(
      cells[cellIndex],
      cellIndex,
      context,
      settings,
      scoringKernel
    );
    if ((cellIndex & 63) === 0) {
      await yieldToUI(shouldCancel);
    }
  }
  return states;
}

async function buildMcmCandidatePools(
  cells: SourceCellData[],
  states: McmCellScoringState[],
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  candidateScreencodes: Uint16Array,
  foregroundsByBackground: Uint8Array[],
  bg: number,
  mc1: number,
  mc2: number,
  poolSize: number,
  shouldCancel?: () => boolean
): Promise<ScreenCandidate[][]> {
  const candidatePools = new Array<ScreenCandidate[]>(cells.length);
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    candidatePools[cellIndex] = buildMcmCandidatePool(
      cells[cellIndex],
      states[cellIndex],
      context,
      metrics,
      settings,
      candidateScreencodes,
      foregroundsByBackground,
      bg,
      mc1,
      mc2,
      poolSize
    );
    if ((cellIndex & 127) === 0) {
      await yieldToUI(shouldCancel);
    }
  }
  return candidatePools;
}

async function buildMcmCandidatePoolsDirect(
  cells: SourceCellData[],
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  candidateScreencodes: Uint16Array,
  foregroundsByBackground: Uint8Array[],
  bg: number,
  mc1: number,
  mc2: number,
  poolSize: number,
  scoringKernel: McmCandidateScoringKernel | undefined,
  shouldCancel?: () => boolean
): Promise<ScreenCandidate[][]> {
  const candidatePools = new Array<ScreenCandidate[]>(cells.length);
  for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
    const state = buildMcmCellScoringState(
      cells[cellIndex],
      cellIndex,
      context,
      settings,
      scoringKernel
    );
    candidatePools[cellIndex] = buildMcmCandidatePool(
      cells[cellIndex],
      state,
      context,
      metrics,
      settings,
      candidateScreencodes,
      foregroundsByBackground,
      bg,
      mc1,
      mc2,
      poolSize
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

function buildEcmBgIndices(
  orderedBgs: number[],
  selected: ScreenCandidate[]
): number[] {
  const bgMap = new Map<number, number>();
  orderedBgs.forEach((color, bgIndex) => bgMap.set(color, bgIndex));
  return selected.map(candidate => bgMap.get(candidate.bg) ?? 0);
}

function sameBackgroundSet(first: number[], second: number[]): boolean {
  if (first.length !== second.length) return false;
  const a = [...first].sort((x, y) => x - y);
  const b = [...second].sort((x, y) => x - y);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

type WeightedEcmBackgroundSample = {
  L: number;
  a: number;
  b: number;
  weight: number;
};

function buildWeightedEcmBackgroundSamples(
  analysis: SourceAnalysis,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  selected: ScreenCandidate[]
): WeightedEcmBackgroundSample[] {
  const samples: WeightedEcmBackgroundSample[] = [];

  for (let cellIndex = 0; cellIndex < selected.length; cellIndex++) {
    const candidate = selected[cellIndex];
    const cell = analysis.cells[cellIndex];
    const nSet = context.refSetCount[candidate.char];
    const nBg = PIXELS_PER_CELL - nSet;
    if (nBg <= 0) continue;

    const invBg = 1 / nBg;
    const estimatedL = (cell.avgL * PIXELS_PER_CELL - nSet * metrics.pL[candidate.fg]) * invBg;
    const estimatedA = (cell.avgA * PIXELS_PER_CELL - nSet * metrics.pA[candidate.fg]) * invBg;
    const estimatedB = (cell.avgB * PIXELS_PER_CELL - nSet * metrics.pB[candidate.fg]) * invBg;
    const weight = Math.max(
      0.25,
      (nBg / PIXELS_PER_CELL) * (1 + candidate.baseError / ECM_REGISTER_RESOLVE_ERROR_SCALE)
    );

    samples.push({
      L: estimatedL,
      a: estimatedA,
      b: estimatedB,
      weight,
    });
  }

  return samples;
}

function quantizeDistinctEcmCenters(
  centers: Array<{ L: number; a: number; b: number }>,
  metrics: PaletteMetricData,
  manualBgColor: number | null
): number[] {
  const colors = new Array<number>(centers.length).fill(0);
  const used = new Set<number>();

  for (let centerIndex = 0; centerIndex < centers.length; centerIndex++) {
    if (manualBgColor !== null && centerIndex === 0) {
      colors[centerIndex] = manualBgColor;
      used.add(manualBgColor);
      continue;
    }

    const center = centers[centerIndex];
    let bestColor = 0;
    let bestError = Infinity;
    for (let color = 0; color < 16; color++) {
      if (used.has(color)) continue;
      const error = perceptualError(
        center.L,
        center.a,
        center.b,
        metrics.pL[color],
        metrics.pA[color],
        metrics.pB[color]
      );
      if (error < bestError) {
        bestError = error;
        bestColor = color;
      }
    }

    colors[centerIndex] = bestColor;
    used.add(bestColor);
  }

  return colors;
}

function refineEcmBackgroundSet(
  analysis: SourceAnalysis,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  selected: ScreenCandidate[],
  currentOrderedBgs: number[],
  manualBgColor: number | null
): number[] {
  const samples = buildWeightedEcmBackgroundSamples(analysis, context, metrics, selected);
  if (samples.length === 0) {
    return currentOrderedBgs;
  }

  let centers = currentOrderedBgs.map(color => ({
    L: metrics.pL[color],
    a: metrics.pA[color],
    b: metrics.pB[color],
  }));
  let quantized = currentOrderedBgs.slice();

  for (let iteration = 0; iteration < ECM_REGISTER_KMEANS_ITERATIONS; iteration++) {
    const accumulators = centers.map(() => ({ L: 0, a: 0, b: 0, weight: 0 }));

    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex++) {
      const sample = samples[sampleIndex];
      let bestCluster = 0;
      let bestError = Infinity;

      for (let clusterIndex = 0; clusterIndex < centers.length; clusterIndex++) {
        const center = centers[clusterIndex];
        const error = perceptualError(sample.L, sample.a, sample.b, center.L, center.a, center.b);
        if (error < bestError) {
          bestError = error;
          bestCluster = clusterIndex;
        }
      }

      const accumulator = accumulators[bestCluster];
      accumulator.L += sample.L * sample.weight;
      accumulator.a += sample.a * sample.weight;
      accumulator.b += sample.b * sample.weight;
      accumulator.weight += sample.weight;
    }

    centers = centers.map((center, centerIndex) => {
      if (manualBgColor !== null && centerIndex === 0) {
        return {
          L: metrics.pL[manualBgColor],
          a: metrics.pA[manualBgColor],
          b: metrics.pB[manualBgColor],
        };
      }
      const accumulator = accumulators[centerIndex];
      if (accumulator.weight <= 1e-6) {
        return center;
      }
      return {
        L: accumulator.L / accumulator.weight,
        a: accumulator.a / accumulator.weight,
        b: accumulator.b / accumulator.weight,
      };
    });

    const nextQuantized = quantizeDistinctEcmCenters(centers, metrics, manualBgColor);
    if (sameBackgroundSet(nextQuantized, quantized)) {
      quantized = nextQuantized;
      break;
    }
    quantized = nextQuantized;
    centers = quantized.map(color => ({
      L: metrics.pL[color],
      a: metrics.pA[color],
      b: metrics.pB[color],
    }));
  }

  return quantized;
}

async function runEcmRegisterResolvePass(
  analysis: SourceAnalysis,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  candidatePoolsByBackground: ScreenCandidate[][][],
  orderedBgs: number[],
  solved: PetsciiResult & { selected: ScreenCandidate[] },
  shouldCancel?: () => boolean,
  wasmKernel?: StandardCandidateScoringKernel
): Promise<{ orderedBgs: number[]; solved: PetsciiResult & { selected: ScreenCandidate[] } }> {
  let bestOrderedBgs = orderedBgs;
  let bestSolved = solved;
  let currentOrderedBgs = orderedBgs;
  let currentSolved = solved;

  for (let pass = 0; pass < ECM_REGISTER_RESOLVE_PASSES; pass++) {
    const refinedSet = refineEcmBackgroundSet(
      analysis,
      context,
      metrics,
      currentSolved.selected,
      currentOrderedBgs,
      settings.manualBgColor
    );
    if (sameBackgroundSet(refinedSet, currentOrderedBgs)) {
      break;
    }

    const candidatePools = mergeBinaryCandidatePoolsByBackground(
      candidatePoolsByBackground,
      refinedSet,
      ECM_POOL_SIZE
    );
    const refinedSolved = await solveScreen(candidatePools, analysis, metrics, shouldCancel, wasmKernel);
    const refinedOrderedBgs = chooseOrderedEcmBackgrounds(refinedSet, refinedSolved.selected, settings.manualBgColor);

    if (refinedSolved.totalError >= bestSolved.totalError) {
      break;
    }

    bestSolved = refinedSolved;
    bestOrderedBgs = refinedOrderedBgs;
    currentSolved = refinedSolved;
    currentOrderedBgs = refinedOrderedBgs;
  }

  return { orderedBgs: bestOrderedBgs, solved: bestSolved };
}

async function solveEcmForCombo(
  analysis: SourceAnalysis,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  palette: PaletteColor[] | undefined,
  scoringKernel: BinaryCandidateScoringKernel | undefined,
  onProgress: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate> {
  // The binary scoring kernel is a BinaryWasmKernel at runtime which also
  // implements StandardCandidateScoringKernel (solve/refine/finalize methods).
  // Duck-type check happens inside trySolveScreenWithKernel.
  const ecmWasmKernel = scoringKernel as unknown as StandardCandidateScoringKernel | undefined;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const backgroundSets = buildEcmBackgroundSets(settings.manualBgColor);
  const allBackgrounds = buildBackgroundColorList();
  const sampleIndices = getSampleIndices(analysis.rankedIndices, ECM_SAMPLE_COUNT);
  const tCoarse0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sampleBestByCell = sampleIndices.map(cellIndex =>
    buildBinaryBestErrorByBackground(analysis.cells[cellIndex], cellIndex, context, metrics, settings, 64, 16, scoringKernel)
  );
  const sampleSaliencyWeights = sampleIndices.map(cellIndex => analysis.cells[cellIndex].saliencyWeight);

  const rankedSets = backgroundSets.map(set => {
    let score = 0;
    for (let i = 0; i < sampleBestByCell.length; i++) {
      const perBg = sampleBestByCell[i];
      score += sampleSaliencyWeights[i] * Math.min(perBg[set[0]], perBg[set[1]], perBg[set[2]], perBg[set[3]]);
    }
    return { set, score };
  }).sort((a, b) => a.score - b.score)
    .slice(0, Math.min(ECM_FINALIST_COUNT, backgroundSets.length));
  const tCoarse1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tPool0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const candidatePoolsByBackground = await buildBinaryCandidatePoolsByBackground(
    analysis.cells,
    context,
    metrics,
    settings,
    64,
    allBackgrounds,
    16,
    ECM_POOL_SIZE,
    scoringKernel,
    shouldCancel,
    0 // ECM: disable contrast filter to preserve color diversity with only 4 backgrounds
  );
  let poolTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tPool0;

  let best: SolvedModeCandidate | undefined;
  let bestSolved: (PetsciiResult & { selected: ScreenCandidate[] }) | undefined;
  let bestOrderedBgs: number[] | undefined;
  let solveTime = 0;
  for (let index = 0; index < rankedSets.length; index++) {
    const set = rankedSets[index].set;
    onProgress('Converting', `ECM backgrounds ${set.join(',')} (${index + 1}/${rankedSets.length})`, Math.round((index / Math.max(1, rankedSets.length)) * 100));
    await yieldToUI(shouldCancel);

    const tMerge0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const candidatePools = mergeBinaryCandidatePoolsByBackground(
      candidatePoolsByBackground,
      set,
      ECM_POOL_SIZE
    );
    poolTime += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tMerge0;
    const tSolve0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const solved = await solveScreen(candidatePools, analysis, metrics, shouldCancel, ecmWasmKernel);
    solveTime += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tSolve0;
    const orderedBgs = chooseOrderedEcmBackgrounds(set, solved.selected, settings.manualBgColor);
    const bgIndices = buildEcmBgIndices(orderedBgs, solved.selected);

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
      preview: palette
        ? renderPreview({ ...solved, bgIndices }, palette, context.ref, orderedBgs[0], orderedBgs, 'ecm')
        : undefined,
      error: solved.totalError,
    });

    if (!best || solved.totalError < best.error) {
      bestSolved = { ...solved, bgIndices };
      bestOrderedBgs = orderedBgs;
    }
  }

  if (best && bestSolved && bestOrderedBgs) {
    onProgress('Converting', 'ECM register re-solve (1/1)', 100);
    await yieldToUI(shouldCancel);
    const refined = await runEcmRegisterResolvePass(
      analysis,
      context,
      metrics,
      settings,
      candidatePoolsByBackground,
      bestOrderedBgs,
      bestSolved,
      shouldCancel,
      ecmWasmKernel
    );
    if (refined.solved.totalError < best.error) {
      const bgIndices = buildEcmBgIndices(refined.orderedBgs, refined.solved.selected);
      best = {
        result: { ...refined.solved, bgIndices },
        conversion: {
          screencodes: refined.solved.screencodes,
          colors: refined.solved.colors,
          backgroundColor: refined.orderedBgs[0],
          ecmBgColors: refined.orderedBgs,
          bgIndices,
          mcmSharedColors: [],
          charset: 'upper',
          mode: 'ecm',
        },
        preview: palette
          ? renderPreview({ ...refined.solved, bgIndices }, palette, context.ref, refined.orderedBgs[0], refined.orderedBgs, 'ecm')
          : undefined,
        error: refined.solved.totalError,
      };
    }
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  console.info('[TruSkii3000] ECM stages', {
    backend: scoringKernel ? 'wasm' : 'js',
    coarseMs: Number((tCoarse1 - tCoarse0).toFixed(1)),
    poolsMs: Number(poolTime.toFixed(1)),
    solveMs: Number(solveTime.toFixed(1)),
    totalMs: Number((t1 - t0).toFixed(1)),
    finalists: rankedSets.length,
  });

  return best!;
}

async function solveMcmForCombo(
  analysis: SourceAnalysis,
  context: CharsetConversionContext,
  metrics: PaletteMetricData,
  settings: ConverterSettings,
  palette: PaletteColor[] | undefined,
  scoringKernel: McmCandidateScoringKernel | undefined,
  onProgress: ProgressCallback,
  shouldCancel?: () => boolean,
  binaryScoringKernel?: BinaryCandidateScoringKernel
): Promise<SolvedModeCandidate> {
  // The binary scoring kernel is a BinaryWasmKernel at runtime which also
  // implements StandardCandidateScoringKernel (solve/refine methods).
  const mcmWasmSolveKernel = binaryScoringKernel as unknown as StandardCandidateScoringKernel | undefined;
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sampleIndices = getSampleIndices(analysis.rankedIndices, MCM_SAMPLE_COUNT);
  const tGlobals0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const candidateScreencodes = getCandidateScreencodes(256, settings.includeTypographic);
  const foregroundsByBackground = getForegroundCandidatesByBackground(metrics, 8);
  const sampleSummaries = sampleIndices.map(cellIndex =>
    buildMcmSampleSummary(
      analysis.cells[cellIndex],
      cellIndex,
      context,
      metrics,
      settings,
      candidateScreencodes,
      foregroundsByBackground,
      scoringKernel
    )
  );
  const triples = buildMcmTriples(settings.manualBgColor);
  const rankedTriples = new Array<{ triple: [number, number, number]; score: number }>(triples.length);

  for (let tripleIndex = 0; tripleIndex < triples.length; tripleIndex++) {
    const [bg, mc1, mc2] = triples[tripleIndex];
    let score = 0;
    for (let sample = 0; sample < sampleSummaries.length; sample++) {
      score += sampleSummaries[sample].saliencyWeight *
        scoreMcmTripleOnSample(
          sampleSummaries[sample],
          context,
          metrics,
          candidateScreencodes,
          settings.lumMatchWeight,
          bg,
          mc1,
          mc2
        );
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
  const tGlobals1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const cellStates = ENABLE_MCM_CELL_STATE_REUSE
    ? await buildMcmCellScoringStates(
        analysis.cells,
        context,
        settings,
        scoringKernel,
        shouldCancel
      )
    : undefined;

  let best: SolvedModeCandidate | undefined;
  let poolTime = 0;
  let solveTime = 0;
  for (let finalistIndex = 0; finalistIndex < rankedTriples.length; finalistIndex++) {
    const [bg, mc1, mc2] = rankedTriples[finalistIndex].triple;
    onProgress(
      'Converting',
      `MCM bg=${bg}, mc1=${mc1}, mc2=${mc2} (${finalistIndex + 1}/${rankedTriples.length})`,
      Math.round((finalistIndex / Math.max(1, rankedTriples.length)) * 100)
    );
    await yieldToUI(shouldCancel);

    const tPool0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const candidatePools = cellStates
      ? await buildMcmCandidatePools(
          analysis.cells,
          cellStates,
          context,
          metrics,
          settings,
          candidateScreencodes,
          foregroundsByBackground,
          bg,
          mc1,
          mc2,
          MCM_POOL_SIZE,
          shouldCancel
        )
      : await buildMcmCandidatePoolsDirect(
          analysis.cells,
          context,
          metrics,
          settings,
          candidateScreencodes,
          foregroundsByBackground,
          bg,
          mc1,
          mc2,
          MCM_POOL_SIZE,
          scoringKernel,
          shouldCancel
        );
    poolTime += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tPool0;
    const tSolve0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const solved = await solveScreen(candidatePools, analysis, metrics, shouldCancel, mcmWasmSolveKernel);
    solveTime += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tSolve0;
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
      preview: palette
        ? renderMcmPreview(solved, palette, context.ref, context.refMcm!, bg, mc1, mc2)
        : undefined,
      error: solved.totalError,
    });
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  console.info('[TruSkii3000] MCM stages', {
    backend: scoringKernel ? 'wasm' : 'js',
    globalsMs: Number((tGlobals1 - tGlobals0).toFixed(1)),
    poolsMs: Number(poolTime.toFixed(1)),
    solveMs: Number(solveTime.toFixed(1)),
    totalMs: Number((t1 - t0).toFixed(1)),
    finalists: rankedTriples.length,
  });

  return best!;
}

async function solveModeForAnalysis(
  mode: 'ecm' | 'mcm',
  analysis: SourceAnalysis,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  metrics: PaletteMetricData,
  binaryScoringKernel: BinaryCandidateScoringKernel | undefined,
  mcmScoringKernel: McmCandidateScoringKernel | undefined,
  onProgress: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate | undefined> {
  let best: SolvedModeCandidate | undefined;
  const backend: ConverterAccelerationPath = mode === 'ecm'
    ? (binaryScoringKernel ? 'wasm' : 'js')
    : (mcmScoringKernel ? 'wasm' : 'js');

  for (const [charsetIndex, charset] of (['upper', 'lower'] as const).entries()) {
    const context = contexts[charset];
    const charsetProgress = createScopedProgress(
      (stage, detail, pct) => onProgress(stage, `${charset.toUpperCase()}${detail ? ` - ${detail}` : ''}`, pct),
      charsetIndex * 50,
      50
    );
    const solved = mode === 'ecm'
      ? await solveEcmForCombo(analysis, context, metrics, settings, undefined, binaryScoringKernel, charsetProgress, shouldCancel)
      : await solveMcmForCombo(analysis, context, metrics, settings, undefined, mcmScoringKernel, charsetProgress, shouldCancel, binaryScoringKernel);
    solved.conversion.charset = charset;
    solved.conversion.accelerationBackend = backend;
    best = pickBetterModeCandidate(best, solved);
  }

  return best;
}

export async function solveModeOffsetWorker(
  mode: 'ecm' | 'mcm',
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  metrics: PaletteMetricData,
  offset: AlignmentOffset,
  binaryScoringKernel: BinaryCandidateScoringKernel | undefined,
  mcmScoringKernel: McmCandidateScoringKernel | undefined,
  onProgress: ProgressCallback,
  shouldCancel?: () => boolean
): Promise<WorkerSolvedModeCandidate | undefined> {
  throwIfCancelled(shouldCancel);
  const analysis = analyzeAlignedSourceImage(
    preprocessed,
    metrics,
    settings,
    mode === 'mcm',
    offset.x,
    offset.y
  );
  binaryScoringKernel?.preloadModeCellErrors?.(analysis.cells);
  if (mode === 'mcm') {
    mcmScoringKernel?.preloadModeCellErrors?.(analysis.cells);
  }
  throwIfCancelled(shouldCancel);

  const best = await solveModeForAnalysis(
    mode,
    analysis,
    settings,
    contexts,
    metrics,
    binaryScoringKernel,
    mcmScoringKernel,
    onProgress,
    shouldCancel
  );

  if (ENABLE_WASM_DIAGNOSTICS && best && modeParityChecksRemaining[mode] > 0) {
    const usingWasm = mode === 'ecm' ? Boolean(binaryScoringKernel) : Boolean(mcmScoringKernel);
    if (usingWasm) {
      modeParityChecksRemaining[mode]--;
      const jsReference = await solveModeForAnalysis(
        mode,
        analysis,
        settings,
        contexts,
        metrics,
        undefined,
        undefined,
        () => {},
        shouldCancel
      );
      if (jsReference) {
        compareModeConversions(mode, jsReference.conversion, best.conversion);
      }
    }
  }

  return best
    ? {
        conversion: best.conversion,
        error: best.error,
        offset,
      }
    : undefined;
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
export type ModeBackendCallback = (mode: 'standard' | 'ecm' | 'mcm', backend: ConverterAccelerationPath) => void;

function renderSolvedModePreview(
  candidate: Pick<SolvedModeCandidate, 'conversion' | 'error'>,
  palette: PaletteColor[],
  contexts: Record<ConverterCharset, CharsetConversionContext>
): ImageData {
  const result: PetsciiResult = {
    screencodes: candidate.conversion.screencodes,
    colors: candidate.conversion.colors,
    bgIndices: candidate.conversion.bgIndices,
    totalError: candidate.error,
  };
  const context = contexts[candidate.conversion.charset];
  if (candidate.conversion.mode === 'mcm') {
    return renderMcmPreview(
      result,
      palette,
      context.ref,
      context.refMcm!,
      candidate.conversion.backgroundColor,
      candidate.conversion.mcmSharedColors[0],
      candidate.conversion.mcmSharedColors[1]
    );
  }
  return renderPreview(
    result,
    palette,
    context.ref,
    candidate.conversion.backgroundColor,
    candidate.conversion.mode === 'ecm' ? candidate.conversion.ecmBgColors : [],
    candidate.conversion.mode
  );
}

function computeMeanDeltaEForPreview(
  preview: ImageData,
  alignedSource: AlignedSourceOklab,
  settings: ConverterSettings
): ConversionQualityMetric {
  const perCellDeltaE = new Array<number>(CELL_COUNT).fill(0);
  let totalDeltaE = 0;

  for (let cellIndex = 0; cellIndex < CELL_COUNT; cellIndex++) {
    const cx = cellIndex % GRID_WIDTH;
    const cy = Math.floor(cellIndex / GRID_WIDTH);
    let cellTotal = 0;

    for (let py = 0; py < CELL_HEIGHT; py++) {
      for (let px = 0; px < CELL_WIDTH; px++) {
        const pixelIndex = (cy * CELL_HEIGHT + py) * CANVAS_WIDTH + (cx * CELL_WIDTH + px);
        const rgbaIndex = pixelIndex * 4;
        const rendered = adjustedPixelToPerceptual(
          preview.data[rgbaIndex],
          preview.data[rgbaIndex + 1],
          preview.data[rgbaIndex + 2],
          settings
        );
        const dL = alignedSource.srcL[pixelIndex] - rendered.L;
        const da = alignedSource.srcA[pixelIndex] - rendered.a;
        const db = alignedSource.srcB[pixelIndex] - rendered.b;
        const deltaE = Math.sqrt((dL * dL) + (da * da) + (db * db));
        cellTotal += deltaE;
      }
    }

    const meanDeltaE = cellTotal / PIXELS_PER_CELL;
    perCellDeltaE[cellIndex] = meanDeltaE;
    totalDeltaE += meanDeltaE;
  }

  return {
    meanDeltaE: totalDeltaE / CELL_COUNT,
    perCellDeltaE,
  };
}

function computeIdealColorPair(cell: SourceCellData): { c1: number; c2: number; error: number } {
  // Find the pair of palette colors that minimizes total per-pixel error.
  // For each pixel, assign it to whichever of the two colors has lower error.
  let bestC1 = 0, bestC2 = 1, bestError = Infinity;
  for (let c1 = 0; c1 < 16; c1++) {
    for (let c2 = c1 + 1; c2 < 16; c2++) {
      let totalErr = 0;
      for (let p = 0; p < PIXELS_PER_CELL; p++) {
        const base = p * 16;
        totalErr += Math.min(cell.weightedPixelErrors[base + c1], cell.weightedPixelErrors[base + c2]);
      }
      if (totalErr < bestError) {
        bestError = totalErr;
        bestC1 = c1;
        bestC2 = c2;
      }
    }
  }
  return { c1: bestC1, c2: bestC2, error: bestError };
}

function computeChosenPairError(cell: SourceCellData, bg: number, fg: number): number {
  let totalErr = 0;
  for (let p = 0; p < PIXELS_PER_CELL; p++) {
    const base = p * 16;
    totalErr += Math.min(cell.weightedPixelErrors[base + bg], cell.weightedPixelErrors[base + fg]);
  }
  return totalErr;
}

function buildCellMetadata(
  conversion: ConversionResult,
  analysis: SourceAnalysis,
  qualityMetric: ConversionQualityMetric
): ConversionCellMetadata[] {
  return analysis.cells.map((cell, cellIndex) => {
    let fgColor = conversion.colors[cellIndex];
    let bgColor = conversion.backgroundColor;
    const cellMetadata: ConversionCellMetadata = {
      fgColor,
      bgColor,
      errorScore: qualityMetric.perCellDeltaE[cellIndex],
      detailScore: cell.detailScore,
      saliencyWeight: cell.saliencyWeight,
      screencode: conversion.screencodes[cellIndex],
    };

    if (conversion.mode === 'ecm') {
      bgColor = conversion.ecmBgColors[conversion.bgIndices[cellIndex]] ?? conversion.backgroundColor;
      cellMetadata.bgColor = bgColor;
    } else if (conversion.mode === 'mcm') {
      fgColor = mcmForegroundColor(conversion.colors[cellIndex]);
      cellMetadata.fgColor = fgColor;
      cellMetadata.bgColor = conversion.backgroundColor;
      cellMetadata.mcmCellIsHires = !mcmIsMulticolorCell(conversion.colors[cellIndex]);
    }

    // Color diagnostics: ideal vs chosen
    const ideal = computeIdealColorPair(cell);
    cellMetadata.idealColor1 = ideal.c1;
    cellMetadata.idealColor2 = ideal.c2;
    cellMetadata.idealError = ideal.error;
    cellMetadata.chosenError = computeChosenPairError(cell, bgColor, fgColor);

    return cellMetadata;
  });
}

function decorateSolvedModeCandidate(
  candidate: SolvedModeCandidate,
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  palette: PaletteColor[],
  metrics: PaletteMetricData,
  contexts: Record<ConverterCharset, CharsetConversionContext>
): SolvedModeCandidate {
  const preview = candidate.preview ?? renderSolvedModePreview(candidate, palette, contexts);
  const analysis = analyzeAlignedSourceImage(
    preprocessed,
    metrics,
    settings,
    candidate.conversion.mode === 'mcm',
    candidate.offset.x,
    candidate.offset.y
  );
  const alignedSource = buildAlignedSourceOklab(preprocessed, candidate.offset.x, candidate.offset.y);
  const qualityMetric = computeMeanDeltaEForPreview(preview, alignedSource, settings);
  const cellMetadata = buildCellMetadata(candidate.conversion, analysis, qualityMetric);

  return {
    ...candidate,
    preview,
    conversion: {
      ...candidate.conversion,
      qualityMetric,
      cellMetadata,
    },
  };
}

function finalizeSolvedModeCandidate(
  candidate: SolvedModeCandidate,
  palette: PaletteColor[],
  contexts: Record<ConverterCharset, CharsetConversionContext>
): SolvedModeCandidate {
  if (candidate.preview) return candidate;
  return {
    ...candidate,
    preview: renderSolvedModePreview(candidate, palette, contexts),
  };
}

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
    offset: candidate.offset,
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

function toSolvedModeCandidateFromWorker(
  candidate: WorkerSolvedModeCandidate,
  palette: PaletteColor[],
  contexts: Record<ConverterCharset, CharsetConversionContext>
): SolvedModeCandidate {
  return finalizeSolvedModeCandidate(
    {
      result: {
        screencodes: candidate.conversion.screencodes,
        colors: candidate.conversion.colors,
        bgIndices: candidate.conversion.bgIndices,
        totalError: candidate.error,
      },
      conversion: candidate.conversion,
      error: candidate.error,
      offset: candidate.offset,
    },
    palette,
    contexts
  );
}

async function solveModeAcrossOffsetsSequential(
  mode: 'ecm' | 'mcm',
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  palette: PaletteColor[],
  metrics: PaletteMetricData,
  onProgress: ProgressCallback,
  onModeBackend?: ModeBackendCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate | undefined> {
  const offsets = buildStandardAlignmentOffsets();
  let best: WorkerSolvedModeCandidate | undefined;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  onModeBackend?.(mode, 'js');
  onProgress('Alignment', `${mode.toUpperCase()} 0 of ${offsets.length}`, 0);

  for (let offsetIndex = 0; offsetIndex < offsets.length; offsetIndex++) {
    const offset = offsets[offsetIndex];
    await yieldToUI(shouldCancel);
    const solved = await solveModeOffsetWorker(
      mode,
      preprocessed,
      settings,
      contexts,
      metrics,
      offset,
      undefined,
      undefined,
      createScopedProgress(
        onProgress,
        Math.round((offsetIndex / Math.max(1, offsets.length)) * 100),
        Math.max(1, Math.ceil(100 / offsets.length))
      ),
      shouldCancel
    );
    if (solved && (!best || solved.error < best.error)) {
      best = solved;
    }
    onProgress(
      'Alignment',
      `${mode.toUpperCase()} ${offsetIndex + 1} of ${offsets.length}`,
      Math.round(((offsetIndex + 1) / Math.max(1, offsets.length)) * 100)
    );
  }

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
  console.info(`[TruSkii3000] ${mode.toUpperCase()} conversion finished.`, {
    backend: 'js',
    alignments: offsets.length,
    elapsedMs: Math.round(elapsedMs),
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
  });

  return best ? toSolvedModeCandidateFromWorker(best, palette, contexts) : undefined;
}

async function solveModeAcrossOffsets(
  mode: 'ecm' | 'mcm',
  preprocessed: PreprocessedFittedImage,
  settings: ConverterSettings,
  contexts: Record<ConverterCharset, CharsetConversionContext>,
  palette: PaletteColor[],
  metrics: PaletteMetricData,
  fontBitsByCharset: ConverterFontBits,
  onProgress: ProgressCallback,
  onModeBackend?: ModeBackendCallback,
  shouldCancel?: () => boolean
): Promise<SolvedModeCandidate | undefined> {
  try {
    const workerSolved = await runModeConversionInWorkers(
      mode,
      preprocessed,
      settings,
      fontBitsByCharset,
      onProgress,
      backend => onModeBackend?.(mode, backend),
      shouldCancel
    );
    if (workerSolved) {
      return toSolvedModeCandidateFromWorker(workerSolved, palette, contexts);
    }
  } catch (error) {
    if (error instanceof ConversionCancelledError) {
      throw error;
    }
    console.warn(`${mode.toUpperCase()} worker acceleration failed; falling back to the single-threaded path.`, error);
    disposeModeConverterWorkers();
  }

  return await solveModeAcrossOffsetsSequential(
    mode,
    preprocessed,
    settings,
    contexts,
    palette,
    metrics,
    onProgress,
    onModeBackend,
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
  onModeBackend?: ModeBackendCallback,
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
      backend => onModeBackend?.('standard', backend),
      shouldCancel
    );
  }
  return await solveModeAcrossOffsets(
    mode,
    preprocessed,
    settings,
    contexts,
    palette,
    metrics,
    fontBitsByCharset,
    onProgress,
    onModeBackend,
    shouldCancel
  );
}

// --- Top-level Orchestrator ---

export async function convertImage(
  img: HTMLImageElement,
  settings: ConverterSettings,
  fontBitsByCharset: ConverterFontBits,
  onProgress: ProgressCallback,
  onModeBackend?: ModeBackendCallback,
  shouldCancel?: () => boolean
): Promise<ConversionOutputs> {
  const paletteData = PALETTES.find(p => p.id === settings.paletteId) || PALETTES[0];
  const palette = buildPaletteColors(paletteData.hex);
  const metrics = buildPaletteMetricData(palette);
  const monotonicProgress = createMonotonicProgress(onProgress);
  monotonicProgress('Preparing', 'TruSkii3000 preprocessing source image...', 0);
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
    const scopedProgress = createScopedProgress(monotonicProgress, modeStart, modeSpan);
    const solved = await solveModeAcrossCombos(
      mode,
      preprocessed,
      settings,
      contexts,
      palette,
      metrics,
      fontBitsByCharset,
      scopedProgress,
      onModeBackend,
      shouldCancel
    );
    if (!solved) continue;
    const finalized = decorateSolvedModeCandidate(
      solved,
      preprocessed,
      settings,
      palette,
      metrics,
      contexts
    );

    if (mode === 'standard') {
      outputs.standard = finalized.conversion;
      outputs.previewStd = finalized.preview;
    } else if (mode === 'ecm') {
      outputs.ecm = finalized.conversion;
      outputs.previewEcm = finalized.preview;
    } else {
      outputs.mcm = finalized.conversion;
      outputs.previewMcm = finalized.preview;
    }
  }

  monotonicProgress('Done', '', 100);
  return outputs;
}
