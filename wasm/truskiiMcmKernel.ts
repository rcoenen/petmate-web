/*
 * TruSkii3000 MCM WASM kernel
 *
 * This file is the SIMD scoring helper for multicolor-mode conversion. The
 * host copies two kinds of error tables into linear memory:
 *   1. per-pixel errors for hires-style cells
 *   2. per-bit-pair errors for multicolor cells
 *
 * The kernel then walks the flattened charset data and produces:
 *   - one hires-style set-error row per character
 *   - four multicolor bit-pair rows per character (00, 01, 10, 11)
 *
 * The TypeScript solver uses those matrices later when it evaluates legal MCM
 * candidates, global colors, and mixed hires/multicolor screens.
 *
 * What we know about speed so far:
 * - The biggest wins in MCM still come from broader architecture changes such
 *   as worker execution and reduced repeated analysis.
 * - This kernel targets one hot numeric stage inside that larger pipeline.
 * - Total MCM time therefore depends heavily on the JS-side global search and
 *   screen solving around it, not just on this SIMD helper.
 */
const COLOR_COUNT: i32 = 16;
const CHAR_COUNT: i32 = 256;
const PIXEL_COUNT: i32 = 64;
const PAIR_COUNT: i32 = 32;
const CELL_COUNT: i32 = 40 * 25;
const MAX_POSITION_COUNT: i32 = CHAR_COUNT * PIXEL_COUNT;
const MAX_PAIR_POSITION_COUNT: i32 = CHAR_COUNT * PAIR_COUNT;
const SET_ERR_COUNT: i32 = CHAR_COUNT * COLOR_COUNT;
const BIT_PAIR_ERR_COUNT: i32 = CHAR_COUNT * 4 * COLOR_COUNT;
const PAIR_DIFF_COUNT: i32 = COLOR_COUNT * COLOR_COUNT;
const MODE_WEIGHTED_PIXEL_ERROR_COUNT: i32 = CELL_COUNT * PIXEL_COUNT * COLOR_COUNT;
const MODE_WEIGHTED_PAIR_ERROR_COUNT: i32 = CELL_COUNT * PAIR_COUNT * COLOR_COUNT;
const BINARY_MIX_COUNT: i32 = (PIXEL_COUNT + 1) * COLOR_COUNT * COLOR_COUNT;
const MAX_MCM_SAMPLE_COUNT: i32 = 64;
const MAX_MCM_TRIPLE_COUNT: i32 = COLOR_COUNT * (COLOR_COUNT - 1) * (COLOR_COUNT - 2);
const MAX_MCM_FINALIST_COUNT: i32 = 16;
const MAX_MCM_POOL_SIZE: i32 = 16;
const MCM_CANONICAL_UNUSED_COLOR_RAM: i32 = 8;

// Per-pixel error table used by the MCM hires path:
// [64 pixels][16 palette colors].
const weightedPixelErrors = new Float32Array(PIXEL_COUNT * COLOR_COUNT);
const modeWeightedPixelErrors = new Float32Array(MODE_WEIGHTED_PIXEL_ERROR_COUNT);

// Per-bit-pair error table used by the multicolor path:
// [32 bit-pairs][16 palette colors].
const weightedPairErrors = new Float32Array(PAIR_COUNT * COLOR_COUNT);
const modeWeightedPairErrors = new Float32Array(MODE_WEIGHTED_PAIR_ERROR_COUNT);
const pairDiff = new Float32Array(PAIR_DIFF_COUNT);
const thresholdMasks = new Uint32Array(4);

// Hires character shape: set pixel positions per character.
const positionOffsets = new Int32Array(CHAR_COUNT + 1);
const flatPositions = new Uint8Array(MAX_POSITION_COUNT);

