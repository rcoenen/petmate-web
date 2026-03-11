import {
  CONVERTER_DEFAULTS,
  buildCharsetConversionContext as buildModeCharsetConversionContext,
  buildPaletteColorsById as buildModePaletteColorsById,
  buildPaletteMetricData as buildModePaletteMetricData,
  convertImage,
  setConverterAccelerationMode,
  type ConversionOutputs,
  type ConversionResult,
  type ConverterFontBits,
  type ConverterSettings,
  type CharsetConversionContext as ModeCharsetConversionContext,
} from './utils/importers/imageConverter';
import {
  buildCharsetConversionContext as buildStandardCharsetConversionContext,
  buildPaletteColorsById as buildStandardPaletteColorsById,
  buildPaletteMetricData as buildStandardPaletteMetricData,
  type CharsetConversionContext as StandardCharsetConversionContext,
} from './utils/importers/imageConverterStandardCore';
import { BinaryWasmKernel } from './utils/importers/imageConverterBinaryWasm';
import { McmWasmKernel } from './utils/importers/imageConverterMcmWasm';
import {
  computeBinaryHammingDistancesJs,
  computeMcmHammingDistancesJs,
  packBinaryThresholdMap,
  packMcmThresholdMasks,
} from './utils/importers/imageConverterBitPacking';
import { getSystemFontData, getSystemFontDataLower, loadAssets } from './utils/assetLoader';
import {
  computeQualityMetrics,
  downscaleToReference,
  toQualityScores,
  type ImageQualityScores,
} from './utils/importers/imageConverterQualityMetrics';

type HarnessMode = 'standard' | 'ecm' | 'mcm';

type HarnessRunRequest = {
  fixture: string;
  settings?: Partial<ConverterSettings>;
  accelerationMode?: 'auto' | 'js' | 'wasm';
};

type HarnessModeSummary = {
  mode: HarnessMode;
  charset: ConversionResult['charset'];
  backgroundColor: number;
  accelerationMode: NonNullable<HarnessRunRequest['accelerationMode']>;
  accelerationBackend?: ConversionResult['accelerationBackend'];
  conversionMs: number;
  conversionSeconds: number;
  ecmBgColors: number[];
  qualityMeanDeltaE: number;
  qualityPerCellHash: string;
  cellMetadataHash: string;
  bgIndicesHash: string;
  mcmSharedColors: number[];
  colorsHash: string;
  screencodesHash: string;
  previewHash: string;
  imageQuality: ImageQualityScores;
  screencodeHistogram: number[];
  uniqueScreencodes: number;
  perCellDetail: number[];
  perCellTileDeltaE: number[];
  perCellTileSSIM: number[];
  perCellColorDiag: Array<{
    fg: number; bg: number; screencode: number;
    idealC1: number; idealC2: number;
    idealErr: number; chosenErr: number;
  }>;
};

type HarnessRunResult = {
  fixture: string;
  requestedModes: HarnessMode[];
  summaries: Partial<Record<HarnessMode, HarnessModeSummary>>;
  previews: Partial<Record<HarnessMode, string>>;
  elapsedMs: number;
  backendByMode: Partial<Record<HarnessMode, ConversionResult['accelerationBackend']>>;
};

type HarnessApi = {
  runFixture: (request: HarnessRunRequest) => Promise<HarnessRunResult>;
  validateKernels: () => Promise<HarnessKernelValidationResult>;
};

type HarnessKernelValidationResult = {
  passed: boolean;
  standardSetErrCases: number;
  standardHammingCases: number;
  mcmMatrixCases: number;
  mcmHammingCases: number;
  mismatchCount: number;
  mismatches: string[];
};

declare global {
  interface Window {
    __TRUSKI_HARNESS__?: HarnessApi;
  }
}

const app = document.getElementById('app');
if (!app) {
  throw new Error('Missing #app element');
}

const PROGRESS_LOG_PREFIX = '[TRUSKI_PROGRESS]';
const BACKEND_LOG_PREFIX = '[TRUSKI_BACKEND]';

function setStatus(message: string) {
  app.textContent = message;
}

function buildFontBitsByCharset(): ConverterFontBits {
  return {
    upper: Array.from(getSystemFontData()),
    lower: Array.from(getSystemFontDataLower()),
  };
}

function buildSettings(overrides: Partial<ConverterSettings> | undefined): ConverterSettings {
  return {
    ...CONVERTER_DEFAULTS,
    ...overrides,
  };
}

