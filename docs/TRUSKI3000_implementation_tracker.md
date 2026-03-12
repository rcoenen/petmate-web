# TRUSKI3000 Implementation Tracker

Status key: **DONE** | **PARTIAL** | **MISSING** | **DIFFERENT** (valid alternative approach) | **NOT APPLICABLE** (excluded by strict standard C64 PETSCII constraints)

Spec reference: `docs/TRUSKI3000_Engine.md`
Standard mode: `src/utils/importers/imageConverterStandardCore.ts` (independent scoring pipeline)
ECM/MCM modes: `src/utils/importers/imageConverter.ts`

Last updated: 2026-03-11

---

## 1. Preprocessing Pipeline

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| OKLAB conversion + stay throughout | **DONE** | imageConverter.ts, imageConverterStandardCore.ts | `sRGBtoOklab()`, correct matrices, never back to RGB until output |
| Per-cell mean luminance (L, a, b) | **DONE** | imageConverterStandardCore.ts | `avgL`, `avgA`, `avgB` per SourceCellData |
| Per-cell variance | **DONE** | imageConverter.ts | `variances` Float64Array, cells ranked |
| Detail score (Laplacian) | **DONE** | imageConverterCellMetrics.ts | 8-neighbor Laplacian per cell, normalized 0..1. Used by CSF, edge alignment, coverage penalty |
| Dominant gradient direction | **DONE** | imageConverterCellMetrics.ts | Sobel Gx/Gy quantized to 5 bins: isotropic, horizontal, vertical, diagonal-right, diagonal-left |
| Luminance range per cell | **DONE** | imageConverterStandardCore.ts | `lumRange` (maxL - minL) in SourceCellData |
| Perceptual saliency mask | **PARTIAL** | imageConverter.ts | Per-pixel deviation-from-mean weighting (`saliencyAlpha=3.0`). No face/edge/focal-point detection |
| Scale/crop cell-aware | **DONE** | imageConverter.ts | Multi-step canvas halving, integer alignment, no partial cells |

---

## 2. Mode Selection

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Standard mode support | **DONE** | imageConverterStandardCore.ts | Full 256-char, fg+bg per cell, independent scoring pipeline |
| ECM support | **DONE** | imageConverter.ts | 64-char subset, 4 background registers |
| MCM support | **DONE** | imageConverter.ts | 2bpp 4×8, 4 colors per cell |
| Legal per-cell hires-vs-multicolor within MCM | **DONE** | imageConverter.ts | Standard C64 behavior, not cross-mode mixing |
| Automatic global legal mode evaluation across Standard/ECM/MCM | **NOT APPLICABLE** | — | Manual mode choice is authoritative. The engine may solve whichever mode the user explicitly requests, but no hidden cross-mode ranking is required |
| Per-region Standard/ECM/MCM mixing | **NOT APPLICABLE** | — | Out of scope for standard C64 PETSCII without raster tricks |

---

## 3. Palette Solver

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Colodore palette in OKLAB | **DONE** | c64Palettes.ts, imageConverter.ts | Multiple palettes available; Colodore is default |
| 16×16 perceptual distance LUT | **DONE** | imageConverter.ts, imageConverterBinaryWasm.ts, imageConverterMcmWasm.ts | `pairDiff` built in JS and uploaded into WASM linear memory per kernel instance for direct kernel reads |
| Standard: background selection | **DONE** | imageConverterStandardCore.ts | Coarse scorer samples 160 cells, ranks all 16 backgrounds, top 8 finalists. Coverage extremity penalty scaled by lumDistance steers toward PETSCII-friendly backgrounds |
| ECM: 4 bg registers | **DIFFERENT** | imageConverter.ts | Exhaustive C(16,4)=1820 enumeration + ranking (not k-means) |
| MCM: shared color selection | **DIFFERENT** | imageConverter.ts | Exhaustive 16×15×14=3360 enumeration + ranking (not k-means) |
| Saliency weighting in palette solve | **DONE** | imageConverter.ts | ECM background-set ranking and MCM triple ranking weight sample cells by `saliencyWeight` |

