# TRUSKI3000 Implementation Tracker

CODEX: Status key: **DONE** | **PARTIAL** | **MISSING** | **DIFFERENT** (valid alternative approach) | **NOT APPLICABLE** (excluded by strict standard C64 PETSCII constraints)

Spec reference: `docs/TRUSKI3000_Engine.md`
Main implementation: `src/utils/importers/imageConverter.ts` (~2316 lines)

---

## CODEX: Current Color Fidelity Investigation (2026-03-09)

CODEX: Recent investigation on the Skeletor / True Neutral case found that a chroma-aware sample-selection fix for ECM/MCM global color search helped `ECM` modestly, but did **not** materially improve `Standard`, and did not materially improve `MCM` either.

CODEX: Current working conclusion:

CODEX: - global sample-selection bias was real and worth fixing

CODEX: - but it is **not sufficient** to solve the color-fidelity problem

CODEX: - the stronger remaining issue appears to be the local error metric still under-valuing chroma relative to luminance

CODEX: Practical implication:

CODEX: - `ECM` may now be near its realistic ceiling on some images

CODEX: - `Standard` is still the clearest evidence that color matching is wrong

CODEX: - `MCM` still appears to inherit the same gray-biased local scoring problem, plus its own mode constraints

CODEX: Next recommended experiment: raise `CHROMA_ERROR_WEIGHT` modestly (`0.85 -> 1.0 -> 1.1`) and retest Standard/MCM before doing more ECM-specific tuning.

---

## 1. Preprocessing Pipeline

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| OKLAB conversion + stay throughout | **DONE** | imageConverter.ts:48-105 | `sRGBtoOklab()`, correct matrices, never back to RGB until output |
| Per-cell mean luminance (L, a, b) | **DONE** | imageConverter.ts:530-750 | `meanL`, `meanA`, `meanB` per cell |
| Per-cell variance | **DONE** | imageConverter.ts:376 | `variances` Float64Array, cells ranked |

CODEX: Note: current ECM/MCM global color search now uses a chroma-aware importance signal rather than pure luminance-variance ranking alone, but this has only modestly improved ECM and has not materially fixed Standard/MCM color fidelity.
| Dominant gradient direction | **MISSING** | — | No per-cell directionality analysis |
| Detail score (Laplacian) | **MISSING** | — | Research doc notes USM preferred over Laplacian, neither implemented |
| Perceptual saliency mask | **PARTIAL** | imageConverter.ts:686-698 | Per-pixel deviation-from-mean weighting (`saliencyAlpha=3.0`). No face/edge/focal-point detection |
| Scale/crop cell-aware | **DONE** | imageConverter.ts:479-533 | Multi-step canvas halving, integer alignment, no partial cells |

---

## 2. Mode Selection

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Standard mode support | **DONE** | imageConverter.ts, imageConverterStandardCore.ts | Full 256-char, fg+bg per cell |
| ECM support | **DONE** | imageConverter.ts:935+, ecm.ts | 64-char subset, 4 background registers |
| MCM support | **DONE** | imageConverter.ts:963+, mcm.ts | 2bpp 4×8, 4 colors per cell |
| CODEX: Legal per-cell hires-vs-multicolor behavior within MCM | **DONE** | imageConverter.ts:1297-1346, 1889-1916 | Current MCM solver already considers binary vs multicolor cell candidates inside a legal MCM screen; this is valid standard C64 behavior, not cross-mode Standard/ECM/MCM mixing |
| CODEX: Global legal mode evaluation across Standard/ECM/MCM | **PARTIAL** | imageConverter.ts:2277-2311 | Modes can be solved and compared in one run, but the converter does not yet auto-select one best full-screen legal mode |
| CODEX: Per-region Standard/ECM/MCM mixing | **NOT APPLICABLE** | — | Out of scope for standard C64 PETSCII without raster tricks |

---

## 3. Palette Solver

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Colodore palette in OKLAB | **DONE** | c64Palettes.ts, imageConverter.ts:148 | Multiple palettes available; Colodore is default |
| 16x16 perceptual distance LUT | **DONE** | imageConverter.ts:148-172 | `pairDiff` Float64Array. In JS memory, not WASM linear memory |
| ECM: 4 bg registers via weighted k-means | **DIFFERENT** | imageConverter.ts:935, 1584-1592 | Exhaustive C(16,4)=1820 enumeration + ranking. Comprehensive but not k-means |
| MCM: shared color via weighted k-means | **DIFFERENT** | imageConverter.ts:963, 1670 | Exhaustive 16x15x14=3360 enumeration + ranking. Same approach |
| Saliency weighting in palette solve | **MISSING** | — | Saliency used per-pixel during matching, not during register selection |

---

## 4. Glyph Atlas Construction

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| 256-char PETSCII set loaded | **DONE** | imageConverter.ts:400-450 | From `system-charset.bin` ROM |
| Standard/ECM: u64 bit-packed glyphs | **PARTIAL** | imageConverter.ts:400-450 | Stored as flattened position arrays, not literal u64. Functionally equivalent |
| MCM: 2bpp 4x8 patterns | **DONE** | imageConverter.ts:420-470 | `refMcmBpCount`, `refMcmPositions` for all 4 bit-pair patterns |
| Glyph tagging (coverage) | **PARTIAL** | imageConverter.ts:449, 1017 | `refSetCount` tracks pixels-set per glyph. No normalized coverage fraction |
| Glyph tagging (spatial frequency) | **MISSING** | — | No frequency analysis |
| Glyph tagging (directionality) | **MISSING** | — | No directional bias tagging |
| Glyph tagging (symmetry) | **MISSING** | — | No symmetry metadata |
| Typographic character exclusion | **MISSING** | — | All 256 chars included by default |
| Precomputed glyph luminance profiles | **MISSING** | — | No per-glyph mean/variance for pre-filtering |