// Multicolor character shape: for each 2-bit pattern (00, 01, 10, 11), store
// the bit-pair positions where that pattern appears for each character.
const mcmPositionOffsets0 = new Int32Array(CHAR_COUNT + 1);
const mcmPositionOffsets1 = new Int32Array(CHAR_COUNT + 1);
const mcmPositionOffsets2 = new Int32Array(CHAR_COUNT + 1);
const mcmPositionOffsets3 = new Int32Array(CHAR_COUNT + 1);
const flatMcmPositions0 = new Uint8Array(MAX_PAIR_POSITION_COUNT);
const flatMcmPositions1 = new Uint8Array(MAX_PAIR_POSITION_COUNT);
const flatMcmPositions2 = new Uint8Array(MAX_PAIR_POSITION_COUNT);
const flatMcmPositions3 = new Uint8Array(MAX_PAIR_POSITION_COUNT);
const packedMcmGlyphMasks0 = new Uint32Array(CHAR_COUNT);
const packedMcmGlyphMasks1 = new Uint32Array(CHAR_COUNT);
const packedMcmGlyphMasks2 = new Uint32Array(CHAR_COUNT);
const packedMcmGlyphMasks3 = new Uint32Array(CHAR_COUNT);
const outputSetErrs = new Float32Array(SET_ERR_COUNT);
const outputBitPairErrs = new Float32Array(BIT_PAIR_ERR_COUNT);
const outputHamming = new Uint8Array(CHAR_COUNT);
const poolTotalErrByColor = new Float32Array(COLOR_COUNT);
const poolTopChars = new Uint8Array(MAX_MCM_POOL_SIZE);
const poolTopColorRams = new Uint8Array(MAX_MCM_POOL_SIZE);
const poolTopVariants = new Uint8Array(MAX_MCM_POOL_SIZE);
const poolTopScores = new Float64Array(MAX_MCM_POOL_SIZE);
const batchPoolCounts = new Uint8Array(MAX_MCM_FINALIST_COUNT);
const batchPoolTopChars = new Uint8Array(MAX_MCM_FINALIST_COUNT * MAX_MCM_POOL_SIZE);
const batchPoolTopColorRams = new Uint8Array(MAX_MCM_FINALIST_COUNT * MAX_MCM_POOL_SIZE);
const batchPoolTopVariants = new Uint8Array(MAX_MCM_FINALIST_COUNT * MAX_MCM_POOL_SIZE);
const batchPoolTopScores = new Float64Array(MAX_MCM_FINALIST_COUNT * MAX_MCM_POOL_SIZE);
const rankSampleCellIndices = new Int32Array(MAX_MCM_SAMPLE_COUNT);
const rankSampleAvgL = new Float64Array(MAX_MCM_SAMPLE_COUNT);
const rankSampleAvgA = new Float64Array(MAX_MCM_SAMPLE_COUNT);
const rankSampleAvgB = new Float64Array(MAX_MCM_SAMPLE_COUNT);
const rankSampleDetailScores = new Float64Array(MAX_MCM_SAMPLE_COUNT);
const rankSampleSaliencyWeights = new Float64Array(MAX_MCM_SAMPLE_COUNT);
const rankSampleTotalErrByColor = new Float32Array(MAX_MCM_SAMPLE_COUNT * COLOR_COUNT);
const rankCandidateScreencodes = new Uint16Array(CHAR_COUNT);
const rankRefSetCount = new Int32Array(CHAR_COUNT);
const rankGlyphSpatialFrequency = new Float32Array(CHAR_COUNT);
const rankRefMcmBpCounts = new Uint8Array(CHAR_COUNT * 4);
const rankBinaryMixL = new Float64Array(BINARY_MIX_COUNT);
const rankBinaryMixA = new Float64Array(BINARY_MIX_COUNT);
const rankBinaryMixB = new Float64Array(BINARY_MIX_COUNT);
const rankPaletteL = new Float64Array(COLOR_COUNT);
const rankPaletteA = new Float64Array(COLOR_COUNT);
const rankPaletteB = new Float64Array(COLOR_COUNT);
const rankContrastMask = new Uint8Array(COLOR_COUNT * 8);
const rankTripleScores = new Float64Array(MAX_MCM_TRIPLE_COUNT);
const rankTopBgs = new Uint8Array(MAX_MCM_FINALIST_COUNT);
const rankTopMc1s = new Uint8Array(MAX_MCM_FINALIST_COUNT);
const rankTopMc2s = new Uint8Array(MAX_MCM_FINALIST_COUNT);
const rankTopScores = new Float64Array(MAX_MCM_FINALIST_COUNT);
const rankBestHiresCostByBg = new Float64Array(COLOR_COUNT);

export function getWeightedPixelErrorsPtr(): usize { return weightedPixelErrors.dataStart; }
export function getWeightedPairErrorsPtr(): usize { return weightedPairErrors.dataStart; }
export function getPairDiffPtr(): usize { return pairDiff.dataStart; }
export function getModeWeightedPixelErrorsPtr(): usize { return modeWeightedPixelErrors.dataStart; }
export function getModeWeightedPairErrorsPtr(): usize { return modeWeightedPairErrors.dataStart; }
export function getThresholdMasksPtr(): usize { return thresholdMasks.dataStart; }
export function getPositionOffsetsPtr(): usize { return positionOffsets.dataStart; }
export function getFlatPositionsPtr(): usize { return flatPositions.dataStart; }
export function getMcmPositionOffsets0Ptr(): usize { return mcmPositionOffsets0.dataStart; }
export function getMcmPositionOffsets1Ptr(): usize { return mcmPositionOffsets1.dataStart; }
export function getMcmPositionOffsets2Ptr(): usize { return mcmPositionOffsets2.dataStart; }
export function getMcmPositionOffsets3Ptr(): usize { return mcmPositionOffsets3.dataStart; }
export function getFlatMcmPositions0Ptr(): usize { return flatMcmPositions0.dataStart; }
export function getFlatMcmPositions1Ptr(): usize { return flatMcmPositions1.dataStart; }
export function getFlatMcmPositions2Ptr(): usize { return flatMcmPositions2.dataStart; }
export function getFlatMcmPositions3Ptr(): usize { return flatMcmPositions3.dataStart; }
export function getPackedMcmGlyphMasks0Ptr(): usize { return packedMcmGlyphMasks0.dataStart; }
export function getPackedMcmGlyphMasks1Ptr(): usize { return packedMcmGlyphMasks1.dataStart; }
export function getPackedMcmGlyphMasks2Ptr(): usize { return packedMcmGlyphMasks2.dataStart; }
export function getPackedMcmGlyphMasks3Ptr(): usize { return packedMcmGlyphMasks3.dataStart; }
export function getOutputSetErrsPtr(): usize { return outputSetErrs.dataStart; }
export function getOutputBitPairErrsPtr(): usize { return outputBitPairErrs.dataStart; }
export function getOutputHammingPtr(): usize { return outputHamming.dataStart; }
export function getPoolTotalErrByColorPtr(): usize { return poolTotalErrByColor.dataStart; }
export function getPoolTopCharsPtr(): usize { return poolTopChars.dataStart; }
export function getPoolTopColorRamsPtr(): usize { return poolTopColorRams.dataStart; }
export function getPoolTopVariantsPtr(): usize { return poolTopVariants.dataStart; }
export function getPoolTopScoresPtr(): usize { return poolTopScores.dataStart; }
export function getBatchPoolCountsPtr(): usize { return batchPoolCounts.dataStart; }
export function getBatchPoolTopCharsPtr(): usize { return batchPoolTopChars.dataStart; }
export function getBatchPoolTopColorRamsPtr(): usize { return batchPoolTopColorRams.dataStart; }
export function getBatchPoolTopVariantsPtr(): usize { return batchPoolTopVariants.dataStart; }
export function getBatchPoolTopScoresPtr(): usize { return batchPoolTopScores.dataStart; }
export function getRankSampleCellIndicesPtr(): usize { return rankSampleCellIndices.dataStart; }
export function getRankSampleAvgLPtr(): usize { return rankSampleAvgL.dataStart; }
export function getRankSampleAvgAPtr(): usize { return rankSampleAvgA.dataStart; }
export function getRankSampleAvgBPtr(): usize { return rankSampleAvgB.dataStart; }
export function getRankSampleDetailScoresPtr(): usize { return rankSampleDetailScores.dataStart; }
export function getRankSampleSaliencyWeightsPtr(): usize { return rankSampleSaliencyWeights.dataStart; }
export function getRankSampleTotalErrByColorPtr(): usize { return rankSampleTotalErrByColor.dataStart; }
export function getRankCandidateScreencodesPtr(): usize { return rankCandidateScreencodes.dataStart; }
export function getRankRefSetCountPtr(): usize { return rankRefSetCount.dataStart; }
export function getRankGlyphSpatialFrequencyPtr(): usize { return rankGlyphSpatialFrequency.dataStart; }
export function getRankRefMcmBpCountsPtr(): usize { return rankRefMcmBpCounts.dataStart; }
export function getRankBinaryMixLPtr(): usize { return rankBinaryMixL.dataStart; }
export function getRankBinaryMixAPtr(): usize { return rankBinaryMixA.dataStart; }
export function getRankBinaryMixBPtr(): usize { return rankBinaryMixB.dataStart; }
export function getRankPaletteLPtr(): usize { return rankPaletteL.dataStart; }
export function getRankPaletteAPtr(): usize { return rankPaletteA.dataStart; }
export function getRankPaletteBPtr(): usize { return rankPaletteB.dataStart; }
export function getRankContrastMaskPtr(): usize { return rankContrastMask.dataStart; }
export function getRankTopBgsPtr(): usize { return rankTopBgs.dataStart; }
export function getRankTopMc1sPtr(): usize { return rankTopMc1s.dataStart; }
export function getRankTopMc2sPtr(): usize { return rankTopMc2s.dataStart; }
export function getRankTopScoresPtr(): usize { return rankTopScores.dataStart; }