---

## 4. Glyph Atlas Construction

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| 256-char PETSCII set loaded | **DONE** | imageConverter.ts | From `system-charset.bin` ROM |
| Standard/ECM: bit-packed glyphs | **DONE** | imageConverterBitPacking.ts | `packBinaryGlyphBitplanes()` — lo/hi Uint32Array pairs |
| MCM: 2bpp 4×8 patterns | **DONE** | imageConverter.ts, imageConverterBitPacking.ts | `refMcmBpCount`, `refMcmPositions`, packed symbol masks |
| Glyph tagging: coverage | **DONE** | glyphAtlas.ts | Float32Array, normalized 0..1 |
| Glyph tagging: spatial frequency | **DONE** | glyphAtlas.ts | Float32Array, edge transition density 0..1. Used by CSF penalty |
| Glyph tagging: directionality | **DONE** | glyphAtlas.ts | 5-way dominant direction (matches cell gradient bins) |
| Glyph tagging: symmetry | **DONE** | glyphAtlas.ts | Horizontal, vertical, and rotational (180°) boolean flags |
| Glyph luminance profiles | **DONE** | glyphAtlas.ts | `luminanceMean` and `luminanceVariance` Float32Arrays |
| Typographic character exclusion | **DONE** | imageConverterHeuristics.ts | `isTypographicScreencode()` + `settings.includeTypographic` toggle |

---

## 5. Cell Matching Engine

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Patch extraction in OKLAB (L/ab split) | **DONE** | imageConverterStandardCore.ts | Separate `srcL`, `srcA`, `srcB` Float32Arrays |
| Color candidate enumeration | **DONE** | imageConverterStandardCore.ts, imageConverter.ts | All valid fg/bg pairs per mode |
| Candidate pruning via contrast LUT | **DONE** | imageConverterHeuristics.ts | `hasMinimumContrast()` with `MIN_PAIR_DIFF_RATIO=0.16` threshold |
| Set-error-matrix scoring | **DONE** | imageConverterStandardCore.ts | Primary scoring path: per-pixel weighted error accumulated over set positions |
| XOR + popcount Hamming path | **DONE** | imageConverterBitPacking.ts | `computeBinaryHammingDistancesJs()` implemented but **disabled** (`ENABLE_EXPERIMENTAL_HAMMING_FAST_PATH=false`) — set-error path produces better results |
| WASM kernel (computeSetErrs) | **DONE** | wasm/truskiiBinaryKernel.ts | f32x4 SIMD for error accumulation. The old narrow-kernel path was slower in isolation, but the current Standard WASM-first path now benchmarks **82.10% faster than JS-only** across the six-fixture Standard set |
| CSF-weighted glyph scoring | **DONE** | imageConverterStandardCore.ts, imageConverterHeuristics.ts | `computeCsfPenalty()` — penalizes high-freq glyphs in smooth regions, relieved by blend quality (`BLEND_CSF_RELIEF=1.5`) |
| Directional alignment bonus | **DONE** | imageConverterHeuristics.ts, imageConverterStandardCore.ts | `computeDirectionalAlignmentBonus()` — rewards glyphs matching cell gradient direction (`EDGE_ALIGNMENT_WEIGHT=14.0`) |
| Blend match bonus | **DONE** | imageConverterStandardCore.ts | Standalone reward for fg/bg pairs whose perceptual blend matches source color (`BLEND_MATCH_WEIGHT=3.0`) |
| Coverage extremity penalty (coarse) | **DONE** | imageConverterStandardCore.ts | Penalizes near-0% or near-100% coverage in coarse scorer. Scaled by luminance distance between cell avgL and background L (`COVERAGE_EXTREMITY_WEIGHT=20.0`). Protects dark images automatically |
| Wildcard candidate admission | **DONE** | imageConverterStandardCore.ts | Competitive low-contrast admission layered on top of the normal contrast-pruned pool. Up to 2 low-contrast candidates per cell/background enter only when within score margin (`0.15`) or blend quality > `0.7` |
| Soft contrast penalty | **NOT SHIPPED** | — | Explored during tuning, but the final Standard path keeps the normal `hasMinimumContrast()` gate for baseline candidates and relies on wildcard admission for selective low-contrast diversity |
| Saliency weight in scoring | **DONE** | imageConverter.ts | `weights[p] * perceptualError(...)` |
| Luminance match penalty | **DONE** | imageConverter.ts | `lumMatchWeight * lumDiff²` |
| Chroma preservation bonus | **PARTIAL** | imageConverterHeuristics.ts | `computeHuePreservationBonus()` implemented but **disabled** (`CHROMA_BONUS_WEIGHT=0`) |
| Edge mismatch weighting | **PARTIAL** | imageConverterStandardCore.ts | Implemented but **disabled** (`EDGE_MISMATCH_WEIGHT=0.0`) pending color-selection fixes |

