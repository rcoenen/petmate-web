# Image-to-PETSCII Converter — How It Works

Petsciishop includes a state-of-the-art image-to-PETSCII converter (File > Convert Image...) that transforms any image into a C64-accurate PETSCII screen. This document explains the algorithm, the math, and the design decisions behind it.

---

## The Problem

Converting an image to PETSCII is a constrained optimization problem with several compounding limitations:

- **320×200 pixels**, split into a grid of **40×25 cells**, each 8×8 pixels
- **256 PETSCII characters** — each a fixed black-and-white bitmap shape
- **16 colors** in the C64 palette, each cell can use exactly **one foreground color**
- **Standard mode:** one global background color for the entire screen
- **ECM mode:** up to 4 background colors, but only the first 64 PETSCII characters available

Every decision made during conversion is a lossy approximation. The goal is to make each approximation as perceptually accurate as possible — meaning the result should look as close as possible to the source *to a human eye*, not just by a mathematical metric.

---

## The Pipeline

```
Source image
    │
    ▼
[Stage A]  Resize & center to 320×200
    │
    ▼
[Stage B]  Map every pixel to nearest C64 palette color (CIE Lab)
    │
    ▼
[Stage C]  Find best background color(s)
           Standard: brute-force all 16 → pick lowest total error
           ECM: top 4 most frequent colors
    │
    ▼
[Stage D+E] Co-optimize character shape + foreground color per cell
            256 chars × 15 fg colors × bg candidate(s)
            Scored by: weighted Lab error + luminance penalty + repeat penalty
    │
    ├──▶ Standard output (256 characters, 1 background)
    └──▶ ECM output (64 characters, 4 backgrounds)
```

---

## Stage A — Resize and Center

The source image is drawn onto a 320×200 canvas, scaled to fit while preserving aspect ratio, and centered with black fill.

---

## Stage B — Palette Mapping

Every pixel in the resized image is mapped to the nearest color in the C64's 16-color palette.

### Pre-processing: brightness and saturation

Before the palette lookup, each pixel is adjusted:

1. **Brightness** is applied as a simple multiplier to all three RGB channels
2. **Saturation** is applied in HSV space — the S channel is multiplied, then converted back to RGB

This matters because the C64 palette is relatively dark and muted compared to modern sRGB displays. Boosting both before palette quantization causes the mapper to correctly prefer the richer palette entries over the grey ones.

### Color distance: CIE Lab

A naive approach uses RGB Euclidean distance:

```
distance² = (R1−R2)² + (G1−G2)² + (B1−B2)²
```

This is fast but the RGB color cube is not perceptually uniform — equal distances in RGB do not correspond to equal perceived differences. Blue shifts are underweighted; yellow-green shifts are overweighted.

Petsciishop converts each pixel to **CIE L\*a\*b\*** color space before comparing — the standard for perceptually uniform color measurement:

```
sRGB → linearize (gamma removal) → XYZ (D65 illuminant) → Lab
```

The Lab space was specifically designed so that Euclidean distance corresponds to perceived color difference. `ΔE = sqrt(ΔL² + Δa² + Δb²)` is the standard measure of perceptual color error.

The full conversion chain per pixel:

```
1. Remove sRGB gamma
   r = r > 0.04045 ? ((r + 0.055) / 1.055) ^ 2.4 : r / 12.92

2. RGB → XYZ (D65)
   X = 0.4124564r + 0.3575761g + 0.1804375b

3. XYZ → Lab (cube-root transfer function)
   L = 116 * f(Y/Yn) - 16
   a = 500 * (f(X/Xn) - f(Y/Yn))
   b = 200 * (f(Y/Yn) - f(Z/Zn))
```

All 16 palette colors are pre-converted to Lab at startup. Each pixel comparison is then a single squared distance in 3D Lab space.

### Multiple palettes

Three palettes are available, each sourced from respected C64 palette research:

- **Colodore** — the default, widely considered the most accurate CRT-measured palette
- **Pepto** — a classic palette from Philip "Pepto" Timmermann's analysis
- **CCS64** — from the CCS64 emulator

---

## Stage C — Background Color Selection

### Standard mode: brute-force search

A naive approach counts pixel frequencies and picks the most common palette color as the background. But the most frequent color is not necessarily the one that produces the best PETSCII output overall — a color that appears slightly less often might allow far better character matches across the screen.

Petsciishop tries **all 16 palette colors** as the background candidate, runs a full character matching pass for each, measures the total perceptual error, and picks the winner. This is 16× more work, but the quality improvement is significant for images where the visually important background isn't the most frequent color.

### Manual override

The user can also manually select a specific background color from the palette swatches, bypassing the auto-detection entirely.

### ECM mode: top-4 frequency

ECM (Extended Color Mode) allows 4 simultaneous background colors, but restricts character selection to the first 64 PETSCII characters. The 4 backgrounds are selected by frequency — the 4 most common palette colors after Stage B quantization.

---

## Stage D+E — Co-optimized Character and Color Matching