function zero16(ptr: usize, zero: v128): void {
  // Store 16 f32 zeros using 4 SIMD writes.
  v128.store(ptr, zero);
  v128.store(ptr + 16, zero);
  v128.store(ptr + 32, zero);
  v128.store(ptr + 48, zero);
}

function accumulatePositions(
  outputPtr: usize,
  inputBasePtr: usize,
  positions: Uint8Array,
  offsets: Int32Array,
  ch: i32
): void {
  // Sum the referenced rows from either the per-pixel or per-bit-pair error
  // table into one contiguous 16-color output row.
  const start = offsets[ch];
  const end = offsets[ch + 1];
  for (let i: i32 = start; i < end; i++) {
    const inPtr: usize = inputBasePtr + (<usize>((<i32>positions[i]) << 4) << 2);
    v128.store(outputPtr,      f32x4.add(v128.load(outputPtr),      v128.load(inPtr)));
    v128.store(outputPtr + 16, f32x4.add(v128.load(outputPtr + 16), v128.load(inPtr + 16)));
    v128.store(outputPtr + 32, f32x4.add(v128.load(outputPtr + 32), v128.load(inPtr + 32)));
    v128.store(outputPtr + 48, f32x4.add(v128.load(outputPtr + 48), v128.load(inPtr + 48)));
  }
}

function computeMatricesFromBase(pixelBasePtr: usize, pairBasePtr: usize): void {
  const zero = f32x4.splat(0);

  for (let ch: i32 = 0; ch < CHAR_COUNT; ch++) {
    // Hires-style matrix used by the mixed MCM solver when a cell is treated as
    // a 1-bit-per-pixel character.
    const setOutPtr: usize = outputSetErrs.dataStart + (<usize>(ch << 4) << 2);
    zero16(setOutPtr, zero);
    accumulatePositions(setOutPtr, pixelBasePtr, flatPositions, positionOffsets, ch);

    // Four 16-color rows per character, one for each 2-bit multicolor symbol.
    // The host later maps these rows to bg/mc1/mc2/cell-color choices.
    const bp0Ptr: usize = outputBitPairErrs.dataStart + (<usize>((ch * 64) << 2));
    const bp1Ptr: usize = bp0Ptr + 64;
    const bp2Ptr: usize = bp1Ptr + 64;
    const bp3Ptr: usize = bp2Ptr + 64;

    zero16(bp0Ptr, zero);
    zero16(bp1Ptr, zero);
    zero16(bp2Ptr, zero);
    zero16(bp3Ptr, zero);

    accumulatePositions(bp0Ptr, pairBasePtr, flatMcmPositions0, mcmPositionOffsets0, ch);
    accumulatePositions(bp1Ptr, pairBasePtr, flatMcmPositions1, mcmPositionOffsets1, ch);
    accumulatePositions(bp2Ptr, pairBasePtr, flatMcmPositions2, mcmPositionOffsets2, ch);
    accumulatePositions(bp3Ptr, pairBasePtr, flatMcmPositions3, mcmPositionOffsets3, ch);
  }
}

export function computeMatrices(): void {
  computeMatricesFromBase(weightedPixelErrors.dataStart, weightedPairErrors.dataStart);
}

export function computeModeMatrices(cellIndex: i32): void {
  computeMatricesFromBase(
    modeWeightedPixelErrors.dataStart + (<usize>(cellIndex * PIXEL_COUNT * COLOR_COUNT) << 2),
    modeWeightedPairErrors.dataStart + (<usize>(cellIndex * PAIR_COUNT * COLOR_COUNT) << 2)
  );
}

