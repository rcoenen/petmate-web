/*
 * TruSkii3000 binary WASM kernel
 *
 * This file is the shared SIMD helper used by the binary character-mode
 * converter paths: Standard and ECM. The TypeScript host prepares one source
 * cell at a time, copies that cell's weighted pixel-versus-palette error table
 * into this module's linear memory, then asks the kernel to accumulate those
 * errors for every PETSCII character.
 *
 * In practical terms, the output answers:
 *   "for character N, what is the total cost of drawing its set pixels with
 *    each of the 16 C64 colors?"
 *
 * The rest of the Standard/ECM solver still lives in TypeScript. This kernel
 * only accelerates the hottest matrix-accumulation step shared by both modes.
 *
 * What we know about speed so far:
 * - Scalar WASM was not enough; the useful version here is the SIMD path.
 * - On a measured reference Standard conversion, total runtime dropped from
 *   about 13.55s to about 5.55s after the broader worker/WASM speed pass.
 * - That improvement is not from this file alone; it combines this kernel with
 *   surrounding solver and worker-side reductions in repeated work.
 */
const COLOR_COUNT: i32 = 16;
const CHAR_COUNT: i32 = 256;
const PIXEL_COUNT: i32 = 64;
const SOURCE_PIXEL_COUNT: i32 = 320 * 200;
const CELL_COUNT: i32 = 40 * 25;
const GRID_WIDTH: i32 = 40;
const GRID_HEIGHT: i32 = 25;
const WEIGHTED_PIXEL_ERROR_COUNT: i32 = PIXEL_COUNT * COLOR_COUNT;
const MODE_WEIGHTED_PIXEL_ERROR_COUNT: i32 = CELL_COUNT * WEIGHTED_PIXEL_ERROR_COUNT;
const MAX_POSITION_COUNT: i32 = CHAR_COUNT * PIXEL_COUNT;
const OUTPUT_COUNT: i32 = CHAR_COUNT * COLOR_COUNT;
const PAIR_DIFF_COUNT: i32 = COLOR_COUNT * COLOR_COUNT;
const BINARY_MIX_COUNT: i32 = (PIXEL_COUNT + 1) * COLOR_COUNT * COLOR_COUNT;
const MAX_STANDARD_POOL_SIZE: i32 = 16;
const STANDARD_SOLVE_BATCH_COUNT: i32 = 16;
const STANDARD_SOLVE_CANDIDATE_COUNT: i32 = CELL_COUNT * MAX_STANDARD_POOL_SIZE;
const STANDARD_SOLVE_EDGE_VALUE_COUNT: i32 = STANDARD_SOLVE_CANDIDATE_COUNT * 8;
const H_BOUNDARY_DIFF_COUNT: i32 = GRID_HEIGHT * (GRID_WIDTH - 1) * 8;
const V_BOUNDARY_DIFF_COUNT: i32 = (GRID_HEIGHT - 1) * GRID_WIDTH * 8;
const H_BOUNDARY_MEAN_COUNT: i32 = GRID_HEIGHT * (GRID_WIDTH - 1);
const V_BOUNDARY_MEAN_COUNT: i32 = (GRID_HEIGHT - 1) * GRID_WIDTH;
const MIN_PAIR_DIFF_RATIO: f64 = 0.16;
const BLEND_CSF_RELIEF: f64 = 1.5;
const BLEND_QUALITY_SHARPNESS: f64 = 48.0;
const BLEND_MATCH_WEIGHT: f64 = 3.0;
const COVERAGE_EXTREMITY_WEIGHT: f64 = 20.0;
const CONTINUITY_PENALTY: f64 = 0.14;
const REPEAT_PENALTY: f64 = 28.0;
const MODE_SWITCH_PENALTY: f64 = 10.0;
const MODE_SWITCH_DIFF_THRESHOLD: f64 = 3.5;
const WILDCARD_SCORE_MARGIN: f64 = 0.15;
const WILDCARD_BLEND_QUALITY_MIN: f64 = 0.7;
const WILDCARD_MAX_ADMITTED: i32 = 2;
const BRIGHTNESS_DEBT_WEIGHT: f64 = 64.0;
const BRIGHTNESS_DEBT_DECAY: f64 = 0.6;
const BRIGHTNESS_DEBT_CLAMP: f64 = 0.18;
const COLOR_COHERENCE_MAX_DELTA: f64 = 18.0;
const EDGE_CONTINUITY_MAX_DELTA: f64 = 12.0;
const EDGE_ALIGNMENT_DETAIL_THRESHOLD: f64 = 0.45;
const EDGE_ALIGNMENT_WEIGHT: f64 = 14.0;

// The host copies one cell's weighted pixel-vs-palette error matrix here:
// 64 pixels * 16 colors. Entry [pixel, color] answers:
// "what does it cost if this pixel is rendered with this C64 color?"
const weightedPixelErrors = new Float32Array(WEIGHTED_PIXEL_ERROR_COUNT);
const modeWeightedPixelErrors = new Float32Array(MODE_WEIGHTED_PIXEL_ERROR_COUNT);
const pairDiff = new Float64Array(PAIR_DIFF_COUNT);
const thresholdBits = new Uint32Array(2);

// Charset data is flattened up front so the kernel can stay in linear memory.
// For each character, positionOffsets[ch..ch+1] points at the subset of pixel
// indices where that character has a set bit.
const positionOffsets = new Int32Array(CHAR_COUNT + 1);
const flatPositions = new Uint8Array(MAX_POSITION_COUNT);
const packedBinaryGlyphLo = new Uint32Array(CHAR_COUNT);
const packedBinaryGlyphHi = new Uint32Array(CHAR_COUNT);

// Output is one row per character and one column per palette color:
// setErrs[ch, color] = sum(weightedPixelErrors[pixel, color]) over the set
// pixels of that character.
const outputSetErrs = new Float32Array(OUTPUT_COUNT);
const outputHamming = new Uint8Array(CHAR_COUNT);
const outputBestByBg = new Float64Array(COLOR_COUNT);

// Phase 6.1a groundwork: reserve resident Standard-mode source/state buffers in
// WASM memory so the full solver can migrate away from per-cell JS-owned data.
const standardSrcL = new Float32Array(SOURCE_PIXEL_COUNT);
const standardSrcA = new Float32Array(SOURCE_PIXEL_COUNT);
const standardSrcB = new Float32Array(SOURCE_PIXEL_COUNT);
const standardNearestPalette = new Uint8Array(SOURCE_PIXEL_COUNT);
const standardScreenCodes = new Uint8Array(CELL_COUNT);
const standardColors = new Uint8Array(CELL_COUNT);
const standardBgIndices = new Uint8Array(CELL_COUNT);
const standardCandidateScratch = new Float32Array(CELL_COUNT * COLOR_COUNT);
const standardRefinementScratch = new Float32Array(CELL_COUNT);
const standardTotalErrByColor = new Float32Array(COLOR_COUNT);
const standardPaletteL = new Float64Array(COLOR_COUNT);
const standardBinaryMixL = new Float64Array(BINARY_MIX_COUNT);
const standardBinaryMixA = new Float64Array(BINARY_MIX_COUNT);
const standardBinaryMixB = new Float64Array(BINARY_MIX_COUNT);
const standardRefSetCount = new Int32Array(CHAR_COUNT);
const standardGlyphSpatialFrequency = new Float32Array(CHAR_COUNT);
const standardCandidateScreencodes = new Uint8Array(CHAR_COUNT);
const standardBackgrounds = new Uint8Array(COLOR_COUNT);
const standardPoolChars = new Uint8Array(COLOR_COUNT * MAX_STANDARD_POOL_SIZE);
const standardPoolFgs = new Uint8Array(COLOR_COUNT * MAX_STANDARD_POOL_SIZE);
const standardPoolScores = new Float64Array(COLOR_COUNT * MAX_STANDARD_POOL_SIZE);
const standardPoolCounts = new Uint8Array(COLOR_COUNT);
const standardThresholdLoScratch = new Uint32Array(PAIR_DIFF_COUNT);
const standardThresholdHiScratch = new Uint32Array(PAIR_DIFF_COUNT);
const standardSolveCounts = new Uint8Array(CELL_COUNT);
const standardSolveChars = new Uint8Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveFgs = new Uint8Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveVariants = new Uint8Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveBaseErrors = new Float64Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveBrightnessResiduals = new Float64Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveRepeatH = new Float64Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveRepeatV = new Float64Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveCoherenceColorMasks = new Uint16Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveGlyphDirections = new Uint8Array(STANDARD_SOLVE_CANDIDATE_COUNT);
const standardSolveEdgeLeft = new Uint8Array(STANDARD_SOLVE_EDGE_VALUE_COUNT);
const standardSolveEdgeRight = new Uint8Array(STANDARD_SOLVE_EDGE_VALUE_COUNT);
const standardSolveEdgeTop = new Uint8Array(STANDARD_SOLVE_EDGE_VALUE_COUNT);
const standardSolveEdgeBottom = new Uint8Array(STANDARD_SOLVE_EDGE_VALUE_COUNT);
const standardSolveHBoundaryDiffs = new Float32Array(H_BOUNDARY_DIFF_COUNT);
const standardSolveVBoundaryDiffs = new Float32Array(V_BOUNDARY_DIFF_COUNT);
const standardSolveHBoundaryMeans = new Float32Array(H_BOUNDARY_MEAN_COUNT);
const standardSolveVBoundaryMeans = new Float32Array(V_BOUNDARY_MEAN_COUNT);
const standardCellDetailScores = new Float32Array(CELL_COUNT);
const standardCellGradientDirections = new Uint8Array(CELL_COUNT);
const standardSolveSelectedIndices = new Uint8Array(CELL_COUNT);
const standardSolveTotalError = new Float64Array(1);
const standardBatchSolveCounts = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * CELL_COUNT);
const standardBatchSolveChars = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveFgs = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveVariants = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveBaseErrors = new Float64Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveBrightnessResiduals = new Float64Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveRepeatH = new Float64Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveRepeatV = new Float64Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveCoherenceColorMasks = new Uint16Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveGlyphDirections = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_CANDIDATE_COUNT);
const standardBatchSolveEdgeLeft = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_EDGE_VALUE_COUNT);
const standardBatchSolveEdgeRight = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_EDGE_VALUE_COUNT);
const standardBatchSolveEdgeTop = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_EDGE_VALUE_COUNT);
const standardBatchSolveEdgeBottom = new Uint8Array(STANDARD_SOLVE_BATCH_COUNT * STANDARD_SOLVE_EDGE_VALUE_COUNT);

