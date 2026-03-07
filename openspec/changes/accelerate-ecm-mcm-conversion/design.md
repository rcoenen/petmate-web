## Context
`TruSkii3000` quality-first conversion widened the search space for all three modes. The first acceleration work proved that structural changes matter more than tiny scalar WASM ports:

- `Standard` got materially faster once it moved to worker-backed offset jobs and stopped duplicating per-offset work
- the current scalar AssemblyScript WASM kernel loads correctly, but it is not yet the main speed breakthrough
- the remaining main-thread serial work now lives mostly in `ECM` and `MCM`

Today:
- `Standard` uses a worker-backed offset-level path and reuses analysis across `upper` and `lower`
- `ECM` and `MCM` still iterate `25 x 2` `(alignment, charset)` combos serially in `imageConverter.ts`
- `ECM` still shares candidate-pool and screen-solver structure with `Standard`
- `MCM` still has the heaviest per-combo work and needs off-main-thread execution before more advanced low-level acceleration is worth attempting

## Goals / Non-Goals
- Goals:
  - Reduce `ECM` wall-clock time by reusing the proven `Standard` worker/offset architecture
  - Reduce `MCM` wall-clock time by moving its outer combo loop off the main thread and reusing offset-level analysis across charsets
  - Keep `ECM` and `MCM` output identical to the current single-threaded reference path
  - Preserve cancellation, progress reporting, and manual rerender behavior
  - Keep the architecture compatible with later ECM/MCM WASM work if profiling ever justifies it
- Non-Goals:
  - Add new ECM or MCM WASM kernels in this change
  - Change legal VIC-II behavior or artistic output semantics
  - Redesign the converter UI
  - Replace the current `Standard` path again in this change

## Decisions

### Decision: Extend worker acceleration to ECM before adding more WASM
`ECM` shares the same broad binary candidate-pool and screen-solver structure as `Standard`. That means the next speed win is to extend the proven worker/off-main-thread architecture first, not to jump to ECM-specific WASM kernels.

Alternatives considered:
- Add ECM WASM first: too early, because the larger architectural win is still unclaimed.
- Leave ECM serial and skip straight to MCM: misses the easier, lower-risk performance win.

### Decision: ECM and MCM jobs are scheduled per offset, not per `(charset, offset)`
Worker jobs will be one alignment offset at a time. Inside the job, the worker will evaluate both ROM charsets on top of the same offset-level source analysis. This matches the recent `Standard` improvement and avoids paying for identical per-offset analysis twice.

Alternatives considered:
- Keep `(charset, offset)` jobs: simpler, but repeats analysis work and inflates job count.
- Batch many offsets per worker call: fewer messages, but worse load balancing and slower cancellation response.

### Decision: MCM is accelerated structurally before it gets new low-level kernels
`MCM` remains the most expensive mode, but its next step is still worker/off-main-thread structural acceleration, not a fresh WASM bet. The MCM global search and final screen solving should move into workers first, while preserving current legality and output behavior.

Alternatives considered:
- Add MCM WASM first: premature while MCM still pays the larger architectural/main-thread cost.
- Only optimize MCM on the main thread: misses the largest elapsed-time gain.

### Decision: Reuse the existing worker infrastructure, but generalize the protocol to be mode-aware
The current worker path should grow into a shared converter-worker architecture instead of spawning a separate one-off system for `ECM` and another for `MCM`.

Alternatives considered:
- Separate worker pools per mode: easier to hack in, but duplicates orchestration logic and complicates teardown/cancellation.
- One giant mode-agnostic worker immediately: acceptable, but the implementation can still stage ECM first and MCM second internally.

### Decision: Preserve exact output parity against the current single-threaded reference path
`ECM` and `MCM` worker paths must remain output-identical to the current serial reference path. This change is about elapsed time and responsiveness, not about loosening output rules.

Alternatives considered:
- Allow near-equal results: not acceptable for a quality-sensitive converter.

### Decision: Keep ECM/MCM timing and progress visible
The timer and progress affordances added during the Standard acceleration work should remain part of the benchmarking workflow for `ECM` and `MCM`. Console timing summaries are also in scope if they help compare runs.

Alternatives considered:
- Rely on ad hoc DevTools measurement only: workable, but slower and less repeatable.

## Risks / Trade-offs
- `MCM` worker jobs are much heavier than `Standard` jobs.
  - Mitigation: keep progress coarse, keep cancellation cooperative, and reuse the warm pool.

- Extending the worker protocol to additional modes increases orchestration complexity.
  - Mitigation: keep the protocol narrow and offset-oriented, and keep the current serial solver as a fallback.

- Sharing analysis across charsets must not accidentally leak charset-specific state.
  - Mitigation: only share source/offset analysis; keep charset-specific candidate generation and solves separate.

- Worker-backed `MCM` may still feel slow even after the move off the main thread.
  - Mitigation: this phase is explicitly structural. If `MCM` remains too slow afterward, future work can target its dominant worker-side stages with more specialized optimization.

## Migration Plan
1. Generalize the current worker/core architecture so it can run `ECM` and `MCM` jobs without changing the existing `Standard` behavior.
2. Move `ECM` to offset-level worker jobs and preserve parity against the current serial path.
3. Move `MCM` to worker-backed offset jobs and preserve parity against the current serial path.
4. Keep serial fallback paths available for unsupported browsers and worker failures.

## Open Questions
- Should `ECM` and `MCM` share the existing worker pool instance with `Standard`, or should the first implementation keep separate pools behind a common protocol?
- Should MCM progress continue to expose its existing global-search detail strings, or should the worker path collapse them into coarser status text during phase 1?

## Timing Notes
Current post-migration manual timing snapshot from the converter UI on 2026-03-07:

- `Standard`: finished in `6 seconds` using the `WASM`-backed Standard path
- `ECM`: finished in `18 seconds` using the new worker-backed JavaScript path
- `MCM`: finished in `24 seconds` using the new worker-backed JavaScript path

These notes are useful as an immediate benchmark reference, but they are not yet a full before/after comparison for `ECM` and `MCM`. That broader comparison remains open in the task checklist.
