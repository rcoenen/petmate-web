/**
 * Quality metrics for comparing source images against PETSCII converter output.
 *
 * Compares a downscaled source reference against the rendered PETSCII preview
 * in OkLab perceptual color space.
 *
 * Scores:
 *   lumaRMSE    — L channel RMSE, brightness fidelity (lower = better)
 *   chromaRMSE  — sqrt(mean(da² + db²)), color preservation (lower = better)
 *   meanDeltaE  — mean OkLab Euclidean distance, overall perceptual error (lower = better)
 *   ssim        — structural similarity on L channel, shape/edge preservation (higher = better)
 */

const TILE_W = 8;
const TILE_H = 8;
const PIXELS_PER_TILE = TILE_W * TILE_H;

// SSIM stability constants for OkLab L channel (range 0..1)
const SSIM_C1 = 0.0001; // (0.01 * 1)²
const SSIM_C2 = 0.0009; // (0.03 * 1)²

export interface ImageQualityMetrics {
  /** L channel RMSE — brightness fidelity */
  lumaRMSE: number;
  /** Chroma RMSE — color fidelity */
  chromaRMSE: number;
  /** Mean OkLab Euclidean distance per pixel */
  meanDeltaE: number;
  /** Structural similarity on L channel, 0..1 */
  ssim: number;
  /** Cell-averaged SSIM — structural similarity at 8×8 cell level, 0..1.
   *  Captures "looks right from viewing distance" by comparing cell-averaged
   *  luminance grids (40×25) with a sliding window SSIM. */
  cellSSIM: number;
  /** Number of 8×8 tiles compared */
  tileCount: number;
  /** Per-tile mean ΔE */
  tileDeltaE: number[];
  /** Per-tile SSIM */
  tileSSIM: number[];
  /** Worst (highest) tile ΔE */
  worstTileDeltaE: number;
  /** Index of worst tile */
  worstTileIndex: number;
  /** 95th percentile tile ΔE */
  percentile95DeltaE: number;
}

/** Aggregate-only subset for JSON serialization (excludes per-tile arrays) */
export interface ImageQualityScores {
  lumaRMSE: number;
  chromaRMSE: number;
  meanDeltaE: number;
  ssim: number;
  cellSSIM: number;
  tileCount: number;
  worstTileDeltaE: number;
  worstTileIndex: number;
  percentile95DeltaE: number;
}

// ---------------------------------------------------------------------------
// OkLab conversion (standalone — matches imageConverter.ts matrices)
// ---------------------------------------------------------------------------

