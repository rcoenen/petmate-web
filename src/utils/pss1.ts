import { deflateSync, inflateSync } from 'fflate';
import { Framebuf } from '../redux/types';
import { CHARSET_LOWER, CHARSET_UPPER } from '../redux/editor';

const SHARE_PREFIX = '#/v/';
const VERSION = 1;
const WIDTH = 40;
const HEIGHT = 25;
const CELL_COUNT = WIDTH * HEIGHT;
const PACKED_COLOR_BYTES = CELL_COUNT / 2;
const MAX_NAME_BYTES = 64;
const MAX_HASH_PAYLOAD_CHARS = 4096;
const MAX_INFLATED_BYTES = 4096;

type ColorModeBits = 0 | 1 | 2;

function colorModeBits(fb: Framebuf): ColorModeBits {
  if (fb.mcmMode) return 1;
  if (fb.ecmMode) return 2;
  return 0;
}

function toColorModeFlags(mode: ColorModeBits) {
  return {
    ecmMode: mode === 2,
    mcmMode: mode === 1
  };
}

function requireNibble(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 15) {
    throw new Error(`Invalid ${label}: expected 0-15`);
  }
  return value;
}

function requireByte(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`Invalid ${label}: expected 0-255`);
  }
  return value;
}

function validateFramebufForShare(fb: Framebuf) {
  if (fb.width !== WIDTH || fb.height !== HEIGHT) {
    throw new Error('Only 40x25 screens can be shared.');
  }
  if (!fb.framebuf || fb.framebuf.length !== HEIGHT || fb.framebuf.some((row) => row.length !== WIDTH)) {
    throw new Error('Invalid framebuffer dimensions.');
  }
  if (fb.charset !== CHARSET_UPPER && fb.charset !== CHARSET_LOWER) {
    throw new Error('Screens with custom fonts cannot be shared via URL.');
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeBase64Url(encoded: string): Uint8Array {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLen = (4 - (normalized.length % 4)) % 4;
  return fromBase64(normalized + '='.repeat(paddingLen));
}

export function encodePSS1(fb: Framebuf): Uint8Array {
  validateFramebufForShare(fb);

  const mode = colorModeBits(fb);
  const hasName = !!fb.name;
  const charsetBit = fb.charset === CHARSET_LOWER ? 1 : 0;
  const nameBytes = hasName ? new TextEncoder().encode(fb.name) : new Uint8Array();
  if (nameBytes.length > MAX_NAME_BYTES) {
    throw new Error(`Screen name too long: max ${MAX_NAME_BYTES} bytes`);
  }

  const headerSize =
    2 +
    (mode === 1 ? 1 : 0) +
    (mode === 2 ? 2 : 0) +
    (hasName ? 1 + nameBytes.length : 0);
  const payload = new Uint8Array(headerSize + CELL_COUNT + PACKED_COLOR_BYTES);

  let ptr = 0;
  payload[ptr++] = ((VERSION & 0x0f) << 4) | ((mode & 0x03) << 2) | ((charsetBit & 0x01) << 1) | (hasName ? 1 : 0);
  payload[ptr++] = (requireNibble(fb.backgroundColor, 'background color') << 4) | requireNibble(fb.borderColor, 'border color');

  if (mode === 1) {
    payload[ptr++] = (requireNibble(fb.mcmColor1 ?? 0, 'MCM shared color 1') << 4) | requireNibble(fb.mcmColor2 ?? 0, 'MCM shared color 2');
  } else if (mode === 2) {
    payload[ptr++] = (requireNibble(fb.extBgColor1 ?? 0, 'ECM background 1') << 4) | requireNibble(fb.extBgColor2 ?? 0, 'ECM background 2');
    payload[ptr++] = (requireNibble(fb.extBgColor3 ?? 0, 'ECM background 3') << 4);
  }

  if (hasName) {
    payload[ptr++] = nameBytes.length;
    payload.set(nameBytes, ptr);
    ptr += nameBytes.length;
  }

  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      payload[ptr++] = requireByte(fb.framebuf[row][col].code, 'screencode');
    }
  }

  for (let i = 0; i < CELL_COUNT; i += 2) {
    const a = fb.framebuf[(i / WIDTH) | 0][i % WIDTH].color;
    const b = fb.framebuf[((i + 1) / WIDTH) | 0][(i + 1) % WIDTH].color;
    payload[ptr++] = (requireNibble(a, 'cell color') << 4) | requireNibble(b, 'cell color');
  }

  return deflateSync(payload);
}

