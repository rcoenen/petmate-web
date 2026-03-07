# TruSkii3000 WASM Acceleration

## Status

Phase 2 is now partially implemented for `Standard` mode only:
- worker-backed Standard conversion is live
- a first AssemblyScript WASM kernel is integrated into the Standard worker path
- the UI shows whether Standard is running as `WASM` or `JS fallback`
- console diagnostics report why workers fall back

This is still an experiment, not a finished acceleration phase. The first live result is important:

- **WASM loads successfully now**
- **the current AssemblyScript kernel is slower end-to-end than the JavaScript path**

So the current WASM path proves integration, loading, and fallback behavior, but it is **not yet a performance win**.

## Live Findings (2026-03-07)

### 1. Initial fallback cause was identified and fixed

The first worker runs fell back with:

`TypeError: WebAssembly.instantiate(): Import #0 "env": module is not an object or function`

Cause:
- the generated AssemblyScript module imports `env.abort`
- the worker was instantiating the module with `{}` instead of an `env` import object

Fix:
- the worker-side loader now provides `env.abort`
- workers now initialize the AssemblyScript module correctly

### 2. `WASM` badge means backend availability, not full-stage WASM

The Standard panel badge shows whether the Standard worker path is using the WASM-backed scoring kernel or the JS fallback path.

It does **not** mean the whole visible stage is running in WASM. For example:
- image fitting / preprocessing is still JavaScript
- orchestration, worker scheduling, progress, and cancellation are still JavaScript
- only a small Standard scoring kernel is currently ported

So seeing `WASM` during a slow stage does not imply that stage itself is implemented in WASM.

### 3. First AssemblyScript kernel is currently slower than JS overall

Observed in live manual testing:
- the WASM badge appeared correctly
- conversion completed successfully
- end-to-end Standard conversion felt significantly slower than the existing JS worker path

Likely reasons:
- only a **small inner kernel** was ported
- data still has to be copied into WASM memory and read back out
- the surrounding pipeline is still JS and still dominates large parts of total time
- AssemblyScript does not automatically outperform modern typed-array-heavy JavaScript for small kernels

Conclusion:
- this first WASM step is a **plumbing success**
- it is **not** yet evidence that the chosen kernel/toolchain combination is worthwhile for performance

### 4. Console diagnostics are now essential

The worker pool now logs:
- per-worker WASM init success/failure
- whether the overall Standard worker pool is running `WASM` or `JS fallback`
- fallback reasons when initialization fails

That should stay in place while the WASM experiment continues.

## Why WASM

The worker path (phase 1) parallelizes the 50 Standard combos across CPU cores, but each worker still runs the full numeric solver in JavaScript. V8 does not auto-vectorize JavaScript — even typed-array-heavy inner loops run scalar. WASM with SIMD intrinsics makes vectorization explicit, targeting an estimated 2-8x speedup on the compute-bound inner loops.

The goal is reducing per-combo compute time without changing output, not replacing the JS solver.

## Candidate Hot Kernels

Based on code analysis (profiling data needed from phase 1 to confirm):

### 1. `buildBinaryCandidatePool` inner loop (highest priority)

The tightest loop in Standard conversion. Per cell: 256 chars x 16 fg colors. For each char, accumulates `setErr[color]` across set positions, then evaluates all fg/bg combinations.

```
for ch in 0..256:
  for each set position:
    for color in 0..16:
      setErr[color] += weightedPixelErrors[pos * 16 + color]  // Float32 source, Float64 accumulator
  for bg in backgrounds:
    bgErr = totalErrByColor[bg] - setErr[bg]
    for fg in 0..16:
      total = bgErr + setErr[fg] + lumMatchWeight * lumDiff^2
```

Working set per cell: `weightedPixelErrors` (64 x 16 = 1024 Float32s = 4KB) + `setPositions` (~30 bytes). Fits in L1 cache. Genuinely compute-bound.

SIMD opportunity: the inner `for color in 0..16` accumulation is a perfect f32x4 reduction — 4 colors per SIMD lane, 4 iterations instead of 16.

