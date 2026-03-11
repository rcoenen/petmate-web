import wasmUrl from './truskiiMcmKernel.wasm?url';

type BinaryKernelContext = {
  flatPositions: Uint8Array;
  positionOffsets: Int32Array;
  packedBinaryGlyphLo: Uint32Array;
  packedBinaryGlyphHi: Uint32Array;
};

type McmKernelContext = BinaryKernelContext & {
  flatMcmPositions?: Uint8Array[];
  mcmPositionOffsets?: Int32Array[];
  packedMcmGlyphMasks?: [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
};

type McmKernelExports = {
  memory: WebAssembly.Memory;
  getWeightedPixelErrorsPtr(): number;
  getWeightedPairErrorsPtr(): number;
  getPairDiffPtr(): number;
  getModeWeightedPixelErrorsPtr(): number;
  getModeWeightedPairErrorsPtr(): number;
  getThresholdMasksPtr(): number;
  getPositionOffsetsPtr(): number;
  getFlatPositionsPtr(): number;
  getMcmPositionOffsets0Ptr(): number;
  getMcmPositionOffsets1Ptr(): number;
  getMcmPositionOffsets2Ptr(): number;
  getMcmPositionOffsets3Ptr(): number;
  getFlatMcmPositions0Ptr(): number;
  getFlatMcmPositions1Ptr(): number;
  getFlatMcmPositions2Ptr(): number;
  getFlatMcmPositions3Ptr(): number;
  getPackedMcmGlyphMasks0Ptr(): number;
  getPackedMcmGlyphMasks1Ptr(): number;
  getPackedMcmGlyphMasks2Ptr(): number;
  getPackedMcmGlyphMasks3Ptr(): number;
  getOutputSetErrsPtr(): number;
  getOutputBitPairErrsPtr(): number;
  getOutputHammingPtr(): number;
  computeMatrices(): void;
  computeModeMatrices(cellIndex: number): void;
  computeHammingDistances(): void;
};

type McmKernelImports = WebAssembly.Imports & {
  env: {
    abort(message?: number, fileName?: number, line?: number, column?: number): never;
  };
};

type ResidentModeMcmCell = {
  weightedPixelErrors: Float32Array;
  weightedPairErrors?: Float32Array;
};

export interface McmWasmKernelCreateResult {
  kernel: McmWasmKernel | null;
  error?: string;
};

let wasmModulePromise: Promise<WebAssembly.Module> | null = null;

function buildImports(): McmKernelImports {
  return {
    env: {
      abort(_message?: number, _fileName?: number, line?: number, column?: number): never {
        throw new Error(
          `[TruSkii3000] MCM WASM kernel aborted${line !== undefined ? ` at ${line}:${column ?? 0}` : ''}.`
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

export class McmWasmKernel {
  private readonly exports: McmKernelExports;
  private loadedContext: McmKernelContext | null = null;
  private loadedPairDiff: Float64Array | null = null;
  private loadedModeCells: ArrayLike<ResidentModeMcmCell> | null = null;
  private weightedPixelErrorsView: Float32Array;
  private weightedPairErrorsView: Float32Array;
  private modeWeightedPixelErrorsView: Float32Array;
  private modeWeightedPairErrorsView: Float32Array;
  private pairDiffView: Float32Array;
  private thresholdMasksView: Uint32Array;
  private positionOffsetsView: Int32Array;
  private flatPositionsView: Uint8Array;
  private mcmPositionOffsetsViews: Int32Array[];
  private flatMcmPositionsViews: Uint8Array[];
  private packedMcmGlyphMaskViews: Uint32Array[];
  private outputSetErrsView: Float32Array;
  private outputBitPairErrsView: Float32Array;
  private outputHammingView: Uint8Array;

  private constructor(exports: McmKernelExports) {
    this.exports = exports;
    this.weightedPixelErrorsView = new Float32Array(exports.memory.buffer, exports.getWeightedPixelErrorsPtr(), 64 * 16);
    this.weightedPairErrorsView = new Float32Array(exports.memory.buffer, exports.getWeightedPairErrorsPtr(), 32 * 16);
    this.modeWeightedPixelErrorsView = new Float32Array(exports.memory.buffer, exports.getModeWeightedPixelErrorsPtr(), 40 * 25 * 64 * 16);
    this.modeWeightedPairErrorsView = new Float32Array(exports.memory.buffer, exports.getModeWeightedPairErrorsPtr(), 40 * 25 * 32 * 16);
    this.pairDiffView = new Float32Array(exports.memory.buffer, exports.getPairDiffPtr(), 16 * 16);
    this.thresholdMasksView = new Uint32Array(exports.memory.buffer, exports.getThresholdMasksPtr(), 4);
    this.positionOffsetsView = new Int32Array(exports.memory.buffer, exports.getPositionOffsetsPtr(), 257);
    this.flatPositionsView = new Uint8Array(exports.memory.buffer, exports.getFlatPositionsPtr(), 256 * 64);
    this.mcmPositionOffsetsViews = [
      new Int32Array(exports.memory.buffer, exports.getMcmPositionOffsets0Ptr(), 257),
      new Int32Array(exports.memory.buffer, exports.getMcmPositionOffsets1Ptr(), 257),
      new Int32Array(exports.memory.buffer, exports.getMcmPositionOffsets2Ptr(), 257),
      new Int32Array(exports.memory.buffer, exports.getMcmPositionOffsets3Ptr(), 257),
    ];
    this.flatMcmPositionsViews = [
      new Uint8Array(exports.memory.buffer, exports.getFlatMcmPositions0Ptr(), 256 * 32),
      new Uint8Array(exports.memory.buffer, exports.getFlatMcmPositions1Ptr(), 256 * 32),
      new Uint8Array(exports.memory.buffer, exports.getFlatMcmPositions2Ptr(), 256 * 32),
      new Uint8Array(exports.memory.buffer, exports.getFlatMcmPositions3Ptr(), 256 * 32),
    ];
    this.packedMcmGlyphMaskViews = [
      new Uint32Array(exports.memory.buffer, exports.getPackedMcmGlyphMasks0Ptr(), 256),
      new Uint32Array(exports.memory.buffer, exports.getPackedMcmGlyphMasks1Ptr(), 256),
      new Uint32Array(exports.memory.buffer, exports.getPackedMcmGlyphMasks2Ptr(), 256),
      new Uint32Array(exports.memory.buffer, exports.getPackedMcmGlyphMasks3Ptr(), 256),
    ];
    this.outputSetErrsView = new Float32Array(exports.memory.buffer, exports.getOutputSetErrsPtr(), 256 * 16);
    this.outputBitPairErrsView = new Float32Array(exports.memory.buffer, exports.getOutputBitPairErrsPtr(), 256 * 4 * 16);
    this.outputHammingView = new Uint8Array(exports.memory.buffer, exports.getOutputHammingPtr(), 256);
  }

  static async create(): Promise<McmWasmKernelCreateResult> {
    try {
      const module = await compileModule();
      const instance = await WebAssembly.instantiate(module, buildImports());
      return { kernel: new McmWasmKernel(instance.exports as unknown as McmKernelExports) };
    } catch (error) {
      return {
        kernel: null,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
  }

  computeMatrices(weightedPixelErrors: Float32Array, weightedPairErrors: Float32Array, context: McmKernelContext) {
    this.ensureContext(context);
    this.weightedPixelErrorsView.set(weightedPixelErrors);
    this.weightedPairErrorsView.set(weightedPairErrors);
    this.exports.computeMatrices();
    return {
      setErrs: this.outputSetErrsView,
      bitPairErrs: this.outputBitPairErrsView,
    };
  }

  computeMatricesForModeCell(cellIndex: number, context: McmKernelContext) {
    this.ensureContext(context);
    this.exports.computeModeMatrices(cellIndex);
    return {
      setErrs: this.outputSetErrsView,
      bitPairErrs: this.outputBitPairErrsView,
    };
  }

  preloadModeCellErrors(cells: ArrayLike<ResidentModeMcmCell>) {
    if (this.loadedModeCells === cells) {
      return;
    }

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const cell = cells[cellIndex];
      if (!cell.weightedPairErrors) {
        throw new Error('Missing MCM weighted pair data for resident WASM upload.');
      }
      this.modeWeightedPixelErrorsView.set(cell.weightedPixelErrors, cellIndex * 64 * 16);
      this.modeWeightedPairErrorsView.set(cell.weightedPairErrors, cellIndex * 32 * 16);
    }
    this.loadedModeCells = cells;
  }

  preloadPairDiff(pairDiff: Float64Array) {
    this.ensurePairDiff(pairDiff);
  }

  computeHammingDistances(thresholdMasks: Uint32Array, pairDiff: Float64Array, context: McmKernelContext): Uint8Array {
    this.ensureContext(context);
    this.ensurePairDiff(pairDiff);
    this.thresholdMasksView.set(thresholdMasks);
    this.exports.computeHammingDistances();
    return this.outputHammingView;
  }

  private ensureContext(context: McmKernelContext) {
    if (this.loadedContext === context) {
      return;
    }
    if (!context.flatMcmPositions || !context.mcmPositionOffsets || !context.packedMcmGlyphMasks) {
      throw new Error('Missing MCM position data for WASM kernel.');
    }

    this.positionOffsetsView.set(context.positionOffsets);
    this.flatPositionsView.set(context.flatPositions);
    for (let bitPair = 0; bitPair < 4; bitPair++) {
      this.mcmPositionOffsetsViews[bitPair].set(context.mcmPositionOffsets[bitPair]);
      this.flatMcmPositionsViews[bitPair].set(context.flatMcmPositions[bitPair]);
      this.packedMcmGlyphMaskViews[bitPair].set(context.packedMcmGlyphMasks[bitPair]);
    }
    this.loadedContext = context;
  }

  private ensurePairDiff(pairDiff: Float64Array) {
    if (this.loadedPairDiff === pairDiff) {
      return;
    }

    this.pairDiffView.set(pairDiff);
    this.loadedPairDiff = pairDiff;
  }
}