---

## 5. Cell Matching Engine (WASM Core)

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Patch extraction in OKLAB (L/ab split) | **DONE** | imageConverter.ts, imageConverterStandardCore.ts | Separate `srcL`, `srcA`, `srcB` Float32Arrays |
| Color candidate enumeration | **DONE** | imageConverter.ts | All valid fg/bg pairs generated per mode |
| Candidate pruning via distance LUT | **MISSING** | — | LUT exists but all pairs tested; no fast pruning threshold |
| Threshold map + pack to u64/u32 | **DIFFERENT** | imageConverterStandardCore.ts:543-558 | Uses per-pixel error accumulation over set-positions instead of threshold→XOR→popcount. Mathematically equivalent |
| XOR + popcount Hamming distance | **DIFFERENT** | — | Error accumulation approach; valid alternative |
| WASM SIMD (i64x2, 2 glyphs/op) | **PARTIAL** | wasm/truskiiBinaryKernel.ts | f32x4 SIMD for error accumulation (4 colors/op, not 2 glyphs/op). Currently slower than JS — only `computeSetErrs` ported |
| CSF-weighted scoring (detail penalty) | **MISSING** | — | No penalty for high-freq glyph in smooth region (needs detail score) |
| Saliency weight in scoring | **DONE** | imageConverter.ts:713 | `weights[p] * perceptualError(...)` |
| Chroma preservation bonus | **MISSING** | — | No hue-matching bonus |
| Luminance match penalty | **DONE** | imageConverter.ts:596 | `lumMatchWeight * lumDiff^2` |
| Brightness debt accumulation | **MISSING** | — | No scanline-level error propagation between cells |

---

## 6. Global Refinement Passes

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Multi-pass solver | **DONE** | imageConverter.ts:689-780 | 5 passes (`SCREEN_SOLVE_PASSES`) re-evaluating cells with neighbor context |
| Neighbor color penalty | **DONE** | imageConverter.ts:1358 | `computeNeighborPenalty()` scores edge color compatibility |
| Color coherence pass (outlier detection) | **MISSING** | — | No isolated single-cell color re-matching |
| Edge continuity pass (glyph directionality) | **MISSING** | — | Boundary diffs tracked but no directional alignment refinement |
| ECM register re-solve pass | **MISSING** | — | No k-means on actual assignments; no targeted re-match |

---

## 7. Output Layer

| Feature | Status | Location | Notes |
|---------|--------|----------|-------|
| Screen RAM + color RAM bytes | **DONE** | imageConverter.ts:227-237 | `screencodes[]`, `colors[]`, `bgIndices[]`, `ecmBgColors[]`, `mcmSharedColors[]` |
| PNG preview with VIC-II ROM bitmaps | **DONE** | imageConverter.ts:1839-1872 | `renderPreview()` / `renderMcmPreview()` at 320x200 |
| Correct C64 aspect ratio (4:3) | **MISSING** | — | Preview is raw 320x200, no PAR correction |
| CODEX: Chosen screen mode + per-cell metadata (colors, error scores) | **MISSING** | — | Root `ConversionResult.mode` exists, but no exported per-cell metadata or mode-ranking diagnostics |
| OKLAB deltaE quality metric | **MISSING** | — | `perceptualError()` used internally; no source-vs-output comparison exposed |

---

## Priority Roadmap

### High Impact (quality visible to users)

1. **Brightness debt accumulation** — scanline scalar nudging neighboring cell thresholds. Cheap to implement, reduces banding artifacts
2. **CSF-weighted glyph scoring** — requires detail score (Laplacian or similar), then penalize high-freq glyphs in smooth regions. Reduces "noise texture" in flat areas
3. **Color coherence post-pass** — detect isolated outlier cells, re-match constrained to neighbor colors. Simple algorithm, measurable cleanup
4. **Chroma preservation bonus** — bias scoring toward hue-preserving color assignments. Small change in scoring function

### Medium Impact (architectural)

5. **Glyph atlas tagging** — precompute coverage/frequency/directionality/symmetry per glyph. Enables CSF weighting and edge continuity
6. **Edge continuity post-pass** — align glyph directionality along detected edges. Requires glyph tagging first
7. **ECM register re-solve** — k-means on actual cell assignments, targeted re-match. Improves ECM quality on complex images
8. **Candidate pruning** — use distance LUT to skip perceptually-similar color pairs. Performance win on Standard mode

### Lower Priority (advanced features)

9. **CODEX: Global legal mode auto-selection** — rank Standard/ECM/MCM as full-screen legal outputs and choose the best one for export. No per-region cross-mode mixing
10. **WASM kernel buildout** — port remaining hot paths, resolve perf regression in current kernel
11. **Distance LUT in WASM memory** — move from JS Float64Array to WASM linear memory for SIMD access
12. **Advanced saliency** — edge-weighted or ML-based saliency map beyond local deviation
13. **Output quality metric** — expose OKLAB deltaE comparison (source vs rendered)
14. **CODEX: Aspect-ratio-correct preview** — present the preview at 4:3 display aspect instead of raw 320x200 square pixels
15. **CODEX: Global mode + per-cell metadata export** — chosen screen mode at result level, plus per-cell colors, error scores, and MCM cell-behavior metadata where applicable