This is the core of the converter, and where most of the quality comes from.

### The naive approach (sequential)

A simple converter works in two steps:
1. Find the dominant foreground color per cell (most frequent non-background color)
2. Find the nearest PETSCII character for that 2-color cell

This means character selection and color selection are decoupled. A character chosen in step 2 might have scored differently had a different foreground color been considered alongside it.

### Joint optimization

Petsciishop evaluates **character shape and foreground color together** in a single pass. For each 8×8 cell:

```
for each background candidate (1 for standard, 4 for ECM):
  for each of 256 PETSCII characters (64 for ECM):
    for each of 15 foreground colors (≠ background):
      score = weighted Lab error + luminance penalty + repeat penalty
      track global minimum
```

The combination with the lowest total score wins. This is a brute-force search over up to `1 × 256 × 15 = 3,840` candidates per cell (standard), or `4 × 64 × 15 = 3,840` for ECM.

### Per-pixel Lab error

For each candidate (character, foreground, background), the rendered cell is compared to the source cell pixel by pixel in Lab space:

- **Background pixels** (where the character bitmap is 0): compare source pixel Lab to background color Lab
- **Foreground pixels** (where the character bitmap is 1): compare source pixel Lab to foreground color Lab

```
error = Σ weight[p] × ΔElab(source[p], rendered[p])²
```

### Perceptual saliency weighting

Not all pixels matter equally. The human visual system is pre-attentively sensitive to edges and high-contrast regions — a mismatch at an edge is far more visible than a mismatch in a flat area.

For each 8×8 cell, per-pixel saliency weights are computed based on deviation from the cell mean in Lab space:

```
mean_Lab = average of all 64 pixels in the cell

for each pixel p:
    deviation[p] = ΔElab(pixel_p, mean_Lab)

weight[p] = 1.0 + α × (deviation[p] / max_deviation)
```

`α` (the "Detail Boost" slider, default 3.0) controls how strongly edge pixels are emphasized. At `α = 0`, all pixels are equally weighted. At `α = 3`, an edge pixel at maximum deviation gets 4× the weight of a flat-area pixel.

The effect: the algorithm preferentially preserves the edges and high-contrast features that define the recognizable shape of an object, even if it means compromising accuracy in flat, uniform areas.

### Luminance matching penalty

PETSCII has 256 character shapes with varying fill densities — from fully blank (space) to nearly solid (reverse space). Two characters with the same shape but different fill densities will render at different average brightnesses with the same fg/bg colors.

A purely Lab-error-based matcher can choose a character that looks right color-by-color but reads as the wrong brightness overall. The luminance penalty corrects this:

```
rendered_avg_L = (n_set_pixels × fg_Lab_L + (64 − n_set) × bg_Lab_L) / 64

lum_penalty = W × (source_avg_L − rendered_avg_L)²
```

`W` (the "Lum. Match" slider, default 12) penalizes candidates whose rendered average luminance diverges from the source cell's average luminance. This preserves the light/dark structure of the image even when individual pixel errors are low.

Luminance dominates human perception of form and structure, particularly at low resolutions. With only 16 colors and 256 fill patterns, getting the brightness relationship right is usually more important than exact hue matching.

### Early exit optimization

Computing Lab error for all foreground colors after computing background error allows an optimization: if the **background error alone** already exceeds the current best total error, no foreground color can possibly beat it. The inner foreground loop is skipped entirely:

```
if (bgError >= bestError) continue;  // skip all 15 fg colors
```

This prunes a large fraction of candidates in practice, keeping the full brute-force tractable in a browser.

---

## Settings Reference

| Setting | Default | Why |
|---|---|---|
| Brightness | 1.1 | Block characters read darker than smooth pixels at the same luminance — no blending, more perceived shadow |
| Saturation | 1.4 | The C64 palette is muted; boosting saturation before quantization pulls the mapper toward colored entries instead of greys |
| Detail Boost (α) | 3.0 | Midpoint: preserves medium-contrast edges while ignoring noise; higher values over-prioritize edges at the cost of flat areas |
| Lum. Match | 12 | PETSCII's variation is mostly in fill density (brightness), not hue; the matcher should weight luminance accuracy accordingly |

---

## Standard vs ECM Mode

| | Standard | ECM |
|---|---|---|
| Background colors | 1 (global) | 4 (per-cell selectable) |
| Available characters | 256 | 64 (first quarter of PETSCII table) |
| Search space per cell | 256 × 15 = 3,840 | 4 × 64 × 15 = 3,840 |
| Best for | Images with one dominant background tone | Complex images with multiple background regions |

ECM often produces richer results for complex images because each cell can pick from 4 background colors, but the reduced character set means less shape variety for fine detail.

---

## Credits

The converter algorithm is based on work from [c64-image-to-petscii](https://github.com/mkeke/c64-image-to-petscii) by Simen Lysebo, with significant enhancements including CIE Lab color matching, co-optimized character+color selection, perceptual saliency weighting, brute-force background search, and ECM mode support.