function getRequestedModes(settings: ConverterSettings): HarnessMode[] {
  const modes: HarnessMode[] = [];
  if (settings.outputStandard) modes.push('standard');
  if (settings.outputEcm) modes.push('ecm');
  if (settings.outputMcm) modes.push('mcm');
  return modes;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    image.src = url;
  });
}

async function hashBytes(bytes: ArrayLike<number>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  return await hashBytes(bytes);
}

async function imageDataToPngDataUrl(imageData: ImageData): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create 2D context for harness preview export');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function buildScreencodeHistogram(screencodes: number[]): number[] {
  const hist = new Array(256).fill(0);
  for (const sc of screencodes) hist[sc]++;
  return hist;
}

function countUniqueScreencodes(screencodes: number[]): number {
  return new Set(screencodes).size;
}

async function summarizeMode(
  mode: HarnessMode,
  result: ConversionResult,
  preview: ImageData,
  sourceReference: ImageData,
  conversionMs: number,
  accelerationMode: NonNullable<HarnessRunRequest['accelerationMode']>
): Promise<{ summary: HarnessModeSummary; previewPngDataUrl: string }> {
  if (!result.qualityMetric || !result.cellMetadata) {
    throw new Error(`Missing Phase 4 diagnostics for ${mode}`);
  }
  const previewPngDataUrl = await imageDataToPngDataUrl(preview);
  const qualityMetrics = computeQualityMetrics(sourceReference, preview);
  return {
    summary: {
      mode,
      charset: result.charset,
      backgroundColor: result.backgroundColor,
      accelerationMode,
      accelerationBackend: result.accelerationBackend,
      conversionMs: Number(conversionMs.toFixed(2)),
      conversionSeconds: Number((conversionMs / 1000).toFixed(3)),
      ecmBgColors: [...result.ecmBgColors],
      qualityMeanDeltaE: result.qualityMetric.meanDeltaE,
      qualityPerCellHash: await hashText(JSON.stringify(result.qualityMetric.perCellDeltaE)),
      cellMetadataHash: await hashText(JSON.stringify(result.cellMetadata)),
      bgIndicesHash: await hashBytes(result.bgIndices),
      mcmSharedColors: [...result.mcmSharedColors],
      colorsHash: await hashBytes(result.colors),
      screencodesHash: await hashBytes(result.screencodes),
      previewHash: await hashBytes(preview.data),
      imageQuality: toQualityScores(qualityMetrics),
      screencodeHistogram: buildScreencodeHistogram(result.screencodes),
      uniqueScreencodes: countUniqueScreencodes(result.screencodes),
      perCellDetail: result.cellMetadata!.map(c => c.detailScore),
      perCellTileDeltaE: qualityMetrics.tileDeltaE,
      perCellTileSSIM: qualityMetrics.tileSSIM,
      perCellColorDiag: result.cellMetadata!.map(c => ({
        fg: c.fgColor, bg: c.bgColor, screencode: c.screencode ?? 0,
        idealC1: c.idealColor1 ?? 0, idealC2: c.idealColor2 ?? 0,
        idealErr: c.idealError ?? 0, chosenErr: c.chosenError ?? 0,
      })),
    },
    previewPngDataUrl,
  };
}

const VALIDATION_PIXEL_CASES = 4;
const VALIDATION_PAIR_CASES = [
  [1, 0],
  [6, 0],
  [14, 6],
  [2, 8],
  [15, 3],
  [9, 11],
  [5, 12],
  [10, 0],
] as const;
const VALIDATION_MCM_CASES = [
  [0, 6, 14, 1],
  [0, 2, 8, 7],
  [6, 14, 3, 5],
  [11, 0, 5, 2],
  [8, 12, 15, 4],
] as const;
const MAX_VALIDATION_MISMATCHES = 20;

function buildWeightedPixelErrorsCase(caseId: number): Float32Array {
  const weightedPixelErrors = new Float32Array(64 * 16);
  for (let pixel = 0; pixel < 64; pixel++) {
    const row = Math.floor(pixel / 8);
    const col = pixel % 8;
    const base = pixel * 16;
    for (let color = 0; color < 16; color++) {
      weightedPixelErrors[base + color] = Math.fround(
        ((pixel * 17 + color * 31 + caseId * 19) % 113) / 11 +
        row * 0.09375 +
        col * 0.03125 +
        color * 0.0078125
      );
    }
  }
  return weightedPixelErrors;
}