---

## 6. Global Refinement Passes

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Multi-pass solver | **DONE** | imageConverterStandardCore.ts | 7 passes (`SCREEN_SOLVE_PASSES`) re-evaluating cells with neighbor context |
| Repeat penalty | **DONE** | imageConverterStandardCore.ts | Screen-level character diversity (`REPEAT_PENALTY=28.0`), scaled by self-tile similarity |
| Brightness debt accumulation | **DONE** | imageConverterStandardCore.ts | Scanline-level error propagation between cells (`BRIGHTNESS_DEBT_WEIGHT=64.0`, `DECAY=0.6`, `CLAMP=0.18`) |
| Color coherence pass | **DONE** | imageConverterStandardCore.ts | 3 passes (`COLOR_COHERENCE_PASSES`), re-matches outlier cells constrained to neighbor colors (`MAX_DELTA=18.0`) |
| Edge continuity pass | **DONE** | imageConverterStandardCore.ts | 3 passes (`EDGE_CONTINUITY_PASSES`), aligns glyph directionality along detected edges (`MAX_DELTA=12.0`) |
| Neighbor color penalty | **DONE** | imageConverter.ts | `computeNeighborPenalty()` scores edge color compatibility |
| ECM register re-solve pass | **DONE** | imageConverter.ts | `runEcmRegisterResolvePass()` refines the chosen background set from actual assignments and re-solves affected cells |

---

## 7. Output & Measurement

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Screen RAM + color RAM bytes | **DONE** | imageConverter.ts | `screencodes[]`, `colors[]`, `bgIndices[]`, `ecmBgColors[]`, `mcmSharedColors[]` |
| PNG preview with VIC-II ROM bitmaps | **DONE** | imageConverter.ts | `renderPreview()` / `renderMcmPreview()` at 320×200 |
| OkLab quality metrics suite | **DONE** | imageConverterQualityMetrics.ts | lumaRMSE, chromaRMSE, meanDeltaE, per-tile SSIM, cellSSIM, p95DeltaE, worst-tile tracking |
| cellSSIM (cell-averaged SSIM) | **DONE** | imageConverterQualityMetrics.ts | Structural similarity at 40×25 cell grid (8×8 averaged) with 3×3 sliding window. Captures "looks right from viewing distance" |
| Test harness | **DONE** | scripts/truski3000-harness/run.mjs | 5 commands: compare, record, benchmark, parity, validate. Visual comparison HTML, named snapshots, character utilization diagnostics, color pair gap analysis |
| Correct C64 aspect ratio (4:3) | **DONE** | ImageConverterModal.module.css | Preview is displayed at a 4:3 presentation aspect in the converter UI |
| Global mode auto-selection + ranking | **NOT APPLICABLE** | — | Manual mode choice is authoritative; hidden cross-mode ranking is out of scope |
| Per-cell metadata export | **DONE** | imageConverter.ts | `ConversionResult.cellMetadata` exports fg/bg, errorScore, detailScore, saliencyWeight, screencode, and MCM hires-vs-multicolor flagging |