export function computeHammingDistances(): void {
  const threshold0 = thresholdMasks[0];
  const threshold1 = thresholdMasks[1];
  const threshold2 = thresholdMasks[2];
  const threshold3 = thresholdMasks[3];

  for (let ch: i32 = 0; ch < CHAR_COUNT; ch++) {
    const matched =
      popcnt<u32>(threshold0 & packedMcmGlyphMasks0[ch]) +
      popcnt<u32>(threshold1 & packedMcmGlyphMasks1[ch]) +
      popcnt<u32>(threshold2 & packedMcmGlyphMasks2[ch]) +
      popcnt<u32>(threshold3 & packedMcmGlyphMasks3[ch]);
    outputHamming[ch] = <u8>(PAIR_COUNT - matched);
  }
}

function computeCsfPenalty(detailScore: f64, glyphSpatialFrequency: f64, csfWeight: f64): f64 {
  if (csfWeight <= 0.0) return 0.0;
  const detailSlack = 1.0 - detailScore;
  return csfWeight * glyphSpatialFrequency * (detailSlack > 0.0 ? detailSlack : 0.0);
}

function computeHuePreservationBonusFromSource(
  sourceChroma: f64,
  sourceHue: f64,
  renderedA: f64,
  renderedB: f64,
  weight: f64
): f64 {
  if (weight <= 0.0 || sourceChroma < 0.015) return 0.0;
  const renderedChroma = Math.sqrt(renderedA * renderedA + renderedB * renderedB);
  if (renderedChroma < 0.015) return 0.0;

  const renderedHue = Math.atan2(renderedB, renderedA);
  let hueDiff = Math.abs(sourceHue - renderedHue);
  if (hueDiff > Math.PI) hueDiff = 2.0 * Math.PI - hueDiff;

  const similarity = 1.0 - (hueDiff / Math.PI);
  const cappedChroma = sourceChroma < renderedChroma ? sourceChroma : renderedChroma;
  return weight * cappedChroma * similarity;
}

function computeMcmColorDemand(detailScore: f64, avgA: f64, avgB: f64): f64 {
  const chroma = Math.sqrt(avgA * avgA + avgB * avgB);
  return computeMcmColorDemandFromChroma(detailScore, chroma);
}

function computeMcmColorDemandFromChroma(detailScore: f64, chroma: f64): f64 {
  if (chroma < 0.015) return 0.0;
  const chromaNeed = chroma < 0.14 ? chroma / 0.14 : 1.0;
  const detailAllowance = 1.0 - (detailScore / 0.8);
  return detailAllowance > 0.0 ? chromaNeed * detailAllowance : 0.0;
}

function computeMcmHiresColorPenaltyFromDemand(colorDemand: f64, weight: f64): f64 {
  return weight <= 0.0 ? 0.0 : weight * colorDemand;
}

function computeMcmHiresColorPenalty(
  detailScore: f64,
  avgA: f64,
  avgB: f64,
  weight: f64
): f64 {
  return computeMcmHiresColorPenaltyFromDemand(
    computeMcmColorDemand(detailScore, avgA, avgB),
    weight
  );
}

function computeMcmMulticolorUsageBonusFromDemand(
  count1: f64,
  count2: f64,
  count3: f64,
  colorDemand: f64,
  weight: f64
): f64 {
  if (weight <= 0.0 || colorDemand <= 0.0) return 0.0;

  const multicolorCoverage = (count1 + count2 + count3) / <f64>PAIR_COUNT;
  return weight * colorDemand * multicolorCoverage;
}

function computeMcmMulticolorUsageBonus(
  count1: f64,
  count2: f64,
  count3: f64,
  detailScore: f64,
  avgA: f64,
  avgB: f64,
  weight: f64
): f64 {
  return computeMcmMulticolorUsageBonusFromDemand(
    count1,
    count2,
    count3,
    computeMcmColorDemand(detailScore, avgA, avgB),
    weight
  );
}

function binaryMixIndex(setCount: i32, bg: i32, fg: i32): i32 {
  return ((setCount * COLOR_COUNT) + bg) * COLOR_COUNT + fg;
}

function rankHasContrast(fg: i32, bg: i32): bool {
  return rankContrastMask[bg * 8 + fg] != 0;
}

function resetPoolTopScores(poolSize: i32): void {
  for (let i: i32 = 0; i < poolSize; i++) {
    poolTopChars[i] = 0;
    poolTopColorRams[i] = 0;
    poolTopVariants[i] = 0;
    poolTopScores[i] = Infinity;
  }
}

function shiftPoolSlot(dst: i32, src: i32): void {
  poolTopChars[dst] = poolTopChars[src];
  poolTopColorRams[dst] = poolTopColorRams[src];
  poolTopVariants[dst] = poolTopVariants[src];
  poolTopScores[dst] = poolTopScores[src];
}

function insertPoolCandidate(
  ch: i32,
  colorRam: i32,
  variant: i32,
  score: f64,
  poolSize: i32,
  selectedCount: i32
): i32 {
  let nextCount = selectedCount;
  let existing = -1;
  for (let i: i32 = 0; i < selectedCount; i++) {
    if (
      <i32>poolTopChars[i] == ch &&
      <i32>poolTopColorRams[i] == colorRam &&
      <i32>poolTopVariants[i] == variant
    ) {
      existing = i;
      break;
    }
  }

  if (existing >= 0) {
    if (score >= poolTopScores[existing]) {
      return selectedCount;
    }
    for (let i: i32 = existing; i < selectedCount - 1; i++) {
      shiftPoolSlot(i, i + 1);
    }
    nextCount--;
  } else if (selectedCount >= poolSize && score >= poolTopScores[poolSize - 1]) {
    return selectedCount;
  }

  let insertAt = nextCount < poolSize ? nextCount : poolSize - 1;
  while (insertAt > 0 && score < poolTopScores[insertAt - 1]) {
    if (insertAt < poolSize) {
      shiftPoolSlot(insertAt, insertAt - 1);
    }
    insertAt--;
  }

  poolTopChars[insertAt] = <u8>ch;
  poolTopColorRams[insertAt] = <u8>colorRam;
  poolTopVariants[insertAt] = <u8>variant;
  poolTopScores[insertAt] = score;
  if (nextCount < poolSize) {
    nextCount++;
  }
  return nextCount;
}

