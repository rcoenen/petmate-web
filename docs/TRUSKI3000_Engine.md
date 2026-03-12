# TRUSKI3000 Engine

TRUSKI3000 grew out of a simple obsession: how good can a PETSCII image converter actually get if you keep pushing it?

The engine is an attempt to build the best PETSCII generator we can make for the real Commodore 64 constraint space. That means respecting the machine as it actually works: a fixed 40x25 character grid, a 16-color palette with uneven perceptual spacing, strict VIC-II mode rules, shared global colors, and constant tradeoffs between structure, contrast, texture, and color identity. The output is real screen RAM and color RAM, ready to load on hardware or in an emulator.

Getting there takes more than one trick. TRUSKI3000 pulls together a lot of useful knowledge that usually lives in separate worlds: C64 graphics practice, PETSCII character behavior, perceptual color theory, luminance structure, saliency, glyph statistics, screen-level refinement, and brute-force search. All color matching happens in OKLAB perceptual color space, glyph scoring is weighted by contrast sensitivity and screen context, and the hot path now runs in a WASM-first core so deeper search and refinement stay practical in the browser.

The result is an engine that treats bitmap-to-PETSCII conversion as a serious optimization problem with artistic consequences. The goal is simple: keep closing the gap between what the medium allows and what the converter can actually discover.

### Pipeline at a Glance

1. **Preprocessing** — Source image is converted to OKLAB color space and divided into 8×8 cell regions. Per-cell statistics are computed: mean luminance, variance, gradient direction, detail score (via Laplacian), and a perceptual saliency mask that tells the engine where the eye will look hardest.

2. **Selected Legal Mode Setup** — The converter executes the explicitly requested VIC-II mode as one legal full-screen PETSCII output. Standard, ECM, and MCM are alternative full-screen solves, and cross-mode mixing is out of scope for final export. If multiple modes are requested for comparison, each mode is rendered independently rather than auto-ranked or auto-selected.

3. **Palette Solving** — Colodore's measured C64 palette is loaded and converted to OKLAB (Colodore models the full PAL analog signal chain including VIC-II luma levels, making it the most accurate reference available; Pepto's palette is supported as a fallback). For ECM, the four global background registers are solved via weighted k-means driven by the saliency map. For MCM, the shared color register is solved similarly. A full 16×16 perceptual distance lookup table is precomputed for use throughout matching.

4. **Glyph Atlas Construction** — The PETSCII character set is curated and tagged by coverage, spatial frequency, directionality, and symmetry. Typographic characters are excluded by default. Glyphs are packed as `u64` bitmaps (Standard/ECM) or `u32` 2bpp patterns (MCM) for single-instruction comparison in the WASM core.

5. **Cell Matching** — The WASM core loop. For each cell: extract the source patch, generate pruned color candidates using the perceptual distance LUT, then for each candidate compute a threshold map, pack it, and XOR + popcount against every glyph in the atlas. Scoring is weighted by a contrast sensitivity function (penalising high-frequency glyphs in smooth regions), the saliency map, and a chroma preservation bonus. A lightweight brightness debt accumulator nudges neighboring cells — not Floyd-Steinberg, just a scalar correction that works in character-cell space.

6. **Global Refinement** — Three post-passes clean up the greedy result. A color coherence pass eliminates isolated single-cell color outliers. An edge continuity pass aligns glyph directionality along detected edges. An ECM register re-solve pass re-runs k-means on actual assignments and re-matches affected cells.

7. **Output** — Raw screen RAM + color RAM bytes for real hardware, a pixel-accurate PNG preview at correct C64 aspect ratio, per-cell metadata and error scores, and a measurable OKLAB ΔE quality metric.

---

## VIC-II Color Modes: A Primer

The Commodore 64's VIC-II video chip renders its 320×200 screen as a 40×25 grid of 8×8 character cells. Every cell references a glyph from a character ROM (or custom charset) and is assigned color attributes. The chip supports three distinct character modes, each imposing different constraints on resolution, color depth, and memory layout. These aren't just palette choices — they fundamentally change the geometry of the matching problem.

### Standard Character Mode (Hires)

The default and highest-resolution text/graphics mode. Each cell is a full 8×8 pixel grid where every pixel is either foreground or background — a 1-bit bitmap per cell.