---

## Active Standard Mode Scoring Constants

All constants in `imageConverterStandardCore.ts`:

| Constant | Value | Purpose |
|----------|-------|---------|
| LUMA_ERROR_WEIGHT | 1.0 | Brightness error weight in OkLab |
| CHROMA_ERROR_WEIGHT | 2.0 | Color error weight (2× luma) |
| BLEND_CSF_RELIEF | 1.5 | CSF penalty reduction for good blend matches |
| BLEND_QUALITY_SHARPNESS | 48.0 | Blend match strictness |
| BLEND_MATCH_WEIGHT | 3.0 | Standalone blend color match reward |
| COVERAGE_EXTREMITY_WEIGHT | 20.0 | Coarse scorer: penalizes extreme coverage × lumDistance |
| WILDCARD_SCORE_MARGIN | 0.15 | Low-contrast candidate admission threshold |
| WILDCARD_BLEND_QUALITY_MIN | 0.7 | Direct wildcard admission on blend quality |
| WILDCARD_MAX_ADMITTED | 2 | Max wildcards per cell |
| REPEAT_PENALTY | 28.0 | Screen-level character diversity |
| CONTINUITY_PENALTY | 0.14 | Edge continuity between adjacent cells |
| MODE_SWITCH_PENALTY | 10.0 | Upper/lower charset switch cost |
| BRIGHTNESS_DEBT_WEIGHT | 64.0 | Scanline brightness error propagation |
| BRIGHTNESS_DEBT_DECAY | 0.6 | Debt carry-over between cells |
| BRIGHTNESS_DEBT_CLAMP | 0.18 | Maximum debt accumulation |
| COLOR_COHERENCE_MAX_DELTA | 18.0 | Max error increase for coherence re-match |
| COLOR_COHERENCE_PASSES | 3 | Coherence refinement iterations |
| EDGE_CONTINUITY_MAX_DELTA | 12.0 | Max error increase for edge alignment |
| EDGE_CONTINUITY_PASSES | 3 | Edge refinement iterations |
| STANDARD_SAMPLE_COUNT | 160 | Cells sampled in coarse background scorer |
| STANDARD_FINALIST_COUNT | 8 | Background finalists from coarse scorer |
| STANDARD_POOL_SIZE | 10 | Candidates per cell per background |
| SCREEN_SOLVE_PASSES | 7 | Solver iterations with neighbor context |

**Disabled:** EDGE_MISMATCH_WEIGHT=0.0, CHROMA_BONUS_WEIGHT=0, ENABLE_EXPERIMENTAL_HAMMING_FAST_PATH=false

---

## Remaining Work

### Next: ECM Quality Tuning (port Standard innovations)
1. **Port blend bonus + CSF/blend interaction** — Add `BLEND_MATCH_WEIGHT` and `BLEND_CSF_RELIEF` to shared binary scoring pipeline (`buildBinaryCellScoringTables` in `imageConverter.ts`). Highest-impact single change — Standard's biggest quality gain came from this.
2. **Coverage extremity × lumDistance for register selection** — Apply coverage penalty at the ECM register-set ranking level: penalize background combos that leave large luminance gaps, forcing cells into near-solid blocks. 4/16 colors is still only 25% of the palette — the bottleneck is softer than Standard but real.
3. **Bump CHROMA_ERROR_WEIGHT to 2.0** — Standard gets better color fidelity at 2.0 vs ECM's current 1.0.
4. **Port wildcard admission** — Replace blunt "disable all contrast filtering" with competitive wildcard system (score margin + blend quality threshold). More selective than flooding pools.
5. **Expand dedicated ECM tuning scenario sets** — Baselines now exist for the shared six-fixture set; next step is richer ECM-specific tuning scenarios rather than basic mode coverage