function computeBestHiresCostByBackgroundForSample(
  sampleIndex: i32,
  candidateCount: i32,
  lumMatchWeight: f64,
  csfWeight: f64,
  mcmHiresColorPenaltyWeight: f64
): void {
  for (let bg: i32 = 0; bg < COLOR_COUNT; bg++) {
    rankBestHiresCostByBg[bg] = Infinity;
  }

  const avgL = rankSampleAvgL[sampleIndex];
  const avgA = rankSampleAvgA[sampleIndex];
  const avgB = rankSampleAvgB[sampleIndex];
  const detailScore = rankSampleDetailScores[sampleIndex];
  const totalErrBase = sampleIndex * COLOR_COUNT;
  const sourceChroma = Math.sqrt(avgA * avgA + avgB * avgB);
  const colorDemand = computeMcmColorDemandFromChroma(detailScore, sourceChroma);
  const hiresPenalty = computeMcmHiresColorPenaltyFromDemand(colorDemand, mcmHiresColorPenaltyWeight);

  for (let candidateIndex: i32 = 0; candidateIndex < candidateCount; candidateIndex++) {
    const ch = <i32>rankCandidateScreencodes[candidateIndex];
    const csfPenalty = computeCsfPenalty(detailScore, <f64>rankGlyphSpatialFrequency[ch], csfWeight);
    const hiresBase = ch << 4;
    const nSet = rankRefSetCount[ch];

    for (let bg: i32 = 0; bg < COLOR_COUNT; bg++) {
      const bgErr = <f64>rankSampleTotalErrByColor[totalErrBase + bg] - <f64>outputSetErrs[hiresBase + bg];
      const hiresLowerBound = bgErr + csfPenalty + hiresPenalty;
      if (hiresLowerBound >= rankBestHiresCostByBg[bg]) continue;

      for (let fg: i32 = 0; fg < 8; fg++) {
        if (fg == bg) continue;
        if (!rankHasContrast(fg, bg)) continue;

        const mixIndex = binaryMixIndex(nSet, bg, fg);
        const lumDiff = avgL - rankBinaryMixL[mixIndex];
        const total =
          bgErr +
          <f64>outputSetErrs[hiresBase + fg] +
          csfPenalty +
          lumMatchWeight * lumDiff * lumDiff +
          hiresPenalty;

        if (total < rankBestHiresCostByBg[bg]) {
          rankBestHiresCostByBg[bg] = total;
        }
      }
    }
  }
}

function resetRankTopScores(finalistCount: i32): void {
  for (let i: i32 = 0; i < finalistCount; i++) {
    rankTopScores[i] = Infinity;
    rankTopBgs[i] = 0;
    rankTopMc1s[i] = 0;
    rankTopMc2s[i] = 0;
  }
}

