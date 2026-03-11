import wasmUrl from './truskiiBinaryKernel.wasm?url';
import type {
  CharsetConversionContext,
  PaletteMetricData,
  StandardPreprocessedImage,
} from './imageConverterStandardCore';

type BinaryKernelContext = {
  flatPositions: Uint8Array;
  positionOffsets: Int32Array;
  packedBinaryGlyphLo: Uint32Array;
  packedBinaryGlyphHi: Uint32Array;
  refSetCount: Int32Array;
  glyphAtlas: {
    spatialFrequency: Float32Array;
  };
};

type BinaryKernelExports = {
  memory: WebAssembly.Memory;
  getWeightedPixelErrorsPtr(): number;
  getPairDiffPtr(): number;
  getThresholdBitsPtr(): number;
  getPositionOffsetsPtr(): number;
  getFlatPositionsPtr(): number;
  getPackedBinaryGlyphLoPtr(): number;
  getPackedBinaryGlyphHiPtr(): number;
  getOutputSetErrsPtr(): number;
  getOutputHammingPtr(): number;
  getOutputBestByBgPtr(): number;
  getStandardSrcLPtr(): number;
  getStandardSrcAPtr(): number;
  getStandardSrcBPtr(): number;
  getStandardNearestPalettePtr(): number;
  getStandardScreenCodesPtr(): number;
  getStandardColorsPtr(): number;
  getStandardBgIndicesPtr(): number;
  getStandardCandidateScratchPtr(): number;
  getStandardRefinementScratchPtr(): number;
  getStandardTotalErrByColorPtr(): number;
  getStandardPaletteLPtr(): number;
  getStandardBinaryMixLPtr(): number;
  getStandardBinaryMixAPtr(): number;
  getStandardBinaryMixBPtr(): number;
  getStandardRefSetCountPtr(): number;
  getStandardGlyphSpatialFrequencyPtr(): number;
  getStandardCandidateScreencodesPtr(): number;
  getStandardBackgroundsPtr(): number;
  getStandardPoolCharsPtr(): number;
  getStandardPoolFgsPtr(): number;
  getStandardPoolScoresPtr(): number;
  getStandardPoolCountsPtr(): number;
  getStandardSolveCountsPtr(): number;
  getStandardSolveCharsPtr(): number;
  getStandardSolveBaseErrorsPtr(): number;
  getStandardSolveBrightnessResidualsPtr(): number;
  getStandardSolveRepeatHPtr(): number;
  getStandardSolveRepeatVPtr(): number;
  getStandardSolveEdgeLeftPtr(): number;
  getStandardSolveEdgeRightPtr(): number;
  getStandardSolveEdgeTopPtr(): number;
  getStandardSolveEdgeBottomPtr(): number;
  getStandardSolveHBoundaryDiffsPtr(): number;
  getStandardSolveVBoundaryDiffsPtr(): number;
  getStandardSolveSelectedIndicesPtr(): number;
  computeSetErrs(): void;
  computeHammingDistances(): void;
  computeStandardBestByBackground(
    avgL: number,
    avgA: number,
    avgB: number,
    detailScore: number,
    lumMatchWeight: number,
    csfWeight: number,
    maxPairDiff: number,
    candidateCount: number
  ): void;
  computeStandardCandidatePools(
    avgL: number,
    avgA: number,
    avgB: number,
    detailScore: number,
    lumMatchWeight: number,
    csfWeight: number,
    maxPairDiff: number,
    candidateCount: number,
    backgroundCount: number,
    poolSize: number,
    edgeMaskLo: number,
    edgeMaskHi: number,
    edgeWeight: number
  ): void;
  computeStandardSolveSelection(passCount: number): void;
};

type BinaryKernelImports = WebAssembly.Imports & {
  env: {
    abort(message?: number, fileName?: number, line?: number, column?: number): never;
  };
};

