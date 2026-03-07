# Performance Optimization for the Converter

Research notes on JavaScript/browser performance for heavy pixel-processing.

---

## Hot Path Analysis

`findOptimalPetscii`: 1000 cells x 256 chars x 16 fg colors, inner loops of 64 pixels.
~262 million pixel iterations per call, each ~8 FLOPs. ~4.2 billion FLOPs per standard conversion.

Runs multiple times: 16x for background search (sampled), 1x final, doubled for upper+lower charsets.

---

## Web Workers (HIGH value, MEDIUM complexity)

### What it solves

The current `setTimeout(0)` yielding still blocks the main thread for each synchronous `findOptimalPetscii` call (hundreds of ms to seconds). Moving to a Worker eliminates all UI jank.

### Transfer overhead is negligible

- Input: ImageData 256KB (transferable, zero-copy), font bits 4KB, settings trivial
- Output: ~8KB screencodes/colors + 256KB preview ImageData
- Transfer latency < 1ms with transferable ArrayBuffers

### SharedArrayBuffer not needed

One-shot batch job, not streaming. Simple postMessage with transferables is sufficient and avoids COOP/COEP header requirements.

### Vite support

First-class: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`. The converter module is already self-contained with no DOM dependencies except `resizeToCanvas()` (which uses canvas — do resize on main thread, transfer the buffer).

### Key change needed

`ref: boolean[][]` must become a flat typed array before transfer (also a computational win — see below).

---

## WASM (HIGH value, MEDIUM-HIGH complexity)

### Expected speedup

4-10x over JS for image processing. With WASM SIMD (128-bit, universal since 2022): 10-15x.

### Ideal WASM kernel

The Lab distance inner loop is a textbook SIMD target:

```
dL = chunkL[p] - paletteL
da = chunkA[p] - paletteA
db = chunkBv[p] - paletteB
error += weight[p] * (dL*dL + da*da + db*db)
```

With `f32x4`: 4 pixels per instruction. 64-pixel loop becomes 16 SIMD iterations.

### Toolchain

Rust + wasm-pack. LLVM auto-vectorizes with `-C target-feature=+simd128`. The entire `findOptimalPetscii` is a good candidate — zero DOM dependencies, pure numeric computation on typed arrays.

### Second-phase optimization

Do Web Workers first (unblocks UI). Then move the hot inner functions to WASM running inside the Worker.

---

## V8 Does NOT Auto-Vectorize JavaScript

Critical finding: V8/TurboFan does not SIMD-vectorize typed array loops. The old SIMD.js proposal was abandoned in favor of WebAssembly SIMD. No way to get SIMD from JS regardless of loop structure. V8 JITs efficient scalar code, but one float op per instruction.

---

## Float32 vs Float64

### Now: negligible difference in JS

V8 scalar performance is similar for both. Float64Array reads slightly faster (~5.3M vs ~4.7M ops/sec), Float32 writes slightly faster.

### For WASM SIMD: Float32 is essential

`f32x4` processes 4 values per instruction vs `f64x2` processing 2. Switching to Float32Array now is preparation for WASM.

### Precision

Float32 has ~7 digits. Lab values range L:[0,100], a:[-128,127]. Squared diffs reach ~65,000. Accumulated over 64 weighted pixels, max sum ~45M. Float32 represents integers exactly up to 16,777,216 — minor precision loss possible at max accumulation. Acceptable for relative comparison.

---

## Typed Array Optimizations (MEDIUM value, LOW risk)

### Replace `boolean[][]` with flat `Uint8Array`

Current `ref` is 256 arrays of 64 JS booleans. Each boolean is 8 bytes in V8. Accessing `ref[ch][p]` involves two pointer dereferences and two bounds checks.

Flat `Uint8Array(16384)` with index `ch * 64 + p`:
- 16KB contiguous (fits L1 cache)
- Single bounds check, direct byte access
- ~10-20% inner loop improvement from cache locality

### SoA layout is already correct

The code already uses separate `Float64Array` per channel (chunkL, chunkA, chunkBv, weights). SoA with typed arrays can be 40x faster than AoS in JS. No change needed.

### Pre-compute per-pixel background error

For a given bg color, `weight[p] * deltaE^2` for pixel p vs bg is the same for every character. Currently recomputed per character. Pre-computing `bgPixelError[64]` once per bg, then summing via bitmask, eliminates redundant work. Adds 512 bytes memory per cell.

---

## Loop Structure Considerations

### Current nesting:

```
for cell (1000):
  for bg (1-16):
    for ch (256):
      bgError = sum(64 pixels where !ref[ch][p])
      if bgError >= bestError: continue  // KEY OPTIMIZATION
      for fg (16):
        fgError = sum(64 pixels where ref[ch][p])
```

### The early-exit is very effective

`bgError >= bestError` on line 682 skips the entire fg loop (16 colors x 64 pixels) for bad characters. Can skip 80-90% of fg evaluations. Any restructuring must preserve this.

### Missing fg early-exit

Inside the fg pixel loop, accumulated `fgError` never breaks early when `fgError + bgError >= bestError`. Adding this would help for bad fg choices.

### In a Web Worker

Yielding via `setTimeout(0)` is unnecessary. All 1000 cells can run in a tight loop, eliminating async/await overhead entirely.

---

## OffscreenCanvas

Only relevant if doing the resize inside a Web Worker (can't use DOM canvas there). Otherwise, resize on main thread and transfer the buffer. The resize is <10ms, not worth optimizing independently.

---

## Recommended Priority

1. **Web Worker** — unblocks UI, eliminates yield overhead. Biggest user-facing improvement.
2. **Flatten `boolean[][]` to `Uint8Array`** — trivial, better cache locality.
3. **Add fg early-exit** — one `if` statement in the inner loop.
4. **Pre-compute bgPixelError** — eliminates redundant per-character bg error computation.
5. **Float32Array** — prepares for WASM SIMD, halves memory bandwidth.
6. **WASM inner loop** — 8-15x speedup for the hot path. Rust + wasm-pack.

---

## References

- surma.dev, "Is postMessage slow?": https://surma.dev/things/is-postmessage-slow/
- Chrome Developers, "Transferable objects": https://developer.chrome.com/blog/transferable-objects-lightning-fast
- V8, "Fast parallel with WASM SIMD": https://v8.dev/features/simd
- "Rust WASM Performance: 8-10x Faster (2025)": https://byteiota.com/rust-webassembly-performance-8-10x-faster-2025-benchmarks/
- Photon WASM image lib: https://silvia-odwyer.github.io/photon/
- web.dev, "OffscreenCanvas": https://web.dev/articles/offscreen-canvas
- "V8 Secrets: 66% memory reduction with TypedArrays": https://dev.to/asadk/v8-engine-secrets-how-we-slashed-memory-usage-by-66-with-typedarrays-g95
- "Object of Arrays beat interleaved arrays in JS": https://news.ycombinator.com/item?id=46574989
- "Exploring SIMD in WASM": https://www.awelm.com/posts/simd-web-assembly-experiment
- "WASM vs JS: Side-by-Side Performance": https://thenewstack.io/webassembly-vs-javascript-testing-side-by-side-performance/
- Emscripten SIMD docs: https://emscripten.org/docs/porting/simd.html