function buildWeightedPairErrorsCase(caseId: number): Float32Array {
  const weightedPairErrors = new Float32Array(32 * 16);
  for (let pairIndex = 0; pairIndex < 32; pairIndex++) {
    const row = Math.floor(pairIndex / 4);
    const col = pairIndex % 4;
    const base = pairIndex * 16;
    for (let color = 0; color < 16; color++) {
      weightedPairErrors[base + color] = Math.fround(
        ((pairIndex * 23 + color * 29 + caseId * 7) % 127) / 13 +
        row * 0.1875 +
        col * 0.0625 +
        color * 0.015625
      );
    }
  }
  return weightedPairErrors;
}

function computeStandardSetErrsReference(
  weightedPixelErrors: Float32Array,
  context: StandardCharsetConversionContext
): Float32Array {
  const output = new Float32Array(256 * 16);
  for (let ch = 0; ch < 256; ch++) {
    const outputBase = ch * 16;
    for (let offset = context.positionOffsets[ch]; offset < context.positionOffsets[ch + 1]; offset++) {
      const pixelBase = context.flatPositions[offset] * 16;
      for (let color = 0; color < 16; color++) {
        output[outputBase + color] = Math.fround(output[outputBase + color] + weightedPixelErrors[pixelBase + color]);
      }
    }
  }
  return output;
}

function computeMcmMatricesReference(
  weightedPixelErrors: Float32Array,
  weightedPairErrors: Float32Array,
  context: ModeCharsetConversionContext
): { setErrs: Float32Array; bitPairErrs: Float32Array } {
  if (!context.flatMcmPositions || !context.mcmPositionOffsets) {
    throw new Error('Missing MCM position data in validation context');
  }

  const setErrs = new Float32Array(256 * 16);
  const bitPairErrs = new Float32Array(256 * 4 * 16);

  for (let ch = 0; ch < 256; ch++) {
    const setOutputBase = ch * 16;
    for (let offset = context.positionOffsets[ch]; offset < context.positionOffsets[ch + 1]; offset++) {
      const pixelBase = context.flatPositions[offset] * 16;
      for (let color = 0; color < 16; color++) {
        setErrs[setOutputBase + color] = Math.fround(setErrs[setOutputBase + color] + weightedPixelErrors[pixelBase + color]);
      }
    }

    for (let bitPair = 0; bitPair < 4; bitPair++) {
      const pairOutputBase = (ch * 4 + bitPair) * 16;
      const positions = context.flatMcmPositions[bitPair];
      const offsets = context.mcmPositionOffsets[bitPair];
      for (let offset = offsets[ch]; offset < offsets[ch + 1]; offset++) {
        const pairBase = positions[offset] * 16;
        for (let color = 0; color < 16; color++) {
          bitPairErrs[pairOutputBase + color] = Math.fround(
            bitPairErrs[pairOutputBase + color] + weightedPairErrors[pairBase + color]
          );
        }
      }
    }
  }

  return { setErrs, bitPairErrs };
}

function compareFloat32ArraysExact(
  label: string,
  expected: Float32Array,
  actual: Float32Array,
  mismatches: string[]
): boolean {
  const expectedBits = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);
  const actualBits = new Uint32Array(actual.buffer, actual.byteOffset, actual.length);
  for (let i = 0; i < expected.length; i++) {
    if (expectedBits[i] === actualBits[i]) continue;
    mismatches.push(
      `${label}[${i}] expected=${expected[i]} (0x${expectedBits[i].toString(16)}) ` +
      `actual=${actual[i]} (0x${actualBits[i].toString(16)})`
    );
    return false;
  }
  return true;
}

function compareUint8ArraysExact(
  label: string,
  expected: Uint8Array,
  actual: Uint8Array,
  mismatches: string[]
): boolean {
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] === actual[i]) continue;
    mismatches.push(`${label}[${i}] expected=${expected[i]} actual=${actual[i]}`);
    return false;
  }
  return true;
}

