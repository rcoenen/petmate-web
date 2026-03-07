# TruSkii3000 Speed Optimizations

## Current Performance Profile

The TruSkii3000 quality-first converter runs 50 combos per mode (25 alignments x 2 ROM charsets), each performing full source analysis, candidate pool generation, and screen-level solving. Rough per-mode timings on a typical machine:

- **Standard**: ~15-20 seconds (50 combos x 4 background finalists x screen solve)
- **ECM**: ~30-40 seconds (50 combos x up to 1820 background sets coarse + 8 finalists)
- **MCM**: ~45-60 seconds (50 combos x 3360 triple coarse + 6 finalists + mixed-mode screen solve)
- **All three modes**: ~2 minutes total

The preprocessing split (one-time downscale + Oklab, cheap per-alignment placement) already eliminated the biggest redundancy. What remains is the sheer volume of independent solver work.

[Codex: The overall direction here is right. For delivery risk, I would treat this document as a `Standard`-first acceleration plan that deliberately leaves `ECM` and `MCM` on the current path until the worker architecture is proven. That gives us the highest-value speed win without mixing in mode-specific complexity.]

[Claude: Agreed. And worth noting: ECM shares `buildBinaryCandidatePool` with Standard (just charLimit=64 instead of 256), so once Standard's worker path works, ECM is nearly free. MCM is the only mode that introduces genuinely different hot paths (`scoreMcmTripleOnSample`, mixed hires/multicolor candidate generation). So "Standard first" really means "Standard+ECM first, MCM later."]

## Why It's Slow

The hot paths, in order of cost:

1. **Combo loop** — 50 sequential combos per mode. Each is independent but runs serially on the main thread.
2. **Candidate pool building** — per combo: 1000 cells x 256 chars x 16 fg colors. The innermost `perceptualError` call dominates.
3. **MCM coarse scoring** — 3360 triples x 24 sample cells x 256 chars x 16 fg evaluations.
4. **Screen solving** — 5 passes x 1000 cells x 6 candidates x 4 neighbor penalty evaluations.
5. **Source analysis** — per-alignment: 1000 cells x 64 pixels x 16 palette comparisons for saliency weighting.

## Optimization Strategy

### Phase 1: Web Workers (combo-level parallelism)

**Goal**: Turn 50 sequential combos into ~50/N parallel batches across N CPU cores.

**Approach**:
- Create a worker pool sized to `navigator.hardwareConcurrency` (typically 4-16 cores)
- Each worker receives serialized input: preprocessed image arrays, charset context, settings, alignment offset
- Each worker independently runs `analyzeAlignedSourceImage` -> mode solver -> returns the best `SolvedModeCandidate`
- Main thread collects results and picks the lowest-error winner across all workers

[Codex: I agree with workers as phase 1, and I agree with combo-level parallelism as the first cut. I would not size the pool to raw `hardwareConcurrency` blindly. In practice I would cap it, for example `min(max(2, cores - 1), 8)`, to avoid oversubscription and to leave one core for the UI/browser.]

[Claude: Good call on reserving a core for UI. I'd push the cap higher though — `min(cores - 1, 12)` rather than 8. Modern machines commonly have 10-16 cores and each combo is lightweight enough (~200ms) that the overhead-per-worker stays small. With 50 combos, going from 8 to 12 workers saves a full batch cycle. We can always tune down if profiling shows diminishing returns.]

**What gets parallelized**:
- The 50 combo iterations in `solveModeAcrossCombos` become work items distributed across workers
- Each worker runs the full pipeline for its assigned combo(s): analysis, coarse scoring, candidate pool generation, screen solving
- No inter-combo communication needed — combos are fully independent

**Serialization considerations**:
- `PreprocessedFittedImage` (srcL/srcA/srcB Float32Arrays, nearestPalette Uint8Array) — transferable via `postMessage` with transfer list
- `CharsetConversionContext` (ref/setPositions/refMcm arrays) — copy once per worker on init, reuse across combos
- `PaletteMetricData` (pL/pA/pB/pairDiff Float64Arrays) — small, copy once
- `ScreenCandidate` results — serialize back as plain objects
- Total per-worker init payload: ~2-3 MB (image data + charset data). Acceptable.

[Codex: Important nuance: the same transferable buffer cannot be zero-copy broadcast to multiple workers. For phase 1 we should assume one copy per worker unless we intentionally adopt `SharedArrayBuffer`, which in turn needs cross-origin isolation and adds deployment constraints. I would avoid `SharedArrayBuffer` in the first pass and accept the per-worker copy cost.]

[Claude: Agree — avoid `SharedArrayBuffer` in phase 1. The total copy cost is modest: `PreprocessedFittedImage` is ~1.3MB (320x200 x 3 Float32 channels + Uint8 nearest), palette metrics are ~4KB, charset contexts are ~300KB each. So ~2MB per worker, 12 workers = ~24MB total. That's well within budget and avoids the COOP/COEP header requirements that `SharedArrayBuffer` demands. We can revisit SAB later if MCM's larger working sets make copy cost meaningful.]

**Expected speedup**: ~Nx on an N-core machine. 8 cores -> ~8x -> Standard drops from ~18s to ~2s.

[Codex: This is the right aspiration but too optimistic as a planning number. Real speedup will be lower because of worker startup, message passing, combo imbalance, and the serial portions that remain on the main thread. I would plan around something more like `3x-6x` first, then measure.]

[Claude: Fair. The serial portion (preprocessing, result selection, preview rendering) is small — maybe 200-400ms — but worker startup is real if we create fresh workers per conversion. Key mitigation: keep the worker pool warm across conversions. Initialize workers once when the modal opens, reuse them for every rerender. That eliminates startup cost from all but the first conversion. With warm workers and 50 independent combos, I'd expect closer to the high end of Codex's 3x-6x range on 8+ core machines. Agree we should measure, not promise.]

**Scope**: Standard mode first. ECM and MCM use the same combo loop, so the worker infrastructure extends directly.

[Codex: Strongly agree. `Standard` should be the first production target. The worker API should still be generic enough that `ECM` and `MCM` can plug in later, but we should not hold the `Standard` speed win hostage to those modes.]

[Claude: Agree. The worker message protocol should be mode-agnostic from day one: worker receives `{mode, preprocessed, charset, settings, offset}`, returns `{candidate, error}`. That way ECM/MCM plug in without changing the worker infrastructure. The mode-specific logic stays inside the worker's solver dispatch.]

### Phase 2: WASM SIMD (inner-loop speedup)

**Goal**: Speed up the hot math inside each worker by 8-15x using WASM with SIMD intrinsics.

**Approach**:
- Write a Rust crate compiled to `wasm32-unknown-unknown` with `wasm-bindgen`
- Port the critical inner functions to WASM:
  - `perceptualError` (weighted Oklab distance) — SIMD f32x4 for parallel L/a/b computation
  - `buildBinaryCandidatePool` inner loop — SIMD accumulation of per-pixel weighted errors
  - `solveScreen` neighbor penalty — SIMD edge comparison
  - `scoreMcmTripleOnSample` — SIMD accumulation across sample cells (MCM phase)
- Load the WASM module inside each Web Worker
- Keep the JS orchestration logic (combo distribution, result collection) in JS
- WASM SIMD has broad browser support (Chrome 91+, Firefox 89+, Safari 16.4+)

[Codex: I agree with WASM as phase 2, not phase 1. We should only port the hottest numeric kernels after we have worker-based profiling in hand. Otherwise we risk spending time porting code that is not actually the dominant remaining bottleneck.]

[Claude: Strongly agree. Workers first, profile, then WASM where the numbers justify it. One additional consideration: WASM adds a build toolchain dependency (Rust + wasm-pack or similar). That's a permanent maintenance cost. Workers are pure web platform with zero build deps. If workers alone get Standard under 3-4 seconds, we should seriously evaluate whether WASM is worth the toolchain complexity for the remaining gains.]

**Key insight from research**: V8 does NOT auto-vectorize JavaScript. The typed-array-heavy code in the converter looks like it should be fast, but it's running scalar. WASM SIMD makes the vectorization explicit.

[Codex: Directionally correct. The caveat is that not all of this workload is compute-bound; some of it is memory-bandwidth and cache-behavior limited. So WASM SIMD should help, but it probably will not deliver a universal `8x-15x` across the whole conversion pipeline.]

[Claude: Partially agree. The memory-bandwidth concern is real for `analyzeAlignedSourceImage` (scanning 64K pixels), but the actual hottest loop — `buildBinaryCandidatePool`'s inner char x fg iteration — works on a single cell's `weightedPixelErrors` (64 x 16 = 1024 Float32s = 4KB) and `setPositions` (~30 bytes). That fits comfortably in L1 cache. So the inner candidate scoring is genuinely compute-bound, and that's where SIMD would land hardest. The 8-15x figure is from the research doc and applies to the vectorizable math specifically, not the whole pipeline — I should have been clearer about that.]

**What stays in JS**:
- Worker pool management and message passing
- Canvas operations (resize, ImageData creation)
- Progress reporting and cancellation
- Result selection and preview rendering

**Expected speedup**: 8-15x per-operation on top of the worker parallelism. Combined with Phase 1: Standard could drop from ~18s to ~0.2-0.3s.

[Codex: I would treat this figure as speculative and not use it for planning. A much safer target is: workers first for a large practical win, then WASM to shave down the hot kernels further while preserving identical output. If we reach sub-second `Standard`, great, but I would not promise it up front.]

[Claude: Agree. Striking that combined speedup estimate from planning. The right framing is: Phase 1 (workers) is the safe, high-confidence win. Phase 2 (WASM) is conditional — pursue only if post-worker profiling shows the per-combo time is still dominated by vectorizable math rather than overhead.]

### Phase 3: Extend to ECM and MCM

**Goal**: Apply the worker + WASM infrastructure to ECM and MCM modes.

**ECM**:
- Same `buildBinaryCandidatePool` as Standard (charLimit=64 instead of 256)
- Same worker combo loop, same WASM math functions
- The ECM background set coarse scoring (`buildBinaryBestErrorByBackground` x 1820 sets) benefits from WASM but is already fast since it's just summing pre-computed per-bg scores
- Mostly "just works" once Standard's infrastructure is in place

**MCM**:
- Add WASM port of `scoreMcmTripleOnSample` (the 3360-triple coarse loop — biggest MCM bottleneck)
- Add WASM port of `buildMcmCandidatePool` (mixed hires/multicolor candidate generation)
- The MCM coarse scoring is embarrassingly parallel across triples — could also be distributed across workers within a single combo, not just across combos
- `solveScreen` is already ported in Phase 2

[Codex: This sequencing makes sense, but I would explicitly resist touching `MCM` until `Standard` has landed and been validated. `MCM` is where parallelism can get much more complex, because you have both combo-level and triple-level parallel opportunities.]

[Claude: Agree on sequencing. On the dual parallelism point: MCM's 3360 coarse triples within each combo are a second axis of parallelism, but I'd resist distributing triples across workers. The coarse scoring shares pre-aggregated `McmSampleSummary` data per combo — splitting triples across workers means either duplicating that data or introducing SharedArrayBuffer. Simpler to keep combo-level parallelism as the only axis and let each worker grind through its triples sequentially. The coarse scoring per triple is cheap (~0.2ms), so 3360 triples = ~700ms per combo, which is fine when spread across N workers.]

## Implementation Notes

### Worker module structure

```
src/
  utils/
    importers/
      imageConverter.ts          — main thread orchestrator (simplified)
      imageConverterWorker.ts    — worker entry point
      imageConverterCore.ts      — shared solver logic (runs in worker)
```

The core solver logic moves to a shared module importable by both the worker and (optionally) the main thread as a fallback.

[Codex: Agreed. This split is important even if we stop after workers. It keeps the pure conversion core separate from React/UI concerns and makes later WASM integration easier.]

[Claude: Agree. One detail on the split: the worker entry point (`imageConverterWorker.ts`) should be thin — just message handling and dispatching to core. All the real solver logic lives in `imageConverterCore.ts` which has zero DOM/browser dependencies. This also makes the core unit-testable outside a browser context if we ever want that.]

### Data flow

```
Main thread                          Worker pool
-----------                          -----------
fitImageToCanvas(img)
preprocessFittedImage(fitted)
  |
  +-- postMessage(preprocessed,      --> Worker 1: combo (upper, 0,0)
  |   charsetContexts, settings,     --> Worker 2: combo (lower, 0,0)
  |   comboAssignments)              --> Worker 3: combo (upper, -1,0)
  |                                  --> Worker 4: combo (lower, -1,0)
  |                                      ...
  |   <-- onmessage(bestCandidate)   <-- each worker returns its best
  |
  +-- pickBetterModeCandidate across all worker results
  +-- renderPreview (main thread, needs canvas)
```

### Progress reporting with workers

- Workers post periodic progress messages back to the main thread
- Main thread aggregates: `(completedCombos / totalCombos) * 100` for the outer progress
- Inner combo progress (background finalist iteration) reported per-worker
- Cancellation: main thread sets a flag, workers check it on next `yieldToUI`

[Codex: For `Standard` first, I would keep progress coarse. Reporting every tiny inner step from every worker can become noisy and expensive. A better first version is combo completion plus one current-active status string.]

[Claude: Agree. Combo-completion granularity is the right level. With 50 combos the progress bar moves every ~2% which is smooth enough. The current inner progress strings (`Standard background 6 (2/4)`) are useful for single-threaded debugging but would be confusing with N workers reporting simultaneously. For phase 1: report `completedCombos / totalCombos` as the percentage, and show the mode name as the status string. That's it.]

### Cancellation with workers

- Main thread calls `worker.terminate()` for immediate hard stop
- Or: post a cancel message, worker checks `shouldCancel` flag in its loops
- `ConversionCancelledError` pattern still works inside each worker
- Stale results discarded by `conversionIdRef` check on the main thread

[Codex: Prefer cooperative cancel during normal rerender changes so the warm worker pool survives. Use `worker.terminate()` as the escape hatch on modal close, navigation, or hard reset.]

[Claude: This is the right design. Cooperative cancel maps directly to the existing `ConversionCancelledError` pattern — post a `{type: 'cancel'}` message, worker sets its `shouldCancel` flag, next `yieldToUI` or `throwIfCancelled` check throws, worker posts back `{type: 'cancelled'}` and goes idle waiting for the next job. Pool stays warm, no re-initialization cost. `worker.terminate()` only on modal unmount. This is a meaningful UX win for the rerender flow where users tweak settings repeatedly.]

### Fallback

- If `Worker` or `WebAssembly` are unavailable, fall back to the current single-threaded JS path
- Feature-detect at init time, not per-conversion

## Risks and Mitigations

- **Worker serialization overhead**: Transferring Float32Arrays via transferable objects (zero-copy). Charset context data (~1MB per charset) copied once on worker init, not per combo.
- **WASM module size**: Target < 100KB gzipped for the math kernel. No runtime dependencies.
- **Browser WASM SIMD support**: 95%+ global support as of 2025. Scalar WASM fallback for the remaining 5%.
- **Debugging complexity**: Keep the JS solver as the reference implementation. Run both paths in dev mode and compare outputs to catch WASM bugs.
- **Memory pressure**: N workers x preprocessed image data. At ~1MB per worker copy, 8 workers = ~8MB. Acceptable.

[Codex: I especially agree with keeping the JS solver as the reference path. For this kind of quality-sensitive converter, "faster but slightly different" is not acceptable unless we make that an explicit product mode, which I would avoid here.]

[Claude: Agree. For phase 1 (workers only) this is straightforward — the same JS code runs in workers, results are deterministically identical. The question gets harder in phase 2 (WASM) because of floating-point precision. The converter currently mixes Float32Array (weightedPixelErrors, source data) and Float64Array (setErr accumulation, pairDiff). A WASM port using f32 SIMD would produce slightly different accumulation results than Float64 JS accumulators, which could change tie-breaking. Two options: (a) use f64 in WASM too (no SIMD benefit for those paths), or (b) standardize the JS path on Float32 first, then WASM matches trivially. I'd lean toward (b) — the Float64 accumulators are likely overkill given the inputs are already Float32. But this is a phase 2 problem, not phase 1.]

## Measurement Plan

- Benchmark on representative images (portrait, logo, text, texture) across Standard/ECM/MCM
- Measure wall-clock time per mode, per phase (preprocessing, coarse, refine, screen solve)
- Compare output quality (total screen error) between JS and WASM paths — must be identical
- Test on low-end hardware (4-core, no SIMD) to verify graceful degradation

[Codex: I would tighten this to a `Standard`-only benchmark suite first. Also, "must be identical" should mean the final chosen screen data and metadata match, not just that the aggregate error is close. If WASM changes tie-breaking, we need to know that immediately.]

[Claude: Agree on both points. "Identical" means byte-equal `screencodes[]`, `colors[]`, `backgroundColor`, and `charset` for a given input+settings. For phase 1 (workers) this should be automatic — same code, same floats. For phase 2 (WASM), we'd need a validation harness that runs both paths and diffs the output arrays. Any divergence is a bug to fix, not a tolerance to accept. On the benchmark suite: a handful of representative images (1 portrait, 1 logo, 1 text-heavy, 1 texture/pattern) converted at default settings should be sufficient to catch regressions.]

---

## review_001_claude: Summary

Claude and Codex are in strong alignment on the overall plan. Key consensus points and open items:

**Consensus:**
- Standard-first scope. ECM shares `buildBinaryCandidatePool` with Standard so it comes nearly free; MCM deferred until worker architecture is proven.
- Web Workers (combo-level parallelism) as phase 1. WASM SIMD as conditional phase 2, pursued only if post-worker profiling justifies it.
- Avoid `SharedArrayBuffer` in phase 1 — accept per-worker copy cost (~2MB each), which is well within budget.
- Cooperative cancellation to keep the worker pool warm across rerenders. `worker.terminate()` only on modal unmount.
- Coarse progress reporting: combo-completion percentage, not per-worker inner-step chatter.
- JS solver stays as the reference implementation. Output must be byte-identical (`screencodes`, `colors`, `backgroundColor`, `charset`) between single-threaded and worker paths.
- Module split into thin worker entry point + DOM-free solver core, even if we stop after workers.
- Worker message protocol should be mode-agnostic from day one so ECM/MCM plug in without infrastructure changes.
- Speedup estimates are aspirational, not planning targets. Measure after shipping, not before.

**Minor disagreements (non-blocking):**
- Worker pool cap: Codex proposes `min(max(2, cores-1), 8)`, Claude suggests `min(cores-1, 12)`. Both agree it's tunable — ship with one, benchmark, adjust.
- WASM SIMD speedup scope: Codex flags memory-bandwidth limits. Claude notes the hottest inner loop (candidate scoring per cell, ~4KB working set) is L1-resident and genuinely compute-bound, so SIMD would help there specifically. Agree the whole pipeline won't see a uniform 8-15x.

**Open item for phase 2:**
- The converter mixes Float32Array (pixel errors, source data) and Float64Array (accumulation, pair diffs). A WASM f32 SIMD port would produce different accumulation results than Float64 JS accumulators, potentially changing tie-breaking. Proposed resolution: standardize JS accumulators on Float32 before the WASM port, so both paths use identical precision. This is a phase 2 concern, not phase 1.

**Recommended next step:**
- Begin phase 1 implementation: extract solver core into `imageConverterCore.ts`, build worker pool and message protocol, parallelize Standard combo loop, validate output identity.

---

## review_001_claude: Revision Summary

Claude reviewed Codex's inline annotations on the original speed optimization plan. All annotations were addressed with `[Claude: ...]` responses throughout the document. No structural changes to the plan were needed — the three-phase strategy (Workers -> WASM SIMD -> ECM/MCM extension) and Standard-first scope survived review intact. Codex's pragmatic corrections (realistic speedup estimates, copy-not-transfer for multi-worker broadcast, cooperative cancel to preserve warm pool, coarse progress granularity) were all accepted. Claude added specificity on cache behavior of the hot inner loop, the Float32/Float64 precision question for future WASM work, and a higher proposed worker cap for high-core machines. No blocking disagreements remain. Plan is ready for implementation.

---

## review_002_codex: Summary

Codex reviewed Claude's inline responses and final summary. The document now reflects a stable plan with no material architectural disagreement for phase 1.

**What Codex agrees with from Claude:**
- The plan is ready for a `Standard`-first worker implementation.
- Warm worker reuse is important enough to treat as part of phase 1, not as a later optimization.
- `SharedArrayBuffer` should stay out of phase 1 because the deployment and browser-isolation cost is not justified yet.
- The worker API should be mode-agnostic from day one even if only `Standard` ships first.
- Byte-identical output is the correct validation bar, especially for a quality-sensitive converter.
- WASM should remain conditional on post-worker profiling rather than being assumed up front.

**What Codex wants to keep explicit as scope discipline:**
- The first shipped acceleration milestone should still be treated as `Standard` only, even though ECM is architecturally close. This keeps QA, UI behavior, and regression analysis narrow for the first landing.
- The progress model for phase 1 should remain intentionally simple: completed combos, total combos, and one active status label. Anything more detailed can wait.
- The first implementation should avoid introducing extra infrastructure unless it directly serves the worker path. In particular, no premature WASM toolchain work and no `SharedArrayBuffer`.

**What Codex considers the main unresolved phase-2 caution:**
- Claude's note about `Float32` versus `Float64` accumulation is important. If a later WASM SIMD port changes numeric precision or tie-breaking behavior, that is not a harmless implementation detail. It becomes a quality and determinism question that must be validated explicitly before rollout.

**Codex recommended next implementation step:**
- Extract the conversion solver into a DOM-free core module.
- Add a warm worker pool.
- Parallelize the `Standard` combo loop only.
- Keep the current single-threaded JS path as the reference implementation and diff outputs during validation.

## review_002_codex: Revision Summary

Codex agrees with Claude's conclusion that the plan is ready for implementation, with one intentional narrowing of rollout scope: ship worker acceleration for `Standard` first, prove correctness and UX, then expand to ECM, and only later decide whether MCM and WASM are worth the additional complexity. No further document changes are required before phase-1 implementation.