export function rankModeTriples(
  sampleCount: i32,
  candidateCount: i32,
  finalistCount: i32,
  lumMatchWeight: f64,
  csfWeight: f64,
  mcmHuePreservationWeight: f64,
  mcmHiresColorPenaltyWeight: f64,
  mcmMulticolorUsageBonusWeight: f64,
  manualBgColor: i32
): i32 {
  const clampedSampleCount = sampleCount > MAX_MCM_SAMPLE_COUNT ? MAX_MCM_SAMPLE_COUNT : sampleCount;
  const clampedCandidateCount = candidateCount > CHAR_COUNT ? CHAR_COUNT : candidateCount;
  const clampedFinalistCount = finalistCount > MAX_MCM_FINALIST_COUNT ? MAX_MCM_FINALIST_COUNT : finalistCount;

  let tripleCount: i32 = 0;
  for (let bg: i32 = 0; bg < COLOR_COUNT; bg++) {
    if (manualBgColor >= 0 && bg != manualBgColor) continue;
    for (let mc1: i32 = 0; mc1 < COLOR_COUNT; mc1++) {
      if (mc1 == bg) continue;
      for (let mc2: i32 = 0; mc2 < COLOR_COUNT; mc2++) {
        if (mc2 == bg || mc2 == mc1) continue;
        rankTripleScores[tripleCount] = 0.0;
        tripleCount++;
      }
    }
  }

  for (let sampleIndex: i32 = 0; sampleIndex < clampedSampleCount; sampleIndex++) {
    const cellIndex = rankSampleCellIndices[sampleIndex];
    const sampleWeight = rankSampleSaliencyWeights[sampleIndex];
    const pixelBasePtr = modeWeightedPixelErrors.dataStart + (<usize>(cellIndex * PIXEL_COUNT * COLOR_COUNT) << 2);
    const pairBasePtr = modeWeightedPairErrors.dataStart + (<usize>(cellIndex * PAIR_COUNT * COLOR_COUNT) << 2);
    computeMatricesFromBase(pixelBasePtr, pairBasePtr);
    computeBestHiresCostByBackgroundForSample(
      sampleIndex,
      clampedCandidateCount,
      lumMatchWeight,
      csfWeight,
      mcmHiresColorPenaltyWeight
    );

    const avgL = rankSampleAvgL[sampleIndex];
    const avgA = rankSampleAvgA[sampleIndex];
    const avgB = rankSampleAvgB[sampleIndex];
    const detailScore = rankSampleDetailScores[sampleIndex];
    const detailSlack = 1.0 - detailScore;
    const safeDetailSlack = detailSlack > 0.0 ? detailSlack : 0.0;
    const sourceChroma = Math.sqrt(avgA * avgA + avgB * avgB);
    const sourceHue = sourceChroma < 0.015 ? 0.0 : Math.atan2(avgB, avgA);
    const colorDemand = computeMcmColorDemandFromChroma(detailScore, sourceChroma);
    const maxHueBonus =
      mcmHuePreservationWeight > 0.0 && sourceChroma >= 0.015
        ? mcmHuePreservationWeight * sourceChroma
        : 0.0;
    let tripleIndex: i32 = 0;

    for (let bg: i32 = 0; bg < COLOR_COUNT; bg++) {
      if (manualBgColor >= 0 && bg != manualBgColor) continue;
      for (let mc1: i32 = 0; mc1 < COLOR_COUNT; mc1++) {
        if (mc1 == bg) continue;
        for (let mc2: i32 = 0; mc2 < COLOR_COUNT; mc2++) {
          if (mc2 == bg || mc2 == mc1) continue;

          let best = rankBestHiresCostByBg[bg];
          for (let candidateIndex: i32 = 0; candidateIndex < clampedCandidateCount; candidateIndex++) {
            const ch = <i32>rankCandidateScreencodes[candidateIndex];
            const csfPenalty = csfWeight > 0.0
              ? csfWeight * <f64>rankGlyphSpatialFrequency[ch] * safeDetailSlack
              : 0.0;
            const bpBase = ch * 64;
            const fixedErr =
              <f64>outputBitPairErrs[bpBase + bg] +
              <f64>outputBitPairErrs[bpBase + 16 + mc1] +
              <f64>outputBitPairErrs[bpBase + 32 + mc2];

            if (2.0 * fixedErr >= best) continue;

            const countsBase = ch * 4;
            const count0 = <f64>rankRefMcmBpCounts[countsBase];
            const count1 = <f64>rankRefMcmBpCounts[countsBase + 1];
            const count2 = <f64>rankRefMcmBpCounts[countsBase + 2];
            const count3 = <i32>rankRefMcmBpCounts[countsBase + 3];
            const count3f = <f64>count3;
            const fixedL =
              count0 * rankPaletteL[bg] +
              count1 * rankPaletteL[mc1] +
              count2 * rankPaletteL[mc2];
            const fixedA =
              count0 * rankPaletteA[bg] +
              count1 * rankPaletteA[mc1] +
              count2 * rankPaletteA[mc2];
            const fixedB =
              count0 * rankPaletteB[bg] +
              count1 * rankPaletteB[mc1] +
              count2 * rankPaletteB[mc2];
            const multicolorUsageBonus = computeMcmMulticolorUsageBonusFromDemand(
              count1,
              count2,
              count3f,
              colorDemand,
              mcmMulticolorUsageBonusWeight
            );
            const multicolorLowerBound = 2.0 * fixedErr + csfPenalty - multicolorUsageBonus - maxHueBonus;
            if (multicolorLowerBound >= best) continue;
            const bp3Base = bpBase + 48;

            if (count3 == 0) {
              const lumDiff = avgL - (fixedL / <f64>PAIR_COUNT);
              const renderedA = fixedA / <f64>PAIR_COUNT;
              const renderedB = fixedB / <f64>PAIR_COUNT;
              const hueBonus = computeHuePreservationBonusFromSource(
                sourceChroma,
                sourceHue,
                renderedA,
                renderedB,
                mcmHuePreservationWeight
              );
              const total =
                2.0 * fixedErr +
                lumMatchWeight * lumDiff * lumDiff +
                csfPenalty -
                hueBonus -
                multicolorUsageBonus;
              if (total < best) best = total;
              continue;
            }

            for (let fg: i32 = 0; fg < 8; fg++) {
              if (!rankHasContrast(fg, bg)) continue;
              const renderedL = (fixedL + count3f * rankPaletteL[fg]) / <f64>PAIR_COUNT;
              const renderedA = (fixedA + count3f * rankPaletteA[fg]) / <f64>PAIR_COUNT;
              const renderedB = (fixedB + count3f * rankPaletteB[fg]) / <f64>PAIR_COUNT;
              const lumDiff = avgL - renderedL;
              const hueBonus = computeHuePreservationBonusFromSource(
                sourceChroma,
                sourceHue,
                renderedA,
                renderedB,
                mcmHuePreservationWeight
              );
              const total =
                2.0 * (fixedErr + <f64>outputBitPairErrs[bp3Base + fg]) +
                lumMatchWeight * lumDiff * lumDiff +
                csfPenalty -
                hueBonus -
                multicolorUsageBonus;
              if (total < best) best = total;
            }
          }

          rankTripleScores[tripleIndex] += sampleWeight * best;
          tripleIndex++;
        }
      }
    }
  }

  resetRankTopScores(clampedFinalistCount);
  let selectedCount: i32 = 0;
  let tripleIndex: i32 = 0;
  for (let bg: i32 = 0; bg < COLOR_COUNT; bg++) {
    if (manualBgColor >= 0 && bg != manualBgColor) continue;
    for (let mc1: i32 = 0; mc1 < COLOR_COUNT; mc1++) {
      if (mc1 == bg) continue;
      for (let mc2: i32 = 0; mc2 < COLOR_COUNT; mc2++) {
        if (mc2 == bg || mc2 == mc1) continue;

        const score = rankTripleScores[tripleIndex];
        if (selectedCount >= clampedFinalistCount && score >= rankTopScores[clampedFinalistCount - 1]) {
          tripleIndex++;
          continue;
        }

        let insertAt = selectedCount < clampedFinalistCount ? selectedCount : clampedFinalistCount - 1;
        while (insertAt > 0 && score < rankTopScores[insertAt - 1]) {
          if (insertAt < clampedFinalistCount) {
            rankTopScores[insertAt] = rankTopScores[insertAt - 1];
            rankTopBgs[insertAt] = rankTopBgs[insertAt - 1];
            rankTopMc1s[insertAt] = rankTopMc1s[insertAt - 1];
            rankTopMc2s[insertAt] = rankTopMc2s[insertAt - 1];
          }
          insertAt--;
        }

        rankTopScores[insertAt] = score;
        rankTopBgs[insertAt] = <u8>bg;
        rankTopMc1s[insertAt] = <u8>mc1;
        rankTopMc2s[insertAt] = <u8>mc2;
        if (selectedCount < clampedFinalistCount) {
          selectedCount++;
        }
        tripleIndex++;
      }
    }
  }

  return selectedCount;
}