async function validateKernels(): Promise<HarnessKernelValidationResult> {
  setStatus('Validating WASM kernels...');

  const fontBitsByCharset = buildFontBitsByCharset();
  const standardPaletteMetrics = buildStandardPaletteMetricData(buildStandardPaletteColorsById('colodore'));
  const modePaletteMetrics = buildModePaletteMetricData(buildModePaletteColorsById('colodore'));
  const [binaryKernelResult, mcmKernelResult] = await Promise.all([
    BinaryWasmKernel.create(),
    McmWasmKernel.create(),
  ]);

  if (!binaryKernelResult.kernel) {
    throw new Error(`Standard/ECM WASM kernel unavailable for validation: ${binaryKernelResult.error ?? 'unknown error'}`);
  }
  if (!mcmKernelResult.kernel) {
    throw new Error(`MCM WASM kernel unavailable for validation: ${mcmKernelResult.error ?? 'unknown error'}`);
  }

  const mismatches: string[] = [];
  let standardSetErrCases = 0;
  let standardHammingCases = 0;
  let mcmMatrixCases = 0;
  let mcmHammingCases = 0;

  for (const [charset, fontBits] of Object.entries(fontBitsByCharset)) {
    const standardContext = buildStandardCharsetConversionContext(fontBits);
    const modeContext = buildModeCharsetConversionContext(fontBits, true);

    for (let caseId = 0; caseId < VALIDATION_PIXEL_CASES; caseId++) {
      if (mismatches.length >= MAX_VALIDATION_MISMATCHES) break;

      const weightedPixelErrors = buildWeightedPixelErrorsCase(caseId + (charset === 'lower' ? 100 : 0));
      const weightedPairErrors = buildWeightedPairErrorsCase(caseId + (charset === 'lower' ? 200 : 0));

      standardSetErrCases++;
      const expectedSetErrs = computeStandardSetErrsReference(weightedPixelErrors, standardContext);
      const actualSetErrs = Float32Array.from(binaryKernelResult.kernel.computeSetErrs(weightedPixelErrors, standardContext));
      compareFloat32ArraysExact(`${charset}/standard-setErrs/case-${caseId}`, expectedSetErrs, actualSetErrs, mismatches);

      mcmMatrixCases++;
      const expectedMcmMatrices = computeMcmMatricesReference(weightedPixelErrors, weightedPairErrors, modeContext);
      const actualMcmMatrices = mcmKernelResult.kernel.computeMatrices(weightedPixelErrors, weightedPairErrors, modeContext);
      compareFloat32ArraysExact(
        `${charset}/mcm-setErrs/case-${caseId}`,
        expectedMcmMatrices.setErrs,
        Float32Array.from(actualMcmMatrices.setErrs),
        mismatches
      );
      if (mismatches.length >= MAX_VALIDATION_MISMATCHES) break;
      compareFloat32ArraysExact(
        `${charset}/mcm-bitPairErrs/case-${caseId}`,
        expectedMcmMatrices.bitPairErrs,
        Float32Array.from(actualMcmMatrices.bitPairErrs),
        mismatches
      );
      if (mismatches.length >= MAX_VALIDATION_MISMATCHES) break;

      for (const [fg, bg] of VALIDATION_PAIR_CASES) {
        standardHammingCases++;
        const [thresholdLo, thresholdHi] = packBinaryThresholdMap(weightedPixelErrors, fg, bg);
        const expectedDistances = computeBinaryHammingDistancesJs(
          thresholdLo,
          thresholdHi,
          standardContext.packedBinaryGlyphLo,
          standardContext.packedBinaryGlyphHi
        );
        const actualDistances = Uint8Array.from(
          binaryKernelResult.kernel.computeHammingDistances(thresholdLo, thresholdHi, standardPaletteMetrics.pairDiff, standardContext)
        );
        compareUint8ArraysExact(
          `${charset}/binary-hamming/case-${caseId}/fg-${fg}-bg-${bg}`,
          expectedDistances,
          actualDistances,
          mismatches
        );
        if (mismatches.length >= MAX_VALIDATION_MISMATCHES) break;
      }
      if (mismatches.length >= MAX_VALIDATION_MISMATCHES) break;

      for (const [bg, mc1, mc2, fg] of VALIDATION_MCM_CASES) {
        mcmHammingCases++;
        const thresholdMasks = packMcmThresholdMasks(weightedPairErrors, bg, mc1, mc2, fg);
        const expectedDistances = computeMcmHammingDistancesJs(thresholdMasks, modeContext.packedMcmGlyphMasks!);
        const actualDistances = Uint8Array.from(
          mcmKernelResult.kernel.computeHammingDistances(thresholdMasks, modePaletteMetrics.pairDiff, modeContext)
        );
        compareUint8ArraysExact(
          `${charset}/mcm-hamming/case-${caseId}/bg-${bg}-mc1-${mc1}-mc2-${mc2}-fg-${fg}`,
          expectedDistances,
          actualDistances,
          mismatches
        );
        if (mismatches.length >= MAX_VALIDATION_MISMATCHES) break;
      }
    }
  }

  const result = {
    passed: mismatches.length === 0,
    standardSetErrCases,
    standardHammingCases,
    mcmMatrixCases,
    mcmHammingCases,
    mismatchCount: mismatches.length,
    mismatches,
  };
  setStatus(result.passed ? 'Kernel validation passed' : 'Kernel validation failed');
  return result;
}