export interface StandardCandidateScoringKernel {
  computeSetErrs(weightedPixelErrors: Float32Array, context: BinaryKernelContext): Float32Array;
  computeHammingDistances(
    thresholdLo: number,
    thresholdHi: number,
    pairDiff: Float64Array,
    context: BinaryKernelContext
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
  solveSelectionWithNeighborPasses?(
    counts: Uint8Array,
    chars: Uint8Array,
    baseErrors: Float64Array,
    brightnessResiduals: Float64Array,
    repeatH: Float64Array,
    repeatV: Float64Array,
    edgeLeft: Uint8Array,
    edgeRight: Uint8Array,
    edgeTop: Uint8Array,
    edgeBottom: Uint8Array,
    hBoundaryDiffs: Float32Array,
    vBoundaryDiffs: Float32Array,
    passCount: number
  ): Uint8Array;
}

export interface BinaryWasmKernelCreateResult {
  kernel: BinaryWasmKernel | null;
  error?: string;
}

export interface StandardWasmResidentLayout {
  srcL: { ptr: number; length: number };
  srcA: { ptr: number; length: number };
  srcB: { ptr: number; length: number };
  nearestPalette: { ptr: number; length: number };
  screenCodes: { ptr: number; length: number };
  colors: { ptr: number; length: number };
  bgIndices: { ptr: number; length: number };
  candidateScratch: { ptr: number; length: number };
  refinementScratch: { ptr: number; length: number };
}

export interface StandardWasmRequestSession {
  readonly scoringKernel: StandardCandidateScoringKernel;
  readonly residentLayout: StandardWasmResidentLayout;
  readonly sourceShape: {
    width: number;
    height: number;
  };
}

const STANDARD_WASM_MAX_POOL_SIZE = 16;

let wasmModulePromise: Promise<WebAssembly.Module> | null = null;

function buildImports(): BinaryKernelImports {
  return {
    env: {
      abort(_message?: number, _fileName?: number, line?: number, column?: number): never {
        throw new Error(
          `[TruSkii3000] Standard/ECM WASM kernel aborted${line !== undefined ? ` at ${line}:${column ?? 0}` : ''}.`
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

export class BinaryWasmKernel implements StandardCandidateScoringKernel {
  private readonly exports: BinaryKernelExports;
  private loadedContext: BinaryKernelContext | null = null;
  private loadedPairDiff: Float64Array | null = null;
  private loadedMetrics: PaletteMetricData | null = null;
  private loadedCandidateScreencodes: Uint16Array | null = null;
  private loadedStandardPreprocessed: StandardPreprocessedImage | null = null;
  private weightedPixelErrorsView: Float32Array;
  private pairDiffView: Float32Array;
  private thresholdBitsView: Uint32Array;
  private positionOffsetsView: Int32Array;
  private flatPositionsView: Uint8Array;
  private packedBinaryGlyphLoView: Uint32Array;
  private packedBinaryGlyphHiView: Uint32Array;
  private outputSetErrsView: Float32Array;
  private outputHammingView: Uint8Array;
  private outputBestByBgView: Float64Array;
  private standardSrcLView: Float32Array;
  private standardSrcAView: Float32Array;
  private standardSrcBView: Float32Array;
  private standardNearestPaletteView: Uint8Array;
  private standardTotalErrByColorView: Float32Array;
  private standardPaletteLView: Float64Array;
  private standardBinaryMixLView: Float64Array;
  private standardBinaryMixAView: Float64Array;
  private standardBinaryMixBView: Float64Array;
  private standardRefSetCountView: Int32Array;
  private standardGlyphSpatialFrequencyView: Float32Array;
  private standardCandidateScreencodesView: Uint8Array;
  private standardBackgroundsView: Uint8Array;
  private standardPoolCharsView: Uint8Array;
  private standardPoolFgsView: Uint8Array;
  private standardPoolScoresView: Float64Array;
  private standardPoolCountsView: Uint8Array;
  private standardSolveCountsView: Uint8Array;
  private standardSolveCharsView: Uint8Array;
  private standardSolveBaseErrorsView: Float64Array;
  private standardSolveBrightnessResidualsView: Float64Array;
  private standardSolveRepeatHView: Float64Array;
  private standardSolveRepeatVView: Float64Array;
  private standardSolveEdgeLeftView: Uint8Array;
  private standardSolveEdgeRightView: Uint8Array;
  private standardSolveEdgeTopView: Uint8Array;
  private standardSolveEdgeBottomView: Uint8Array;
  private standardSolveHBoundaryDiffsView: Float32Array;
  private standardSolveVBoundaryDiffsView: Float32Array;
  private standardSolveSelectedIndicesView: Uint8Array;
  private readonly standardResidentLayout: StandardWasmResidentLayout;

  private constructor(exports: BinaryKernelExports) {
    this.exports = exports;
    this.weightedPixelErrorsView = new Float32Array(
      exports.memory.buffer,
      exports.getWeightedPixelErrorsPtr(),
      64 * 16
    );
    this.pairDiffView = new Float32Array(
      exports.memory.buffer,
      exports.getPairDiffPtr(),
      16 * 16
    );
    this.thresholdBitsView = new Uint32Array(
      exports.memory.buffer,
      exports.getThresholdBitsPtr(),
      2
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
    this.packedBinaryGlyphLoView = new Uint32Array(
      exports.memory.buffer,
      exports.getPackedBinaryGlyphLoPtr(),
      256
    );
    this.packedBinaryGlyphHiView = new Uint32Array(
      exports.memory.buffer,
      exports.getPackedBinaryGlyphHiPtr(),
      256
    );
    this.outputSetErrsView = new Float32Array(
      exports.memory.buffer,
      exports.getOutputSetErrsPtr(),
      256 * 16
    );
    this.outputHammingView = new Uint8Array(
      exports.memory.buffer,
      exports.getOutputHammingPtr(),
      256
    );
    this.outputBestByBgView = new Float64Array(
      exports.memory.buffer,
      exports.getOutputBestByBgPtr(),
      16
    );
    this.standardSrcLView = new Float32Array(
      exports.memory.buffer,
      exports.getStandardSrcLPtr(),
      320 * 200
    );
    this.standardSrcAView = new Float32Array(
      exports.memory.buffer,
      exports.getStandardSrcAPtr(),
      320 * 200
    );
    this.standardSrcBView = new Float32Array(
      exports.memory.buffer,
      exports.getStandardSrcBPtr(),
      320 * 200
    );
    this.standardNearestPaletteView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardNearestPalettePtr(),
      320 * 200
    );
    this.standardTotalErrByColorView = new Float32Array(
      exports.memory.buffer,
      exports.getStandardTotalErrByColorPtr(),
      16
    );
    this.standardPaletteLView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardPaletteLPtr(),
      16
    );
    this.standardBinaryMixLView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardBinaryMixLPtr(),
      65 * 16 * 16
    );
    this.standardBinaryMixAView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardBinaryMixAPtr(),
      65 * 16 * 16
    );
    this.standardBinaryMixBView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardBinaryMixBPtr(),
      65 * 16 * 16
    );
    this.standardRefSetCountView = new Int32Array(
      exports.memory.buffer,
      exports.getStandardRefSetCountPtr(),
      256
    );
    this.standardGlyphSpatialFrequencyView = new Float32Array(
      exports.memory.buffer,
      exports.getStandardGlyphSpatialFrequencyPtr(),
      256
    );
    this.standardCandidateScreencodesView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardCandidateScreencodesPtr(),
      256
    );
    this.standardBackgroundsView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardBackgroundsPtr(),
      16
    );
    this.standardPoolCharsView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardPoolCharsPtr(),
      16 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardPoolFgsView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardPoolFgsPtr(),
      16 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardPoolScoresView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardPoolScoresPtr(),
      16 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardPoolCountsView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardPoolCountsPtr(),
      16
    );
    this.standardSolveCountsView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardSolveCountsPtr(),
      40 * 25
    );
    this.standardSolveCharsView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardSolveCharsPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardSolveBaseErrorsView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardSolveBaseErrorsPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardSolveBrightnessResidualsView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardSolveBrightnessResidualsPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardSolveRepeatHView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardSolveRepeatHPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardSolveRepeatVView = new Float64Array(
      exports.memory.buffer,
      exports.getStandardSolveRepeatVPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE
    );
    this.standardSolveEdgeLeftView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardSolveEdgeLeftPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE * 8
    );
    this.standardSolveEdgeRightView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardSolveEdgeRightPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE * 8
    );
    this.standardSolveEdgeTopView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardSolveEdgeTopPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE * 8
    );
    this.standardSolveEdgeBottomView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardSolveEdgeBottomPtr(),
      40 * 25 * STANDARD_WASM_MAX_POOL_SIZE * 8
    );
    this.standardSolveHBoundaryDiffsView = new Float32Array(
      exports.memory.buffer,
      exports.getStandardSolveHBoundaryDiffsPtr(),
      25 * 39 * 8
    );
    this.standardSolveVBoundaryDiffsView = new Float32Array(
      exports.memory.buffer,
      exports.getStandardSolveVBoundaryDiffsPtr(),
      24 * 40 * 8
    );
    this.standardSolveSelectedIndicesView = new Uint8Array(
      exports.memory.buffer,
      exports.getStandardSolveSelectedIndicesPtr(),
      40 * 25
    );
    this.standardResidentLayout = {
      srcL: { ptr: exports.getStandardSrcLPtr(), length: this.standardSrcLView.length },
      srcA: { ptr: exports.getStandardSrcAPtr(), length: this.standardSrcAView.length },
      srcB: { ptr: exports.getStandardSrcBPtr(), length: this.standardSrcBView.length },
      nearestPalette: { ptr: exports.getStandardNearestPalettePtr(), length: this.standardNearestPaletteView.length },
      screenCodes: { ptr: exports.getStandardScreenCodesPtr(), length: 40 * 25 },
      colors: { ptr: exports.getStandardColorsPtr(), length: 40 * 25 },
      bgIndices: { ptr: exports.getStandardBgIndicesPtr(), length: 40 * 25 },
      candidateScratch: { ptr: exports.getStandardCandidateScratchPtr(), length: 40 * 25 * 16 },
      refinementScratch: { ptr: exports.getStandardRefinementScratchPtr(), length: 40 * 25 },
    };
  }

  static async create(): Promise<BinaryWasmKernelCreateResult> {
    try {
      const module = await compileModule();
      const instance = await WebAssembly.instantiate(module, buildImports());
      return { kernel: new BinaryWasmKernel(instance.exports as unknown as BinaryKernelExports) };
    } catch (error) {
      return {
        kernel: null,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      };
    }
  }

  computeSetErrs(weightedPixelErrors: Float32Array, context: BinaryKernelContext): Float32Array {
    this.ensureContext(context);
    this.weightedPixelErrorsView.set(weightedPixelErrors);
    this.exports.computeSetErrs();
    return this.outputSetErrsView;
  }

  computeHammingDistances(
    thresholdLo: number,
    thresholdHi: number,
    pairDiff: Float64Array,
    context: BinaryKernelContext
  ): Uint8Array {
    this.ensureContext(context);
    this.ensurePairDiff(pairDiff);
    this.thresholdBitsView[0] = thresholdLo >>> 0;
    this.thresholdBitsView[1] = thresholdHi >>> 0;
    this.exports.computeHammingDistances();
    return this.outputHammingView;
  }

  computeBestErrorByBackground(
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
  ): Float64Array {
    this.ensureContext(context);
    this.ensureMetrics(metrics);
    this.ensureCandidateScreencodes(candidateScreencodes);
    this.weightedPixelErrorsView.set(weightedPixelErrors);
    this.standardTotalErrByColorView.set(totalErrByColor);
    this.exports.computeStandardBestByBackground(
      avgL,
      avgA,
      avgB,
      detailScore,
      settings.lumMatchWeight,
      settings.csfWeight,
      metrics.maxPairDiff,
      candidateScreencodes.length
    );
    return this.outputBestByBgView;
  }

  computeCandidatePoolsByBackground(
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
  ) {
    this.ensureContext(context);
    this.ensureMetrics(metrics);
    this.ensureCandidateScreencodes(candidateScreencodes);
    this.ensureBackgrounds(backgrounds);
    this.weightedPixelErrorsView.set(weightedPixelErrors);
    this.standardTotalErrByColorView.set(totalErrByColor);
    this.exports.computeStandardCandidatePools(
      avgL,
      avgA,
      avgB,
      detailScore,
      settings.lumMatchWeight,
      settings.csfWeight,
      metrics.maxPairDiff,
      candidateScreencodes.length,
      backgrounds.length,
      Math.min(poolSize, STANDARD_WASM_MAX_POOL_SIZE),
      edgeMaskLo >>> 0,
      edgeMaskHi >>> 0,
      edgeWeight
    );
    return {
      counts: this.standardPoolCountsView.subarray(0, backgrounds.length),
      chars: this.standardPoolCharsView.subarray(0, backgrounds.length * STANDARD_WASM_MAX_POOL_SIZE),
      fgs: this.standardPoolFgsView.subarray(0, backgrounds.length * STANDARD_WASM_MAX_POOL_SIZE),
      scores: this.standardPoolScoresView.subarray(0, backgrounds.length * STANDARD_WASM_MAX_POOL_SIZE),
      setErrs: this.outputSetErrsView,
    };
  }

  solveSelectionWithNeighborPasses(
    counts: Uint8Array,
    chars: Uint8Array,
    baseErrors: Float64Array,
    brightnessResiduals: Float64Array,
    repeatH: Float64Array,
    repeatV: Float64Array,
    edgeLeft: Uint8Array,
    edgeRight: Uint8Array,
    edgeTop: Uint8Array,
    edgeBottom: Uint8Array,
    hBoundaryDiffs: Float32Array,
    vBoundaryDiffs: Float32Array,
    passCount: number
  ): Uint8Array {
    this.standardSolveCountsView.set(counts);
    this.standardSolveCharsView.set(chars);
    this.standardSolveBaseErrorsView.set(baseErrors);
    this.standardSolveBrightnessResidualsView.set(brightnessResiduals);
    this.standardSolveRepeatHView.set(repeatH);
    this.standardSolveRepeatVView.set(repeatV);
    this.standardSolveEdgeLeftView.set(edgeLeft);
    this.standardSolveEdgeRightView.set(edgeRight);
    this.standardSolveEdgeTopView.set(edgeTop);
    this.standardSolveEdgeBottomView.set(edgeBottom);
    this.standardSolveHBoundaryDiffsView.set(hBoundaryDiffs);
    this.standardSolveVBoundaryDiffsView.set(vBoundaryDiffs);
    this.exports.computeStandardSolveSelection(passCount);
    return this.standardSolveSelectedIndicesView;
  }

  getStandardResidentLayout(): StandardWasmResidentLayout {
    return this.standardResidentLayout;
  }

  beginStandardRequest(
    preprocessed: StandardPreprocessedImage,
    pairDiff: Float64Array
  ): StandardWasmRequestSession {
    this.preloadStandardState(preprocessed, pairDiff);
    return {
      scoringKernel: this,
      residentLayout: this.standardResidentLayout,
      sourceShape: {
        width: preprocessed.width,
        height: preprocessed.height,
      },
    };
  }

  preloadStandardState(preprocessed: StandardPreprocessedImage, pairDiff: Float64Array) {
    if (this.loadedStandardPreprocessed !== preprocessed) {
      this.standardSrcLView.set(preprocessed.srcL);
      this.standardSrcAView.set(preprocessed.srcA);
      this.standardSrcBView.set(preprocessed.srcB);
      this.standardNearestPaletteView.set(preprocessed.nearestPalette);
      this.loadedStandardPreprocessed = preprocessed;
    }
    this.ensurePairDiff(pairDiff);
  }

  private ensureContext(context: BinaryKernelContext) {
    if (this.loadedContext === context) {
      return;
    }

    this.positionOffsetsView.set(context.positionOffsets);
    this.flatPositionsView.set(context.flatPositions);
    this.packedBinaryGlyphLoView.set(context.packedBinaryGlyphLo);
    this.packedBinaryGlyphHiView.set(context.packedBinaryGlyphHi);
    this.standardRefSetCountView.set(context.refSetCount);
    this.standardGlyphSpatialFrequencyView.set(context.glyphAtlas.spatialFrequency);
    this.loadedContext = context;
  }

  private ensurePairDiff(pairDiff: Float64Array) {
    if (this.loadedPairDiff === pairDiff) {
      return;
    }

    this.pairDiffView.set(pairDiff);
    this.loadedPairDiff = pairDiff;
  }

  private ensureMetrics(metrics: PaletteMetricData) {
    if (this.loadedMetrics === metrics) {
      return;
    }

    this.ensurePairDiff(metrics.pairDiff);
    this.standardPaletteLView.set(metrics.pL);
    this.standardBinaryMixLView.set(metrics.binaryMixL);
    this.standardBinaryMixAView.set(metrics.binaryMixA);
    this.standardBinaryMixBView.set(metrics.binaryMixB);
    this.loadedMetrics = metrics;
  }

  private ensureCandidateScreencodes(candidateScreencodes: Uint16Array) {
    if (this.loadedCandidateScreencodes === candidateScreencodes) {
      return;
    }

    this.standardCandidateScreencodesView.fill(0);
    for (let i = 0; i < candidateScreencodes.length; i++) {
      this.standardCandidateScreencodesView[i] = candidateScreencodes[i] & 0xff;
    }
    this.loadedCandidateScreencodes = candidateScreencodes;
  }

  private ensureBackgrounds(backgrounds: number[]) {
    this.standardBackgroundsView.fill(0);
    for (let i = 0; i < backgrounds.length; i++) {
      this.standardBackgroundsView[i] = backgrounds[i] & 0xff;
    }
  }
}
