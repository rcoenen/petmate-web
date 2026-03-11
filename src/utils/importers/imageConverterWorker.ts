import {
  buildCharsetConversionContext as buildModeCharsetConversionContext,
  buildPaletteColorsById as buildModePaletteColorsById,
  buildPaletteMetricData as buildModePaletteMetricData,
  type ProgressCallback as ModeProgressCallback,
  solveModeOffsetWorker,
} from './imageConverter';
import type {
  BinaryCandidateScoringKernel,
  CharsetConversionContext as ModeCharsetConversionContext,
  ConverterCharset,
  McmCandidateScoringKernel,
  PaletteMetricData as ModePaletteMetricData,
  PreprocessedFittedImage,
} from './imageConverter';
import {
  buildCharsetConversionContext,
  buildPaletteColorsById,
  buildPaletteMetricData,
  ConversionCancelledError,
  solveStandardOffset,
} from './imageConverterStandardCore';
import type {
  CharsetConversionContext,
  PaletteMetricData,
  ProgressCallback as StandardProgressCallback,
  StandardCandidateScoringKernel,
} from './imageConverterStandardCore';
import { BinaryWasmKernel, type StandardWasmRequestSession } from './imageConverterBinaryWasm';
import { McmWasmKernel } from './imageConverterMcmWasm';
import type {
  ConverterWorkerRequestMessage,
  ConverterWorkerResponseMessage,
} from './imageConverterWorkerProtocol';

type WorkerState = {
  standardContexts: Record<ConverterCharset, CharsetConversionContext> | null;
  modeContexts: Record<ConverterCharset, ModeCharsetConversionContext> | null;
  enabledModes: Set<'standard' | 'ecm' | 'mcm'>;
  activeRequests: Set<number>;
  requestData: Map<number, {
    preprocessed: Parameters<typeof solveStandardOffset>[0];
    settings: Parameters<typeof solveStandardOffset>[1];
    standardWasmSession?: StandardWasmRequestSession;
  }>;
  standardPaletteCache: Map<string, PaletteMetricData>;
  modePaletteCache: Map<string, ModePaletteMetricData>;
  scoringKernel: StandardCandidateScoringKernel | null;
  modeBinaryScoringKernel: BinaryCandidateScoringKernel | null;
  mcmScoringKernel: McmCandidateScoringKernel | null;
};

const state: WorkerState = {
  standardContexts: null,
  modeContexts: null,
  enabledModes: new Set(['standard', 'ecm', 'mcm']),
  activeRequests: new Set(),
  requestData: new Map(),
  standardPaletteCache: new Map(),
  modePaletteCache: new Map(),
  scoringKernel: null,
  modeBinaryScoringKernel: null,
  mcmScoringKernel: null,
};

function post(message: ConverterWorkerResponseMessage) {
  self.postMessage(message);
}

function getStandardMetrics(paletteId: string) {
  const cached = state.standardPaletteCache.get(paletteId);
  if (cached) return cached;
  const metrics = buildPaletteMetricData(buildPaletteColorsById(paletteId));
  state.standardPaletteCache.set(paletteId, metrics);
  return metrics;
}

function getModeMetrics(paletteId: string) {
  const cached = state.modePaletteCache.get(paletteId);
  if (cached) return cached;
  const metrics = buildModePaletteMetricData(buildModePaletteColorsById(paletteId));
  state.modePaletteCache.set(paletteId, metrics);
  return metrics;
}