- **Resolution**: 320×200 (8×8 per cell, 40×25 cells)
- **Colors per cell**: 2 — one foreground color (from 16) stored in color RAM, one background color from a single global register (`$D021`)
- **Character set**: full 256 characters available
- **Memory**: 1 byte screen RAM (character index) + 1 nybble color RAM (fg color) per cell

The constraint is stark: two colors per cell, period. If your source image has three distinct colors within any 8×8 region, you're forced to quantize. The upside is full horizontal resolution and access to the entire glyph set, making this the best mode for rendering fine detail, sharp edges, and line art.

### Extended Color Mode (ECM)

ECM trades character set size for background color flexibility. The top two bits of the character index byte are repurposed as a selector into four global background color registers (`$D021`–`$D024`), leaving only 6 bits for the character index itself.

- **Resolution**: 320×200 (still 8×8 per cell)
- **Colors per cell**: 2 — one foreground color (from 16) plus one of four global background colors selected per cell
- **Character set**: only 64 characters available (indices 0–63)
- **Memory**: same layout as Standard, but character index is effectively 6-bit

The reduced glyph set is a serious limitation for image conversion — you lose 75% of your matching candidates. But the four switchable backgrounds are powerful when an image has a small number of dominant background tones (sky/ground, light/shadow). The engine must solve which four palette entries to assign to the background registers to minimise total error across all cells — a global optimization problem that Standard mode doesn't have.

### Multicolor Character Mode (MCM)

MCM doubles the color depth at the cost of horizontal resolution. Pixels are grouped into horizontal pairs, so each cell is effectively a 4×8 grid of "fat pixels", each of which can be one of four colors.

- **Resolution**: 160×200 effective (4×8 per cell, 40×25 cells — each multicolor pixel is 2 screen pixels wide)
- **Colors per cell**: 4 — global background (`$D021`), a shared "extra" color from `$D022`, and two per-cell colors stored in color RAM and screen RAM
- **Character set**: full 256 characters, but glyph bitmaps are interpreted as 2-bit-per-pixel patterns
- **Memory**: screen RAM high nybble = one per-cell color, color RAM = second per-cell color, character index in low 8 bits

The 2bpp encoding means each pair of bits in the glyph bitmap selects one of the four available colors: `00` = background, `01` = shared extra color, `10` = screen RAM color, `11` = color RAM color. This gives much richer color per cell but the halved horizontal resolution makes fine detail mushy. MCM is the go-to for photographic or painterly content where color fidelity matters more than edge sharpness.

Within a legal MCM screen, per-cell hires-versus-multicolor behavior is still a valid standard C64 technique: when the screen is globally in MCM and bit 3 of color RAM is clear for a cell, the VIC-II renders that cell in hires mode (2 colors, full 8x8 resolution) even though the screen remains an MCM screen. The tradeoff is that hires-like MCM cells keep full horizontal resolution but their foreground color is restricted to palette entries 0-7 because only color RAM bits 0-2 are available. This is not cross-mode mixing; it is part of how MCM works.

### Why Mode Choice Matters for Conversion

No single mode is optimal for all images. A portrait might score best in MCM because color richness matters more than fine detail. A line-art drawing might score best in Standard mode. A landscape with a few dominant background tones might score best in ECM.

TRUSKI3000 treats Standard, ECM, and MCM as alternative legal full-screen outputs. The user chooses which mode to render. If the editor wants to compare multiple modes, it must request and render those modes explicitly.

---

## 1. Preprocessing Pipeline

Before any character matching happens, the source bitmap goes through perceptual preparation:

- **Convert to OKLAB immediately and stay there throughout** — never go back to RGB until final output
- **Build a local image statistics map**: per-cell mean luminance, variance, dominant gradient direction, and a "detail score" derived from a Laplacian. This map drives decisions downstream
- **Compute a perceptual saliency mask** — humans don't perceive all regions equally, so error in a high-saliency region (faces, edges, focal points) should be weighted more heavily than flat backgrounds
- **Scale/crop aware of cell boundaries** — no partial cells, ever

---

## 2. Mode Support Layer

TRUSKI3000 treats the three modes as alternative full-screen legal outputs and never mixes Standard, ECM, and MCM within one final export.

### Standard Mode

- Full 8×8 glyph resolution, all 256 characters
- Fg + bg chosen per cell from full 16-color palette
- Best for high-detail regions and sharp edges

### ECM — Extended Color Mode