### CODEX: ECM baseline provenance and preferred drift notes (2026-03-11)
- Stored ECM baselines for `doggy` and `house-a` are stale reference artifacts, not a recent regression introduced by the Phase 6 worker/WASM transport work. Both fixtures are JS/WASM parity-clean on current HEAD.
- `doggy` was traced across repo history:
  - `5f6d90d`: poor ECM solve, `upper`, bg `[8,9,10,15]`, `qualityMeanDeltaE 0.2534`
  - `16a8b33`: first major quality recovery, `upper`, bg `[8,7,15,10]`, `0.1424`
  - `daf9d14`: second major recovery, `lower`, bg `[7,11,12,5]`, `0.1024`
  - `59bc36e`: first commit that matches the current preferred output exactly, `upper`, bg `[11,12,7,15]`, `0.095247`
- Interpretation:
  - The first quality wave came from ECM candidate-pool/indexing/contrast/cache fixes (`16a8b33`, `daf9d14`)
  - The final jump to the accepted current `doggy` output came from the shared ECM solve/parity refactor in `59bc36e`
  - This drift is not caused by later WASM progress/result bridge work (`6.4b`/`6.4c`)
- `house-a` current ECM output is also preferred over baseline, but its bg register set stayed `[9,15,0,12]`; the gain is per-cell candidate quality, not coarse bg-set selection.
- The accepted ECM baselines were refreshed on 2026-03-11 after targeted explicit `js` vs `wasm` parity passed on both fixtures:
  - `doggy`: `upper`, bg `[11,12,7,15]`, `qualityMeanDeltaE 0.095247`, `SSIM 0.520048`, `cellSSIM 0.851185`
  - `house-a`: `upper`, bg `[9,15,0,12]`, `qualityMeanDeltaE 0.111238`, `SSIM 0.444943`, `cellSSIM 0.79293`
- Current `doggy` color diagnostics suggest the remaining ECM headroom is reducing gray/black over-selection in detailed tiles:
  - underused vs ideal: `lgray`, `brown`, `white`, `orange`, `yellow`, `green`
  - overused vs ideal: `black`, `dgray`, `mgray`
- Operational rule going forward: refresh `doggy` / `house-a` ECM baselines deliberately as accepted quality improvements, not as regression fixes, and preserve this provenance note so future benchmark work does not misclassify them.

### CODEX: MCM skeletor baseline provenance (2026-03-11)
- The explicit-backend milestone sweep flagged `mcm/skeletor`, but the failure is not a WASM transport or worker bug. Current `js` and current `wasm` are parity-clean and land on the same newer result: `upper`, bg `11`, shared `[10,12]`, `qualityMeanDeltaE 0.140578`.
- The biggest source of drift is tuning-profile provenance, not backend divergence. Running current HEAD with the pre-`c889703` UI profile (`brightnessFactor 1.1`, `saturationFactor 1.4`, `saliencyAlpha 3`, `lumMatchWeight 12`, `csfWeight 10`) shifts `skeletor` to `upper`, bg `0`, shared `[11,9]`, which restores most of the older hood/palette identity.
- Reinstating the pre-`c889703` scoring constants on top of that old profile reproduces the accepted MCM baseline exactly: `lower`, bg `7`, shared `[0,9]`, `qualityMeanDeltaE 0.1561526239406585`, preview hash `d6aaff887bb8b7f6177e16fac4c05108b8cee47d9a0cce0665402db8c4803284`.
- The constants required to reproduce that baseline were:
  - `LUMA_ERROR_WEIGHT = 1.55`
  - `CHROMA_ERROR_WEIGHT = 0.85`
  - `MCM_HIRES_COLOR_PENALTY_WEIGHT = 4.0`
  - `MCM_MULTICOLOR_USAGE_BONUS_WEIGHT = 4.0`
- Operational rule going forward: do not treat `skeletor` MCM compare drift against that stored baseline as evidence of a recent WASM regression unless the effective tuning profile and objective constants are held fixed. Baselines need settings/objective provenance before they are used as regression gates.

