import { Framebuf } from '../redux/types';

/** Lower 6 bits: index into the first 64 character shapes */
export function ecmCharIndex(code: number): number {
  return code & 0x3F;
}

/** Upper 2 bits: which of the 4 background colors to use */
export function ecmBgSelector(code: number): number {
  return (code >> 6) & 3;
}

/** Build a screencode from a 6-bit char index and a 2-bit bg selector */
export function ecmScreencode(charIndex: number, bgSelector: number): number {
  return (bgSelector << 6) | (charIndex & 0x3F);
}

/** Resolve the background color index for a cell in ECM mode */
export function ecmCellBgColor(fb: Framebuf, code: number): number {
  const sel = ecmBgSelector(code);
  switch (sel) {
    case 0: return fb.backgroundColor;
    case 1: return fb.extBgColor1 ?? 0;
    case 2: return fb.extBgColor2 ?? 0;
    case 3: return fb.extBgColor3 ?? 0;
    default: return fb.backgroundColor;
  }
}