export function getWeightedPixelErrorsPtr(): usize {
  return weightedPixelErrors.dataStart;
}

export function getPairDiffPtr(): usize {
  return pairDiff.dataStart;
}

export function getModeWeightedPixelErrorsPtr(): usize {
  return modeWeightedPixelErrors.dataStart;
}

export function getThresholdBitsPtr(): usize {
  return thresholdBits.dataStart;
}

export function getPositionOffsetsPtr(): usize {
  return positionOffsets.dataStart;
}

export function getFlatPositionsPtr(): usize {
  return flatPositions.dataStart;
}

export function getPackedBinaryGlyphLoPtr(): usize {
  return packedBinaryGlyphLo.dataStart;
}

export function getPackedBinaryGlyphHiPtr(): usize {
  return packedBinaryGlyphHi.dataStart;
}

export function getOutputSetErrsPtr(): usize {
  return outputSetErrs.dataStart;
}

export function getOutputHammingPtr(): usize {
  return outputHamming.dataStart;
}

export function getOutputBestByBgPtr(): usize {
  return outputBestByBg.dataStart;
}

export function getStandardSrcLPtr(): usize {
  return standardSrcL.dataStart;
}

export function getStandardSrcAPtr(): usize {
  return standardSrcA.dataStart;
}

export function getStandardSrcBPtr(): usize {
  return standardSrcB.dataStart;
}

export function getStandardNearestPalettePtr(): usize {
  return standardNearestPalette.dataStart;
}

export function getStandardScreenCodesPtr(): usize {
  return standardScreenCodes.dataStart;
}

export function getStandardColorsPtr(): usize {
  return standardColors.dataStart;
}

export function getStandardBgIndicesPtr(): usize {
  return standardBgIndices.dataStart;
}

export function getStandardCandidateScratchPtr(): usize {
  return standardCandidateScratch.dataStart;
}

export function getStandardRefinementScratchPtr(): usize {
  return standardRefinementScratch.dataStart;
}

export function getStandardTotalErrByColorPtr(): usize {
  return standardTotalErrByColor.dataStart;
}

export function getStandardPaletteLPtr(): usize {
  return standardPaletteL.dataStart;
}

export function getStandardBinaryMixLPtr(): usize {
  return standardBinaryMixL.dataStart;
}

export function getStandardBinaryMixAPtr(): usize {
  return standardBinaryMixA.dataStart;
}

export function getStandardBinaryMixBPtr(): usize {
  return standardBinaryMixB.dataStart;
}

export function getStandardRefSetCountPtr(): usize {
  return standardRefSetCount.dataStart;
}

export function getStandardGlyphSpatialFrequencyPtr(): usize {
  return standardGlyphSpatialFrequency.dataStart;
}

export function getStandardCandidateScreencodesPtr(): usize {
  return standardCandidateScreencodes.dataStart;
}

export function getStandardBackgroundsPtr(): usize {
  return standardBackgrounds.dataStart;
}

export function getStandardPoolCharsPtr(): usize {
  return standardPoolChars.dataStart;
}

export function getStandardPoolFgsPtr(): usize {
  return standardPoolFgs.dataStart;
}

export function getStandardPoolScoresPtr(): usize {
  return standardPoolScores.dataStart;
}

export function getStandardPoolCountsPtr(): usize {
  return standardPoolCounts.dataStart;
}

export function getStandardSolveCountsPtr(): usize {
  return standardSolveCounts.dataStart;
}

export function getStandardSolveCharsPtr(): usize {
  return standardSolveChars.dataStart;
}

export function getStandardSolveFgsPtr(): usize {
  return standardSolveFgs.dataStart;
}

export function getStandardSolveVariantsPtr(): usize {
  return standardSolveVariants.dataStart;
}

export function getStandardSolveBaseErrorsPtr(): usize {
  return standardSolveBaseErrors.dataStart;
}

export function getStandardSolveBrightnessResidualsPtr(): usize {
  return standardSolveBrightnessResiduals.dataStart;
}

export function getStandardSolveRepeatHPtr(): usize {
  return standardSolveRepeatH.dataStart;
}

export function getStandardSolveRepeatVPtr(): usize {
  return standardSolveRepeatV.dataStart;
}

export function getStandardSolveCoherenceColorMasksPtr(): usize {
  return standardSolveCoherenceColorMasks.dataStart;
}

export function getStandardSolveGlyphDirectionsPtr(): usize {
  return standardSolveGlyphDirections.dataStart;
}

export function getStandardSolveEdgeLeftPtr(): usize {
  return standardSolveEdgeLeft.dataStart;
}

export function getStandardSolveEdgeRightPtr(): usize {
  return standardSolveEdgeRight.dataStart;
}

export function getStandardSolveEdgeTopPtr(): usize {
  return standardSolveEdgeTop.dataStart;
}

export function getStandardSolveEdgeBottomPtr(): usize {
  return standardSolveEdgeBottom.dataStart;
}

export function getStandardSolveHBoundaryDiffsPtr(): usize {
  return standardSolveHBoundaryDiffs.dataStart;
}

export function getStandardSolveVBoundaryDiffsPtr(): usize {
  return standardSolveVBoundaryDiffs.dataStart;
}

export function getStandardSolveHBoundaryMeansPtr(): usize {
  return standardSolveHBoundaryMeans.dataStart;
}

export function getStandardSolveVBoundaryMeansPtr(): usize {
  return standardSolveVBoundaryMeans.dataStart;
}

export function getStandardCellDetailScoresPtr(): usize {
  return standardCellDetailScores.dataStart;
}

export function getStandardCellGradientDirectionsPtr(): usize {
  return standardCellGradientDirections.dataStart;
}

export function getStandardSolveSelectedIndicesPtr(): usize {
  return standardSolveSelectedIndices.dataStart;
}

export function getStandardSolveTotalErrorPtr(): usize {
  return standardSolveTotalError.dataStart;
}

export function getStandardBatchSolveCountsPtr(): usize {
  return standardBatchSolveCounts.dataStart;
}

export function getStandardBatchSolveCharsPtr(): usize {
  return standardBatchSolveChars.dataStart;
}

export function getStandardBatchSolveFgsPtr(): usize {
  return standardBatchSolveFgs.dataStart;
}

export function getStandardBatchSolveVariantsPtr(): usize {
  return standardBatchSolveVariants.dataStart;
}

export function getStandardBatchSolveBaseErrorsPtr(): usize {
  return standardBatchSolveBaseErrors.dataStart;
}

export function getStandardBatchSolveBrightnessResidualsPtr(): usize {
  return standardBatchSolveBrightnessResiduals.dataStart;
}

export function getStandardBatchSolveRepeatHPtr(): usize {
  return standardBatchSolveRepeatH.dataStart;
}

export function getStandardBatchSolveRepeatVPtr(): usize {
  return standardBatchSolveRepeatV.dataStart;
}

