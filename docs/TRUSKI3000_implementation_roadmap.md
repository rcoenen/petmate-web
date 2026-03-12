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
| 6.2 | **ECM/MCM full solver cores in WASM** | ✅ Complete | ECM and MCM screen solve + refinement now run in WASM via shared kernel entrypoints. Per-cell scoring (computeSetErrs / computeMatrices), MCM coarse triple ranking, and MCM per-cell candidate-pool construction also use WASM |
| 6.3 | **Resident solver state in WASM memory** | ✅ Complete | Standard source planes/LUTs remain resident per request, and ECM/MCM now upload per-offset cell error tables once so both binary and MCM kernels read resident cell buffers by `cellIndex` instead of per-cell JS copies |
| 6.4 | **Progress/result bridge + fallback reduction** | ⚠️ Partial | ECM pool construction/finalization is parity-clean on the WASM-first path, MCM triple ranking plus per-cell candidate-pool construction are on the WASM-first path, mode workers now return compact typed result buffers plus structured progress checkpoints, the old `auto` backend selection has been removed so `js` is explicit and `wasm` no longer silently downgrades, the Image Converter modal now surfaces explicit `wasm` failures with a manual `js` fallback hint, and the harness now records effective settings plus an objective fingerprint so compare runs can classify provenance mismatches explicitly. The remaining work is fallback reduction in the remaining legacy/debug plumbing plus selecting the canonical default tuning profile |

CODEX note on ECM baselines (2026-03-11): the stored ECM `doggy` / `house-a` baselines were legacy artifacts, not the expected result of the current solver line. `doggy` quality improved in two real waves after the early harness import: first through ECM candidate-pool/indexing/contrast/cache fixes (`16a8b33`, `daf9d14`), then again through the shared ECM solve/parity refactor (`59bc36e`), which is the first commit that exactly matches the current preferred `doggy` output (`upper`, bg `[11,12,7,15]`, `qualityMeanDeltaE 0.095247`). `house-a` also improved and is visually preferred, but its bg set stayed `[9,15,0,12]`, so that gain is per-cell candidate quality rather than coarse bg-set selection. Both accepted ECM baselines were refreshed on 2026-03-11 after targeted explicit `js` vs `wasm` parity passed on those fixtures.

CODEX note on MCM `skeletor` provenance (2026-03-11): the broad explicit-backend sweep failure on `mcm/skeletor` is not a WASM regression. Current `js` and current `wasm` are parity-clean and both land on the newer `upper`, bg `11`, shared `[10,12]` result. The older accepted baseline came from an older tuning stack: restoring the pre-`c889703` profile (`brightnessFactor 1.1`, `saturationFactor 1.4`, `saliencyAlpha 3`, `lumMatchWeight 12`, `csfWeight 10`) already shifts `skeletor` back toward the older palette direction (`upper`, bg `0`, shared `[11,9]`), and restoring the pre-`c889703` scoring constants (`LUMA_ERROR_WEIGHT 1.55`, `CHROMA_ERROR_WEIGHT 0.85`, `MCM_HIRES_COLOR_PENALTY_WEIGHT 4.0`, `MCM_MULTICOLOR_USAGE_BONUS_WEIGHT 4.0`) on top of that profile reproduces the stored baseline exactly (`lower`, bg `7`, shared `[0,9]`, preview hash `d6aaff887bb8b7f6177e16fac4c05108b8cee47d9a0cce0665402db8c4803284`). Treat future `skeletor` MCM drift as settings/objective provenance first, not backend breakage.
CODEX note on compact MCM path isolation (2026-03-11): the compact MCM solve-scratch rewrite is not causing the current `skeletor` drift. Under current HEAD and `current-defaults`, a forced preview-side old WASM object-pool capture matched the compact path exactly (`previewHash e3d6f78d...`, `screencodesHash 3e6523d8...`, `colorsHash 880d4f4b...`, preview diff `0` pixels) while lowering the isolated preview capture from `31449.7ms` to `24318.4ms`. Any remaining mismatch versus the older `gate-wasm` artifact belongs to earlier current-code MCM behavior changes, not the compact path itself.
CODEX note on MCM math precompute cleanup (2026-03-11): precomputing source chroma/hue/color-demand once per sample/cell in the MCM WASM kernel and JS reference path, plus moving `foregroundsByBackground` behind the JS fallback gates, preserved the current compact-path output exactly on `skeletor` while lowering the isolated `current-defaults` WASM preview capture from `24318.4ms` to `22180.7ms` (`8.8%` faster).

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

### Measured ECM Benchmark

ECM per-combo stage breakdown (single `solveEcmForCombo` call, averaged from six-fixture set):

| Stage | JS only | WASM | Faster |
|-------|---------|------|--------|
| Coarse ranking | `~137ms` | `~133ms` | similar (uses `computeSetErrs` WASM in both) |
| Pool construction | `~1425ms` | `~1285ms` | ~10% (inner `computeSetErrs` WASM, loop JS) |
| Screen solve + refinement | `~3711ms` | `~527ms` | **85.8%** (`7.0x`) |
| **Per-combo total** | `~5355ms` | `~2052ms` | **61.7%** (`2.6x`) |

The solve phase (neighbor passes + color coherence + edge continuity) now runs entirely in WASM.
Pool construction is the remaining per-combo bottleneck; its inner scoring uses WASM but the outer loop and ScreenCandidate construction remain in JS.

### Measured MCM Benchmark

MCM per-combo stage breakdown (single `solveMcmForCombo` call, averaged from six-fixture set):

| Stage | JS only | WASM | Faster |
|-------|---------|------|--------|
| Global triple ranking | `~6500ms` | `~5800ms` | similar (MCM kernel used in both) |
| Pool construction | `~1900ms` | `~2200ms` | similar (noise) |
| Screen solve + refinement | `~2500ms` | `~440ms` | **82.4%** (`5.7x`) |
| **Per-combo total** | `~10900ms` | `~8440ms` | **22.5%** (`1.3x`) |

Note: MCM overall wall-clock benchmarks are inflated by automatic parity checking (`ENABLE_WASM_DIAGNOSTICS`),
which re-runs JS solves during the WASM path. The per-combo stage breakdown above reflects actual per-call performance.

---

## Summary

| Phase | Status | What Changed |
|-------|--------|--------------|
| 1. Quick Wins | ✅ Complete | Brightness debt, color coherence, typographic exclusion, contrast pruning |
| 2. Foundation | ✅ Complete | Detail scores, gradient directions, full glyph atlas |
| 3. Perceptual Scoring | ✅ Complete | CSF, saliency-weighted palette solve, ECM re-solve, edge continuity, blend bonus, coverage extremity, wildcards |
| 4. Output & Measurement | ✅ Complete | Full quality metrics suite + cellSSIM + test harness + per-cell metadata export + 4:3 preview |
| 5. WASM Performance | ⚠️ ~80% | All three modes (Standard, ECM, MCM) have WASM-accelerated solve phases; pool construction loops remain partly JS |
| 6. WASM-First Migration | ⚠️ ~85% | Standard is fully WASM-first; ECM/MCM now keep request and per-offset solve state resident in WASM, while pool construction optimization and broader fallback reduction remain |

**Current engine state: ~95% of spec implemented with all major perceptual features active. Standard is fully WASM-first (82.10% faster). ECM solve phase is WASM-accelerated (85.8% faster per solve, 61.7% per combo). MCM solve phase is WASM-accelerated (82.4% faster per solve, 22.5% per combo). Resident mode state now stays in WASM; pool construction optimization remains.**
