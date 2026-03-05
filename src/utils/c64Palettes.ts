/**
 * C64 colour palettes — single source of truth.
 *
 * Each entry defines how the 16 C64 colour indices (0–15) map to RGB.
 * Palette data sourced from the c64-petscii-editor project and cross-
 * referenced with petscii.krissz.hu.
 *
 * Colour order: black, white, red, cyan, purple, green, blue, yellow,
 *               orange, brown, light red, dark grey, grey, light green,
 *               light blue, light grey.
 */

export interface C64Palette {
  id: string;
  name: string;
  description: string;
  hex: string[]; // 16 entries, e.g. '#000000'
}

export const C64_PALETTES: C64Palette[] = [
  {
    id: 'colodore',
    name: 'Colodore',
    description: 'Calculated by Philip "Pepto" Timmermann using a mathematical model of the VIC-II chip (2017). Widely considered the most accurate modern reference.',
    hex: [
      '#000000', '#FFFFFF', '#813338', '#75CEC8',
      '#8E3C97', '#56AC4D', '#2E2C9B', '#EDF171',
      '#8E5029', '#553800', '#C46C71', '#4A4A4A',
      '#7B7B7B', '#A9FF9F', '#706DEB', '#B2B2B2',
    ],
  },
  {
    id: 'pepto-pal',
    name: 'Pepto PAL',
    description: 'Measured by Philip "Pepto" Timmermann from a PAL C64 using an oscilloscope (2004). The classic reference palette used by many emulators.',
    hex: [
      '#000000', '#FFFFFF', '#68372B', '#70A4B2',
      '#6F3D86', '#588D43', '#352879', '#B8C76F',
      '#6F4F25', '#433900', '#9A6759', '#444444',
      '#6C6C6C', '#9AD284', '#6C5EB5', '#959595',
    ],
  },
  {
    id: 'pepto-pal-old',
    name: 'Pepto PAL (old)',
    description: 'Earlier PAL measurement by Pepto, before the 2004 revision. Slightly warmer tones.',
    hex: [
      '#000000', '#FFFFFF', '#58291D', '#91C6D5',
      '#915CA8', '#588D43', '#352879', '#B8C76F',
      '#916F43', '#433900', '#9A6759', '#353535',
      '#747474', '#9AD284', '#7466BE', '#B8B8B8',
    ],
  },
  {
    id: 'pepto-ntsc',
    name: 'Pepto NTSC',
    description: 'Measured by Pepto from an NTSC C64. Slightly different hues from the PAL version due to NTSC colour encoding.',
    hex: [
      '#000000', '#FFFFFF', '#67372B', '#70A3B1',
      '#6F3D86', '#588C42', '#342879', '#B7C66E',
      '#6F4E25', '#423800', '#996659', '#434343',
      '#6B6B6B', '#9AD183', '#6B5EB5', '#959595',
    ],
  },
  {
    id: 'pepto-ntsc-sony',
    name: 'Pepto NTSC (Sony)',
    description: 'Pepto NTSC measurement taken with a Sony monitor. Cooler whites and slightly shifted mid-tones.',
    hex: [
      '#000000', '#FFFFFF', '#7C352B', '#5AA6B1',
      '#694185', '#5D8643', '#212E78', '#CFBE6F',
      '#894A26', '#5B3300', '#AF6459', '#434343',
      '#6B6B6B', '#A0CB84', '#5665B3', '#959595',
    ],
  },
  {
    id: 'vice',
    name: 'VICE',
    description: 'Palette used by the VICE emulator. Vibrant, high-contrast colours common in emulation screenshots.',
    hex: [
      '#000000', '#FDFEFC', '#BE1A24', '#30E6C6',
      '#B41AE2', '#1FD21E', '#211BAE', '#DFF60A',
      '#B84104', '#6A3304', '#FE4A57', '#424540',
      '#70746F', '#59FE59', '#5F53FE', '#A4A7A2',
    ],
  },
  {
    id: 'frodo',
    name: 'Frodo',
    description: 'Palette from the Frodo C64 emulator. Pure primary colours with minimal intermediate shading.',
    hex: [
      '#000000', '#FFFFFF', '#CC0000', '#00FFCC',
      '#FF00FF', '#00CC00', '#0000CC', '#FFFF00',
      '#FF8800', '#884400', '#FF8888', '#444444',
      '#888888', '#88FF88', '#8888FF', '#CCCCCC',
    ],
  },
  {
    id: 'ccs64',
    name: 'CCS64',
    description: 'Palette from the CCS64 emulator by Per Håkan Sundell. Notably bright and saturated.',
    hex: [
      '#191D19', '#FCF9FC', '#933A4C', '#B6FAFA',
      '#D27DED', '#6ACF6F', '#4F44D8', '#FBFB8B',
      '#D89C5B', '#7F5307', '#EF839F', '#575753',
      '#A3A7A7', '#B7FBBF', '#A397FF', '#EFE9E7',
    ],
  },
  {
    id: 'petmate',
    name: 'Petmate',
    description: 'Palette used by the Petmate editor. Included for compatibility with files created in Petmate.',
    hex: [
      '#000000', '#FFFFFF', '#924A40', '#84C5CC',
      '#9351B6', '#72B14B', '#483AA4', '#D5DF7C',
      '#99692D', '#675201', '#C08178', '#606060',
      '#8A8A8A', '#B2EC91', '#867ADE', '#AEAEAE',
    ],
  },
];

/** Look up a palette by id. Returns Colodore as fallback. */
export function getPaletteById(id: string): C64Palette {
  return C64_PALETTES.find(p => p.id === id) ?? C64_PALETTES[0];
}

/** Convert a palette's hex array to {r,g,b} objects. */
export function paletteToRgb(palette: C64Palette): { r: number; g: number; b: number }[] {
  return palette.hex.map(h => ({
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  }));
}
