# Image Preprocessing for Retro Conversion

Research notes on preprocessing techniques before palette-constrained conversion.

---

## Current Pipeline

1. Browser `drawImage` resize (bilinear) to 320x200
2. Brightness: multiply R,G,B in sRGB space
3. Saturation: multiply S in HSV space

---

## Downscaling: Current Method is Suboptimal

Canvas `drawImage` uses bilinear interpolation: samples only 4 neighboring pixels. When downscaling from 4000x3000 to 320x200 (~12x), each destination pixel should represent ~150 source pixels. Bilinear uses 4 of those 150, discarding 97% of information. Causes aliasing, moire, and lost detail.

### Better alternatives, ranked:

| Method | Quality | Notes |
|--------|---------|-------|
| Area averaging (box filter) | Best for extreme ratios | Every source pixel contributes. No info discarded. |
| Lanczos-3 | Excellent, sharper | Better edges, but can ring at extreme ratios |
| Multi-step halving | Good practical compromise | Halve repeatedly then final bilinear. Easy with canvas. |
| `imageSmoothingQuality = "high"` | Marginal improvement | One-line change, browser uses better filter |
| Bilinear (current) | Poor for extreme ratios | Only samples 4 pixels |

### Multi-step halving (no dependencies, ~20 lines):

Repeatedly `drawImage` at half size until within 2x of target, then final step. Well-known browser trick that dramatically improves quality.

### pica library (best quality):

npm `pica` — Lanczos-3 with Web Workers and optional WASM. Built-in unsharp mask. Drop-in replacement.

---

## Gamma-Correct Brightness

### The problem

Current code multiplies sRGB values directly: `r * brightnessFactor`. sRGB has nonlinear transfer function (~gamma 2.2). Multiplying in this space:
- Over-brightens dark tones relative to light tones
- Shifts mid-tone relationships
- Applies non-uniform exposure curve instead of uniform brightness boost

### Correct approach

Linearize first, multiply, re-encode:

```
// Linearize (already have this code in sRGBtoLab)
rLin = sRGBToLinear(r) * brightnessFactor
// Re-encode
r = linearToSRGB(rLin) * 255
```

Practically: most visible in dark and mid-tone images. A brightness factor of 1.1 in sRGB pushes dark pixels disproportionately. In linear space, the boost is proportional to actual light intensity.

### Saturation in Lab space

Instead of HSV round-trip, adjust saturation by scaling Lab `a` and `b` channels:

```
lab.a *= saturationFactor
lab.b *= saturationFactor
```

More perceptually uniform. Avoids the HSV round-trip entirely. Since we convert to Lab anyway, this is free.

---

## Post-Downscale Sharpening

Downscaling smears edges via interpolation. When quantized to 16 colors and 256 char shapes, smeared edges cause wrong character picks. Sharpening the 320x200 result restores edge information the character matcher needs.

### Unsharp Mask (recommended)

```
sharpened = original + amount * (original - blurred)
```

Parameters for post-downscale, pre-quantization:
- **Radius**: 0.5-1.0 pixels (small — sharpen at character-cell scale)
- **Amount**: 0.3-0.8 (moderate — too high creates ringing that confuses palette mapper)
- **Threshold**: 2-4 (skip flat regions, only sharpen edges)

Apply after downscaling, before brightness/saturation/palette mapping.

Why not Laplacian? Isotropic second-derivative, amplifies noise, no threshold or radius control. USM is strictly superior here.

---

## CLAHE (Contrast-Limited Adaptive Histogram Equalization)

Adaptively enhances contrast in local regions. Pulls detail out of shadows while keeping highlights controlled. Global brightness lifts everything uniformly; CLAHE is local.

### For 320x200:

- Apply to L channel only (preserves hue/saturation)
- **Tile size**: 8x8 tiles = 40x25 pixel tiles = exactly one character-cell column by row. Excellent match — equalizes contrast at the character-cell grid scale.
- **Clip limit**: 2.0-3.0 (prevents over-amplification in flat regions)

