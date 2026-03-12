import wasmUrl from './truskiiMcmKernel.wasm?url';

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

type McmKernelContext = BinaryKernelContext & {
  flatMcmPositions?: Uint8Array[];
  mcmPositionOffsets?: Int32Array[];
  packedMcmGlyphMasks?: [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  refMcmBpCount?: Int32Array[];
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
  getPoolTotalErrByColorPtr(): number;
  getPoolTopCharsPtr(): number;
  getPoolTopColorRamsPtr(): number;
  getPoolTopVariantsPtr(): number;
  getPoolTopScoresPtr(): number;
  getBatchPoolCountsPtr(): number;
  getBatchPoolTopCharsPtr(): number;
  getBatchPoolTopColorRamsPtr(): number;
  getBatchPoolTopVariantsPtr(): number;
  getBatchPoolTopScoresPtr(): number;
  getRankSampleCellIndicesPtr(): number;
  getRankSampleAvgLPtr(): number;
  getRankSampleAvgAPtr(): number;
  getRankSampleAvgBPtr(): number;
  getRankSampleDetailScoresPtr(): number;
  getRankSampleSaliencyWeightsPtr(): number;
  getRankSampleTotalErrByColorPtr(): number;
  getRankCandidateScreencodesPtr(): number;
  getRankRefSetCountPtr(): number;
  getRankGlyphSpatialFrequencyPtr(): number;
  getRankRefMcmBpCountsPtr(): number;
  getRankBinaryMixLPtr(): number;
  getRankBinaryMixAPtr(): number;
  getRankBinaryMixBPtr(): number;
  getRankPaletteLPtr(): number;
  getRankPaletteAPtr(): number;
  getRankPaletteBPtr(): number;
  getRankContrastMaskPtr(): number;
  getRankTopBgsPtr(): number;
  getRankTopMc1sPtr(): number;
  getRankTopMc2sPtr(): number;
  getRankTopScoresPtr(): number;
  computeMatrices(): void;
  computeModeMatrices(cellIndex: number): void;
  computeHammingDistances(): void;
  rankModeTriples(
    sampleCount: number,
    candidateCount: number,
    finalistCount: number,
    lumMatchWeight: number,
    csfWeight: number,
    mcmHuePreservationWeight: number,
    mcmHiresColorPenaltyWeight: number,
    mcmMulticolorUsageBonusWeight: number,
    manualBgColor: number
  ): number;
  computeModeCandidatePool(
    cellIndex: number,
    candidateCount: number,
    poolSize: number,
    bg: number,
    mc1: number,
    mc2: number,
    avgL: number,
    avgA: number,
    avgB: number,
    detailScore: number,
    lumMatchWeight: number,
    csfWeight: number,
    mcmHuePreservationWeight: number,
    mcmHiresColorPenaltyWeight: number,
    mcmMulticolorUsageBonusWeight: number
  ): number;
  computeModeCandidatePoolsBatch(
    cellIndex: number,
    candidateCount: number,
    poolSize: number,
    finalistCount: number,
    avgL: number,
    avgA: number,
    avgB: number,
    detailScore: number,
    lumMatchWeight: number,
    csfWeight: number,
    mcmHuePreservationWeight: number,
    mcmHiresColorPenaltyWeight: number,
    mcmMulticolorUsageBonusWeight: number
  ): number;
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

export interface McmBatchCandidatePools {
  counts: Uint8Array;
  chars: Uint8Array;
  colorRams: Uint8Array;
  variants: Uint8Array;
  scores: Float64Array;
}

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
  private poolTotalErrByColorView: Float32Array;
  private poolTopCharsView: Uint8Array;
  private poolTopColorRamsView: Uint8Array;
  private poolTopVariantsView: Uint8Array;
  private poolTopScoresView: Float64Array;
  private batchPoolCountsView: Uint8Array;
  private batchPoolTopCharsView: Uint8Array;
  private batchPoolTopColorRamsView: Uint8Array;
  private batchPoolTopVariantsView: Uint8Array;
  private batchPoolTopScoresView: Float64Array;
  private rankSampleCellIndicesView: Int32Array;
  private rankSampleAvgLView: Float64Array;
  private rankSampleAvgAView: Float64Array;
  private rankSampleAvgBView: Float64Array;
  private rankSampleDetailScoresView: Float64Array;
  private rankSampleSaliencyWeightsView: Float64Array;
  private rankSampleTotalErrByColorView: Float32Array;
  private rankCandidateScreencodesView: Uint16Array;
  private rankRefSetCountView: Int32Array;
  private rankGlyphSpatialFrequencyView: Float32Array;
  private rankRefMcmBpCountsView: Uint8Array;
  private rankBinaryMixLView: Float64Array;
  private rankBinaryMixAView: Float64Array;
  private rankBinaryMixBView: Float64Array;
  private rankPaletteLView: Float64Array;
  private rankPaletteAView: Float64Array;
  private rankPaletteBView: Float64Array;
  private rankContrastMaskView: Uint8Array;
  private rankTopBgsView: Uint8Array;
  private rankTopMc1sView: Uint8Array;
  private rankTopMc2sView: Uint8Array;
  private rankTopScoresView: Float64Array;
  private positionOffsetsView: Int32Array;
  private flatPositionsView: Uint8Array;
  private mcmPositionOffsetsViews: Int32Array[];
  private flatMcmPositionsViews: Uint8Array[];
  private packedMcmGlyphMaskViews: Uint32Array[];
  private outputSetErrsView: Float32Array;
  private outputBitPairErrsView: Float32Array;
  private outputHammingView: Uint8Array;
  private loadedRankingMetrics: {
    binaryMixL: Float64Array;
    binaryMixA: Float64Array;
    binaryMixB: Float64Array;
    pL: Float64Array;
    pA: Float64Array;
    pB: Float64Array;
    pairDiff: Float64Array;
    maxPairDiff: number;
  } | null = null;

  private constructor(exports: McmKernelExports) {
    this.exports = exports;
    this.weightedPixelErrorsView = new Float32Array(exports.memory.buffer, exports.getWeightedPixelErrorsPtr(), 64 * 16);
    this.weightedPairErrorsView = new Float32Array(exports.memory.buffer, exports.getWeightedPairErrorsPtr(), 32 * 16);
    this.modeWeightedPixelErrorsView = new Float32Array(exports.memory.buffer, exports.getModeWeightedPixelErrorsPtr(), 40 * 25 * 64 * 16);
    this.modeWeightedPairErrorsView = new Float32Array(exports.memory.buffer, exports.getModeWeightedPairErrorsPtr(), 40 * 25 * 32 * 16);
    this.pairDiffView = new Float32Array(exports.memory.buffer, exports.getPairDiffPtr(), 16 * 16);
    this.thresholdMasksView = new Uint32Array(exports.memory.buffer, exports.getThresholdMasksPtr(), 4);
    this.poolTotalErrByColorView = new Float32Array(exports.memory.buffer, exports.getPoolTotalErrByColorPtr(), 16);
    this.poolTopCharsView = new Uint8Array(exports.memory.buffer, exports.getPoolTopCharsPtr(), 16);
    this.poolTopColorRamsView = new Uint8Array(exports.memory.buffer, exports.getPoolTopColorRamsPtr(), 16);
    this.poolTopVariantsView = new Uint8Array(exports.memory.buffer, exports.getPoolTopVariantsPtr(), 16);
    this.poolTopScoresView = new Float64Array(exports.memory.buffer, exports.getPoolTopScoresPtr(), 16);
    this.batchPoolCountsView = new Uint8Array(exports.memory.buffer, exports.getBatchPoolCountsPtr(), 16);
    this.batchPoolTopCharsView = new Uint8Array(exports.memory.buffer, exports.getBatchPoolTopCharsPtr(), 16 * 16);
    this.batchPoolTopColorRamsView = new Uint8Array(exports.memory.buffer, exports.getBatchPoolTopColorRamsPtr(), 16 * 16);
    this.batchPoolTopVariantsView = new Uint8Array(exports.memory.buffer, exports.getBatchPoolTopVariantsPtr(), 16 * 16);
    this.batchPoolTopScoresView = new Float64Array(exports.memory.buffer, exports.getBatchPoolTopScoresPtr(), 16 * 16);
    this.rankSampleCellIndicesView = new Int32Array(exports.memory.buffer, exports.getRankSampleCellIndicesPtr(), 64);
    this.rankSampleAvgLView = new Float64Array(exports.memory.buffer, exports.getRankSampleAvgLPtr(), 64);
    this.rankSampleAvgAView = new Float64Array(exports.memory.buffer, exports.getRankSampleAvgAPtr(), 64);
    this.rankSampleAvgBView = new Float64Array(exports.memory.buffer, exports.getRankSampleAvgBPtr(), 64);
    this.rankSampleDetailScoresView = new Float64Array(exports.memory.buffer, exports.getRankSampleDetailScoresPtr(), 64);
    this.rankSampleSaliencyWeightsView = new Float64Array(exports.memory.buffer, exports.getRankSampleSaliencyWeightsPtr(), 64);
    this.rankSampleTotalErrByColorView = new Float32Array(exports.memory.buffer, exports.getRankSampleTotalErrByColorPtr(), 64 * 16);
    this.rankCandidateScreencodesView = new Uint16Array(exports.memory.buffer, exports.getRankCandidateScreencodesPtr(), 256);
    this.rankRefSetCountView = new Int32Array(exports.memory.buffer, exports.getRankRefSetCountPtr(), 256);
    this.rankGlyphSpatialFrequencyView = new Float32Array(exports.memory.buffer, exports.getRankGlyphSpatialFrequencyPtr(), 256);
    this.rankRefMcmBpCountsView = new Uint8Array(exports.memory.buffer, exports.getRankRefMcmBpCountsPtr(), 256 * 4);
    this.rankBinaryMixLView = new Float64Array(exports.memory.buffer, exports.getRankBinaryMixLPtr(), 65 * 16 * 16);
    this.rankBinaryMixAView = new Float64Array(exports.memory.buffer, exports.getRankBinaryMixAPtr(), 65 * 16 * 16);
    this.rankBinaryMixBView = new Float64Array(exports.memory.buffer, exports.getRankBinaryMixBPtr(), 65 * 16 * 16);
    this.rankPaletteLView = new Float64Array(exports.memory.buffer, exports.getRankPaletteLPtr(), 16);
    this.rankPaletteAView = new Float64Array(exports.memory.buffer, exports.getRankPaletteAPtr(), 16);
    this.rankPaletteBView = new Float64Array(exports.memory.buffer, exports.getRankPaletteBPtr(), 16);
    this.rankContrastMaskView = new Uint8Array(exports.memory.buffer, exports.getRankContrastMaskPtr(), 16 * 8);
    this.rankTopBgsView = new Uint8Array(exports.memory.buffer, exports.getRankTopBgsPtr(), 16);
    this.rankTopMc1sView = new Uint8Array(exports.memory.buffer, exports.getRankTopMc1sPtr(), 16);
    this.rankTopMc2sView = new Uint8Array(exports.memory.buffer, exports.getRankTopMc2sPtr(), 16);
    this.rankTopScoresView = new Float64Array(exports.memory.buffer, exports.getRankTopScoresPtr(), 16);
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

  computeModeCandidatePool(
    cellIndex: number,
    cell: {
      totalErrByColor: Float32Array;
      avgL: number;
      avgA: number;
      avgB: number;
      detailScore: number;
    },
    candidateScreencodes: Uint16Array,
    bg: number,
    mc1: number,
    mc2: number,
    poolSize: number,
    metrics: {
      pairDiff: Float64Array;
      binaryMixL: Float64Array;
      binaryMixA: Float64Array;
      binaryMixB: Float64Array;
      pL: Float64Array;
      pA: Float64Array;
      pB: Float64Array;
      maxPairDiff: number;
    },
    context: McmKernelContext,
    settings: {
      lumMatchWeight: number;
      csfWeight: number;
      mcmHuePreservationWeight: number;
      mcmHiresColorPenaltyWeight: number;
      mcmMulticolorUsageBonusWeight: number;
    }
  ): {
    count: number;
    chars: Uint8Array;
    colorRams: Uint8Array;
    variants: Uint8Array;
    scores: Float64Array;
  } {
    this.ensureContext(context);
    this.ensurePairDiff(metrics.pairDiff);
    this.ensureRankingMetrics(metrics);
    this.rankCandidateScreencodesView.set(candidateScreencodes);
    this.poolTotalErrByColorView.set(cell.totalErrByColor);

    const count = this.exports.computeModeCandidatePool(
      cellIndex,
      candidateScreencodes.length,
      Math.min(poolSize, 16),
      bg,
      mc1,
      mc2,
      cell.avgL,
      cell.avgA,
      cell.avgB,
      cell.detailScore,
      settings.lumMatchWeight,
      settings.csfWeight,
      settings.mcmHuePreservationWeight,
      settings.mcmHiresColorPenaltyWeight,
      settings.mcmMulticolorUsageBonusWeight
    );

    return {
      count,
      chars: this.poolTopCharsView.subarray(0, count),
      colorRams: this.poolTopColorRamsView.subarray(0, count),
      variants: this.poolTopVariantsView.subarray(0, count),
      scores: this.poolTopScoresView.subarray(0, count),
    };
  }

  computeModeCandidatePoolsBatch(
    cellIndex: number,
    cell: {
      totalErrByColor: Float32Array;
      avgL: number;
      avgA: number;
      avgB: number;
      detailScore: number;
    },
    candidateScreencodes: Uint16Array,
    finalistCount: number,
    metrics: {
      pairDiff: Float64Array;
      binaryMixL: Float64Array;
      binaryMixA: Float64Array;
      binaryMixB: Float64Array;
      pL: Float64Array;
      pA: Float64Array;
      pB: Float64Array;
      maxPairDiff: number;
    },
    context: McmKernelContext,
    settings: {
      lumMatchWeight: number;
      csfWeight: number;
      mcmHuePreservationWeight: number;
      mcmHiresColorPenaltyWeight: number;
      mcmMulticolorUsageBonusWeight: number;
    },
    poolSize: number
  ): McmBatchCandidatePools {
    this.ensureContext(context);
    this.ensurePairDiff(metrics.pairDiff);
    this.ensureRankingMetrics(metrics);
    this.rankCandidateScreencodesView.set(candidateScreencodes);
    this.poolTotalErrByColorView.set(cell.totalErrByColor);

    const rankedCount = this.exports.computeModeCandidatePoolsBatch(
      cellIndex,
      candidateScreencodes.length,
      Math.min(poolSize, 16),
      Math.min(finalistCount, 16),
      cell.avgL,
      cell.avgA,
      cell.avgB,
      cell.detailScore,
      settings.lumMatchWeight,
      settings.csfWeight,
      settings.mcmHuePreservationWeight,
      settings.mcmHiresColorPenaltyWeight,
      settings.mcmMulticolorUsageBonusWeight
    );

    const slotStride = 16;
    return {
      counts: this.batchPoolCountsView.subarray(0, rankedCount),
      chars: this.batchPoolTopCharsView.subarray(0, rankedCount * slotStride),
      colorRams: this.batchPoolTopColorRamsView.subarray(0, rankedCount * slotStride),
      variants: this.batchPoolTopVariantsView.subarray(0, rankedCount * slotStride),
      scores: this.batchPoolTopScoresView.subarray(0, rankedCount * slotStride),
    };
  }

  rankModeTriples(
    cells: ArrayLike<{
      totalErrByColor: Float32Array;
      avgL: number;
      avgA: number;
      avgB: number;
      detailScore: number;
      saliencyWeight: number;
    }>,
    sampleIndices: ArrayLike<number>,
    candidateScreencodes: Uint16Array,
    manualBgColor: number | null,
    finalistCount: number,
    metrics: {
      pairDiff: Float64Array;
      binaryMixL: Float64Array;
      binaryMixA: Float64Array;
      binaryMixB: Float64Array;
      pL: Float64Array;
      pA: Float64Array;
      pB: Float64Array;
      maxPairDiff: number;
    },
    context: McmKernelContext,
    settings: {
      lumMatchWeight: number;
      csfWeight: number;
      mcmHuePreservationWeight: number;
      mcmHiresColorPenaltyWeight: number;
      mcmMulticolorUsageBonusWeight: number;
    }
  ): Array<{ triple: [number, number, number]; score: number }> {
    this.ensureContext(context);
    this.ensurePairDiff(metrics.pairDiff);
    this.ensureRankingMetrics(metrics);
    this.rankCandidateScreencodesView.set(candidateScreencodes);

    const sampleCount = Math.min(sampleIndices.length, 64);
    for (let sample = 0; sample < sampleCount; sample++) {
      const cellIndex = sampleIndices[sample] ?? 0;
      const cell = cells[cellIndex];
      this.rankSampleCellIndicesView[sample] = cellIndex;
      this.rankSampleAvgLView[sample] = cell.avgL;
      this.rankSampleAvgAView[sample] = cell.avgA;
      this.rankSampleAvgBView[sample] = cell.avgB;
      this.rankSampleDetailScoresView[sample] = cell.detailScore;
      this.rankSampleSaliencyWeightsView[sample] = cell.saliencyWeight;
      this.rankSampleTotalErrByColorView.set(cell.totalErrByColor, sample * 16);
    }

    const rankedCount = this.exports.rankModeTriples(
      sampleCount,
      candidateScreencodes.length,
      Math.min(finalistCount, 16),
      settings.lumMatchWeight,
      settings.csfWeight,
      settings.mcmHuePreservationWeight,
      settings.mcmHiresColorPenaltyWeight,
      settings.mcmMulticolorUsageBonusWeight,
      manualBgColor ?? -1
    );

    const ranked: Array<{ triple: [number, number, number]; score: number }> = [];
    for (let index = 0; index < rankedCount; index++) {
      ranked.push({
        triple: [
          this.rankTopBgsView[index] ?? 0,
          this.rankTopMc1sView[index] ?? 0,
          this.rankTopMc2sView[index] ?? 0,
        ],
        score: this.rankTopScoresView[index] ?? Infinity,
      });
    }
    return ranked;
  }

  private ensureContext(context: McmKernelContext) {
    if (this.loadedContext === context) {
      return;
    }
    if (
      !context.flatMcmPositions ||
      !context.mcmPositionOffsets ||
      !context.packedMcmGlyphMasks ||
      !context.refMcmBpCount
    ) {
      throw new Error('Missing MCM position data for WASM kernel.');
    }

    this.positionOffsetsView.set(context.positionOffsets);
    this.flatPositionsView.set(context.flatPositions);
    this.rankRefSetCountView.set(context.refSetCount);
    this.rankGlyphSpatialFrequencyView.set(context.glyphAtlas.spatialFrequency);
    for (let bitPair = 0; bitPair < 4; bitPair++) {
      this.mcmPositionOffsetsViews[bitPair].set(context.mcmPositionOffsets[bitPair]);
      this.flatMcmPositionsViews[bitPair].set(context.flatMcmPositions[bitPair]);
      this.packedMcmGlyphMaskViews[bitPair].set(context.packedMcmGlyphMasks[bitPair]);
      for (let ch = 0; ch < 256; ch++) {
        this.rankRefMcmBpCountsView[ch * 4 + bitPair] = context.refMcmBpCount[ch][bitPair] ?? 0;
      }
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

  private ensureRankingMetrics(metrics: {
    binaryMixL: Float64Array;
    binaryMixA: Float64Array;
    binaryMixB: Float64Array;
    pL: Float64Array;
    pA: Float64Array;
    pB: Float64Array;
    pairDiff: Float64Array;
    maxPairDiff: number;
  }) {
    if (
      this.loadedRankingMetrics?.binaryMixL === metrics.binaryMixL &&
      this.loadedRankingMetrics?.binaryMixA === metrics.binaryMixA &&
      this.loadedRankingMetrics?.binaryMixB === metrics.binaryMixB &&
      this.loadedRankingMetrics?.pL === metrics.pL &&
      this.loadedRankingMetrics?.pA === metrics.pA &&
      this.loadedRankingMetrics?.pB === metrics.pB &&
      this.loadedRankingMetrics?.pairDiff === metrics.pairDiff &&
      this.loadedRankingMetrics?.maxPairDiff === metrics.maxPairDiff
    ) {
      return;
    }

    this.rankBinaryMixLView.set(metrics.binaryMixL);
    this.rankBinaryMixAView.set(metrics.binaryMixA);
    this.rankBinaryMixBView.set(metrics.binaryMixB);
    this.rankPaletteLView.set(metrics.pL);
    this.rankPaletteAView.set(metrics.pA);
    this.rankPaletteBView.set(metrics.pB);
    for (let bg = 0; bg < 16; bg++) {
      for (let fg = 0; fg < 8; fg++) {
        this.rankContrastMaskView[bg * 8 + fg] =
          fg !== bg && metrics.pairDiff[fg * 16 + bg] >= metrics.maxPairDiff * 0.16 ? 1 : 0;
      }
    }
    this.loadedRankingMetrics = metrics;
  }
}
