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
