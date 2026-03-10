# TRUSKI3000 Quality Metrics

Objective measurement of how close the PETSCII converter output is to the original source image.

## Why Not Just One Number

A PETSCII conversion is constrained by 16 colors, 8×8 character tiles, and a fixed character set. A single similarity score hides whether the problem is brightness, color, or structure. We split measurement into three independent channels so we can see exactly what the converter preserves and what it loses.

## The Metrics

### Luminance RMSE (`lumaRMSE`)

Root mean square error of the OkLab L channel. Measures how well brightness is tracked.

- **Lower = better**
- Typical range: 0.03–0.15
- If this is low but `chromaRMSE` is high → gray collapse (converter matches brightness but loses color)

### Chroma RMSE (`chromaRMSE`)

Root mean square of the OkLab a/b channel distances: `sqrt(mean(da² + db²))`. Measures color preservation.

- **Lower = better**
- Typical range: 0.02–0.12
- This is the metric most sensitive to the gray bias problem identified in TRUE_COLOR.md
- Directly reflects `CHROMA_ERROR_WEIGHT` tuning in the converter

### Mean Delta E (`meanDeltaE`)

Mean Euclidean distance in OkLab space per pixel: `mean(sqrt(dL² + da² + db²))`. Overall perceptual difference.

- **Lower = better**
- Typical range: 0.05–0.20
- Combines luminance and chroma into one number
- OkLab ΔE ≈ 0.01 is barely perceptible, ≈ 0.05 is noticeable, ≈ 0.15 is clearly different

### SSIM (`ssim`)

Structural Similarity Index on the L channel, computed per 8×8 tile (matching the PETSCII cell size) and averaged.

- **Higher = better**, range 0–1
- Typical PETSCII range: 0.30–0.70
- Measures shape and edge preservation independent of exact pixel values
- Uses standard SSIM formula with stability constants tuned for OkLab L range (0–1)

### Tile-Level Breakdown

All metrics are also computed per 8×8 tile (40×25 = 1000 tiles for a standard C64 screen):

- `worstTileDeltaE` / `worstTileIndex` — identifies the single worst-performing tile
- `percentile95DeltaE` — 95th percentile tile ΔE, useful for catching outliers without being dominated by one bad tile
- Per-tile arrays (`tileDeltaE[]`, `tileSSIM[]`) available programmatically for heatmap visualization

## How It Works

1. **Downscale source** to preview resolution (320×200) using center-crop + scale to match converter fill behavior
2. **Convert both** (source reference and rendered preview) to OkLab color space
3. **Compute per-pixel** L, a, b differences
4. **Aggregate** into RMSE, mean ΔE, and per-tile SSIM

## Two-Score Interpretation

For quick assessment:

| Score | Measures | "Is this good?" |
|-------|----------|-----------------|
| **SSIM** | Recognition — does it still look like the same image? | > 0.50 = recognizable |
| **chromaRMSE** | Faithfulness — are the colors right? | < 0.06 = good color |

A PETSCII image can score high on recognition but low on faithfulness (correct shapes, wrong colors) or vice versa.

## Running Quality Comparison

Quality scores are computed automatically in all harness runs:

```bash
# Run scenarios and see quality scores
npm run truski:harness:compare

# Record baselines (including quality scores)
npm run truski:harness:record

# Compare shows quality deltas vs baseline:
#   standard/skeletor [CHANGED]: SSIM 0.420->0.455 (+0.035) chromaRMSE 0.0812->0.0723 (-0.0089)
```

## Adding Quality Tests to Manifest

Quality scores are included in `summary.json` for each scenario. The `compare` command will show score changes whenever baselines differ, making it easy to track the impact of converter changes.

To add quality coverage for a fixture:

1. Add to `manifest.json`
2. Run `npm run truski:harness:record` to capture baseline scores
3. Make converter changes
4. Run `npm run truski:harness:compare` to see quality deltas

## Implementation

- **Metrics module**: `src/utils/importers/imageConverterQualityMetrics.ts`
- **Harness integration**: `src/truski3000-harness.ts` (calls metrics after conversion)
- **Runner display**: `scripts/truski3000-harness/run.mjs` (prints scores, shows deltas in compare)

## Design Choices

- **OkLab color space**: Matches the converter's internal perceptual space. ΔE in OkLab is perceptually uniform.
- **8×8 tile SSIM**: Matches the PETSCII cell size. More physically meaningful than sliding-window SSIM for character graphics.
- **Center-crop downscaling**: The converter fills the 40×25 grid. The reference image uses the same crop-to-fill strategy.
- **No blur on source**: We measure against the actual downscaled source, not a pre-blurred version. The converter should aim to preserve as much as the resolution allows.

## Future Extensions

- **MS-SSIM**: Multi-scale SSIM for better handling of detail loss at different scales
- **Edge similarity**: Sobel/Canny edge map comparison for contour preservation
- **Gradient direction**: Detect whether shading flows in the correct direction
- **Saliency weighting**: Weight important regions (faces, focal points) more heavily
- **UI integration**: Show quality scores in the converter modal after each render
