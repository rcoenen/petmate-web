import {
  buildCharsetConversionContext as buildModeCharsetConversionContext,
  buildPaletteColorsById as buildModePaletteColorsById,
  buildPaletteMetricData as buildModePaletteMetricData,
  solveModeOffsetWorker,
} from './imageConverter';
import type {
  CharsetConversionContext as ModeCharsetConversionContext,
  ConverterCharset,
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
  StandardCandidateScoringKernel,
} from './imageConverterStandardCore';
import { StandardWasmKernel } from './imageConverterStandardWasm';
import type {
  ConverterWorkerRequestMessage,
  ConverterWorkerResponseMessage,
} from './imageConverterWorkerProtocol';

type WorkerState = {
  standardContexts: Record<ConverterCharset, CharsetConversionContext> | null;
  modeContexts: Record<ConverterCharset, ModeCharsetConversionContext> | null;
  activeRequests: Set<number>;
  requestData: Map<number, {
    preprocessed: Parameters<typeof solveStandardOffset>[0];
    settings: Parameters<typeof solveStandardOffset>[1];
  }>;
  standardPaletteCache: Map<string, PaletteMetricData>;
  modePaletteCache: Map<string, ModePaletteMetricData>;
  scoringKernel: StandardCandidateScoringKernel | null;
};

const state: WorkerState = {
  standardContexts: null,
  modeContexts: null,
  activeRequests: new Set(),
  requestData: new Map(),
  standardPaletteCache: new Map(),
  modePaletteCache: new Map(),
  scoringKernel: null,
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
      state.standardContexts = {
        upper: buildCharsetConversionContext(message.fontBitsByCharset.upper),
        lower: buildCharsetConversionContext(message.fontBitsByCharset.lower),
      };
      state.modeContexts = {
        upper: buildModeCharsetConversionContext(message.fontBitsByCharset.upper, true),
        lower: buildModeCharsetConversionContext(message.fontBitsByCharset.lower, true),
      };
      const wasm = await StandardWasmKernel.create();
      state.scoringKernel = wasm.kernel;
      if (wasm.kernel) {
        console.info('[TruSkii3000] Standard worker initialized with WASM kernel.');
      } else {
        console.warn('[TruSkii3000] Standard worker falling back to JavaScript scoring.', wasm.error);
      }
      post({
        type: 'ready',
        wasmEnabled: Boolean(wasm.kernel),
        wasmError: wasm.error,
      });
      return;
    }

    if (message.type === 'start-request') {
      state.requestData.set(message.requestId, {
        preprocessed: message.preprocessed,
        settings: message.settings,
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
      if (!state.standardContexts || !state.modeContexts) {
        throw new Error('Worker not initialized');
      }
      const request = state.requestData.get(message.requestId);
      if (!request) {
        throw new Error(`Unknown worker request ${message.requestId}`);
      }
      const shouldCancel = () => !state.activeRequests.has(message.requestId);
      const result = message.mode === 'standard'
        ? await solveStandardOffset(
            request.preprocessed,
            request.settings,
            state.standardContexts,
            getStandardMetrics(request.settings.paletteId),
            message.offset,
            state.scoringKernel ?? undefined,
            shouldCancel
          )
        : await solveModeOffsetWorker(
            message.mode,
            request.preprocessed as PreprocessedFittedImage,
            request.settings,
            state.modeContexts,
            getModeMetrics(request.settings.paletteId),
            message.offset,
            () => {},
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