Apply before brightness/saturation — normalizes input so the global brightness factor becomes less critical.

No off-the-shelf browser JS implementation — would need ~100-150 lines. Algorithm: build per-tile histograms, clip at limit, redistribute excess, bilinearly interpolate mapping functions across tile boundaries.

---

## Local Contrast Enhancement

### Base/Detail Decomposition

1. Compute heavily blurred version (Gaussian, radius 16-24px, ~2-3 character cells)
2. Extract detail: `detail = original - base`
3. Compress base dynamic range: `compressed = base^0.5` in linear space
4. Reconstruct: `output = compressed + detail`

Local texture is preserved; global contrast compressed to fit C64's limited range.

### Simple Per-Cell Normalization

```
for each 8x8 cell:
  adjust = strength * (globalMeanL - cellMeanL)
  pixel.L += adjust
```

Pulls dark cells brighter, bright cells darker. Preserves local texture. Very cheap.

---

## Hue-Aware Saturation Boosting

The C64 palette has limited chromatic entries at similar saturation. Uniform saturation boost helps but isn't optimal.

### Problem areas:

- **Red-brown-orange** (hue 0-60): collapses easily, common in photos (skin, wood, earth)
- **Green-cyan** (hue 120-180): green and light green palette entries are close
- **Blue-purple** (hue 240-300): cyan and blue need separation

### Approach:

Boost more aggressively in hue ranges where C64 palette entries are close:

```
if (h >= 0 && h < 60) factor *= 1.3    // red-brown-orange
if (h >= 60 && h < 120) factor *= 1.2  // yellow-green
if (h >= 180 && h < 270) factor *= 1.2 // cyan-blue
```

### Better: Lab-space palette-aware boosting

For pixels near the decision boundary between confusable palette entries, boost chroma to push them clearly toward one entry:

```
nearest1 = findNearestPaletteColor(lab)
nearest2 = findSecondNearest(lab)
if close(nearest1, nearest2):
  boost lab.a, lab.b to push away from boundary
```

Brown (palette 9) is the critical case — first to produce out-of-gamut on saturation increase, extremely common in photos.

---

## Recommended Priority (impact / effort)

1. **Gamma-correct brightness** — minimal code change, fixes a real error
2. **Better downscaling** — `imageSmoothingQuality = 'high'` (1 line) or multi-step halving (~20 lines)
3. **Post-downscale unsharp mask** — ~40 lines, high impact on edge quality
4. **Per-cell normalization** — ~15 lines, high impact for mixed-lighting photos
5. **CLAHE** — ~100-150 lines, most useful for very dark/bright photos
6. **Hue-aware saturation** — ~20 lines, moderate impact

---

## References

- pica library: https://github.com/nodeca/pica
- Canvas downscaling techniques: https://www.ghinda.net/article/canvas-resize/
- "Image resize in browsers is broken" (Uploadcare): https://uploadcare.com/blog/image-resize-in-browsers/
- Area-average downscale: https://github.com/ytiurin/downscale
- "The Importance of Being Linear" (NVIDIA GPU Gems 3): https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-24-importance-being-linear
- Gamma Correction (LearnOpenGL): https://learnopengl.com/Advanced-Lighting/Gamma-Correction
- Exposure Fusion (Bart Wronski): https://bartwronski.com/2022/02/28/exposure-fusion-local-tonemapping-for-real-time-rendering/
- CLAHE (OpenCV): https://docs.opencv.org/4.x/d2/d74/tutorial_js_histogram_equalization.html
- CLAHE (ImageMagick): https://imagemagick.org/script/clahe.php
- Hue-Preserving Saturation Improvement: https://www.mdpi.com/2313-433X/7/8/150
- VIC-II Color Analysis (Pepto): https://www.pepto.de/projects/colorvic/
- pkh.me, "Improving color quantization heuristics": http://blog.pkh.me/p/39-improving-color-quantization-heuristics.html