function scoreModeCandidatePoolWithCurrentMatrices(
  candidateCount: i32,
  poolSize: i32,
  bg: i32,
  mc1: i32,
  mc2: i32,
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  mcmHuePreservationWeight: f64,
  mcmHiresColorPenaltyWeight: f64,
  mcmMulticolorUsageBonusWeight: f64
): i32 {
  const detailSlack = 1.0 - detailScore;
  const safeDetailSlack = detailSlack > 0.0 ? detailSlack : 0.0;
  const sourceChroma = Math.sqrt(avgA * avgA + avgB * avgB);
  const sourceHue = sourceChroma < 0.015 ? 0.0 : Math.atan2(avgB, avgA);
  const colorDemand = computeMcmColorDemandFromChroma(detailScore, sourceChroma);
  const maxHueBonus =
    mcmHuePreservationWeight > 0.0 && sourceChroma >= 0.015
      ? mcmHuePreservationWeight * sourceChroma
      : 0.0;
  const hiresPenalty = computeMcmHiresColorPenaltyFromDemand(colorDemand, mcmHiresColorPenaltyWeight);
  let selectedCount: i32 = 0;
  resetPoolTopScores(poolSize);

  for (let candidateIndex: i32 = 0; candidateIndex < candidateCount; candidateIndex++) {
    const ch = <i32>rankCandidateScreencodes[candidateIndex];
    const csfPenalty = csfWeight > 0.0
      ? csfWeight * <f64>rankGlyphSpatialFrequency[ch] * safeDetailSlack
      : 0.0;
    const hiresBase = ch << 4;
    const bgErr = <f64>poolTotalErrByColor[bg] - <f64>outputSetErrs[hiresBase + bg];
    const poolLimit = selectedCount < poolSize ? Infinity : poolTopScores[poolSize - 1];
    const hiresLowerBound = bgErr + csfPenalty + hiresPenalty;

    if (hiresLowerBound < poolLimit) {
      const nSet = rankRefSetCount[ch];
      for (let fg: i32 = 0; fg < 8; fg++) {
        if (!rankHasContrast(fg, bg)) continue;
        const mixIndex = binaryMixIndex(nSet, bg, fg);
        const lumDiff = avgL - rankBinaryMixL[mixIndex];
        const total =
          bgErr +
          <f64>outputSetErrs[hiresBase + fg] +
          csfPenalty +
          lumMatchWeight * lumDiff * lumDiff +
          hiresPenalty;
        selectedCount = insertPoolCandidate(ch, fg, 0, total, poolSize, selectedCount);
      }
    }

    const bpBase = ch * 64;
    const fixedErr =
      <f64>outputBitPairErrs[bpBase + bg] +
      <f64>outputBitPairErrs[bpBase + 16 + mc1] +
      <f64>outputBitPairErrs[bpBase + 32 + mc2];

    if (2.0 * fixedErr < poolLimit) {
      const countsBase = ch * 4;
      const count0 = <f64>rankRefMcmBpCounts[countsBase];
      const count1 = <f64>rankRefMcmBpCounts[countsBase + 1];
      const count2 = <f64>rankRefMcmBpCounts[countsBase + 2];
      const count3 = <i32>rankRefMcmBpCounts[countsBase + 3];
      const count3f = <f64>count3;
      const fixedL =
        count0 * rankPaletteL[bg] +
        count1 * rankPaletteL[mc1] +
        count2 * rankPaletteL[mc2];
      const fixedA =
        count0 * rankPaletteA[bg] +
        count1 * rankPaletteA[mc1] +
        count2 * rankPaletteA[mc2];
      const fixedB =
        count0 * rankPaletteB[bg] +
        count1 * rankPaletteB[mc1] +
        count2 * rankPaletteB[mc2];
      const multicolorUsageBonus = computeMcmMulticolorUsageBonusFromDemand(
        count1,
        count2,
        count3f,
        colorDemand,
        mcmMulticolorUsageBonusWeight
      );
      const multicolorLowerBound = 2.0 * fixedErr + csfPenalty - multicolorUsageBonus - maxHueBonus;
      if (multicolorLowerBound >= poolLimit) {
        continue;
      }
      if (count3 == 0) {
        const renderedL = fixedL / <f64>PAIR_COUNT;
        const renderedA = fixedA / <f64>PAIR_COUNT;
        const renderedB = fixedB / <f64>PAIR_COUNT;
        const lumDiff = avgL - renderedL;
        const hueBonus = computeHuePreservationBonusFromSource(
          sourceChroma,
          sourceHue,
          renderedA,
          renderedB,
          mcmHuePreservationWeight
        );
        const total =
          2.0 * fixedErr +
          lumMatchWeight * lumDiff * lumDiff +
          csfPenalty -
          hueBonus -
          multicolorUsageBonus;
        selectedCount = insertPoolCandidate(
          ch,
          MCM_CANONICAL_UNUSED_COLOR_RAM,
          1,
          total,
          poolSize,
          selectedCount
        );
        continue;
      }

      const bp3Base = bpBase + 48;

      for (let fg: i32 = 0; fg < 8; fg++) {
        if (!rankHasContrast(fg, bg)) continue;
        const renderedL = (fixedL + count3f * rankPaletteL[fg]) / <f64>PAIR_COUNT;
        const renderedA = (fixedA + count3f * rankPaletteA[fg]) / <f64>PAIR_COUNT;
        const renderedB = (fixedB + count3f * rankPaletteB[fg]) / <f64>PAIR_COUNT;
        const lumDiff = avgL - renderedL;
        const hueBonus = computeHuePreservationBonusFromSource(
          sourceChroma,
          sourceHue,
          renderedA,
          renderedB,
          mcmHuePreservationWeight
        );
        const total =
          2.0 * (<f64>fixedErr + <f64>outputBitPairErrs[bp3Base + fg]) +
          lumMatchWeight * lumDiff * lumDiff +
          csfPenalty -
          hueBonus -
          multicolorUsageBonus;
        selectedCount = insertPoolCandidate(ch, fg | 8, 1, total, poolSize, selectedCount);
      }
    }
  }

  return selectedCount;
}

