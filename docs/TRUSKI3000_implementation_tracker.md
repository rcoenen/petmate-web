# TRUSKI3000 Implementation Tracker

Status key: **DONE** | **PARTIAL** | **MISSING** | **DIFFERENT** (valid alternative approach) | **NOT APPLICABLE** (excluded by strict standard C64 PETSCII constraints)

Spec reference: `docs/TRUSKI3000_Engine.md`
Standard mode: `src/utils/importers/imageConverterStandardCore.ts` (independent scoring pipeline)
ECM/MCM modes: `src/utils/importers/imageConverter.ts`

Last updated: 2026-03-10

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
| WASM kernel (computeSetErrs) | **DONE** | wasm/truskiiBinaryKernel.ts | f32x4 SIMD for error accumulation. Currently **slower than JS** on most workloads |
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
12. **Standard full solver core in WASM** — Move coarse background ranking, candidate scoring, screen solve passes, and refinement out of JS and into WASM
13. **ECM/MCM full solver cores in WASM** — Move register/triple ranking, legal hires-within-MCM solving, and final cell assignment into WASM
14. **Resident solver state in WASM memory** — Keep source planes, glyph metadata, pairDiff/LUT data, and working buffers resident in WASM instead of round-tripping per-cell state through JS
15. **Progress/result bridge + JS fallback reduction** — JS should orchestrate workers/UI only, receiving compact progress events and result buffers from WASM while fallback JS solvers are reduced over time

### Performance (Phase 5 groundwork)
16. **WASM kernel performance** — Current WASM is slower than JS; needs profiling and optimization
17. **Full parity coverage for WASM paths** — Expand parity validation from targeted cases into stable mode-wide coverage before Phase 6 migration

### Quality polish (ongoing)
18. **Chroma preservation bonus** — Implemented but disabled (weight=0); needs tuning
19. **Edge mismatch weighting** — Implemented but disabled (weight=0.0); needs color-selection fixes
20. **Advanced saliency model** — Add edge energy + center bias on top of the existing deviation-based saliency now that register selection already uses saliency weights