function linearize(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function sRGBtoOkLab(r: number, g: number, b: number): [number, number, number] {
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function imageDataToOkLab(
  data: ImageData
): { L: Float64Array; a: Float64Array; b: Float64Array } {
  const pixelCount = data.width * data.height;
  const L = new Float64Array(pixelCount);
  const a = new Float64Array(pixelCount);
  const b = new Float64Array(pixelCount);
  const pixels = data.data;

  for (let i = 0; i < pixelCount; i++) {
    const base = i * 4;
    const [lv, av, bv] = sRGBtoOkLab(pixels[base], pixels[base + 1], pixels[base + 2]);
    L[i] = lv;
    a[i] = av;
    b[i] = bv;
  }

  return { L, a, b };
}

function computeTileSSIM(
  srcL: Float64Array,
  refL: Float64Array,
  startX: number,
  startY: number,
  stride: number
): number {
  let sumSrc = 0;
  let sumRef = 0;
  let sumSrcSq = 0;
  let sumRefSq = 0;
  let sumCross = 0;

  for (let dy = 0; dy < TILE_H; dy++) {
    const rowOffset = (startY + dy) * stride + startX;
    for (let dx = 0; dx < TILE_W; dx++) {
      const idx = rowOffset + dx;
      const sv = srcL[idx];
      const rv = refL[idx];
      sumSrc += sv;
      sumRef += rv;
      sumSrcSq += sv * sv;
      sumRefSq += rv * rv;
      sumCross += sv * rv;
    }
  }

  const muSrc = sumSrc / PIXELS_PER_TILE;
  const muRef = sumRef / PIXELS_PER_TILE;
  const sigmaSrcSq = sumSrcSq / PIXELS_PER_TILE - muSrc * muSrc;
  const sigmaRefSq = sumRefSq / PIXELS_PER_TILE - muRef * muRef;
  const sigmaCross = sumCross / PIXELS_PER_TILE - muSrc * muRef;

  const numerator = (2 * muSrc * muRef + SSIM_C1) * (2 * sigmaCross + SSIM_C2);
  const denominator =
    (muSrc * muSrc + muRef * muRef + SSIM_C1) * (sigmaSrcSq + sigmaRefSq + SSIM_C2);

  return numerator / denominator;
}

/**
 * Cell-averaged SSIM: averages each 8×8 cell to a single luminance value,
 * then computes SSIM over the resulting 40×25 grid using a sliding window.
 * Captures whether the overall brightness layout "looks right from a distance"
 * without being affected by within-cell character pixel patterns.
 */
function computeCellSSIM(
  srcL: Float64Array,
  refL: Float64Array,
  width: number,
  height: number
): number {
  const cellsX = Math.floor(width / TILE_W);
  const cellsY = Math.floor(height / TILE_H);
  const cellCount = cellsX * cellsY;

  // Average each 8×8 cell
  const srcCellL = new Float64Array(cellCount);
  const refCellL = new Float64Array(cellCount);

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      let srcSum = 0;
      let refSum = 0;
      for (let dy = 0; dy < TILE_H; dy++) {
        const row = (cy * TILE_H + dy) * width + cx * TILE_W;
        for (let dx = 0; dx < TILE_W; dx++) {
          srcSum += srcL[row + dx];
          refSum += refL[row + dx];
        }
      }
      srcCellL[cy * cellsX + cx] = srcSum / PIXELS_PER_TILE;
      refCellL[cy * cellsX + cx] = refSum / PIXELS_PER_TILE;
    }
  }

  // Sliding-window SSIM over cell grid (3×3 window)
  const WIN = 3;
  const WIN_AREA = WIN * WIN;
  let ssimSum = 0;
  let count = 0;

  for (let cy = 0; cy <= cellsY - WIN; cy++) {
    for (let cx = 0; cx <= cellsX - WIN; cx++) {
      let sumS = 0, sumR = 0, sumSS = 0, sumRR = 0, sumSR = 0;
      for (let wy = 0; wy < WIN; wy++) {
        for (let wx = 0; wx < WIN; wx++) {
          const idx = (cy + wy) * cellsX + (cx + wx);
          const s = srcCellL[idx];
          const r = refCellL[idx];
          sumS += s;
          sumR += r;
          sumSS += s * s;
          sumRR += r * r;
          sumSR += s * r;
        }
      }
      const muS = sumS / WIN_AREA;
      const muR = sumR / WIN_AREA;
      const sigSS = sumSS / WIN_AREA - muS * muS;
      const sigRR = sumRR / WIN_AREA - muR * muR;
      const sigSR = sumSR / WIN_AREA - muS * muR;

      const num = (2 * muS * muR + SSIM_C1) * (2 * sigSR + SSIM_C2);
      const den = (muS * muS + muR * muR + SSIM_C1) * (sigSS + sigRR + SSIM_C2);
      ssimSum += num / den;
      count++;
    }
  }

  return count > 0 ? ssimSum / count : 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Downscale a source image to target dimensions using center-crop + scale.
 * Matches the converter's fill behavior (no letterboxing).
 */
export function downscaleToReference(
  image: HTMLImageElement,
  targetWidth: number,
  targetHeight: number
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create 2D context for quality reference');

  // Center-crop source to match target aspect ratio, then scale down
  const targetAspect = targetWidth / targetHeight;
  const sourceAspect = image.naturalWidth / image.naturalHeight;

  let sx: number, sy: number, sw: number, sh: number;
  if (sourceAspect > targetAspect) {
    // Source is wider — crop sides
    sh = image.naturalHeight;
    sw = sh * targetAspect;
    sx = (image.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    // Source is taller — crop top/bottom
    sw = image.naturalWidth;
    sh = sw / targetAspect;
    sx = 0;
    sy = (image.naturalHeight - sh) / 2;
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);
  return ctx.getImageData(0, 0, targetWidth, targetHeight);
}

/**
 * Compute quality metrics comparing rendered output against source reference.
 * Both ImageData must have the same dimensions.
 */
export function computeQualityMetrics(
  source: ImageData,
  rendered: ImageData
): ImageQualityMetrics {
  if (source.width !== rendered.width || source.height !== rendered.height) {
    throw new Error(
      `Dimension mismatch: source ${source.width}×${source.height} ` +
        `vs rendered ${rendered.width}×${rendered.height}`
    );
  }

  const width = source.width;
  const height = source.height;
  const pixelCount = width * height;

  const src = imageDataToOkLab(source);
  const ref = imageDataToOkLab(rendered);

  // Global per-pixel errors
  let sumDLSq = 0;
  let sumDaSq = 0;
  let sumDbSq = 0;
  let sumDeltaE = 0;

  for (let i = 0; i < pixelCount; i++) {
    const dL = src.L[i] - ref.L[i];
    const da = src.a[i] - ref.a[i];
    const db = src.b[i] - ref.b[i];
    sumDLSq += dL * dL;
    sumDaSq += da * da;
    sumDbSq += db * db;
    sumDeltaE += Math.sqrt(dL * dL + da * da + db * db);
  }

  const lumaRMSE = Math.sqrt(sumDLSq / pixelCount);
  const chromaRMSE = Math.sqrt((sumDaSq + sumDbSq) / pixelCount);
  const meanDeltaE = sumDeltaE / pixelCount;

  // Per-tile SSIM and ΔE
  const tilesX = Math.floor(width / TILE_W);
  const tilesY = Math.floor(height / TILE_H);
  const tileCount = tilesX * tilesY;
  const tileDeltaE: number[] = new Array(tileCount);
  const tileSSIM: number[] = new Array(tileCount);

  let ssimSum = 0;
  let worstTileDeltaE = 0;
  let worstTileIndex = 0;

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileIndex = ty * tilesX + tx;
      const startX = tx * TILE_W;
      const startY = ty * TILE_H;

      // Tile ΔE
      let tileDeltaESum = 0;
      for (let dy = 0; dy < TILE_H; dy++) {
        const rowOffset = (startY + dy) * width + startX;
        for (let dx = 0; dx < TILE_W; dx++) {
          const idx = rowOffset + dx;
          const dL = src.L[idx] - ref.L[idx];
          const da = src.a[idx] - ref.a[idx];
          const db = src.b[idx] - ref.b[idx];
          tileDeltaESum += Math.sqrt(dL * dL + da * da + db * db);
        }
      }
      tileDeltaE[tileIndex] = tileDeltaESum / PIXELS_PER_TILE;

      if (tileDeltaE[tileIndex] > worstTileDeltaE) {
        worstTileDeltaE = tileDeltaE[tileIndex];
        worstTileIndex = tileIndex;
      }

      // Tile SSIM
      const ssimValue = computeTileSSIM(src.L, ref.L, startX, startY, width);
      tileSSIM[tileIndex] = ssimValue;
      ssimSum += ssimValue;
    }
  }

  const ssim = tileCount > 0 ? ssimSum / tileCount : 0;
  const cellSSIM = computeCellSSIM(src.L, ref.L, width, height);

  // 95th percentile tile ΔE
  const sortedDeltaE = [...tileDeltaE].sort((a, b) => a - b);
  const p95Index = Math.min(Math.floor(tileCount * 0.95), tileCount - 1);
  const percentile95DeltaE = sortedDeltaE[p95Index] ?? 0;

  return {
    lumaRMSE,
    chromaRMSE,
    meanDeltaE,
    ssim,
    cellSSIM,
    tileCount,
    tileDeltaE,
    tileSSIM,
    worstTileDeltaE,
    worstTileIndex,
    percentile95DeltaE,
  };
}

/** Extract JSON-serializable aggregate scores (strips per-tile arrays). */
export function toQualityScores(metrics: ImageQualityMetrics): ImageQualityScores {
  return {
    lumaRMSE: Number(metrics.lumaRMSE.toFixed(6)),
    chromaRMSE: Number(metrics.chromaRMSE.toFixed(6)),
    meanDeltaE: Number(metrics.meanDeltaE.toFixed(6)),
    ssim: Number(metrics.ssim.toFixed(6)),
    cellSSIM: Number(metrics.cellSSIM.toFixed(6)),
    tileCount: metrics.tileCount,
    worstTileDeltaE: Number(metrics.worstTileDeltaE.toFixed(6)),
    worstTileIndex: metrics.worstTileIndex,
    percentile95DeltaE: Number(metrics.percentile95DeltaE.toFixed(6)),
  };
}
