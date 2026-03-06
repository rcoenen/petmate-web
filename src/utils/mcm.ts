export function mcmIsMulticolorCell(colorRam: number): boolean {
  return colorRam >= 8;
}

export function mcmForegroundColor(colorRam: number): number {
  return colorRam & 7;
}

export function mcmColorRam(fgColor: number, isMulticolor: boolean): number {
  return isMulticolor ? (fgColor | 8) : fgColor;
}

export function mcmResolveBitPairColor(
  bitPair: number,
  bgColor: number,
  mc1: number,
  mc2: number,
  fgColor: number
): number {
  if (bitPair === 0) return bgColor;
  if (bitPair === 1) return mc1;
  if (bitPair === 2) return mc2;
  return fgColor;
}