export function computeModeCandidatePool(
  cellIndex: i32,
  candidateCount: i32,
  poolSize: i32,
  bg: i32,
  mc1: i32,
  mc2: i32,
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  mcmHuePreservationWeight: f64,
  mcmHiresColorPenaltyWeight: f64,
  mcmMulticolorUsageBonusWeight: f64
): i32 {
  const clampedCandidateCount = candidateCount > CHAR_COUNT ? CHAR_COUNT : candidateCount;
  const clampedPoolSize = poolSize > MAX_MCM_POOL_SIZE ? MAX_MCM_POOL_SIZE : poolSize;
  if (clampedCandidateCount <= 0 || clampedPoolSize <= 0) {
    return 0;
  }

  const pixelBasePtr = modeWeightedPixelErrors.dataStart + (<usize>(cellIndex * PIXEL_COUNT * COLOR_COUNT) << 2);
  const pairBasePtr = modeWeightedPairErrors.dataStart + (<usize>(cellIndex * PAIR_COUNT * COLOR_COUNT) << 2);
  computeMatricesFromBase(pixelBasePtr, pairBasePtr);

  return scoreModeCandidatePoolWithCurrentMatrices(
    clampedCandidateCount,
    clampedPoolSize,
    bg,
    mc1,
    mc2,
    avgL,
    avgA,
    avgB,
    detailScore,
    lumMatchWeight,
    csfWeight,
    mcmHuePreservationWeight,
    mcmHiresColorPenaltyWeight,
    mcmMulticolorUsageBonusWeight
  );
}

export function computeModeCandidatePoolsBatch(
  cellIndex: i32,
  candidateCount: i32,
  poolSize: i32,
  finalistCount: i32,
  avgL: f64,
  avgA: f64,
  avgB: f64,
  detailScore: f64,
  lumMatchWeight: f64,
  csfWeight: f64,
  mcmHuePreservationWeight: f64,
  mcmHiresColorPenaltyWeight: f64,
  mcmMulticolorUsageBonusWeight: f64
): i32 {
  const clampedCandidateCount = candidateCount > CHAR_COUNT ? CHAR_COUNT : candidateCount;
  const clampedPoolSize = poolSize > MAX_MCM_POOL_SIZE ? MAX_MCM_POOL_SIZE : poolSize;
  const clampedFinalistCount = finalistCount > MAX_MCM_FINALIST_COUNT ? MAX_MCM_FINALIST_COUNT : finalistCount;
  if (clampedCandidateCount <= 0 || clampedPoolSize <= 0 || clampedFinalistCount <= 0) {
    return 0;
  }

  const pixelBasePtr = modeWeightedPixelErrors.dataStart + (<usize>(cellIndex * PIXEL_COUNT * COLOR_COUNT) << 2);
  const pairBasePtr = modeWeightedPairErrors.dataStart + (<usize>(cellIndex * PAIR_COUNT * COLOR_COUNT) << 2);
  computeMatricesFromBase(pixelBasePtr, pairBasePtr);

  for (let finalistIndex: i32 = 0; finalistIndex < clampedFinalistCount; finalistIndex++) {
    const selectedCount = scoreModeCandidatePoolWithCurrentMatrices(
      clampedCandidateCount,
      clampedPoolSize,
      <i32>rankTopBgs[finalistIndex],
      <i32>rankTopMc1s[finalistIndex],
      <i32>rankTopMc2s[finalistIndex],
      avgL,
      avgA,
      avgB,
      detailScore,
      lumMatchWeight,
      csfWeight,
      mcmHuePreservationWeight,
      mcmHiresColorPenaltyWeight,
      mcmMulticolorUsageBonusWeight
    );
    batchPoolCounts[finalistIndex] = <u8>selectedCount;
    const poolBase = finalistIndex * MAX_MCM_POOL_SIZE;
    for (let slot: i32 = 0; slot < clampedPoolSize; slot++) {
      batchPoolTopChars[poolBase + slot] = poolTopChars[slot];
      batchPoolTopColorRams[poolBase + slot] = poolTopColorRams[slot];
      batchPoolTopVariants[poolBase + slot] = poolTopVariants[slot];
      batchPoolTopScores[poolBase + slot] = poolTopScores[slot];
    }
  }

  return clampedFinalistCount;
}
