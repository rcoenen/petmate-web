const COLOR_COUNT: i32 = 16;
const CHAR_COUNT: i32 = 256;
const PIXEL_COUNT: i32 = 64;
const WEIGHTED_PIXEL_ERROR_COUNT: i32 = PIXEL_COUNT * COLOR_COUNT;
const MAX_POSITION_COUNT: i32 = CHAR_COUNT * PIXEL_COUNT;
const OUTPUT_COUNT: i32 = CHAR_COUNT * COLOR_COUNT;

const weightedPixelErrors = new Float32Array(WEIGHTED_PIXEL_ERROR_COUNT);
const positionOffsets = new Int32Array(CHAR_COUNT + 1);
const flatPositions = new Uint8Array(MAX_POSITION_COUNT);
const outputSetErrs = new Float32Array(OUTPUT_COUNT);

export function getWeightedPixelErrorsPtr(): usize {
  return weightedPixelErrors.dataStart;
}

export function getPositionOffsetsPtr(): usize {
  return positionOffsets.dataStart;
}

export function getFlatPositionsPtr(): usize {
  return flatPositions.dataStart;
}

export function getOutputSetErrsPtr(): usize {
  return outputSetErrs.dataStart;
}

export function computeSetErrs(): void {
  const zero = f32x4.splat(0);

  for (let ch: i32 = 0; ch < CHAR_COUNT; ch++) {
    // Byte offset into the Float32 output array: ch * 16 floats * 4 bytes
    const outPtr: usize = outputSetErrs.dataStart + (<usize>(ch << 4) << 2);

    // Zero 16 f32 values via 4 x v128 stores
    v128.store(outPtr, zero);
    v128.store(outPtr + 16, zero);
    v128.store(outPtr + 32, zero);
    v128.store(outPtr + 48, zero);

    const start = positionOffsets[ch];
    const end = positionOffsets[ch + 1];
    for (let i: i32 = start; i < end; i++) {
      // Byte offset into the Float32 input array: position * 16 floats * 4 bytes
      const inPtr: usize = weightedPixelErrors.dataStart + (<usize>((<i32>flatPositions[i]) << 4) << 2);

      // f32x4 SIMD: accumulate 4 colors per lane, 4 iterations for 16 colors
      v128.store(outPtr,      f32x4.add(v128.load(outPtr),      v128.load(inPtr)));
      v128.store(outPtr + 16, f32x4.add(v128.load(outPtr + 16), v128.load(inPtr + 16)));
      v128.store(outPtr + 32, f32x4.add(v128.load(outPtr + 32), v128.load(inPtr + 32)));
      v128.store(outPtr + 48, f32x4.add(v128.load(outPtr + 48), v128.load(inPtr + 48)));
    }
  }
}
