# Color Distance Metrics for Palette-Constrained Conversion

Research notes on perceptual color distance for image-to-PETSCII conversion.

---

## Current: CIE Lab Euclidean (deltaE76)

The converter uses `deltaE76 = sqrt(dL^2 + da^2 + db^2)` in CIE L*a*b* space. This was the gold standard from 1976 and is widely used. The main known weaknesses:

- **Blue-violet hue non-uniformity**: Lab's hue linearity breaks down around 270-330 degrees. Two blues that look similar to humans can have large Lab distance, and vice versa.
- **Neutral/low-chroma bias**: Small Lab differences in near-grey colors overstate perceived difference.
- **Saturated color compression**: Chroma differences at high saturation are perceived differently than Lab Euclidean predicts.

For a 16-color palette where inter-color distances are large (typically deltaE > 10), these issues only matter at decision boundaries between adjacent palette entries — but those boundary cases are exactly where conversion quality is most visible.

---

## CIEDE2000 — More Accurate, Too Expensive

CIEDE2000 adds corrections for all three Lab weaknesses above, plus a hue rotation term. It is the current CIE standard for perceptual color difference.

**Cost per comparison**: ~4-5 sqrt, 2 atan2, 4 cos, 1 sin, 1 exp, 2-3 pow(x,7) calls plus dozens of multiplications. Roughly **20-40x more expensive** than Lab Euclidean (3 subtractions, 3 multiplies, 2 adds).

**At our scale**: The inner loop evaluates ~262 million distance comparisons per conversion (1000 cells x 256 chars x 16 colors x 64 pixels). CIEDE2000 at that scale is prohibitive in a browser.

**No practical fast approximations exist** — the formula's corrections are deeply intertwined (hue rotation depends on chroma, which depends on modified a* values). You can't simplify piecewise without losing the benefits.

**Verdict**: Not worth it for our use case.

---

## Oklab — The Sweet Spot

Oklab (Bjorn Ottosson, 2020) was specifically designed for image processing. It is now the default gradient space in Photoshop, adopted by Unity/Godot, standardized in CSS Color Level 4, and used by FFmpeg's color quantization.

### Why it's better than CIE Lab

- **Perceptual uniformity**: On lightness uniformity tests, Oklab achieves RMS error of 0.20 vs CIE Lab's 1.70 (measured via CIEDE2000 distances). That's an 8.5x improvement in uniformity.
- **Blue hue fix**: Specifically corrects CIE Lab's notorious blue-region hue shift.
- **Numerically optimized** against CAM16-UCS perceptual data — essentially a learned approximation of the best color appearance models.

### Same computational cost as CIE Lab

Oklab Euclidean distance is identical: `dL^2 + da^2 + db^2`. The conversion from sRGB is two matrix multiplies and three cube roots:

```
// sRGB (linearized) -> Oklab
l = 0.4122214708*rl + 0.5363325363*gl + 0.0514459929*bl
m = 0.2119034982*rl + 0.6806995451*gl + 0.1073969566*bl
s = 0.0883024619*rl + 0.2817188376*gl + 0.6299787005*bl

l = cbrt(l); m = cbrt(m); s = cbrt(s);

L = 0.2104542553*l + 0.7936177850*m - 0.0040720468*s
a = 1.9779984951*l - 2.4285922050*m + 0.4505937099*s
b = 0.0259040371*l + 0.7827717662*m - 0.8086757660*s
```

The sRGB linearization step is the same gamma decode we already do. `Math.cbrt` is a single hardware instruction on modern CPUs.

**Verdict**: Drop-in replacement. CIEDE2000-class accuracy at Lab-Euclidean cost. Strong recommendation.

---

## HyAB Distance — Better for Large Color Differences

Standard Euclidean distance (even in Oklab) treats lightness and chromaticity equally. The HyAB metric separates them:

```
deltaE_HyAB = |L1 - L2| + sqrt((a1-a2)^2 + (b1-b2)^2)
```

Research shows HyAB is more faithful than both Euclidean and CIEDE2000 for **large color differences** — exactly what palette matching with 16 widely-spaced colors involves. The L1 norm on lightness (absolute difference) better captures how humans perceive lightness jumps vs. chromaticity shifts.

A tunable variant allows weighting lightness independently:

```
deltaE = k_L * |L1 - L2| + sqrt((a1-a2)^2 + (b1-b2)^2)
```

Setting `k_L > 1.0` biases toward luminance preservation, which is typically more important for recognizable PETSCII output (humans have much higher spatial resolution for luminance than chrominance).

**Cost**: One extra sqrt per comparison for the chroma plane. Can be avoided by using squared chroma for ordering comparisons.

**Verdict**: Worth experimenting with after switching to Oklab. The lightness weighting parameter could subsume or complement the existing `lumMatchWeight` penalty.

---

## CAM16-UCS — Overkill

CAM16-UCS is the most accurate color appearance model available. Recent research (2024) shows it outperforms everything for wide-gamut HDR content. But it requires viewing condition parameters, chromatic adaptation transforms, and multiple nonlinear compressions — significantly more complex than Oklab with no practical advantage for our fixed-palette, fixed-viewing scenario.

**Verdict**: Skip.

---

## Key Insight for Character-Art Specifically

For 8x8 block matching with 2-color cells:

1. **Luminance structure is king.** Humans have much higher spatial resolution for luminance than chrominance. Getting the light/dark pattern right matters more than exact hue.
2. **Hue errors are more noticeable than chroma errors.** A slightly desaturated correct hue looks better than a saturated wrong hue. Oklab's superior hue uniformity directly helps here.
3. **Block-level average color matters.** Since each cell is constrained to 2 colors, perceptual quality depends heavily on the average color of set/unset pixel regions matching the fg/bg. The saliency-weighted error accumulation already captures this well.

---

## References

- Bjorn Ottosson, "A perceptual color space for image processing" (Oklab): https://bottosson.github.io/posts/oklab/
- Raph Levien, "An interactive review of Oklab": https://raphlinus.github.io/color/2021/01/18/oklab-critique.html
- pkh.me, "Improving color quantization heuristics" (FFmpeg/Oklab): http://blog.pkh.me/p/39-improving-color-quantization-heuristics.html
- pkh.me, "Porting OkLab to integer arithmetic": http://blog.pkh.me/p/38-porting-oklab-colorspace-to-integer-arithmetic.html
- 30fps.net, "HyAB k-means for color quantization": https://30fps.net/pages/hyab-kmeans/
- ColorAide, "Color Distance and Delta E": https://facelessuser.github.io/coloraide/distance/
- Wikipedia, "Color difference" (HyAB, CIEDE2000, deltaE76): https://en.wikipedia.org/wiki/Color_difference
- Sharma et al., "CIEDE2000 Implementation Notes": https://www.ece.rochester.edu/~gsharma/ciede2000/ciede2000noteCRNA.pdf
- MDPI, "Evaluation of Color Difference Models for WCG and HDR" (2024): https://www.mdpi.com/2313-433X/10/12/317
- Compuphase, "Colour metric": https://www.compuphase.com/cmetric.htm