async function runFixture(request: HarnessRunRequest): Promise<HarnessRunResult> {
  const settings = buildSettings(request.settings);
  const requestedModes = getRequestedModes(settings);
  if (requestedModes.length === 0) {
    throw new Error('Harness run requires at least one enabled output mode');
  }

  const fixtureUrl = `${import.meta.env.BASE_URL}truski3000-harness/fixtures/${request.fixture}`;
  setStatus(`Loading ${request.fixture}...`);
  const image = await loadImage(fixtureUrl);

  setStatus(`Converting ${request.fixture}...`);
  const fontBitsByCharset = buildFontBitsByCharset();
  const accelerationMode = request.accelerationMode ?? 'auto';
  let outputs!: ConversionOutputs;
  let elapsedMs = 0;
  let lastProgressKey = '';
  setConverterAccelerationMode(accelerationMode);
  try {
    const startedAt = performance.now();
    outputs = await convertImage(
      image,
      settings,
      fontBitsByCharset,
      (stage, detail, pct) => {
        const nextPct = Math.max(0, Math.min(100, Math.round(pct)));
        const progressKey = `${stage}|${detail}|${nextPct}`;
        if (progressKey === lastProgressKey) {
          return;
        }
        lastProgressKey = progressKey;
        setStatus(`${request.fixture}: ${stage} ${nextPct}%${detail ? ` - ${detail}` : ''}`);
        console.info(
          `${PROGRESS_LOG_PREFIX} ` +
          JSON.stringify({
            fixture: request.fixture,
            stage,
            detail,
            pct: nextPct,
          })
        );
      },
      (mode, backend) => {
        console.info(
          `${BACKEND_LOG_PREFIX} ` +
          JSON.stringify({
            fixture: request.fixture,
            mode,
            backend,
            accelerationMode,
          })
        );
      },
      () => false
    );
    elapsedMs = performance.now() - startedAt;
  } finally {
    setConverterAccelerationMode('auto');
  }

  const summaries: Partial<Record<HarnessMode, HarnessModeSummary>> = {};
  const previews: Partial<Record<HarnessMode, string>> = {};
  const backendByMode: Partial<Record<HarnessMode, ConversionResult['accelerationBackend']>> = {};

  // Downscale source image to preview resolution for quality comparison.
  // Use the first available preview to determine target dimensions.
  const firstPreview = outputs.previewStd ?? outputs.previewEcm ?? outputs.previewMcm;
  const sourceReference = firstPreview
    ? downscaleToReference(image, firstPreview.width, firstPreview.height)
    : null;

  const modeEntries: Array<[HarnessMode, ConversionResult | undefined, ImageData | undefined]> = [
    ['standard', outputs.standard, outputs.previewStd],
    ['ecm', outputs.ecm, outputs.previewEcm],
    ['mcm', outputs.mcm, outputs.previewMcm],
  ];

  for (const [mode, result, preview] of modeEntries) {
    if (!result || !preview || !sourceReference) continue;
    backendByMode[mode] = result.accelerationBackend;
    const summarized = await summarizeMode(mode, result, preview, sourceReference, elapsedMs, accelerationMode);
    summaries[mode] = summarized.summary;
    previews[mode] = summarized.previewPngDataUrl;
  }

  setStatus(`Finished ${request.fixture}`);
  return {
    fixture: request.fixture,
    requestedModes,
    summaries,
    previews,
    elapsedMs,
    backendByMode,
  };
}

async function main() {
  setStatus('Loading converter assets...');
  await loadAssets();
  window.__TRUSKI_HARNESS__ = { runFixture, validateKernels };
  setStatus('TRUSKI3000 harness ready');
}

main().catch(error => {
  console.error(error);
  setStatus(`Harness failed: ${error instanceof Error ? error.message : String(error)}`);
});