export function getStandardBatchSolveCoherenceColorMasksPtr(): usize {
  return standardBatchSolveCoherenceColorMasks.dataStart;
}

export function getStandardBatchSolveGlyphDirectionsPtr(): usize {
  return standardBatchSolveGlyphDirections.dataStart;
}

export function getStandardBatchSolveEdgeLeftPtr(): usize {
  return standardBatchSolveEdgeLeft.dataStart;
}

export function getStandardBatchSolveEdgeRightPtr(): usize {
  return standardBatchSolveEdgeRight.dataStart;
}

export function getStandardBatchSolveEdgeTopPtr(): usize {
  return standardBatchSolveEdgeTop.dataStart;
}

export function getStandardBatchSolveEdgeBottomPtr(): usize {
  return standardBatchSolveEdgeBottom.dataStart;
}

function computeSetErrsFromBase(weightedPixelErrorBasePtr: usize): void {
  // SIMD lane filled with zeros so each character row starts clean.
  const zero = f32x4.splat(0);

  for (let ch: i32 = 0; ch < CHAR_COUNT; ch++) {
    // Each character writes 16 f32 values, one per legal C64 color.
    const outPtr: usize = outputSetErrs.dataStart + (<usize>(ch << 4) << 2);

    // Clear the row in 4 SIMD stores: 16 f32 values / 4 lanes = 4 writes.
    v128.store(outPtr, zero);
    v128.store(outPtr + 16, zero);
    v128.store(outPtr + 32, zero);
    v128.store(outPtr + 48, zero);

    const start = positionOffsets[ch];
    const end = positionOffsets[ch + 1];
    for (let i: i32 = start; i < end; i++) {
      // Jump to the chosen source pixel's 16-color error row.
      const inPtr: usize = weightedPixelErrorBasePtr + (<usize>((<i32>flatPositions[i]) << 4) << 2);

      // Accumulate the 16 color costs 4 at a time. This is the hot loop that
      // replaces the JS typed-array summation used by candidate scoring.
      v128.store(outPtr,      f32x4.add(v128.load(outPtr),      v128.load(inPtr)));
      v128.store(outPtr + 16, f32x4.add(v128.load(outPtr + 16), v128.load(inPtr + 16)));
      v128.store(outPtr + 32, f32x4.add(v128.load(outPtr + 32), v128.load(inPtr + 32)));
      v128.store(outPtr + 48, f32x4.add(v128.load(outPtr + 48), v128.load(inPtr + 48)));
    }
  }
}

export function computeSetErrs(): void {
  computeSetErrsFromBase(weightedPixelErrors.dataStart);
}

export function computeModeSetErrs(cellIndex: i32): void {
  computeSetErrsFromBase(
    modeWeightedPixelErrors.dataStart + (<usize>(cellIndex * WEIGHTED_PIXEL_ERROR_COUNT) << 2)
  );
}

export function computeHammingDistances(): void {
  const thresholdLo = thresholdBits[0];
  const thresholdHi = thresholdBits[1];

  for (let ch: i32 = 0; ch < CHAR_COUNT; ch++) {
    outputHamming[ch] =
      <u8>(
        popcnt<u32>(packedBinaryGlyphLo[ch] ^ thresholdLo) +
        popcnt<u32>(packedBinaryGlyphHi[ch] ^ thresholdHi)
      );
  }
}

export function computeStandardBestByBackground(
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  maxPairDiff: f64,
  candidateCount: i32
): void {
  computeBestByBackgroundForBase(
    weightedPixelErrors.dataStart,
    avgL,
    avgA,
    avgB,
    detailScore,
    lumMatchWeight,
    csfWeight,
    maxPairDiff,
    candidateCount,
    true,
    COLOR_COUNT,
    MIN_PAIR_DIFF_RATIO
  );
}

export function computeModeBestByBackground(
  cellIndex: i32,
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  maxPairDiff: f64,
  candidateCount: i32
): void {
  computeBestByBackgroundForBase(
    modeWeightedPixelErrors.dataStart + (<usize>(cellIndex * WEIGHTED_PIXEL_ERROR_COUNT) << 2),
    avgL,
    avgA,
    avgB,
    detailScore,
    lumMatchWeight,
    csfWeight,
    maxPairDiff,
    candidateCount,
    false,
    COLOR_COUNT,
    MIN_PAIR_DIFF_RATIO
  );
}

function computeHuePreservationBonus(
  sourceA: f64,
  sourceB: f64,
  renderedA: f64,
  renderedB: f64
): f64 {
  return 0.0;
}

function computeBestByBackgroundForBase(
  weightedPixelErrorBasePtr: usize,
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  maxPairDiff: f64,
  candidateCount: i32,
  useCoveragePenalty: bool,
  fgLimit: i32,
  minContrastRatio: f64
): void {
  computeSetErrsFromBase(weightedPixelErrorBasePtr);

  for (let bg: i32 = 0; bg < COLOR_COUNT; bg++) {
    outputBestByBg[bg] = Infinity;
  }

  for (let candidateIndex: i32 = 0; candidateIndex < candidateCount; candidateIndex++) {
    const ch = <i32>standardCandidateScreencodes[candidateIndex];
    const rowBase = ch << 4;
    const nSet = standardRefSetCount[ch];
    const sf = <f64>standardGlyphSpatialFrequency[ch];
    const detailSlack = 1.0 - detailScore;
    const csfPenalty = csfWeight > 0 ? csfWeight * sf * (detailSlack > 0.0 ? detailSlack : 0.0) : 0.0;
    const covRatio = <f64>nSet / <f64>PIXEL_COUNT;
    const covCentered = 2.0 * covRatio - 1.0;
    const extremity = covCentered * covCentered;

    for (let bg: i32 = 0; bg < COLOR_COUNT; bg++) {
      const bgErr = <f64>standardTotalErrByColor[bg] - <f64>outputSetErrs[rowBase + bg];
      if (bgErr >= outputBestByBg[bg]) continue;

      const covPenalty = useCoveragePenalty
        ? COVERAGE_EXTREMITY_WEIGHT * Math.abs(avgL - standardPaletteL[bg]) * extremity
        : 0.0;
      let best = outputBestByBg[bg];

      for (let fg: i32 = 0; fg < fgLimit; fg++) {
        if (fg == bg) continue;
        if (minContrastRatio > 0.0 && <f64>pairDiff[fg * COLOR_COUNT + bg] < maxPairDiff * minContrastRatio) continue;

        const mixIndex = ((nSet * COLOR_COUNT) + bg) * COLOR_COUNT + fg;
        const lumDiff = avgL - standardBinaryMixL[mixIndex];
        let pairAdjustment = lumMatchWeight * lumDiff * lumDiff;
        if (useCoveragePenalty) {
          const dL = lumDiff;
          const dA = avgA - standardBinaryMixA[mixIndex];
          const dB = avgB - standardBinaryMixB[mixIndex];
          const blendError = dL * dL + dA * dA + dB * dB;
          const blendQuality = 1.0 / (1.0 + blendError * BLEND_QUALITY_SHARPNESS);
          pairAdjustment -= BLEND_MATCH_WEIGHT * blendQuality;
        } else {
          pairAdjustment -= computeHuePreservationBonus(
            avgA,
            avgB,
            standardBinaryMixA[mixIndex],
            standardBinaryMixB[mixIndex]
          );
        }
        const total =
          bgErr +
          <f64>outputSetErrs[rowBase + fg] +
          csfPenalty +
          pairAdjustment +
          covPenalty;

        if (total < best) best = total;
      }

      outputBestByBg[bg] = best;
    }
  }
}

function packStandardThresholdLo(fg: i32, bg: i32): u32 {
  let lo: u32 = 0;
  for (let pixel: i32 = 0; pixel < 32; pixel++) {
    const base = pixel << 4;
    if (weightedPixelErrors[base + fg] <= weightedPixelErrors[base + bg]) {
      lo |= <u32>(1 << pixel);
    }
  }
  return lo;
}

function packStandardThresholdHi(fg: i32, bg: i32): u32 {
  let hi: u32 = 0;
  for (let pixel: i32 = 32; pixel < PIXEL_COUNT; pixel++) {
    const base = pixel << 4;
    if (weightedPixelErrors[base + fg] <= weightedPixelErrors[base + bg]) {
      hi |= <u32>(1 << (pixel - 32));
    }
  }
  return hi;
}