export function decodePSS1(compressed: Uint8Array): Framebuf {
  let inflated: Uint8Array;
  try {
    inflated = inflateSync(compressed);
  } catch {
    throw new Error('Invalid compressed payload.');
  }
  if (inflated.length > MAX_INFLATED_BYTES) {
    throw new Error('Payload too large.');
  }
  if (inflated.length < 2 + CELL_COUNT + PACKED_COLOR_BYTES) {
    throw new Error('Payload too short.');
  }

  let ptr = 0;
  const header = inflated[ptr++];
  const version = (header >> 4) & 0x0f;
  const mode = (header >> 2) & 0x03;
  const charsetBit = (header >> 1) & 0x01;
  const hasName = (header & 0x01) === 1;
  if (version !== VERSION) {
    throw new Error(`Unsupported PSS version: ${version}`);
  }
  if (mode !== 0 && mode !== 1 && mode !== 2) {
    throw new Error('Unsupported color mode.');
  }

  const bgBorder = inflated[ptr++];
  const backgroundColor = (bgBorder >> 4) & 0x0f;
  const borderColor = bgBorder & 0x0f;

  let mcmColor1 = 0;
  let mcmColor2 = 0;
  let extBgColor1 = 0;
  let extBgColor2 = 0;
  let extBgColor3 = 0;

  if (mode === 1) {
    if (ptr >= inflated.length) throw new Error('Malformed payload.');
    const mcm = inflated[ptr++];
    mcmColor1 = (mcm >> 4) & 0x0f;
    mcmColor2 = mcm & 0x0f;
  } else if (mode === 2) {
    if (ptr + 1 >= inflated.length) throw new Error('Malformed payload.');
    const ecm12 = inflated[ptr++];
    const ecm3 = inflated[ptr++];
    extBgColor1 = (ecm12 >> 4) & 0x0f;
    extBgColor2 = ecm12 & 0x0f;
    extBgColor3 = (ecm3 >> 4) & 0x0f;
  }

  let name: string | undefined;
  if (hasName) {
    if (ptr >= inflated.length) throw new Error('Malformed payload.');
    const nameLength = inflated[ptr++];
    if (nameLength > MAX_NAME_BYTES || ptr + nameLength > inflated.length) {
      throw new Error('Invalid name field.');
    }
    name = new TextDecoder().decode(inflated.subarray(ptr, ptr + nameLength));
    ptr += nameLength;
  }

  const remaining = inflated.length - ptr;
  if (remaining !== CELL_COUNT + PACKED_COLOR_BYTES) {
    throw new Error('Payload size mismatch.');
  }

  const framebuf: { code: number; color: number }[][] = [];
  for (let row = 0; row < HEIGHT; row++) {
    const rowPixels: { code: number; color: number }[] = [];
    for (let col = 0; col < WIDTH; col++) {
      rowPixels.push({
        code: inflated[ptr++],
        color: 0
      });
    }
    framebuf.push(rowPixels);
  }

  for (let i = 0; i < CELL_COUNT; i += 2) {
    const packed = inflated[ptr++];
    const rowA = (i / WIDTH) | 0;
    const colA = i % WIDTH;
    const rowB = ((i + 1) / WIDTH) | 0;
    const colB = (i + 1) % WIDTH;
    framebuf[rowA][colA].color = (packed >> 4) & 0x0f;
    framebuf[rowB][colB].color = packed & 0x0f;
  }

  return {
    width: WIDTH,
    height: HEIGHT,
    framebuf,
    backgroundColor,
    borderColor,
    charset: charsetBit ? CHARSET_LOWER : CHARSET_UPPER,
    name,
    ...toColorModeFlags(mode),
    extBgColor1,
    extBgColor2,
    extBgColor3,
    mcmColor1,
    mcmColor2
  };
}

export function framebufToShareURL(fb: Framebuf): string {
  return `${window.location.origin}${window.location.pathname}${SHARE_PREFIX}${encodeBase64Url(encodePSS1(fb))}`;
}

export function parseShareURL(hash: string): Framebuf | null {
  if (!hash.startsWith(SHARE_PREFIX)) {
    return null;
  }
  const payload = hash.slice(SHARE_PREFIX.length);
  if (!payload) {
    throw new Error('Missing share payload.');
  }
  if (payload.length > MAX_HASH_PAYLOAD_CHARS) {
    throw new Error('Share payload too long.');
  }
  return decodePSS1(decodeBase64Url(payload));
}

