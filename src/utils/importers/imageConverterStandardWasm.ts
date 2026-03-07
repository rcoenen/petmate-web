import wasmUrl from './truskiiStandardKernel.wasm?url';

import type { CharsetConversionContext } from './imageConverterStandardCore';

type StandardKernelExports = {
  memory: WebAssembly.Memory;
  getWeightedPixelErrorsPtr(): number;
  getPositionOffsetsPtr(): number;
  getFlatPositionsPtr(): number;
  getOutputSetErrsPtr(): number;
  computeSetErrs(): void;
};

type StandardKernelImports = WebAssembly.Imports & {
  env: {
    abort(message?: number, fileName?: number, line?: number, column?: number): never;
  };
};

export interface StandardCandidateScoringKernel {
  computeSetErrs(weightedPixelErrors: Float32Array, context: CharsetConversionContext): Float32Array;
}

export interface StandardWasmKernelCreateResult {
  kernel: StandardWasmKernel | null;
  error?: string;
}

let wasmModulePromise: Promise<WebAssembly.Module> | null = null;

function buildImports(): StandardKernelImports {
  return {
    env: {
      abort(_message?: number, _fileName?: number, line?: number, column?: number): never {
        throw new Error(
          `[TruSkii3000] Standard WASM kernel aborted${line !== undefined ? ` at ${line}:${column ?? 0}` : ''}.`
        );
      },
    },
  };
}

function compileModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      if (typeof WebAssembly === 'undefined') {
        throw new Error('WebAssembly is unavailable');
      }
      if (typeof WebAssembly.compileStreaming === 'function') {
        try {
          return await WebAssembly.compileStreaming(fetch(wasmUrl));
        } catch {
          // Fall back to array-buffer compilation below.
        }
      }
      const response = await fetch(wasmUrl);
      const bytes = await response.arrayBuffer();
      return await WebAssembly.compile(bytes);
    })();
  }
  return wasmModulePromise;
}

export class StandardWasmKernel implements StandardCandidateScoringKernel {
  private readonly exports: StandardKernelExports;
  private loadedContext: CharsetConversionContext | null = null;
  private weightedPixelErrorsView: Float32Array;
  private positionOffsetsView: Int32Array;
  private flatPositionsView: Uint8Array;
  private outputSetErrsView: Float32Array;

  private constructor(exports: StandardKernelExports) {
    this.exports = exports;
    this.weightedPixelErrorsView = new Float32Array(
      exports.memory.buffer,
      exports.getWeightedPixelErrorsPtr(),
      64 * 16
    );
    this.positionOffsetsView = new Int32Array(
      exports.memory.buffer,
      exports.getPositionOffsetsPtr(),
      257
    );
    this.flatPositionsView = new Uint8Array(
      exports.memory.buffer,
      exports.getFlatPositionsPtr(),
      256 * 64
    );
    this.outputSetErrsView = new Float32Array(
      exports.memory.buffer,
      exports.getOutputSetErrsPtr(),
      256 * 16
    );
  }

  static async create(): Promise<StandardWasmKernelCreateResult> {
    try {
      const module = await compileModule();
      const instance = await WebAssembly.instantiate(module, buildImports());
      return { kernel: new StandardWasmKernel(instance.exports as unknown as StandardKernelExports) };
    } catch (error) {
      return {
        kernel: null,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
  }

  computeSetErrs(weightedPixelErrors: Float32Array, context: CharsetConversionContext): Float32Array {
    this.ensureContext(context);
    this.weightedPixelErrorsView.set(weightedPixelErrors);
    this.exports.computeSetErrs();
    return this.outputSetErrsView;
  }

  private ensureContext(context: CharsetConversionContext) {
    if (this.loadedContext === context) {
      return;
    }

    this.positionOffsetsView.set(context.positionOffsets);
    this.flatPositionsView.fill(0);
    this.flatPositionsView.set(context.flatPositions);
    this.loadedContext = context;
  }
}
