# TRUSKI3000 Implementation Roadmap

Goal: 100% coverage of `docs/TRUSKI3000_Engine.md`.

Legal per-cell hires-versus-multicolor behavior within an MCM screen remains in scope throughout this roadmap. It is standard C64 behavior inside MCM, not forbidden cross-mode Standard/ECM/MCM mixing.

Effort: **XS** < 4h | **S** 1-2d | **M** 3-5d | **L** 1-2w | **XL** 2-4w

Last updated: 2026-03-10

---

## Phase 1 — Quick Wins ✅ COMPLETE

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1.1 | **Brightness debt accumulation** | ✅ | `BRIGHTNESS_DEBT_WEIGHT=64.0`, decay=0.6, clamp=0.18. Scanline-level error propagation |
| 1.2 | **Color coherence post-pass** | ✅ | 3 passes, `COLOR_COHERENCE_MAX_DELTA=18.0`. Re-matches outlier cells to neighbor colors |
| 1.3 | **Chroma preservation bonus** | ⚠️ Implemented, disabled | `computeHuePreservationBonus()` exists but `CHROMA_BONUS_WEIGHT=0` — needs tuning |
| 1.4 | **Typographic character exclusion** | ✅ | `isTypographicScreencode()` + `settings.includeTypographic` toggle |
| 1.5 | **Candidate pruning via distance LUT** | ✅ | `hasMinimumContrast()` with `MIN_PAIR_DIFF_RATIO=0.16` |

---

## Phase 2 — Atlas & Cell Statistics Foundation ✅ COMPLETE

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 2.1 | **Detail score (Laplacian)** | ✅ | `imageConverterCellMetrics.ts` — 8-neighbor Laplacian, normalized 0..1 |
| 2.2 | **Dominant gradient direction** | ✅ | Sobel Gx/Gy → 5 bins (isotropic, H, V, diag-R, diag-L) |
| 2.3 | **Glyph atlas tagging** | ✅ | `glyphAtlas.ts` — coverage, spatialFrequency, dominantDirection, symmetry (H/V/rotational) |
| 2.4 | **Glyph luminance profiles** | ✅ | `luminanceMean` and `luminanceVariance` Float32Arrays |

---

## Phase 3 — Perceptual Scoring Upgrades ✅ COMPLETE

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 3.1 | **CSF-weighted glyph scoring** | ✅ | `computeCsfPenalty()` — high-freq glyph in smooth cell = penalty. Unified with blend bonus via `BLEND_CSF_RELIEF=1.5` |
| 3.2 | **Edge continuity post-pass** | ✅ | 3 passes, `EDGE_CONTINUITY_MAX_DELTA=12.0`. Directional alignment bonus (`EDGE_ALIGNMENT_WEIGHT=14.0`) |
| 3.3 | **Saliency weighting in palette solve** | ✅ | ECM background-set ranking and MCM triple ranking are weighted by per-cell saliency |
| 3.4 | **ECM register re-solve** | ✅ | `runEcmRegisterResolvePass()` refines actual assignments and re-solves affected cells |

**Beyond original roadmap (added during tuning):**

| Feature | Status | Notes |
|---------|--------|-------|
| **Coverage extremity penalty** | ✅ | Coarse scorer penalizes extreme coverage × lumDistance. Steers mid-tone images to PETSCII-friendly backgrounds while protecting dark images. `COVERAGE_EXTREMITY_WEIGHT=20.0` |
| **Standalone blend match bonus** | ✅ | `BLEND_MATCH_WEIGHT=3.0` — rewards fg/bg pairs whose blend matches source color |
| **Wildcard candidate admission** | ✅ | Low-contrast candidates enter pool when within score margin (0.15) or blend quality > 0.7 |
| **Repeat penalty** | ✅ | `REPEAT_PENALTY=28.0` — screen-level character diversity, scaled by self-tile similarity |
| **Selective low-contrast handling** | ✅ | Standard keeps the normal contrast-pruned pool and admits a capped number of competitive low-contrast wildcard candidates during pool construction |

---

## Phase 4 — Output & Measurement ✅ COMPLETE

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 4.1 | **OKLAB ΔE quality metric** | ✅ | `imageConverterQualityMetrics.ts` — full suite: lumaRMSE, chromaRMSE, meanDeltaE, per-tile SSIM, p95DeltaE |
| 4.1+ | **cellSSIM metric** | ✅ | Cell-averaged SSIM at 40×25 grid with 3×3 sliding window — captures "looks right from viewing distance" |
| 4.1+ | **Test harness** | ✅ | `scripts/truski3000-harness/run.mjs` — 5 commands (compare, record, benchmark, parity, validate), visual comparison HTML, character utilization diagnostics, color pair gap analysis |
| 4.2 | **Per-cell metadata export** | ✅ | `ConversionResult.cellMetadata` now includes per-cell colors, error, detail, saliency, and MCM cell-behavior metadata |
| 4.3 | **Aspect-ratio-correct preview** | ✅ | Converter previews are displayed at a 4:3 presentation aspect in the UI |

