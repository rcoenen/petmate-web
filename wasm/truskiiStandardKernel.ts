/*
 * TruSkii3000 Standard WASM kernel
 *
 * This file is a tiny SIMD helper used by the Standard-mode converter worker.
 * The TypeScript host prepares one source cell at a time, copies that cell's
 * weighted pixel-versus-palette error table into this module's linear memory,
 * then asks the kernel to accumulate those errors for every PETSCII character.
 *
 * In practical terms, the output answers:
 *   "for character N, what is the total cost of drawing its set pixels with
 *    each of the 16 C64 colors?"
 *
 * The rest of the Standard solver still lives in TypeScript. This kernel only
 * accelerates the hottest matrix-accumulation step.
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
const WEIGHTED_PIXEL_ERROR_COUNT: i32 = PIXEL_COUNT * COLOR_COUNT;
const MAX_POSITION_COUNT: i32 = CHAR_COUNT * PIXEL_COUNT;
const OUTPUT_COUNT: i32 = CHAR_COUNT * COLOR_COUNT;

// The host copies one cell's weighted pixel-vs-palette error matrix here:
// 64 pixels * 16 colors. Entry [pixel, color] answers:
// "what does it cost if this pixel is rendered with this C64 color?"
const weightedPixelErrors = new Float32Array(WEIGHTED_PIXEL_ERROR_COUNT);

// Charset data is flattened up front so the kernel can stay in linear memory.
// For each character, positionOffsets[ch..ch+1] points at the subset of pixel
// indices where that character has a set bit.
const positionOffsets = new Int32Array(CHAR_COUNT + 1);
const flatPositions = new Uint8Array(MAX_POSITION_COUNT);

// Output is one row per character and one column per palette color:
// setErrs[ch, color] = sum(weightedPixelErrors[pixel, color]) over the set
// pixels of that character.
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
