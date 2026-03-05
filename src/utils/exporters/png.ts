
import { FramebufWithFont, FileFormatPng, RgbPalette } from '../../redux/types'
import { framebufToPixels, scalePixels, computeOutputImageDims } from './util'

export function savePNG(fb: FramebufWithFont, palette: RgbPalette, fmt: FileFormatPng): Promise<Blob> {
  const options = fmt.exportOptions;

  const { imgWidth, imgHeight } = computeOutputImageDims(fb, options.borders);
  const scale = options.scale
  const buf = framebufToPixels(fb, palette, options.borders);
  const pixBuf = scale != 1 ? scalePixels(buf, imgWidth, imgHeight, scale) : buf;

  const outWidth = scale * imgWidth;
  const outHeight = scale * imgHeight;

  if (options.alphaPixel) {
    pixBuf[3] = 254;
  }

  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d')!;
  const imageData = new ImageData(new Uint8ClampedArray(pixBuf), outWidth, outHeight);
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode PNG'));
    }, 'image/png');
  });
}