function packThresholdLoAt(weightedPixelErrorBasePtr: usize, fg: i32, bg: i32): u32 {
  let lo: u32 = 0;
  for (let pixel: i32 = 0; pixel < 32; pixel++) {
    const baseOffset = (<usize>(pixel << 4) << 2);
    const fgErr = load<f32>(weightedPixelErrorBasePtr + baseOffset + (<usize>fg << 2));
    const bgErr = load<f32>(weightedPixelErrorBasePtr + baseOffset + (<usize>bg << 2));
    if (fgErr <= bgErr) {
      lo |= <u32>(1 << pixel);
    }
  }
  return lo;
}

function packThresholdHiAt(weightedPixelErrorBasePtr: usize, fg: i32, bg: i32): u32 {
  let hi: u32 = 0;
  for (let pixel: i32 = 32; pixel < PIXEL_COUNT; pixel++) {
    const baseOffset = (<usize>(pixel << 4) << 2);
    const fgErr = load<f32>(weightedPixelErrorBasePtr + baseOffset + (<usize>fg << 2));
    const bgErr = load<f32>(weightedPixelErrorBasePtr + baseOffset + (<usize>bg << 2));
    if (fgErr <= bgErr) {
      hi |= <u32>(1 << (pixel - 32));
    }
  }
  return hi;
}

function resetStandardPools(backgroundCount: i32, poolSize: i32): void {
  for (let bi: i32 = 0; bi < backgroundCount; bi++) {
    standardPoolCounts[bi] = 0;
    const base = bi * MAX_STANDARD_POOL_SIZE;
    for (let slot: i32 = 0; slot < poolSize; slot++) {
      standardPoolScores[base + slot] = Infinity;
      standardPoolChars[base + slot] = 0;
      standardPoolFgs[base + slot] = 0;
    }
  }
}

function insertStandardPoolCandidate(
  backgroundIndex: i32,
  poolSize: i32,
  ch: i32,
  fg: i32,
  score: f64
): bool {
  const poolBase = backgroundIndex * MAX_STANDARD_POOL_SIZE;
  let count = <i32>standardPoolCounts[backgroundIndex];
  if (count >= poolSize && score >= standardPoolScores[poolBase + poolSize - 1]) {
    return false;
  }

  let insertAt = count < poolSize ? count : poolSize - 1;
  while (insertAt > 0 && score < standardPoolScores[poolBase + insertAt - 1]) {
    if (insertAt < poolSize) {
      standardPoolScores[poolBase + insertAt] = standardPoolScores[poolBase + insertAt - 1];
      standardPoolChars[poolBase + insertAt] = standardPoolChars[poolBase + insertAt - 1];
      standardPoolFgs[poolBase + insertAt] = standardPoolFgs[poolBase + insertAt - 1];
    }
    insertAt--;
  }

  standardPoolScores[poolBase + insertAt] = score;
  standardPoolChars[poolBase + insertAt] = <u8>ch;
  standardPoolFgs[poolBase + insertAt] = <u8>fg;
  if (count < poolSize) {
    standardPoolCounts[backgroundIndex] = <u8>(count + 1);
  }
  return true;
}

function clampBrightnessDebt(value: f64): f64 {
  if (value < -BRIGHTNESS_DEBT_CLAMP) return -BRIGHTNESS_DEBT_CLAMP;
  if (value > BRIGHTNESS_DEBT_CLAMP) return BRIGHTNESS_DEBT_CLAMP;
  return value;
}

function standardSolveFlatIndex(cellIndex: i32, candidateIndex: i32): i32 {
  return cellIndex * MAX_STANDARD_POOL_SIZE + candidateIndex;
}

function standardSolveEdgeOffset(flatIndex: i32): i32 {
  return flatIndex * 8;
}

function hBoundaryOffset(cy: i32, cx: i32): i32 {
  return (cy * (GRID_WIDTH - 1) + cx) * 8;
}

function hBoundaryMeanOffset(cy: i32, cx: i32): i32 {
  return cy * (GRID_WIDTH - 1) + cx;
}

function vBoundaryOffset(cy: i32, cx: i32): i32 {
  return (cy * GRID_WIDTH + cx) * 8;
}

function vBoundaryMeanOffset(cy: i32, cx: i32): i32 {
  return cy * GRID_WIDTH + cx;
}

function computeStandardNeighborPenalty(
  firstFlatIndex: i32,
  secondFlatIndex: i32,
  boundaryCy: i32,
  boundaryCx: i32,
  horizontal: bool
): f64 {
  let edgePenalty = 0.0;
  const firstEdgeOffset = standardSolveEdgeOffset(firstFlatIndex);
  const secondEdgeOffset = standardSolveEdgeOffset(secondFlatIndex);
  const boundaryBase = horizontal ? hBoundaryOffset(boundaryCy, boundaryCx) : vBoundaryOffset(boundaryCy, boundaryCx);
  const boundaryMean = horizontal
    ? <f64>standardSolveHBoundaryMeans[hBoundaryMeanOffset(boundaryCy, boundaryCx)]
    : <f64>standardSolveVBoundaryMeans[vBoundaryMeanOffset(boundaryCy, boundaryCx)];

  for (let i: i32 = 0; i < 8; i++) {
    const firstColor = horizontal
      ? <i32>standardSolveEdgeRight[firstEdgeOffset + i]
      : <i32>standardSolveEdgeBottom[firstEdgeOffset + i];
    const secondColor = horizontal
      ? <i32>standardSolveEdgeLeft[secondEdgeOffset + i]
      : <i32>standardSolveEdgeTop[secondEdgeOffset + i];
    const rendered = <f64>pairDiff[firstColor * COLOR_COUNT + secondColor];
    const desired = horizontal
      ? <f64>standardSolveHBoundaryDiffs[boundaryBase + i]
      : <f64>standardSolveVBoundaryDiffs[boundaryBase + i];
    const delta = rendered - desired;
    edgePenalty += delta * delta;
  }

  let repeatPenalty = 0.0;
  const sameVariant = standardSolveVariants[firstFlatIndex] == standardSolveVariants[secondFlatIndex];
  if (sameVariant && standardSolveChars[firstFlatIndex] == standardSolveChars[secondFlatIndex]) {
    const scale = horizontal
      ? (standardSolveRepeatH[firstFlatIndex] + standardSolveRepeatH[secondFlatIndex]) * 0.5
      : (standardSolveRepeatV[firstFlatIndex] + standardSolveRepeatV[secondFlatIndex]) * 0.5;
    repeatPenalty = REPEAT_PENALTY * scale;
  }

  let modePenalty = 0.0;
  if (!sameVariant) {
    const smoothness = Math.max(0.0, 1.0 - boundaryMean / MODE_SWITCH_DIFF_THRESHOLD);
    modePenalty = MODE_SWITCH_PENALTY * smoothness;
  }

  return CONTINUITY_PENALTY * (edgePenalty / 8.0) + repeatPenalty + modePenalty;
}

function standardBatchSolveCountIndex(batchIndex: i32, cellIndex: i32): i32 {
  return batchIndex * CELL_COUNT + cellIndex;
}

function standardBatchSolveFlatIndex(batchIndex: i32, cellIndex: i32, candidateIndex: i32): i32 {
  return batchIndex * STANDARD_SOLVE_CANDIDATE_COUNT + standardSolveFlatIndex(cellIndex, candidateIndex);
}

function computeStandardBatchNeighborPenalty(
  firstFlatIndex: i32,
  secondFlatIndex: i32,
  boundaryCy: i32,
  boundaryCx: i32,
  horizontal: bool
): f64 {
  let edgePenalty = 0.0;
  const firstEdgeOffset = standardSolveEdgeOffset(firstFlatIndex);
  const secondEdgeOffset = standardSolveEdgeOffset(secondFlatIndex);
  const boundaryBase = horizontal ? hBoundaryOffset(boundaryCy, boundaryCx) : vBoundaryOffset(boundaryCy, boundaryCx);
  const boundaryMean = horizontal
    ? <f64>standardSolveHBoundaryMeans[hBoundaryMeanOffset(boundaryCy, boundaryCx)]
    : <f64>standardSolveVBoundaryMeans[vBoundaryMeanOffset(boundaryCy, boundaryCx)];

  for (let i: i32 = 0; i < 8; i++) {
    const firstColor = horizontal
      ? <i32>standardBatchSolveEdgeRight[firstEdgeOffset + i]
      : <i32>standardBatchSolveEdgeBottom[firstEdgeOffset + i];
    const secondColor = horizontal
      ? <i32>standardBatchSolveEdgeLeft[secondEdgeOffset + i]
      : <i32>standardBatchSolveEdgeTop[secondEdgeOffset + i];
    const rendered = <f64>pairDiff[firstColor * COLOR_COUNT + secondColor];
    const desired = horizontal
      ? <f64>standardSolveHBoundaryDiffs[boundaryBase + i]
      : <f64>standardSolveVBoundaryDiffs[boundaryBase + i];
    const delta = rendered - desired;
    edgePenalty += delta * delta;
  }

  let repeatPenalty = 0.0;
  const sameVariant = standardBatchSolveVariants[firstFlatIndex] == standardBatchSolveVariants[secondFlatIndex];
  if (sameVariant && standardBatchSolveChars[firstFlatIndex] == standardBatchSolveChars[secondFlatIndex]) {
    const scale = horizontal
      ? (standardBatchSolveRepeatH[firstFlatIndex] + standardBatchSolveRepeatH[secondFlatIndex]) * 0.5
      : (standardBatchSolveRepeatV[firstFlatIndex] + standardBatchSolveRepeatV[secondFlatIndex]) * 0.5;
    repeatPenalty = REPEAT_PENALTY * scale;
  }

  let modePenalty = 0.0;
  if (!sameVariant) {
    const smoothness = Math.max(0.0, 1.0 - boundaryMean / MODE_SWITCH_DIFF_THRESHOLD);
    modePenalty = MODE_SWITCH_PENALTY * smoothness;
  }

  return CONTINUITY_PENALTY * (edgePenalty / 8.0) + repeatPenalty + modePenalty;
}