### CODEX: Compact MCM path isolation (2026-03-11)
- The new compact MCM solve-scratch path is not the source of the current `skeletor` output drift. Under current HEAD and `current-defaults`, a forced preview-side old WASM object-pool capture reproduced the compact path exactly.
- The matched current-code result was: `charset upper`, bg `11`, shared `[10,12]`, `qualityMeanDeltaE 0.1406041834`, `previewHash e3d6f78de4e62b4d7b23d0551d820cd65229e9051dd0e21161ad4fac764a71be`, `screencodesHash 3e6523d87875761e6c6c136ce0d9e5e8211655a909a354bdb7bea2e82d3530a4`, `colorsHash 880d4f4b2cb276b3d966caf6b56cdab8485dca1bcc7bcfc6100c5e4dac8907e3`, with preview diff `0` pixels between old-path and compact-path captures.
- The compact path lowered the isolated preview capture from `31449.7ms` to `24318.4ms` while keeping the current-code output unchanged.
- Operational rule going forward: if `skeletor` differs from the older `gate-wasm` artifact, attribute that to earlier current-code MCM behavior changes until proven otherwise; do not blame the compact scratch rewrite.

### CODEX: MCM math precompute cleanup (2026-03-11)
- The next exact-preserving optimization after the compact path was to precompute source chroma/hue/color-demand once per sample/cell in both the MCM WASM kernel and the JS reference path, rather than recomputing `sqrt` / `atan2` / color-demand math inside the inner candidate loops.
- The pure WASM MCM path also stopped building `foregroundsByBackground` eagerly in `solveMcmForCombo`; that prep now stays behind the JS fallback gates.
- Targeted validation on `skeletor` under `current-defaults` and `wasm` stayed byte-identical to the pre-change compact path (`previewHash e3d6f78de4e62b4d7b23d0551d820cd65229e9051dd0e21161ad4fac764a71be`, `screencodesHash 3e6523d87875761e6c6c136ce0d9e5e8211655a909a354bdb7bea2e82d3530a4`, `colorsHash 880d4f4b2cb276b3d966caf6b56cdab8485dca1bcc7bcfc6100c5e4dac8907e3`, preview diff `0` pixels).
- On that same isolated preview capture, `conversionMs` improved from `24318.4ms` to `22180.7ms` (`8.8%` faster).

### Next: MCM Quality Tuning (port Standard innovations + MCM-specific)