self.onmessage = async (event: MessageEvent<ConverterWorkerRequestMessage>) => {
  const message = event.data;

  try {
    if (message.type === 'init') {
      const enabledModes = new Set(message.enabledModes ?? ['standard', 'ecm', 'mcm']);
      const needsStandard = enabledModes.has('standard');
      const needsBinaryMode = enabledModes.has('ecm') || enabledModes.has('mcm');
      const needsMcm = enabledModes.has('mcm');
      state.enabledModes = enabledModes;
      state.standardContexts = needsStandard
        ? {
            upper: buildCharsetConversionContext(message.fontBitsByCharset.upper),
            lower: buildCharsetConversionContext(message.fontBitsByCharset.lower),
          }
        : null;
      state.modeContexts = needsBinaryMode
        ? {
            upper: buildModeCharsetConversionContext(message.fontBitsByCharset.upper, needsMcm),
            lower: buildModeCharsetConversionContext(message.fontBitsByCharset.lower, needsMcm),
          }
        : null;
      const standardWasm = message.disableWasm || (!needsStandard && !needsBinaryMode)
        ? { kernel: null, error: message.disableWasm ? 'WASM disabled by caller.' : undefined }
        : await BinaryWasmKernel.create();
      const mcmWasm = message.disableWasm || !needsMcm
        ? { kernel: null, error: message.disableWasm ? 'WASM disabled by caller.' : undefined }
        : await McmWasmKernel.create();
      state.scoringKernel = standardWasm.kernel;
      state.modeBinaryScoringKernel = standardWasm.kernel;
      state.mcmScoringKernel = mcmWasm.kernel;
      if (needsStandard && standardWasm.kernel) {
        console.info('[TruSkii3000] Standard/ECM worker initialized with WASM kernel.');
      } else if (needsStandard || enabledModes.has('ecm')) {
        console.warn('[TruSkii3000] Standard/ECM worker falling back to JavaScript scoring.', standardWasm.error);
      }
      if (needsMcm && mcmWasm.kernel) {
        console.info('[TruSkii3000] MCM worker initialized with WASM kernel.');
      } else if (needsMcm) {
        console.warn('[TruSkii3000] MCM worker falling back to JavaScript scoring.', mcmWasm.error);
      }
      post({
        type: 'ready',
        wasmByMode: {
          standard: needsStandard && Boolean(standardWasm.kernel),
          ecm: needsBinaryMode && Boolean(standardWasm.kernel),
          mcm: needsMcm && Boolean(mcmWasm.kernel),
        },
        wasmErrors: {
          standard: needsStandard ? standardWasm.error : undefined,
          ecm: needsBinaryMode ? standardWasm.error : undefined,
          mcm: needsMcm ? mcmWasm.error : undefined,
        },
      });
      return;
    }

    if (message.type === 'start-request') {
      let standardWasmSession: StandardWasmRequestSession | undefined;
      if (state.scoringKernel instanceof BinaryWasmKernel) {
        const metrics = getStandardMetrics(message.settings.paletteId);
        if (state.enabledModes.has('standard')) {
          standardWasmSession = state.scoringKernel.beginStandardRequest(message.preprocessed, metrics.pairDiff);
        } else {
          state.scoringKernel.preloadStandardState(message.preprocessed, metrics.pairDiff);
        }
      }
      if (state.mcmScoringKernel instanceof McmWasmKernel) {
        state.mcmScoringKernel.preloadPairDiff(getModeMetrics(message.settings.paletteId).pairDiff);
      }
      state.requestData.set(message.requestId, {
        preprocessed: message.preprocessed,
        settings: message.settings,
        standardWasmSession,
      });
      state.activeRequests.add(message.requestId);
      return;
    }

    if (message.type === 'cancel') {
      state.activeRequests.delete(message.requestId);
      state.requestData.delete(message.requestId);
      post({ type: 'cancelled', requestId: message.requestId });
      return;
    }

    if (message.type === 'solve-offset') {
      if (!state.enabledModes.has(message.mode)) {
        throw new Error(`Worker does not support mode ${message.mode}`);
      }
      const request = state.requestData.get(message.requestId);
      if (!request) {
        throw new Error(`Unknown worker request ${message.requestId}`);
      }
      const shouldCancel = () => !state.activeRequests.has(message.requestId);
      const postProgress = ((stage: string, detail: string, pct: number) => {
        if (!state.activeRequests.has(message.requestId)) {
          return;
        }
        post({
          type: 'progress',
          requestId: message.requestId,
          mode: message.mode,
          offsetId: message.offsetId,
          stage,
          detail,
          pct,
        });
      }) as StandardProgressCallback & ModeProgressCallback;
      const result = message.mode === 'standard'
        ? await solveStandardOffset(
            request.preprocessed,
            request.settings,
            (() => {
              if (!state.standardContexts) {
                throw new Error('Worker not initialized for Standard mode');
              }
              return state.standardContexts;
            })(),
            getStandardMetrics(request.settings.paletteId),
            message.offset,
            request.standardWasmSession?.scoringKernel ?? state.scoringKernel ?? undefined,
            shouldCancel,
            postProgress
          )
        : await solveModeOffsetWorker(
            message.mode,
            request.preprocessed as PreprocessedFittedImage,
            request.settings,
            (() => {
              if (!state.modeContexts) {
                throw new Error(`Worker not initialized for ${message.mode.toUpperCase()} mode`);
              }
              return state.modeContexts;
            })(),
            getModeMetrics(request.settings.paletteId),
            message.offset,
            state.modeBinaryScoringKernel ?? undefined,
            state.mcmScoringKernel ?? undefined,
            postProgress,
            shouldCancel
          );
      if (!state.activeRequests.has(message.requestId)) {
        post({ type: 'cancelled', requestId: message.requestId, offsetId: message.offsetId });
        return;
      }
      if (!result) {
        post({ type: 'cancelled', requestId: message.requestId, offsetId: message.offsetId });
        return;
      }
      post({
        type: 'offset-result',
        requestId: message.requestId,
        mode: message.mode,
        offsetId: message.offsetId,
        conversion: result.conversion,
        error: result.error,
      });
      return;
    }
  } catch (error: any) {
    if (error instanceof ConversionCancelledError) {
      if ('requestId' in message) {
        post({
          type: 'cancelled',
          requestId: message.requestId,
          offsetId: 'offsetId' in message ? message.offsetId : undefined,
        });
      }
      return;
    }
    post({
      type: 'error',
      requestId: 'requestId' in message ? message.requestId : undefined,
      offsetId: 'offsetId' in message ? message.offsetId : undefined,
      error: error?.message ?? String(error),
    });
  }
};
