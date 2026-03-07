## 1. Implementation
- [x] 1.1 Generalize the existing converter worker/core architecture so it can schedule `ECM` and `MCM` jobs without regressing `Standard`
- [x] 1.2 Extend `ECM` conversion to worker-backed offset jobs that reuse one offset analysis across both ROM charsets
- [x] 1.3 Keep a single-threaded `ECM` fallback path and verify output parity against the current reference path
- [x] 1.4 Extend `MCM` conversion to worker-backed offset jobs that reuse one offset analysis across both ROM charsets
- [x] 1.5 Keep a single-threaded `MCM` fallback path and preserve current legality, progress, and cancellation behavior
- [x] 1.6 Preserve manual rerender flow, per-output timing feedback, and coarse progress reporting for worker-backed `ECM` and `MCM` runs
- [ ] 1.7 Record before/after timing notes for `ECM` and `MCM`
- [ ] 1.8 Validate representative `ECM` and `MCM` outputs and import/preview behavior after the worker migration
