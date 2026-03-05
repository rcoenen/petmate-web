
import { FramebufWithFont, RgbPalette } from '../../redux/types'
import { ecmCharIndex, ecmCellBgColor } from '../ecm'

// These match what VICE exports as a PNG.
const BORDER_LEFT_WIDTH = 32;
const BORDER_RIGHT_WIDTH = 32;
const BORDER_TOP_HEIGHT = 35;
const BORDER_BOTTOM_HEIGHT = 37;

export function computeOutputImageDims(fb: FramebufWithFont, borders: boolean) {
  const { width, height } = fb;
  const borderLeftWidth = borders ? BORDER_LEFT_WIDTH : 0;  // 384x272 for 320x200
  const borderTopHeight = borders ? BORDER_TOP_HEIGHT : 0;
  let imgWidth = width*8;
  let imgHeight = height*8;
  if (borders) {
    imgWidth  += BORDER_LEFT_WIDTH + BORDER_RIGHT_WIDTH;
    imgHeight += BORDER_TOP_HEIGHT + BORDER_BOTTOM_HEIGHT;
  }
  return { imgWidth, imgHeight, imgXOffset: borderLeftWidth, imgYOffset: borderTopHeight };
}

export function framebufToPixelsIndexed(fb: FramebufWithFont, borders: boolean): Uint8Array  {
  const { width, height, framebuf, backgroundColor, borderColor, font } = fb;
  const fontData = font.bits;
  const { imgWidth, imgHeight, imgXOffset, imgYOffset } = computeOutputImageDims(fb, borders);
  const buf = new Uint8Array(imgWidth * imgHeight);

  buf.fill(borderColor);

  const isEcm = fb.ecmMode;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pix = framebuf[y][x]
      const code = pix.code
      const col = pix.color
      const charIdx = isEcm ? ecmCharIndex(code) : code;
      const cellBg = isEcm ? ecmCellBgColor(fb, code) : backgroundColor;
      const boffs = charIdx*8;

      for (let cy = 0; cy < 8; cy++) {
        const p = fontData[boffs + cy]
        for (let i = 0; i < 8; i++) {
          const set = ((128 >> i) & p) !== 0
          const offs = (y*8 + cy + imgYOffset) * imgWidth + (x*8 + i) + imgXOffset;

          const c = set ? col : cellBg;
          buf[offs] = c;
        }
      }
    }
  }
  return buf
}

export function framebufToPixels(fb: FramebufWithFont, palette: RgbPalette, borders: boolean): Uint8Array {
  const { imgWidth, imgHeight } = computeOutputImageDims(fb, borders);

  const indexedBuf = framebufToPixelsIndexed(fb, borders)
  const buf = new Uint8Array(imgWidth * imgHeight * 4)

  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      const offs = y*imgWidth + x
      const col = palette[indexedBuf[offs]]
      // RGBA order (for Canvas ImageData)
      buf[offs * 4 + 0] = col.r
      buf[offs * 4 + 1] = col.g
      buf[offs * 4 + 2] = col.b
      buf[offs * 4 + 3] = 255
    }
  }
  return buf
}

export function scalePixels(buf: Uint8Array, width: number, height: number, scale: number): Uint8Array {

  const pixelLength = 4;
  const dstPitch = scale * width * pixelLength
  const dst = new Uint8Array(scale * width * scale * height * pixelLength)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcOffs = (x + y * width) * pixelLength
      const r = buf[srcOffs + 0]
      const g = buf[srcOffs + 1]
      const b = buf[srcOffs + 2]
      const a = buf[srcOffs + 3]

      const dstOffs = (x * scale * 4 + scale * y * dstPitch)
      for (let o = 0; o < dstPitch * scale; o += dstPitch) {
        for (let horizontal = 0; horizontal < scale * 4; horizontal+=4) {
          dst[o + dstOffs + 0 + horizontal] = r
          dst[o + dstOffs + 1 + horizontal] = g
          dst[o + dstOffs + 2 + horizontal] = b
          dst[o + dstOffs + 3 + horizontal] = a
        }
      }
    }
  }
  return dst
}
