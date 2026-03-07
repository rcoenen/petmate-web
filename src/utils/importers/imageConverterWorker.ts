import type { ConverterCharset } from './imageConverter';
import {
  buildCharsetConversionContext,
  buildPaletteColorsById,
  buildPaletteMetricData,
  ConversionCancelledError,
  solveStandardOffset,
} from './imageConverterStandardCore';
import type {
  CharsetConversionContext,
  StandardCandidateScoringKernel,
} from './imageConverterStandardCore';
import { StandardWasmKernel } from './imageConverterStandardWasm';
import type {
  StandardWorkerRequestMessage,
  StandardWorkerResponseMessage,
} from './imageConverterWorkerProtocol';

type WorkerState = {
  contexts: Record<ConverterCharset, CharsetConversionContext> | null;
  activeRequests: Set<number>;
  requestData: Map<number, {
    preprocessed: Parameters<typeof solveStandardOffset>[0];
    settings: Parameters<typeof solveStandardOffset>[1];
  }>;
  paletteCache: Map<string, ReturnType<typeof buildPaletteMetricData>>;
  scoringKernel: StandardCandidateScoringKernel | null;
};

const state: WorkerState = {
  contexts: null,
  activeRequests: new Set(),
  requestData: new Map(),
  paletteCache: new Map(),
  scoringKernel: null,
};

function post(message: StandardWorkerResponseMessage) {
  self.postMessage(message);
}

function getMetrics(paletteId: string) {
  const cached = state.paletteCache.get(paletteId);
  if (cached) return cached;
  const metrics = buildPaletteMetricData(buildPaletteColorsById(paletteId));
  state.paletteCache.set(paletteId, metrics);
  return metrics;
}

self.onmessage = async (event: MessageEvent<StandardWorkerRequestMessage>) => {
  const message = event.data;

  try {
    if (message.type === 'init') {
      state.contexts = {
        upper: buildCharsetConversionContext(message.fontBitsByCharset.upper),
        lower: buildCharsetConversionContext(message.fontBitsByCharset.lower),
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

    if (message.type === 'solve-standard-offset') {
      if (!state.contexts) {
        throw new Error('Worker not initialized');
      }
      const request = state.requestData.get(message.requestId);
      if (!request) {
        throw new Error(`Unknown worker request ${message.requestId}`);
      }
      const result = await solveStandardOffset(
        request.preprocessed,
        request.settings,
        state.contexts,
        getMetrics(request.settings.paletteId),
        message.offset,
        state.scoringKernel ?? undefined,
        () => !state.activeRequests.has(message.requestId)
      );
      if (!state.activeRequests.has(message.requestId)) {
        post({ type: 'cancelled', requestId: message.requestId, offsetId: message.offsetId });
        return;
      }
      post({
        type: 'offset-result',
        requestId: message.requestId,
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