function computeStandardCandidateCost(cellIndex: i32, candidateIndex: i32): f64 {
  const flatIndex = standardSolveFlatIndex(cellIndex, candidateIndex);
  const cx = cellIndex % GRID_WIDTH;
  const cy = cellIndex / GRID_WIDTH;
  let cost = standardSolveBaseErrors[flatIndex];

  if (cx > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - 1];
    cost += computeStandardNeighborPenalty(
      standardSolveFlatIndex(cellIndex - 1, neighborIndex),
      flatIndex,
      cy,
      cx - 1,
      true
    );
  }
  if (cx < GRID_WIDTH - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + 1];
    cost += computeStandardNeighborPenalty(
      flatIndex,
      standardSolveFlatIndex(cellIndex + 1, neighborIndex),
      cy,
      cx,
      true
    );
  }
  if (cy > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - GRID_WIDTH];
    cost += computeStandardNeighborPenalty(
      standardSolveFlatIndex(cellIndex - GRID_WIDTH, neighborIndex),
      flatIndex,
      cy - 1,
      cx,
      false
    );
  }
  if (cy < GRID_HEIGHT - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + GRID_WIDTH];
    cost += computeStandardNeighborPenalty(
      flatIndex,
      standardSolveFlatIndex(cellIndex + GRID_WIDTH, neighborIndex),
      cy,
      cx,
      false
    );
  }

  return cost;
}

function computeStandardBatchCandidateCost(batchIndex: i32, cellIndex: i32, candidateIndex: i32): f64 {
  const flatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, candidateIndex);
  const cx = cellIndex % GRID_WIDTH;
  const cy = cellIndex / GRID_WIDTH;
  let cost = standardBatchSolveBaseErrors[flatIndex];

  if (cx > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - 1];
    cost += computeStandardBatchNeighborPenalty(
      standardBatchSolveFlatIndex(batchIndex, cellIndex - 1, neighborIndex),
      flatIndex,
      cy,
      cx - 1,
      true
    );
  }
  if (cx < GRID_WIDTH - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + 1];
    cost += computeStandardBatchNeighborPenalty(
      flatIndex,
      standardBatchSolveFlatIndex(batchIndex, cellIndex + 1, neighborIndex),
      cy,
      cx,
      true
    );
  }
  if (cy > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - GRID_WIDTH];
    cost += computeStandardBatchNeighborPenalty(
      standardBatchSolveFlatIndex(batchIndex, cellIndex - GRID_WIDTH, neighborIndex),
      flatIndex,
      cy - 1,
      cx,
      false
    );
  }
  if (cy < GRID_HEIGHT - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + GRID_WIDTH];
    cost += computeStandardBatchNeighborPenalty(
      flatIndex,
      standardBatchSolveFlatIndex(batchIndex, cellIndex + GRID_WIDTH, neighborIndex),
      cy,
      cx,
      false
    );
  }

  return cost;
}

function countMaskBits(mask: u32): i32 {
  return popcnt<u32>(mask);
}

function buildStandardNeighborCoherenceMask(cellIndex: i32): u32 {
  const cx = cellIndex % GRID_WIDTH;
  const cy = cellIndex / GRID_WIDTH;
  let mask: u32 = 0;

  if (cx > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - 1];
    mask |= <u32>standardSolveCoherenceColorMasks[standardSolveFlatIndex(cellIndex - 1, neighborIndex)];
  }
  if (cx < GRID_WIDTH - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + 1];
    mask |= <u32>standardSolveCoherenceColorMasks[standardSolveFlatIndex(cellIndex + 1, neighborIndex)];
  }
  if (cy > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - GRID_WIDTH];
    mask |= <u32>standardSolveCoherenceColorMasks[standardSolveFlatIndex(cellIndex - GRID_WIDTH, neighborIndex)];
  }
  if (cy < GRID_HEIGHT - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + GRID_WIDTH];
    mask |= <u32>standardSolveCoherenceColorMasks[standardSolveFlatIndex(cellIndex + GRID_WIDTH, neighborIndex)];
  }

  return mask;
}

function buildStandardBatchNeighborCoherenceMask(batchIndex: i32, cellIndex: i32): u32 {
  const cx = cellIndex % GRID_WIDTH;
  const cy = cellIndex / GRID_WIDTH;
  let mask: u32 = 0;

  if (cx > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - 1];
    mask |= <u32>standardBatchSolveCoherenceColorMasks[
      standardBatchSolveFlatIndex(batchIndex, cellIndex - 1, neighborIndex)
    ];
  }
  if (cx < GRID_WIDTH - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + 1];
    mask |= <u32>standardBatchSolveCoherenceColorMasks[
      standardBatchSolveFlatIndex(batchIndex, cellIndex + 1, neighborIndex)
    ];
  }
  if (cy > 0) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex - GRID_WIDTH];
    mask |= <u32>standardBatchSolveCoherenceColorMasks[
      standardBatchSolveFlatIndex(batchIndex, cellIndex - GRID_WIDTH, neighborIndex)
    ];
  }
  if (cy < GRID_HEIGHT - 1) {
    const neighborIndex = <i32>standardSolveSelectedIndices[cellIndex + GRID_WIDTH];
    mask |= <u32>standardBatchSolveCoherenceColorMasks[
      standardBatchSolveFlatIndex(batchIndex, cellIndex + GRID_WIDTH, neighborIndex)
    ];
  }

  return mask;
}

function computeStandardDirectionalAlignmentBonus(
  detailScore: f64,
  cellDirection: u8,
  glyphDirection: u8
): f64 {
  if (detailScore < EDGE_ALIGNMENT_DETAIL_THRESHOLD || cellDirection == 0) {
    return 0.0;
  }

  const denom = 1.0 - EDGE_ALIGNMENT_DETAIL_THRESHOLD;
  const detailStrength = Math.max(0.0, Math.min(1.0, (detailScore - EDGE_ALIGNMENT_DETAIL_THRESHOLD) / (denom > 1e-6 ? denom : 1e-6)));
  if (glyphDirection == cellDirection) {
    return EDGE_ALIGNMENT_WEIGHT * (0.35 + 0.65 * detailStrength);
  }
  if (glyphDirection == 0) {
    return EDGE_ALIGNMENT_WEIGHT * 0.15 * detailStrength;
  }
  return 0.0;
}

function runStandardColorCoherencePass(passCount: i32): void {
  for (let pass: i32 = 0; pass < passCount; pass++) {
    for (let cellIndex: i32 = 0; cellIndex < CELL_COUNT; cellIndex++) {
      const neighborMask = buildStandardNeighborCoherenceMask(cellIndex);
      if (neighborMask == 0) continue;

      const currentIndex = <i32>standardSolveSelectedIndices[cellIndex];
      const currentFlatIndex = standardSolveFlatIndex(cellIndex, currentIndex);
      const currentMask = <u32>standardSolveCoherenceColorMasks[currentFlatIndex];
      const currentMissing = countMaskBits(currentMask & <u32>~neighborMask);
      if (currentMissing == 0) continue;

      const currentCost = computeStandardCandidateCost(cellIndex, currentIndex);
      let bestIndex = currentIndex;
      let bestCost = currentCost;
      let bestMissing = currentMissing;
      const count = <i32>standardSolveCounts[cellIndex];

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        if (candidateIndex == currentIndex) continue;
        const flatIndex = standardSolveFlatIndex(cellIndex, candidateIndex);
        const candidateMask = <u32>standardSolveCoherenceColorMasks[flatIndex];
        if ((candidateMask & neighborMask) == 0) continue;

        const candidateMissing = countMaskBits(candidateMask & <u32>~neighborMask);
        if (candidateMissing >= bestMissing) continue;

        const cost = computeStandardCandidateCost(cellIndex, candidateIndex);
        if (
          cost <= currentCost + COLOR_COHERENCE_MAX_DELTA &&
          (candidateMissing < bestMissing || cost < bestCost)
        ) {
          bestIndex = candidateIndex;
          bestCost = cost;
          bestMissing = candidateMissing;
        }
      }

      if (bestIndex != currentIndex) {
        standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
      }
    }
  }
}