### 2. `analyzeAlignedSourceImage` cell analysis (medium priority)

Per cell: 64 pixels x 16 palette comparisons for saliency weighting and `weightedPixelErrors` construction. Less likely to dominate after workers parallelize combos, but still significant — 1000 cells per combo.

SIMD opportunity: the `perceptualError` computation (3 subtractions, 3 multiplies, 2 adds, weighted sum) can be packed into f32x4 with one lane unused.

### 3. `solveScreen` neighbor penalty (lower priority)

5 passes x 1000 cells x 6 candidates x 4 neighbors. Each `computeNeighborPenalty` does an 8-iteration loop over edge pixels. Less compute per call but called frequently.

SIMD opportunity: the 8-element edge comparison loop could use f32x4 (2 iterations instead of 8), but the branch-heavy structure around it limits the gain.

## Precision Strategy

### The Float32/Float64 Mix

The current JS solver uses mixed precision:
- **Float32Array**: `weightedPixelErrors`, `totalErrByColor`, source image channels (`srcL`, `srcA`, `srcB`)
- **Float64Array**: `setErr` accumulation in candidate scoring, `pairDiff` palette pair distances, `coarseScores`

The Float64 accumulators exist to avoid precision loss when summing many Float32 values. In candidate scoring, `setErr` accumulates up to ~30 Float32 values per color channel — Float64 prevents the sum from drifting enough to change tie-breaking.

### Options

**Option A: f64 in WASM for accumulators**
- Match existing JS precision exactly.
- No SIMD benefit for accumulation paths (WASM SIMD is f32x4 or f64x2, not f64x4).
- f64x2 gives 2x throughput on the 16-color loop, not 4x.
- Parity is trivially guaranteed.

**Option B: Standardize JS on Float32 first, then WASM matches**
- Change JS accumulators from Float64 to Float32.
- Verify output doesn't change on representative images (it might not — the accumulated values may not be large enough for Float32 precision to matter).
- If output does change, this becomes a quality decision, not just an implementation detail.
- Once JS is Float32-only, WASM f32x4 gives full 4x throughput and trivial parity.

**Option C: Profile the precision impact**
- Run the Standard solver twice — once with Float64 accumulators, once with Float32 — and diff the final `screencodes[]` and `colors[]`.
- If identical on all test images: use Float32 everywhere (Option B is safe).
- If different: keep Float64 for those paths (Option A) or accept the quality delta as a deliberate trade-off.

**Recommendation: Option C first, then B or A based on results.** This is a 30-minute experiment that resolves the question empirically before any WASM code is written.

## Toolchain Options

### Rust + wasm-pack
- Best SIMD control via `core::arch::wasm32` intrinsics
- Mature ecosystem: `wasm-bindgen`, `wasm-pack`, well-documented
- Adds Rust to the build toolchain (permanent dependency)
- Smallest output for numeric kernels (no runtime overhead)
- Can target `wasm32-unknown-unknown` with `#[no_std]` for minimal module size

### AssemblyScript
- TypeScript-like syntax, npm-native toolchain
- Lower friction for JS/TS developers
- Weaker SIMD support and optimizer compared to LLVM/Rust
- Better for simple kernels, worse for complex data layouts

### C / Emscripten
- Maximum low-level control
- Heaviest toolchain, most boilerplate
- Overkill for the scope of these kernels

**Decision: AssemblyScript first, Rust as fallback.** The kernels are small (3-4 functions) and the project priorities are browser-first, simple contributor setup, and GitHub-friendly builds. AssemblyScript stays inside the existing npm/Node toolchain — no second language, no `rustup`/`cargo` for contributors, no extra CI steps. Rust is installed on the dev machine as a fallback if AssemblyScript hits a SIMD or optimization wall, but it should not be the default path unless AS clearly can't deliver the needed speedup.

**Current update:** AssemblyScript has now been proven viable as an integration path, but the first kernel is not yet faster. That does **not** automatically mean Rust is required next, but it does mean AssemblyScript has not earned broader rollout yet.

