# MCM (Multicolor Mode) Optimization

Research notes on optimal approaches for C64 multicolor image conversion.

---

## The MCM Constraint

- 3 shared colors for the entire screen: background, multicolor1, multicolor2
- Per-cell choice: **multicolor** (4 colors at 4x8 resolution — bg + mc1 + mc2 + per-cell fg from lower 8) OR **hires** (2 colors at 8x8 resolution — bg + per-cell fg from lower 8)
- The hires/multicolor decision is encoded in color RAM bit 3

---

## Current Approach

1. Build shortlist of 8 most frequent palette-mapped colors
2. Generate all ordered permutations as triples (up to 8x7x6 = 336)
3. **Coarse pass**: evaluate each triple against 48 high-complexity sample cells
4. **Refine pass**: evaluate top 24 triples against all 1000 cells
5. Final full conversion with winning triple, per-cell hires vs multicolor by error comparison

---

## Finding Global Colors: Alternatives

### Expand to Full Search Space

C(16,3) = 560 unordered triples, or 3360 ordered. The coarse evaluation (48 sample cells) is fast — 560 coarse evals is only 1.67x more work than 336. Eliminates risk of missing a good triple because an important color wasn't in the top-8 frequency list.

### Weighted Frequency Analysis

Rather than raw pixel counts for the shortlist, weight each pixel's contribution by saliency weight and distance from nearest palette color. Makes the shortlist more responsive to which colors matter most perceptually, not just which appear most often.

### Median-Cut for Initial Candidates

Group all pixels by palette-mapped color. Compute Lab centroid and population per group. Apply median-cut on the 16 centroids (weighted by population) to find 3 representative clusters. Use nearest palette entries as initial triple.

Better handles cases where multiple similar colors are frequent but a single distinct color at moderate frequency is more important for quality.

### Alternating Optimization (Coordinate Descent)

The most promising technique from the literature:

```
triple = initialTriple(colorCounts)
for iter in 0..MAX_ITERS:
  // Fix globals, optimize locals
  result = findOptimalPetsciiMcm(triple)

  // Fix locals, try swapping each global color
  for slot in [bg, mc1, mc2]:
    for candidate in 0..15:
      testTriple = {...triple, [slot]: candidate}
      testResult = findOptimalPetsciiMcm(testTriple)
      if testResult.totalError < result.totalError:
        triple = testTriple; result = testResult

  if no improvement: break
```

Cost: 3 x 16 = 48 full evals per iteration, typically converges in 2-4 iterations. Can use coarse sample evaluation for the inner loop. This is what Dithertron does ("iterate until they stabilize").

### Genetic Algorithm

Syntiac (https://www.syntiac.com/tech_ga_c64.html) uses GA for C64 conversion. Research (Scheunders 1997) shows GA beats k-means for small palette sizes. But with only 560 unordered triples, brute-force is feasible and GA is overkill.

---

## How Other Tools Handle This

| Tool | Approach |
|------|----------|
| **png2prg** (Go) | Brute-force bitpair permutations, selects by compressed size (not perceptual error) |
| **Dithertron** (TypeScript) | Iterative stabilization — choose cell colors, dither, re-choose, repeat until stable |
| **NUFLIX Studio** (C#/Unity) | Compute shader exhaustive search — 256 x 256 x 8 x 7 per two-line block, GPU parallel |
| **RetroPixels** (TypeScript) | XYZ color space quantization + FS dithering, no documented global optimization |
| **SPOT** | Tries all possible background colors, optimizes for compression |
| **Pixcen** | Primarily an editor, basic import |

---

## Hires vs. Multicolor Per-Cell Decision

### Current: Direct Error Comparison

```
useMcm = bestMcmErr < bestHiresErr
```

MCM error is doubled (`2 * (fixedErr + fgErr)`) to normalize 32 MCM pixels against 64 hires pixels. This is mathematically correct since `mcmWeights[mi] = avg(weights[p0], weights[p1])`.

### Detail-Aware Bias (Optional)

Cells with high spatial frequency (edges, fine detail) benefit more from 8x8 hires. Cells with smooth color gradients benefit more from 4-color MCM. A refinement:

```
hiresBonus = detailWeight * cellComplexity
useMcm = bestMcmErr < (bestHiresErr - hiresBonus)
```

But the counterargument is strong: if a cell has high detail AND many colors, MCM's 4 colors at lower res may still beat hires's 2 colors. The raw error comparison already implicitly captures this. Best left as an optional parameter (default 0).

### Mode Coherence Penalty

Abrupt hires/MCM switches between adjacent cells create visible resolution discontinuity. A small penalty for switching modes between neighbors (similar to the repeat penalty) could smooth the boundary. No surveyed tool implements this.

---

## References

- Syntiac GA: https://www.syntiac.com/tech_ga_c64.html
- NUFLIX Studio: https://cobbpg.github.io/articles/nuflix.html
- png2prg: https://github.com/staD020/png2prg
- Dithertron: https://github.com/sehugg/dithertron
- RetroPixels: https://github.com/micheldebree/retropixels
- Retrospex: https://github.com/micheldebree/retrospex
- SPOT: https://github.com/spartaomg/SPOT
- Pixcen: https://github.com/Hammarberg/pixcen
- "Forty Years of Color Quantization" (Celebi et al. 2023): https://link.springer.com/article/10.1007/s10462-023-10406-6
- pkh.me, "Improving color quantization heuristics": http://blog.pkh.me/p/39-improving-color-quantization-heuristics.html
- Multicolor Bitmap Mode, C64-Wiki: https://www.c64-wiki.com/wiki/Multicolor_Bitmap_Mode
- Lemon64 forum, "Which image converter?": https://www.lemon64.com/forum/viewtopic.php?t=83862