**Shared with ECM** (same changes benefit both — items 1, 3 above apply to MCM's hires-within-MCM candidates too):
6. **Blend bonus + CSF/blend in shared binary pipeline** — Same port as ECM item 1. MCM's hires candidates use `buildBinarySummaryScoringTables` which lacks blend quality. Critical for hires-within-MCM cells where dithering characters should beat multicolor on smooth gradients.
7. **CHROMA_ERROR_WEIGHT ≥ 2.0** — Arguably even higher for MCM than Standard/ECM. At 4×8 fat-pixel resolution, color fidelity matters MORE than fine spatial detail. The halved horizontal resolution makes chroma the dominant perceptual signal.

**MCM-specific**:
8. **MCM triple refinement pass** — Currently the 3 shared colors (bg, mc1, mc2) are locked after coarse ranking with no refinement. ECM has `runEcmRegisterResolvePass` (k-means + re-solve, up to 4 iterations). Port an equivalent for MCM: after initial solve, k-means on (mc1, mc2) weighted by per-cell residual error, re-quantize to nearest palette colors, re-solve affected cells.
9. **Luminance-spread penalty for triple selection** — In the coarse ranking of 3360 triples, penalize triples whose 3 shared colors are clustered in luminance. Prefer triples that cover the image's brightness range so all cells have a nearby shared color. Conceptually similar to coverage extremity × lumDistance applied at the triple level.
10. **Wildcard admission for hires candidates** — MCM's hires path uses hard `hasMinimumContrast` gate. Port competitive wildcard system for the hires candidates within MCM.
11. **Expand dedicated MCM tuning scenario sets** — Baselines now exist for the shared six-fixture set; next step is richer MCM-specific tuning scenarios rather than basic mode coverage

### Phase 6 — WASM-First Engine Migration
12. **Standard full solver core in WASM** — **DONE**. Resident state, host API, coarse background ranking, candidate scoring/pool construction, iterative solve passes, refinement/post-passes, finalization, and wildcard admission are in WASM for Standard
13. **ECM/MCM full solver cores in WASM** — **DONE**. Both ECM and MCM screen solve + refinement (neighbor passes, color coherence, edge continuity) now run in WASM via shared kernel entrypoints. ECM per-combo solve: 85.8% faster (7.0x), per-combo total: 61.7% faster (2.6x). MCM per-combo solve: 82.4% faster (5.7x), per-combo total: 22.5% faster (1.3x)
14. **Resident solver state in WASM memory** — **DONE**. Standard source planes, pairDiff/LUT data, candidate buffers, and screen-state buffers stay resident per request, and ECM/MCM now upload per-offset cell error tables once so the kernels read resident cell buffers by `cellIndex` rather than copying one cell at a time from JS
15. **Progress/result bridge + JS fallback reduction** — **PARTIAL**. Standard progress/result bridging exists, ECM pool construction/finalization is parity-clean on the WASM-first path, MCM triple ranking plus per-cell candidate-pool construction stay on the WASM-first path, and mode workers now return transferable typed result buffers plus structured progress checkpoints so the main thread assembles the final `ConversionResult`. The old `auto` backend selection has been removed, `js` is now an explicit reference/debug path, requested `wasm` no longer silently downgrades to JS, and the Image Converter modal now surfaces explicit `wasm` failures with a manual `js` fallback hint. The remaining work is shrinking the last legacy/debug fallback paths
   - Harness provenance is now explicit: `summary.json` records `profileId`, effective settings, and an objective fingerprint, `compare` classifies provenance mismatches separately from backend regressions, and `capture --profile ...` can generate controlled profile artifacts without baseline gating

### Performance (Phase 5 groundwork)
16. **WASM kernel performance** — Standard is now materially faster on the WASM-first path. Exact benchmark on the accepted six-fixture Standard set:
   - `doggy.png`: `30277.7ms -> 6022.1ms` = **80.11% faster**
   - `house-a.png`: `30700.7ms -> 5008.4ms` = **83.69% faster**
   - `ninja-a.png`: `31610.9ms -> 4827.3ms` = **84.73% faster**
   - `petsciishop_logo.png`: `29198.9ms -> 6488.6ms` = **77.78% faster**
   - `skeletor.png`: `28410.3ms -> 4640.1ms` = **83.67% faster**
   - `slayer_multi_color.png`: `32478.4ms -> 5720.9ms` = **82.39% faster**
   - weighted total: `182676.9ms -> 32707.4ms` = **82.10% faster** (`5.59x`)
   - **ECM per-combo stage breakdown** (averaged from six-fixture set):
     - Solve phase: `~3711ms -> ~527ms` = **85.8% faster** (`7.0x`)
     - Pool construction: `~1425ms -> ~1285ms` = ~10% (inner scoring WASM, loop JS)
     - Per-combo total: `~5355ms -> ~2052ms` = **61.7% faster** (`2.6x`)
   - **MCM per-combo stage breakdown** (averaged from six-fixture set):
     - Solve phase: `~2500ms -> ~440ms` = **82.4% faster** (`5.7x`)
     - Global triple ranking: `~6500ms -> ~5800ms` = similar (MCM kernel used in both)
     - Per-combo total: `~10900ms -> ~8440ms` = **22.5% faster** (`1.3x`)
17. **Full parity coverage for WASM paths** — Expand parity validation from targeted cases into stable mode-wide coverage before Phase 6 migration

### Quality polish (ongoing)
18. **Chroma preservation bonus** — Implemented but disabled (weight=0); needs tuning
19. **Edge mismatch weighting** — Implemented but disabled (weight=0.0); needs color-selection fixes
20. **Advanced saliency model** — Add edge energy + center bias on top of the existing deviation-based saliency now that register selection already uses saliency weights