- 8×8 glyphs but only 64 usable character indices
- Four global background color registers shared across all ECM cells
- The engine must solve which 4 background colors to assign globally to minimise total error — a **k-means clustering problem** run on the bg color needs of all cells simultaneously
- Best for images with a few dominant background tones

### MCM — Multicolor Mode

- Horizontal resolution halved — effective 4×8 cells with 2bpp encoding
- Four colors per cell: global bg, shared extra color, two per-cell colors
- Glyph atlas interpreted as 2bpp patterns, matched against 4×8 effective geometry
- Best for colorful regions where detail matters less than color richness

### User-Selected Mode Execution

The engine solves the legal full-screen mode the user explicitly requested. If multiple modes are requested for comparison, each mode is solved independently. Within a chosen MCM screen, legal per-cell hires-versus-multicolor behavior may still be evaluated as part of the solver, but Standard, ECM, and MCM are not mixed inside one export.

---

## 3. Palette Solver

Run once before glyph matching, informs everything downstream.

- Load **Colodore's measured C64 palette values** — derived from the full PAL analog signal chain including VIC-II luma output characteristics, the most accurate RGB reference available — and convert to OKLAB. Pepto's palette supported as an alternative.
- **Build a perceptual distance LUT** for all 16×16 color pairs in OKLAB — used constantly during glyph matching, precomputed once in WASM linear memory

### Standard Mode: Coverage-Aware Background Selection

Standard mode has the hardest constraint: a single global background color (`$D021`) shared by all 1000 cells. Choosing poorly here is catastrophic — if the background is far from the image's dominant brightness, every cell is forced into near-solid blocks (90-100% foreground coverage) just to compensate, killing all character diversity.

TRUSKI3000 solves this with a **coverage extremity penalty scaled by luminance distance**. The coarse background scorer samples cells across the image and, for each candidate background color, penalizes character choices that require extreme coverage (near 0% or 100% of pixels set). The penalty is proportional to the **luminance distance** between the cell's average brightness and the background color in OkLab:

```
covPenalty = COVERAGE_EXTREMITY_WEIGHT × |cellAvgL − bgL| × (2 × coverageRatio − 1)²
```

The key insight is that luminance distance is self-calibrating:
- **Dark images** (e.g. a ninja on a black background): cells have low average luminance, so `|cellAvgL − bgL|` is small for bg=black → near-zero penalty → bg=0 wins correctly
- **Mid-tone images** (e.g. a brown dog on green grass): cells have medium luminance, so `|cellAvgL − bgL|` is large for bg=black → strong penalty → solver picks a mid-tone background that enables 50% coverage characters, unlocking edge-tracing glyphs and PETSCII texture

This penalty applies **only in the coarse background scorer** (which selects the top finalist backgrounds), not in per-cell solving — once a good background is chosen, the per-cell solver is free to find the best character without artificial constraints.

This technique is specific to Standard mode's single-background constraint. ECM and MCM have per-cell background flexibility (4 registers or 4 colors per cell), so the "forced into solid blocks" problem largely doesn't arise.

### ECM and MCM Register Solving

- **ECM**: solve the 4 global background registers using weighted k-means where weights come from the saliency map — background color error in a salient region costs more
- **MCM**: solve the shared color register similarly

---

## 4. Glyph Atlas Construction

The matching corpus is **curated**, not the raw 256 PETSCII characters.

Each glyph is tagged by:

- **Coverage**: fraction of pixels set
- **Dominant frequency**: smooth vs detailed
- **Directionality**: horizontal bias, vertical bias, diagonal, isotropic
- **Symmetry**

Storage:

- **Standard/ECM**: 256 glyphs × 64 bits each, stored as packed `u64` in WASM memory
- **MCM**: separate atlas of 2bpp 4×8 patterns, packed as `u32`

Purely typographic glyphs are excluded from image-matching search by default (configurable — some PETSCII work intentionally uses letters).

Precompute **glyph luminance profiles**: mean and variance of each glyph's pixel pattern, used for fast pre-filtering before full Hamming search.

---

## 5. Cell Matching Engine (WASM Core)

For each cell, in order:

### 5.1 Patch Extraction

Extract the 8×8 (or 4×8 for MCM) source region in OKLAB. Separate L (luminance) and ab (chroma) channels — they're handled differently.

### 5.2 Color Candidate Generation