## WASM Module Loading in Workers

### Compile once, instantiate per worker

```
Main thread:
  const wasmModule = await WebAssembly.compileStreaming(fetch('truskii.wasm'));

Worker init message:
  { type: 'init', fontBitsByCharset, wasmModule }

Worker side:
  const instance = await WebAssembly.instantiate(wasmModule, imports);
```

`WebAssembly.Module` is transferable — sending it to workers via `postMessage` avoids each worker re-fetching and re-compiling the WASM binary. Compilation happens once on the main thread, instantiation (cheap) happens per worker.

### Memory layout

The WASM module needs access to:
- `weightedPixelErrors` (Float32Array, 1024 per cell)
- `setPositions` (Uint8Array, ~30 per char)
- `totalErrByColor` (Float32Array, 16)
- `paletteMetrics` (Float64Array, pL/pA/pB each 16)
- `refSetCount` (Int32Array, 256)

Strategy: allocate a shared WASM linear memory region, copy cell data in before each `buildBinaryCandidatePool` call, read results out. The per-cell working set is ~5KB — well within a fixed WASM memory page.

### Fallback

Feature-detect `WebAssembly.compileStreaming` on init. If unavailable, the worker runs the JS solver path. No conditional logic inside the hot loops — the decision is made once during worker initialization.

## Module Size Target

Target: < 50KB uncompressed, < 15KB gzipped for the numeric kernel module. The kernels are pure math with no runtime dependencies, no allocator, no string handling. Rust `#[no_std]` with `wasm-opt -Oz` should achieve this comfortably.

## Expected Impact

Speculative until phase 1 profiling confirms the bottleneck distribution:

- If candidate scoring dominates (likely): WASM f32x4 gives ~3-4x on that kernel, reducing per-combo time by ~60-75%.
- Combined with worker parallelism: total Standard conversion time could drop from post-worker ~3-5s to ~1-2s.
- These are estimates, not commitments. Measure after implementation.

## What We Learned From The First Implementation

The first live AssemblyScript implementation changed the planning reality:

- the hardest part was **not** loading WASM in the browser; that is working now
- the current kernel scope is probably too small to overcome call + memory-transfer overhead
- performance claims should now be evaluated at **kernel level** and **stage level**, not by “WASM loaded successfully”

Practical implication:
- do **not** roll WASM out to ECM/MCM yet
- do **not** assume “more WASM” automatically means faster
- either:
  - port a larger contiguous hot path, or
  - keep Standard on JS workers until a faster WASM path is proven

## Risks

- **Build toolchain**: AssemblyScript is npm-native, so no additional toolchain for contributors. Rust is available as a fallback if AS hits optimization limits.
- **Precision divergence**: Addressed by the precision strategy above — resolve before writing WASM code.
- **Debugging**: WASM numeric bugs are harder to trace than JS. Mitigated by keeping the JS solver as reference and diffing outputs automatically in dev mode.
- **Browser support**: WASM SIMD is supported in Chrome 91+, Firefox 89+, Safari 16.4+. ~95% global coverage. Non-SIMD WASM fallback is possible but reduces the speedup to ~1.5-2x (still worth it for the function call overhead reduction).

## Prerequisites Before Implementation

1. Phase 1 (workers) shipped and stable
2. Profiling data confirming which Standard kernels dominate in the worker path
3. Precision experiment (Option C) resolving the Float32/Float64 question
4. OpenSpec approval of `accelerate-standard-converter-with-wasm`

## Recommended Next Step

Before expanding the WASM port:

1. add precise stage-level timings for Standard
2. compare **JS kernel time vs WASM kernel time** directly
3. decide whether this AssemblyScript kernel should be:
   - optimized further,
   - replaced with a larger kernel target, or
   - abandoned in favor of Rust/SIMD

Right now, the evidence says:
- WASM integration works
- fallback diagnostics work
- the current AssemblyScript kernel is **not yet a speedup**
