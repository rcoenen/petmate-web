import { inflateSync, unzlibSync } from 'fflate';
import { framebufFromJson } from '../../redux/workspace';
import { Pixel, Framebuf } from '../../redux/types';

const VCE_MAGIC = 'VCE\0';
const HEADER_SIZE = 12;
const INNER_HEADER_SIZE = 25;
const SCREEN_CELLS = 40 * 25; // 1000
const BORDER_COLOR_OFFSET = 19;
const BACKGROUND_COLOR_OFFSET = 20;
const MODE_FLAGS_OFFSET = 21;

export interface VCEAnalysis {
  // Retro Debugger VCE header byte at offset 21. We currently treat 0/1 as
  // standard PETSCII charset variants and values >1 as unsupported/custom.
  charsetMode: number;
  hasUnsupportedCharsetMode: boolean;
}

function decompressVCEPayload(content: Uint8Array): Uint8Array {
  if (content.length < HEADER_SIZE) {
    throw new Error(`VCE file too small: ${content.length} bytes`);
  }

  // Verify magic bytes
  const magic = String.fromCharCode(content[0], content[1], content[2], content[3]);
  if (magic !== VCE_MAGIC) {
    throw new Error('Not a valid VCE file');
  }

  // Decompress zlib payload starting after file header.
  const compressed = content.slice(HEADER_SIZE);
  try {
    return unzlibSync(compressed);
  } catch (_e) {
    // Fallback for files that may contain a raw deflate stream.
    return inflateSync(compressed);
  }
}

export function analyzeVCE(content: Uint8Array): VCEAnalysis {
  const data = decompressVCEPayload(content);
  if (data.length < INNER_HEADER_SIZE) {
    throw new Error(`VCE payload too small: ${data.length} bytes (need ${INNER_HEADER_SIZE})`);
  }
  const charsetMode = data[MODE_FLAGS_OFFSET] ?? 0;
  return {
    charsetMode,
    hasUnsupportedCharsetMode: charsetMode > 1,
  };
}

export function loadVCE(content: Uint8Array): Framebuf[] {
  const data = decompressVCEPayload(content);

  const minRequired = INNER_HEADER_SIZE + SCREEN_CELLS + SCREEN_CELLS;
  if (data.length < minRequired) {
    throw new Error(`VCE payload too small: ${data.length} bytes (need ${minRequired})`);
  }

  // Retro Debugger stores border/background in the inner VCE header.
  const borderColor = data[BORDER_COLOR_OFFSET] & 0x0F;
  const backgroundColor = data[BACKGROUND_COLOR_OFFSET] & 0x0F;

  // NOTE: Petsciishop is currently a PETSCII editor (ROM charsets only).
  // This importer reads VCE screen codes + colors as PETSCII cells, but does
  // not import custom charsets/bitmap glyph data from VCE projects.
  // For artwork relying on custom chars/bitmap shapes, visual fidelity will be limited.
  // Build pixel grid from screencodes (offset 25) and colors (offset 1025)
  const framebuf: Pixel[][] = [];
  for (let row = 0; row < 25; row++) {
    const rowPixels: Pixel[] = [];
    for (let col = 0; col < 40; col++) {
      const idx = row * 40 + col;
      rowPixels.push({
        code: data[INNER_HEADER_SIZE + idx],
        color: data[INNER_HEADER_SIZE + SCREEN_CELLS + idx] & 0x0F,
      });
    }
    framebuf.push(rowPixels);
  }

  const result = framebufFromJson({
    width: 40,
    height: 25,
    backgroundColor,
    borderColor,
    // Keep imported VCE content in standard PETSCII space for now.
    charset: 'upper',
    framebuf,
  });
  return [result];
}