- **Standard**: enumerate valid (fg, bg) pairs from the 16-color palette. Use the precomputed perceptual distance LUT to prune pairs where both colors are perceptually similar (won't produce useful contrast). Typically reduces from 256 pairs to ~40–60 viable ones.
- **ECM**: fg from 16 colors, bg constrained to whichever of the 4 global registers is assigned. Fewer candidates but the global register solve must already be done.
- **MCM**: 4-color combinations from (global bg, shared color, 2 per-cell colors). Search space is larger per cell but pruned aggressively by clustering the source patch to its dominant colors first.

### 5.3 Per-Color-Pair Glyph Search

For each viable color combination:

1. Compute a **threshold map** for the cell: given the candidate colors, for each pixel in the patch, which color is closest in OKLAB? This gives a target bit pattern (1-bit for Standard/ECM, 2-bit for MCM)
2. Pack that pattern into a `u64` (Standard/ECM) or `u32` (MCM)
3. XOR against all glyph entries and `popcount` — this is Hamming distance in one CPU instruction per candidate
4. With WASM SIMD: process 2 glyphs simultaneously with `i64x2`, so 128 iterations covers the full Standard atlas
5. Track the minimum-error (glyph, color assignment) tuple

### 5.4 CSF-Weighted Error Scoring

Raw Hamming distance isn't the final score. Weight it by:

- **Detail score**: high-frequency glyph in a smooth source region gets penalized — the eye sees glyph texture as noise
- **Saliency weight**: errors in salient regions cost more
- **Chroma preservation bonus**: if the color assignment preserves the dominant hue of the source patch, score it better. Humans are more tolerant of luminance error than hue error

### 5.5 Brightness Debt Accumulation

Not Floyd-Steinberg — error diffusion doesn't translate to character-cell space. Instead, a simple scalar: how much brighter or darker was the best match versus the source patch mean? Accumulate across cells in a scanline buffer and nudge the threshold for neighboring cells. Horizontal and vertical debt tracked separately. Coarse, cheap, effective.

---

## 6. Post-Matching Optimization Passes

After the initial per-cell greedy match, TRUSKI3000 runs global refinement:

### 6.1 Color Coherence Pass

Scan for isolated single cells with a unique color that doesn't appear in any neighbor. These are almost always wrong — the eye reads them as noise. Re-match those cells under the constraint that at least one of their colors must appear in an adjacent cell. Accept the re-match if error increase is below a threshold.

### 6.2 Edge Continuity Pass

The detail score map identifies strong edges in the source. Check that glyph selections along detected edges have compatible directionality — a diagonal edge should be rendered with diagonal-biased glyphs, not a random mix. Re-score candidates with a directional alignment bonus and re-assign if it improves coherence without significantly increasing pixel error.

### 6.3 ECM Background Register Re-solve

After initial matching, the assigned background colors may not optimally use all 4 ECM registers. Re-run k-means on the actual assigned bg colors, reassign registers, and do a targeted re-match pass on cells whose bg color changed. One or two iterations is enough.

---

## 7. Output Layer

- **Screen data**: raw PETSCII screen RAM + color RAM bytes — valid for direct loading onto real hardware or emulator
- **Preview**: PNG rendered using actual VIC-II character ROM bitmaps and displayed at a 4:3 presentation aspect rather than as raw 320x200 square pixels
- **Metadata**: chosen screen mode, per-cell color assignments, and error scores — useful for debugging and iterative tuning
- **Quality metrics**: a suite of perceptual measurements comparing rendered output against the source, all computed in OkLab color space

### Quality Metrics Suite

Standard image quality metrics (SSIM, PSNR) evaluate pixel-level fidelity — appropriate for photographic compression where every pixel is independently placed. But PETSCII is a **mosaic medium**: the unit of artistic expression is the 8×8 character cell, not the individual pixel. Within a cell, the pixel pattern is constrained to a fixed glyph from a 256-character set. Pixel-level SSIM penalizes within-cell character patterns that don't match source pixels, but from viewing distance those patterns ARE the art.

TRUSKI3000 computes both traditional and PETSCII-specific metrics:

**Per-pixel metrics** (traditional):
- **lumaRMSE** — L channel RMSE, brightness fidelity
- **chromaRMSE** — chroma channel RMSE in OkLab, color preservation
- **meanDeltaE** — mean OkLab Euclidean distance per pixel, overall perceptual error
- **ssim** — structural similarity on L channel (per 8×8 tile, averaged)
- **p95DeltaE** — 95th percentile tile ΔE, captures worst-case quality

**Cell-level metrics** (PETSCII-specific):
- **cellSSIM** — structural similarity computed on a **40×25 cell-averaged luminance grid**. Each 8×8 cell is reduced to its mean luminance, then SSIM is evaluated over this coarser grid using a 3×3 sliding window. This captures whether the overall brightness layout "looks right from viewing distance" without being penalized by within-cell glyph pixel patterns. A high cellSSIM with a lower pixel SSIM means the converter chose characters that create the right impression at the scale PETSCII art is actually viewed — even if individual pixels don't match the source.

cellSSIM is **mode-agnostic** — it works identically for Standard, ECM, and MCM since all three produce the same 40×25 cell grid. This makes it the primary metric for comparing conversion quality across modes.

---

## 8. Systematic Testing and Engine Tuning

TRUSKI3000's scoring pipeline has many interacting parameters (error weights, penalty strengths, admission thresholds). Tuning these by eye is unreliable — a change that improves one image can regress another. The engine uses a systematic harness-driven approach:

### Test Harness

A headless browser harness (`scripts/truski3000-harness/`) converts a manifest of fixture images under controlled settings and records per-image quality metrics. The harness supports:

- **Baseline recording and comparison** — save known-good output, then measure deltas after any code change
- **Visual side-by-side HTML** — source, baseline, and latest renders with metric delta tables
- **Normalized delta display** — all metrics presented as "higher = better" with color coding (green = improvement, red = regression), so scanning results is instant
- **Character utilization diagnostics** — unique character count, usage distribution, detail-split analysis
- **Color pair gap analysis** — ideal vs chosen color pairs per cell, identifying where the scorer compromises

### Parameter Sweep Methodology

When tuning a constant (e.g. `COVERAGE_EXTREMITY_WEIGHT`), the approach is:

1. **Sweep** the parameter across a range of values
2. **Run the full fixture suite** at each value
3. **Record deltas** across all metrics and all images simultaneously
4. **Look for plateaus** — the optimal value is typically the lowest that reaches a stable good solution, maximizing safety margin

Example: the coverage extremity weight was swept from 3→64. At weight 16, doggy picked a suboptimal background (SSIM regressed). At weight 20+, it found bg=9 (brown) and plateaued — identical results from 20 through 64. All other images showed zero change at any weight. Weight 20 was chosen: lowest value on the plateau.

### Principled Tuning Rules

- **Never tune for a single image** — every change must be evaluated across the full fixture suite
- **Protect what works** — if ninja (dark image, bg=0 correct) regresses, the change is wrong regardless of how much doggy improves
- **Self-calibrating mechanisms over manual thresholds** — the lumDistance scaling in coverage extremity adapts automatically to each image's brightness profile, rather than using a fixed threshold that would need per-image tuning
- **Metrics must capture what matters** — when pixel SSIM failed to reflect perceived quality improvements (doggy had sharper character outlines but lower SSIM), cellSSIM was invented to measure what the eye actually sees at PETSCII viewing distance

---

## What Makes It State of the Art

Most existing converters do greedy per-cell matching in RGB with no perceptual weighting, no CSF, no global color solving, and no post-pass refinement. TRUSKI3000 treats it as what it actually is: a constrained combinatorial optimization problem with a perceptual objective function. The WASM core makes the inner loop fast enough that the expensive global passes are tractable in reasonable time on modern hardware.

Two techniques in particular distinguish TRUSKI3000 from traditional image compression adapted for character art:

1. **Coverage-aware background selection via luminance distance** — recognizes that PETSCII's single-background constraint creates a fundamentally different optimization landscape than pixel-level dithering. By scaling the coverage penalty to the brightness gap between background and cell content, the engine self-calibrates per image without manual thresholds.

2. **Cell-averaged structural similarity (cellSSIM)** — evaluates quality at the character cell resolution (40×25), the actual unit of artistic expression in PETSCII. This captures "does it look right from viewing distance" rather than "do individual pixels match the source" — a critical distinction for a mosaic medium where within-cell patterns are constrained to a fixed glyph set.

Together with CSF-weighted scoring, brightness debt propagation, and multi-pass global refinement, the result is the highest-fidelity automated PETSCII conversion achievable from a source bitmap.
