import {
  CELL_GRADIENT_ISOTROPIC,
  type CellGradientDirection,
} from './imageConverterCellMetrics';

const TYPOGRAPHIC_CODE_MASK = buildTypographicCodeMask();

export const MIN_PAIR_DIFF_RATIO = 0.16;
export const CHROMA_BONUS_WEIGHT = 0;
export const EDGE_ALIGNMENT_DETAIL_THRESHOLD = 0.45;
export const EDGE_ALIGNMENT_WEIGHT = 14.0;

type PaletteMetricLike = {
  pairDiff: Float64Array;
  maxPairDiff: number;
};

function asciiToScreenCode(asc: string): number | null {
  if (asc.length !== 1) return null;
  const code = asc.charCodeAt(0);
  if (asc >= 'a' && asc <= 'z') return code - 'a'.charCodeAt(0) + 1;
  if (asc >= 'A' && asc <= 'Z') return code - 'A'.charCodeAt(0) + 0x41;
  if (asc >= '0' && asc <= '9') return code - '0'.charCodeAt(0) + 0x30;

  const punctuation: Record<string, number> = {
    '@': 0,
    '!': 0x21,
    '"': 0x22,
    '#': 0x23,
    '$': 0x24,
    '%': 0x25,
    '&': 0x26,
    '\'': 0x27,
    '(': 0x28,
    ')': 0x29,
    '*': 0x2a,
    '+': 0x2b,
    ',': 0x2c,
    '-': 0x2d,
    '.': 0x2e,
    '/': 0x2f,
    ':': 0x3a,
    ';': 0x3b,
    '<': 0x3c,
    '=': 0x3d,
    '>': 0x3e,
    '?': 0x3f,
  };

  return punctuation[asc] ?? null;
}

function buildTypographicCodeMask(): Uint8Array {
  const mask = new Uint8Array(256);
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
    '@!"#$%&\'()*+,-./:;<=>?';

  for (const ch of chars) {
    const code = asciiToScreenCode(ch);
    if (code !== null) mask[code] = 1;
  }

  return mask;
}

export function isTypographicScreencode(code: number): boolean {
  return code >= 0 && code < TYPOGRAPHIC_CODE_MASK.length && TYPOGRAPHIC_CODE_MASK[code] === 1;
}

export function hasMinimumContrast(
  metrics: PaletteMetricLike,
  fg: number,
  bg: number,
  minimumRatio = MIN_PAIR_DIFF_RATIO
): boolean {
  return metrics.pairDiff[fg * 16 + bg] >= metrics.maxPairDiff * minimumRatio;
}

export function computeHuePreservationBonus(
  sourceA: number,
  sourceB: number,
  renderedA: number,
  renderedB: number,
  weight = CHROMA_BONUS_WEIGHT
): number {
  const sourceChroma = Math.hypot(sourceA, sourceB);
  const renderedChroma = Math.hypot(renderedA, renderedB);
  if (sourceChroma < 0.015 || renderedChroma < 0.015) return 0;

  const sourceHue = Math.atan2(sourceB, sourceA);
  const renderedHue = Math.atan2(renderedB, renderedA);
  let hueDiff = Math.abs(sourceHue - renderedHue);
  if (hueDiff > Math.PI) hueDiff = 2 * Math.PI - hueDiff;

  const similarity = 1 - (hueDiff / Math.PI);
  return weight * Math.min(sourceChroma, renderedChroma) * similarity;
}

export function computeCsfPenalty(
  detailScore: number,
  glyphSpatialFrequency: number,
  csfWeight: number
): number {
  if (csfWeight <= 0) return 0;
  return csfWeight * glyphSpatialFrequency * Math.max(0, 1 - detailScore);
}

export function computeDirectionalAlignmentBonus(
  detailScore: number,
  cellDirection: CellGradientDirection,
  glyphDirection: CellGradientDirection,
  detailThreshold = EDGE_ALIGNMENT_DETAIL_THRESHOLD,
  alignmentWeight = EDGE_ALIGNMENT_WEIGHT
): number {
  if (detailScore < detailThreshold || cellDirection === CELL_GRADIENT_ISOTROPIC) {
    return 0;
  }

  const detailStrength = Math.max(0, Math.min(1, (detailScore - detailThreshold) / Math.max(1e-6, 1 - detailThreshold)));
  if (glyphDirection === cellDirection) {
    return alignmentWeight * (0.35 + 0.65 * detailStrength);
  }
  if (glyphDirection === CELL_GRADIENT_ISOTROPIC) {
    return alignmentWeight * 0.15 * detailStrength;
  }
  return 0;
}