function runStandardBatchColorCoherencePass(batchIndex: i32, passCount: i32): void {
  for (let pass: i32 = 0; pass < passCount; pass++) {
    for (let cellIndex: i32 = 0; cellIndex < CELL_COUNT; cellIndex++) {
      const neighborMask = buildStandardBatchNeighborCoherenceMask(batchIndex, cellIndex);
      if (neighborMask == 0) continue;

      const currentIndex = <i32>standardSolveSelectedIndices[cellIndex];
      const currentFlatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, currentIndex);
      const currentMask = <u32>standardBatchSolveCoherenceColorMasks[currentFlatIndex];
      const currentMissing = countMaskBits(currentMask & <u32>~neighborMask);
      if (currentMissing == 0) continue;

      const currentCost = computeStandardBatchCandidateCost(batchIndex, cellIndex, currentIndex);
      let bestIndex = currentIndex;
      let bestCost = currentCost;
      let bestMissing = currentMissing;
      const count = <i32>standardBatchSolveCounts[standardBatchSolveCountIndex(batchIndex, cellIndex)];

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        if (candidateIndex == currentIndex) continue;
        const flatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, candidateIndex);
        const candidateMask = <u32>standardBatchSolveCoherenceColorMasks[flatIndex];
        if ((candidateMask & neighborMask) == 0) continue;

        const candidateMissing = countMaskBits(candidateMask & <u32>~neighborMask);
        if (candidateMissing >= bestMissing) continue;

        const cost = computeStandardBatchCandidateCost(batchIndex, cellIndex, candidateIndex);
        if (
          cost <= currentCost + COLOR_COHERENCE_MAX_DELTA &&
          (candidateMissing < bestMissing || cost < bestCost)
        ) {
          bestIndex = candidateIndex;
          bestCost = cost;
          bestMissing = candidateMissing;
        }
      }

      if (bestIndex != currentIndex) {
        standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
      }
    }
  }
}

function runStandardEdgeContinuityPass(passCount: i32): void {
  for (let pass: i32 = 0; pass < passCount; pass++) {
    for (let cellIndex: i32 = 0; cellIndex < CELL_COUNT; cellIndex++) {
      const detailScore = <f64>standardCellDetailScores[cellIndex];
      const cellDirection = standardCellGradientDirections[cellIndex];
      const currentIndex = <i32>standardSolveSelectedIndices[cellIndex];
      const currentFlatIndex = standardSolveFlatIndex(cellIndex, currentIndex);
      const currentAlignment = computeStandardDirectionalAlignmentBonus(
        detailScore,
        cellDirection,
        standardSolveGlyphDirections[currentFlatIndex]
      );
      if (currentAlignment <= 0.0 && detailScore < EDGE_ALIGNMENT_DETAIL_THRESHOLD) continue;

      const currentRawCost = computeStandardCandidateCost(cellIndex, currentIndex);
      let bestIndex = currentIndex;
      let bestAlignment = currentAlignment;
      let bestAdjustedCost = currentRawCost - currentAlignment;
      const count = <i32>standardSolveCounts[cellIndex];

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        if (candidateIndex == currentIndex) continue;
        const flatIndex = standardSolveFlatIndex(cellIndex, candidateIndex);
        const candidateAlignment = computeStandardDirectionalAlignmentBonus(
          detailScore,
          cellDirection,
          standardSolveGlyphDirections[flatIndex]
        );
        if (candidateAlignment <= bestAlignment) continue;

        const candidateRawCost = computeStandardCandidateCost(cellIndex, candidateIndex);
        if (candidateRawCost > currentRawCost + EDGE_CONTINUITY_MAX_DELTA) continue;

        const candidateAdjustedCost = candidateRawCost - candidateAlignment;
        if (candidateAdjustedCost < bestAdjustedCost) {
          bestIndex = candidateIndex;
          bestAlignment = candidateAlignment;
          bestAdjustedCost = candidateAdjustedCost;
        }
      }

      if (bestIndex != currentIndex) {
        standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
      }
    }
  }
}

function runStandardBatchEdgeContinuityPass(batchIndex: i32, passCount: i32): void {
  for (let pass: i32 = 0; pass < passCount; pass++) {
    for (let cellIndex: i32 = 0; cellIndex < CELL_COUNT; cellIndex++) {
      const detailScore = <f64>standardCellDetailScores[cellIndex];
      const cellDirection = standardCellGradientDirections[cellIndex];
      const currentIndex = <i32>standardSolveSelectedIndices[cellIndex];
      const currentFlatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, currentIndex);
      const currentAlignment = computeStandardDirectionalAlignmentBonus(
        detailScore,
        cellDirection,
        standardBatchSolveGlyphDirections[currentFlatIndex]
      );
      if (currentAlignment <= 0.0 && detailScore < EDGE_ALIGNMENT_DETAIL_THRESHOLD) continue;

      const currentRawCost = computeStandardBatchCandidateCost(batchIndex, cellIndex, currentIndex);
      let bestIndex = currentIndex;
      let bestAlignment = currentAlignment;
      let bestAdjustedCost = currentRawCost - currentAlignment;
      const count = <i32>standardBatchSolveCounts[standardBatchSolveCountIndex(batchIndex, cellIndex)];

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        if (candidateIndex == currentIndex) continue;
        const flatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, candidateIndex);
        const candidateAlignment = computeStandardDirectionalAlignmentBonus(
          detailScore,
          cellDirection,
          standardBatchSolveGlyphDirections[flatIndex]
        );
        if (candidateAlignment <= bestAlignment) continue;

        const candidateRawCost = computeStandardBatchCandidateCost(batchIndex, cellIndex, candidateIndex);
        if (candidateRawCost > currentRawCost + EDGE_CONTINUITY_MAX_DELTA) continue;

        const candidateAdjustedCost = candidateRawCost - candidateAlignment;
        if (candidateAdjustedCost < bestAdjustedCost) {
          bestIndex = candidateIndex;
          bestAlignment = candidateAlignment;
          bestAdjustedCost = candidateAdjustedCost;
        }
      }

      if (bestIndex != currentIndex) {
        standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
      }
    }
  }
}

export function computeStandardCandidatePools(
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  maxPairDiff: f64,
  candidateCount: i32,
  backgroundCount: i32,
  fgLimit: i32,
  minContrastRatio: f64,
  poolSize: i32,
  edgeMaskLo: u32,
  edgeMaskHi: u32,
  edgeWeight: f64,
  useCoveragePenalty: bool
): void {
  computeCandidatePoolsForBase(
    weightedPixelErrors.dataStart,
    avgL,
    avgA,
    avgB,
    detailScore,
    lumMatchWeight,
    csfWeight,
    maxPairDiff,
    candidateCount,
    backgroundCount,
    fgLimit,
    minContrastRatio,
    poolSize,
    edgeMaskLo,
    edgeMaskHi,
    edgeWeight,
    useCoveragePenalty
  );
}

export function computeModeCandidatePools(
  cellIndex: i32,
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  maxPairDiff: f64,
  candidateCount: i32,
  backgroundCount: i32,
  fgLimit: i32,
  minContrastRatio: f64,
  poolSize: i32,
  edgeMaskLo: u32,
  edgeMaskHi: u32,
  edgeWeight: f64
): void {
  const weightedPixelErrorBasePtr = modeWeightedPixelErrors.dataStart + (<usize>(cellIndex * WEIGHTED_PIXEL_ERROR_COUNT) << 2);
  computeCandidatePoolsForBase(
    weightedPixelErrorBasePtr,
    avgL,
    avgA,
    avgB,
    detailScore,
    lumMatchWeight,
    csfWeight,
    maxPairDiff,
    candidateCount,
    backgroundCount,
    fgLimit,
    minContrastRatio,
    poolSize,
    edgeMaskLo,
    edgeMaskHi,
    edgeWeight,
    false
  );
}

