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
const WEIGHTED_PIXEL_ERROR_COUNT: i32 = PIXEL_COUNT * COLOR_COUNT;
const MAX_POSITION_COUNT: i32 = CHAR_COUNT * PIXEL_COUNT;
const OUTPUT_COUNT: i32 = CHAR_COUNT * COLOR_COUNT;
const PAIR_DIFF_COUNT: i32 = COLOR_COUNT * COLOR_COUNT;
const BINARY_MIX_COUNT: i32 = (PIXEL_COUNT + 1) * COLOR_COUNT * COLOR_COUNT;
const MAX_STANDARD_POOL_SIZE: i32 = 16;
const MIN_PAIR_DIFF_RATIO: f64 = 0.16;
const BLEND_CSF_RELIEF: f64 = 1.5;
const BLEND_QUALITY_SHARPNESS: f64 = 48.0;
const BLEND_MATCH_WEIGHT: f64 = 3.0;
const COVERAGE_EXTREMITY_WEIGHT: f64 = 20.0;

// The host copies one cell's weighted pixel-vs-palette error matrix here:
// 64 pixels * 16 colors. Entry [pixel, color] answers:
// "what does it cost if this pixel is rendered with this C64 color?"
const weightedPixelErrors = new Float32Array(WEIGHTED_PIXEL_ERROR_COUNT);
const pairDiff = new Float32Array(PAIR_DIFF_COUNT);
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

export function getWeightedPixelErrorsPtr(): usize {
  return weightedPixelErrors.dataStart;
}

export function getPairDiffPtr(): usize {
  return pairDiff.dataStart;
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

export function computeSetErrs(): void {
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
      const inPtr: usize = weightedPixelErrors.dataStart + (<usize>((<i32>flatPositions[i]) << 4) << 2);

      // Accumulate the 16 color costs 4 at a time. This is the hot loop that
      // replaces the JS typed-array summation used by candidate scoring.
      v128.store(outPtr,      f32x4.add(v128.load(outPtr),      v128.load(inPtr)));
      v128.store(outPtr + 16, f32x4.add(v128.load(outPtr + 16), v128.load(inPtr + 16)));
      v128.store(outPtr + 32, f32x4.add(v128.load(outPtr + 32), v128.load(inPtr + 32)));
      v128.store(outPtr + 48, f32x4.add(v128.load(outPtr + 48), v128.load(inPtr + 48)));
    }
  }
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
  computeSetErrs();

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

      const covPenalty = COVERAGE_EXTREMITY_WEIGHT * Math.abs(avgL - standardPaletteL[bg]) * extremity;
      let best = outputBestByBg[bg];

      for (let fg: i32 = 0; fg < COLOR_COUNT; fg++) {
        if (fg == bg) continue;
        if (<f64>pairDiff[fg * COLOR_COUNT + bg] < maxPairDiff * MIN_PAIR_DIFF_RATIO) continue;

        const mixIndex = ((nSet * COLOR_COUNT) + bg) * COLOR_COUNT + fg;
        const lumDiff = avgL - standardBinaryMixL[mixIndex];
        const dL = lumDiff;
        const dA = avgA - standardBinaryMixA[mixIndex];
        const dB = avgB - standardBinaryMixB[mixIndex];
        const blendError = dL * dL + dA * dA + dB * dB;
        const blendQuality = 1.0 / (1.0 + blendError * BLEND_QUALITY_SHARPNESS);
        const pairAdjustment = lumMatchWeight * lumDiff * lumDiff - BLEND_MATCH_WEIGHT * blendQuality;
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
): void {
  const poolBase = backgroundIndex * MAX_STANDARD_POOL_SIZE;
  let count = <i32>standardPoolCounts[backgroundIndex];
  if (count >= poolSize && score >= standardPoolScores[poolBase + poolSize - 1]) {
    return;
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
  poolSize: i32,
  edgeMaskLo: u32,
  edgeMaskHi: u32,
  edgeWeight: f64
): void {
  computeSetErrs();

  const clampedPoolSize = poolSize > MAX_STANDARD_POOL_SIZE ? MAX_STANDARD_POOL_SIZE : poolSize;
  resetStandardPools(backgroundCount, clampedPoolSize);

  const detailSlack = 1.0 - detailScore;
  const safeDetailSlack = detailSlack > 0.0 ? detailSlack : 0.0;
  const hasEdges = edgeWeight > 0.01 && ((edgeMaskLo | edgeMaskHi) != 0);

  if (hasEdges) {
    for (let bi: i32 = 0; bi < backgroundCount; bi++) {
      const bg = <i32>standardBackgrounds[bi];
      for (let fg: i32 = 0; fg < COLOR_COUNT; fg++) {
        if (fg == bg) continue;
        if (<f64>pairDiff[fg * COLOR_COUNT + bg] < maxPairDiff * MIN_PAIR_DIFF_RATIO) continue;
        const pairIndex = bg * COLOR_COUNT + fg;
        standardThresholdLoScratch[pairIndex] = packStandardThresholdLo(fg, bg);
        standardThresholdHiScratch[pairIndex] = packStandardThresholdHi(fg, bg);
      }
    }
  }

  for (let candidateIndex: i32 = 0; candidateIndex < candidateCount; candidateIndex++) {
    const ch = <i32>standardCandidateScreencodes[candidateIndex];
    const rowBase = ch << 4;
    const nSet = standardRefSetCount[ch];
    const sf = <f64>standardGlyphSpatialFrequency[ch];
    const csfPenalty = sf <= 0.1 && csfWeight > 0.0 ? csfWeight * sf * safeDetailSlack : 0.0;
    const csfBase = sf > 0.1 && csfWeight > 0.0 ? csfWeight * sf * safeDetailSlack : 0.0;

    for (let bi: i32 = 0; bi < backgroundCount; bi++) {
      const bg = <i32>standardBackgrounds[bi];
      const poolBase = bi * MAX_STANDARD_POOL_SIZE;
      const count = <i32>standardPoolCounts[bi];
      const worst = count >= clampedPoolSize ? standardPoolScores[poolBase + clampedPoolSize - 1] : Infinity;
      const bgErr = <f64>standardTotalErrByColor[bg] - <f64>outputSetErrs[rowBase + bg];
      if (bgErr >= worst) continue;

      for (let fg: i32 = 0; fg < COLOR_COUNT; fg++) {
        if (fg == bg) continue;
        if (<f64>pairDiff[fg * COLOR_COUNT + bg] < maxPairDiff * MIN_PAIR_DIFF_RATIO) continue;

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

        insertStandardPoolCandidate(bi, clampedPoolSize, ch, fg, total);
      }
    }
  }
}