---

## Phase 5 — WASM Performance ⚠️ PARTIAL

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 5.1 | **XOR + popcount Hamming path** | ⚠️ Implemented, disabled | `computeBinaryHammingDistancesJs()` in `imageConverterBitPacking.ts`. Disabled because set-error-matrix produces better quality (`ENABLE_EXPERIMENTAL_HAMMING_FAST_PATH=false`) |
| 5.2 | **Distance LUT in WASM linear memory** | ✅ | Host uploads `pairDiff` into WASM linear memory once per kernel instance; kernels read it directly thereafter |
| 5.3 | **Full WASM kernel buildout** | ⚠️ Partial | Narrow kernel groundwork exists (`computeSetErrs`, resident LUTs, pool/solve helpers), but ECM/MCM still rely on the older hybrid path and the Hamming fast path remains disabled |

**Status: current WASM work is groundwork, not the end state. Standard has now crossed into a WASM-first path and benchmarks at 82.10% faster than JS-only across the accepted six-fixture Standard set, but ECM/MCM still remain on the older hybrid path.**

---

## Phase 6 — WASM-First Engine Migration ⚠️ PARTIAL

The capstone: move the full conversion engine into WASM while keeping JavaScript as UI, orchestration, and result-plumbing only.

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 6.1 | **Standard full solver core in WASM** | ✅ Complete | Resident state, host API, coarse background ranking, candidate pools, iterative solve passes, refinement/post-passes, finalization, and wildcard admission now execute in WASM for Standard |
| 6.2 | **ECM/MCM full solver cores in WASM** | ❌ Missing | ECM register solving, MCM triple solving, legal hires-within-MCM behavior, and final cell solves should run in WASM |
| 6.3 | **Resident solver state in WASM memory** | ⚠️ Partial | Standard source planes, LUT data, candidate buffers, and screen buffers are resident. Equivalent ECM/MCM residency still missing |
| 6.4 | **Progress/result bridge + fallback reduction** | ⚠️ Partial | Standard progress/result plumbing is bridged through the worker/kernel boundary, but the JS fallback still remains for safety and ECM/MCM solver logic still lives outside the WASM-first path |

### Measured Standard Benchmark

Current exact benchmark on the accepted six-fixture Standard set (`--acceleration js` vs `--acceleration wasm`, 1 iteration each):

| Fixture | JS only | WASM only | Faster |
|---------|---------|-----------|--------|
| `doggy.png` | `30277.7ms` | `6022.1ms` | **80.11%** (`5.03x`) |
| `house-a.png` | `30700.7ms` | `5008.4ms` | **83.69%** (`6.13x`) |
| `ninja-a.png` | `31610.9ms` | `4827.3ms` | **84.73%** (`6.55x`) |
| `petsciishop_logo.png` | `29198.9ms` | `6488.6ms` | **77.78%** (`4.50x`) |
| `skeletor.png` | `28410.3ms` | `4640.1ms` | **83.67%** (`6.12x`) |
| `slayer_multi_color.png` | `32478.4ms` | `5720.9ms` | **82.39%** (`5.68x`) |

Weighted total:
- JS only: `182676.9ms`
- WASM only: `32707.4ms`
- Net speedup: **82.10% faster** (`5.59x`)

---

## Summary

| Phase | Status | What Changed |
|-------|--------|--------------|
| 1. Quick Wins | ✅ Complete | Brightness debt, color coherence, typographic exclusion, contrast pruning |
| 2. Foundation | ✅ Complete | Detail scores, gradient directions, full glyph atlas |
| 3. Perceptual Scoring | ✅ Complete | CSF, saliency-weighted palette solve, ECM re-solve, edge continuity, blend bonus, coverage extremity, wildcards |
| 4. Output & Measurement | ✅ Complete | Full quality metrics suite + cellSSIM + test harness + per-cell metadata export + 4:3 preview |
| 5. WASM Performance | ⚠️ ~60% | Groundwork is in place and Standard now shows a strong WASM win, but ECM/MCM still need parity/perf work and the hybrid path remains partly alive |
| 6. WASM-First Migration | ⚠️ ~55% | Standard is now fully WASM-first; ECM/MCM migration and broader fallback reduction remain |

**Current engine state: ~91% of spec implemented with all major perceptual features active. Standard is now fully WASM-first and benchmarks 82.10% faster than JS-only; remaining work is ECM/MCM quality polish plus the ECM/MCM-side WASM migration and fallback reduction.**