function computeCandidatePoolsForBase(
  weightedPixelErrorBasePtr: usize,
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  maxPairDiff: f64,
  candidateCount: i32,
  backgroundCount: i32,
  fgLimit: i32,
  minContrastRatio: f64,
  poolSize: i32,
  edgeMaskLo: u32,
  edgeMaskHi: u32,
  edgeWeight: f64,
  useCoveragePenalty: bool
): void {
  computeSetErrsFromBase(weightedPixelErrorBasePtr);

  const clampedPoolSize = poolSize > MAX_STANDARD_POOL_SIZE ? MAX_STANDARD_POOL_SIZE : poolSize;
  resetStandardPools(backgroundCount, clampedPoolSize);

  const detailSlack = 1.0 - detailScore;
  const safeDetailSlack = detailSlack > 0.0 ? detailSlack : 0.0;
  const hasEdges = edgeWeight > 0.01 && ((edgeMaskLo | edgeMaskHi) != 0);

  if (hasEdges) {
    for (let bi: i32 = 0; bi < backgroundCount; bi++) {
      const bg = <i32>standardBackgrounds[bi];
      for (let fg: i32 = 0; fg < fgLimit; fg++) {
        if (fg == bg) continue;
        if (minContrastRatio > 0.0 && <f64>pairDiff[fg * COLOR_COUNT + bg] < maxPairDiff * minContrastRatio) continue;
        const pairIndex = bg * COLOR_COUNT + fg;
        standardThresholdLoScratch[pairIndex] = packThresholdLoAt(weightedPixelErrorBasePtr, fg, bg);
        standardThresholdHiScratch[pairIndex] = packThresholdHiAt(weightedPixelErrorBasePtr, fg, bg);
      }
    }
  }

  for (let candidateIndex: i32 = 0; candidateIndex < candidateCount; candidateIndex++) {
    const ch = <i32>standardCandidateScreencodes[candidateIndex];
    const rowBase = ch << 4;
    const nSet = standardRefSetCount[ch];
    const sf = <f64>standardGlyphSpatialFrequency[ch];
    const csfPenaltyFull = csfWeight > 0.0 ? csfWeight * sf * safeDetailSlack : 0.0;
    const csfPenalty = useCoveragePenalty
      ? (sf <= 0.1 ? csfPenaltyFull : 0.0)
      : csfPenaltyFull;
    const csfBase = useCoveragePenalty && sf > 0.1 ? csfPenaltyFull : 0.0;

    for (let bi: i32 = 0; bi < backgroundCount; bi++) {
      const bg = <i32>standardBackgrounds[bi];
      const poolBase = bi * MAX_STANDARD_POOL_SIZE;
      const count = <i32>standardPoolCounts[bi];
      const worst = count >= clampedPoolSize ? standardPoolScores[poolBase + clampedPoolSize - 1] : Infinity;
      const bgErr = <f64>standardTotalErrByColor[bg] - <f64>outputSetErrs[rowBase + bg];
      if (bgErr >= worst) continue;

      for (let fg: i32 = 0; fg < fgLimit; fg++) {
        if (fg == bg) continue;
        if (minContrastRatio > 0.0 && <f64>pairDiff[fg * COLOR_COUNT + bg] < maxPairDiff * minContrastRatio) continue;

        const mixIndex = ((nSet * COLOR_COUNT) + bg) * COLOR_COUNT + fg;
        const lumDiff = avgL - standardBinaryMixL[mixIndex];
        let blendQuality = 0.0;
        let pairAdjustment = lumMatchWeight * lumDiff * lumDiff;
        if (useCoveragePenalty) {
          const dL = lumDiff;
          const dA = avgA - standardBinaryMixA[mixIndex];
          const dB = avgB - standardBinaryMixB[mixIndex];
          const blendError = dL * dL + dA * dA + dB * dB;
          blendQuality = 1.0 / (1.0 + blendError * BLEND_QUALITY_SHARPNESS);
          pairAdjustment -= BLEND_MATCH_WEIGHT * blendQuality;
        } else {
          pairAdjustment -= computeHuePreservationBonus(
            avgA,
            avgB,
            standardBinaryMixA[mixIndex],
            standardBinaryMixB[mixIndex]
          );
        }

        let total =
          bgErr +
          <f64>outputSetErrs[rowBase + fg] +
          csfPenalty +
          pairAdjustment;

        if (useCoveragePenalty && csfBase > 0.0) {
          total += csfBase * (1.0 - BLEND_CSF_RELIEF * blendQuality);
        }

        if (hasEdges) {
          const pairIndex = bg * COLOR_COUNT + fg;
          const thresholdLo = standardThresholdLoScratch[pairIndex];
          const thresholdHi = standardThresholdHiScratch[pairIndex];
          const mismatchLo = packedBinaryGlyphLo[ch] ^ thresholdLo;
          const mismatchHi = packedBinaryGlyphHi[ch] ^ thresholdHi;
          const edgeMismatches =
            <f64>(
              popcnt<u32>(mismatchLo & edgeMaskLo) +
              popcnt<u32>(mismatchHi & edgeMaskHi)
            );
          total += edgeWeight * edgeMismatches;
        }

        insertStandardPoolCandidate(bi, clampedPoolSize, ch, fg, total);
      }
    }
  }

  if (useCoveragePenalty) {
    for (let bi: i32 = 0; bi < backgroundCount; bi++) {
      const bg = <i32>standardBackgrounds[bi];
      const poolBase = bi * MAX_STANDARD_POOL_SIZE;
      const normalCount = <i32>standardPoolCounts[bi];
      const bestNormal = normalCount > 0 ? standardPoolScores[poolBase] : Infinity;
      const scoreThreshold = bestNormal * (1.0 + WILDCARD_SCORE_MARGIN);
      let admitted = 0;

      for (let fg: i32 = 0; fg < COLOR_COUNT && admitted < WILDCARD_MAX_ADMITTED; fg++) {
        if (fg == bg) continue;
        if (<f64>pairDiff[fg * COLOR_COUNT + bg] >= maxPairDiff * MIN_PAIR_DIFF_RATIO) continue;

        for (let candidateIndex: i32 = 0; candidateIndex < candidateCount && admitted < WILDCARD_MAX_ADMITTED; candidateIndex++) {
          const ch = <i32>standardCandidateScreencodes[candidateIndex];
          const rowBase = ch << 4;
          const nSet = standardRefSetCount[ch];
          const sf = <f64>standardGlyphSpatialFrequency[ch];
          const csfPenalty = sf <= 0.1 && csfWeight > 0.0 ? csfWeight * sf * safeDetailSlack : 0.0;
          const csfBase = sf > 0.1 && csfWeight > 0.0 ? csfWeight * sf * safeDetailSlack : 0.0;
          const bgErr = <f64>standardTotalErrByColor[bg] - <f64>outputSetErrs[rowBase + bg];
          if (bgErr >= scoreThreshold) continue;

          const mixIndex = ((nSet * COLOR_COUNT) + bg) * COLOR_COUNT + fg;
          const lumDiff = avgL - standardBinaryMixL[mixIndex];
          const dL = lumDiff;
          const dA = avgA - standardBinaryMixA[mixIndex];
          const dB = avgB - standardBinaryMixB[mixIndex];
          const blendError = dL * dL + dA * dA + dB * dB;
          const blendQuality = 1.0 / (1.0 + blendError * BLEND_QUALITY_SHARPNESS);
          const pairAdjustment = lumMatchWeight * lumDiff * lumDiff - BLEND_MATCH_WEIGHT * blendQuality;

          let total =
            bgErr +
            <f64>outputSetErrs[rowBase + fg] +
            csfPenalty +
            pairAdjustment;

          if (csfBase > 0.0) {
            total += csfBase * (1.0 - BLEND_CSF_RELIEF * blendQuality);
          }

          if (hasEdges) {
            const pairIndex = bg * COLOR_COUNT + fg;
            const thresholdLo = standardThresholdLoScratch[pairIndex];
            const thresholdHi = standardThresholdHiScratch[pairIndex];
            const mismatchLo = packedBinaryGlyphLo[ch] ^ thresholdLo;
            const mismatchHi = packedBinaryGlyphHi[ch] ^ thresholdHi;
            const edgeMismatches =
              <f64>(
                popcnt<u32>(mismatchLo & edgeMaskLo) +
                popcnt<u32>(mismatchHi & edgeMaskHi)
              );
            total += edgeWeight * edgeMismatches;
          }

          if (total > scoreThreshold && blendQuality < WILDCARD_BLEND_QUALITY_MIN) continue;

          if (insertStandardPoolCandidate(bi, clampedPoolSize, ch, fg, total)) {
            admitted += 1;
          }
        }
      }
    }
  }
}

export function computeStandardSolveSelection(passCount: i32): void {
  const verticalDebt = new Float32Array(GRID_WIDTH);

  for (let cy: i32 = 0; cy < GRID_HEIGHT; cy++) {
    let horizontalDebt = 0.0;
    for (let cx: i32 = 0; cx < GRID_WIDTH; cx++) {
      const cellIndex = cy * GRID_WIDTH + cx;
      const count = <i32>standardSolveCounts[cellIndex];
      let bestIndex = 0;
      let bestCost = Infinity;

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        const flatIndex = standardSolveFlatIndex(cellIndex, candidateIndex);
        const debtAfter = clampBrightnessDebt(horizontalDebt + verticalDebt[cx] + standardSolveBrightnessResiduals[flatIndex]);
        const cost = standardSolveBaseErrors[flatIndex] + BRIGHTNESS_DEBT_WEIGHT * debtAfter * debtAfter;
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = candidateIndex;
        }
      }

      standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
      const chosenFlatIndex = standardSolveFlatIndex(cellIndex, bestIndex);
      horizontalDebt = clampBrightnessDebt((horizontalDebt + standardSolveBrightnessResiduals[chosenFlatIndex]) * BRIGHTNESS_DEBT_DECAY);
      verticalDebt[cx] = <f32>clampBrightnessDebt(
        (verticalDebt[cx] + standardSolveBrightnessResiduals[chosenFlatIndex]) * BRIGHTNESS_DEBT_DECAY
      );
    }
  }

  for (let pass: i32 = 0; pass < passCount; pass++) {
    const forward = (pass & 1) == 0;
    let start = forward ? 0 : CELL_COUNT - 1;
    let end = forward ? CELL_COUNT : -1;
    let step = forward ? 1 : -1;
    let changed = false;

    for (let cellIndex = start; cellIndex != end; cellIndex += step) {
      const count = <i32>standardSolveCounts[cellIndex];
      let bestIndex = <i32>standardSolveSelectedIndices[cellIndex];
      let bestCost = Infinity;

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        const cost = computeStandardCandidateCost(cellIndex, candidateIndex);
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = candidateIndex;
        }
      }

      if (bestIndex != <i32>standardSolveSelectedIndices[cellIndex]) {
        standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }
}

export function computeStandardBatchSolveSelection(batchIndex: i32, passCount: i32): void {
  if (batchIndex < 0 || batchIndex >= STANDARD_SOLVE_BATCH_COUNT) {
    return;
  }

  const verticalDebt = new Float32Array(GRID_WIDTH);

  for (let cy: i32 = 0; cy < GRID_HEIGHT; cy++) {
    let horizontalDebt = 0.0;
    for (let cx: i32 = 0; cx < GRID_WIDTH; cx++) {
      const cellIndex = cy * GRID_WIDTH + cx;
      const count = <i32>standardBatchSolveCounts[standardBatchSolveCountIndex(batchIndex, cellIndex)];
      let bestIndex = 0;
      let bestCost = Infinity;

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        const flatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, candidateIndex);
        const debtAfter = clampBrightnessDebt(horizontalDebt + verticalDebt[cx] + standardBatchSolveBrightnessResiduals[flatIndex]);
        const cost = standardBatchSolveBaseErrors[flatIndex] + BRIGHTNESS_DEBT_WEIGHT * debtAfter * debtAfter;
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = candidateIndex;
        }
      }

      standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
      const chosenFlatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, bestIndex);
      horizontalDebt = clampBrightnessDebt((horizontalDebt + standardBatchSolveBrightnessResiduals[chosenFlatIndex]) * BRIGHTNESS_DEBT_DECAY);
      verticalDebt[cx] = <f32>clampBrightnessDebt(
        (verticalDebt[cx] + standardBatchSolveBrightnessResiduals[chosenFlatIndex]) * BRIGHTNESS_DEBT_DECAY
      );
    }
  }

  for (let pass: i32 = 0; pass < passCount; pass++) {
    const forward = (pass & 1) == 0;
    let start = forward ? 0 : CELL_COUNT - 1;
    let end = forward ? CELL_COUNT : -1;
    let step = forward ? 1 : -1;
    let changed = false;

    for (let cellIndex = start; cellIndex != end; cellIndex += step) {
      const count = <i32>standardBatchSolveCounts[standardBatchSolveCountIndex(batchIndex, cellIndex)];
      let bestIndex = <i32>standardSolveSelectedIndices[cellIndex];
      let bestCost = Infinity;

      for (let candidateIndex: i32 = 0; candidateIndex < count; candidateIndex++) {
        const cost = computeStandardBatchCandidateCost(batchIndex, cellIndex, candidateIndex);
        if (cost < bestCost) {
          bestCost = cost;
          bestIndex = candidateIndex;
        }
      }

      if (bestIndex != <i32>standardSolveSelectedIndices[cellIndex]) {
        standardSolveSelectedIndices[cellIndex] = <u8>bestIndex;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }
}

export function computeStandardRefineSelection(
  colorPassCount: i32,
  edgePassCount: i32
): void {
  if (colorPassCount > 0) {
    runStandardColorCoherencePass(colorPassCount);
  }
  if (edgePassCount > 0) {
    runStandardEdgeContinuityPass(edgePassCount);
  }
}

export function computeStandardBatchRefineSelection(
  batchIndex: i32,
  colorPassCount: i32,
  edgePassCount: i32
): void {
  if (batchIndex < 0 || batchIndex >= STANDARD_SOLVE_BATCH_COUNT) {
    return;
  }
  if (colorPassCount > 0) {
    runStandardBatchColorCoherencePass(batchIndex, colorPassCount);
  }
  if (edgePassCount > 0) {
    runStandardBatchEdgeContinuityPass(batchIndex, edgePassCount);
  }
}

export function finalizeStandardBatchSolveSelection(batchIndex: i32): void {
  if (batchIndex < 0 || batchIndex >= STANDARD_SOLVE_BATCH_COUNT) {
    return;
  }

  let totalError = 0.0;

  for (let cellIndex: i32 = 0; cellIndex < CELL_COUNT; cellIndex++) {
    const candidateIndex = <i32>standardSolveSelectedIndices[cellIndex];
    const flatIndex = standardBatchSolveFlatIndex(batchIndex, cellIndex, candidateIndex);
    standardScreenCodes[cellIndex] = standardBatchSolveChars[flatIndex];
    standardColors[cellIndex] = standardBatchSolveFgs[flatIndex];
    standardBgIndices[cellIndex] = 0;
    totalError += standardBatchSolveBaseErrors[flatIndex];

    const cx = cellIndex % GRID_WIDTH;
    const cy = cellIndex / GRID_WIDTH;
    if (cx > 0) {
      const leftIndex = <i32>standardSolveSelectedIndices[cellIndex - 1];
      totalError += computeStandardBatchNeighborPenalty(
        standardBatchSolveFlatIndex(batchIndex, cellIndex - 1, leftIndex),
        flatIndex,
        cy,
        cx - 1,
        true
      );
    }
    if (cy > 0) {
      const topIndex = <i32>standardSolveSelectedIndices[cellIndex - GRID_WIDTH];
      totalError += computeStandardBatchNeighborPenalty(
        standardBatchSolveFlatIndex(batchIndex, cellIndex - GRID_WIDTH, topIndex),
        flatIndex,
        cy - 1,
        cx,
        false
      );
    }
  }

  standardSolveTotalError[0] = totalError;
}

export function finalizeStandardSolveSelection(): void {
  let totalError = 0.0;

  for (let cellIndex: i32 = 0; cellIndex < CELL_COUNT; cellIndex++) {
    const candidateIndex = <i32>standardSolveSelectedIndices[cellIndex];
    const flatIndex = standardSolveFlatIndex(cellIndex, candidateIndex);
    standardScreenCodes[cellIndex] = standardSolveChars[flatIndex];
    standardColors[cellIndex] = standardSolveFgs[flatIndex];
    standardBgIndices[cellIndex] = 0;
    totalError += standardSolveBaseErrors[flatIndex];

    const cx = cellIndex % GRID_WIDTH;
    const cy = cellIndex / GRID_WIDTH;
    if (cx > 0) {
      const leftIndex = <i32>standardSolveSelectedIndices[cellIndex - 1];
      totalError += computeStandardNeighborPenalty(
        standardSolveFlatIndex(cellIndex - 1, leftIndex),
        flatIndex,
        cy,
        cx - 1,
        true
      );
    }
    if (cy > 0) {
      const topIndex = <i32>standardSolveSelectedIndices[cellIndex - GRID_WIDTH];
      totalError += computeStandardNeighborPenalty(
        standardSolveFlatIndex(cellIndex - GRID_WIDTH, topIndex),
        flatIndex,
        cy - 1,
        cx,
        false
      );
    }
  }

  standardSolveTotalError[0] = totalError;
}
