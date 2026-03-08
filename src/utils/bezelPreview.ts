
import { FramebufWithFont, RgbPalette } from '../redux/types';
import { framebufToPixels, computeOutputImageDims } from './exporters/util';

const BEZEL_W = 1280;
const BEZEL_H = 720;
const SCREEN_X = 325;
const SCREEN_Y = 95;
const SCREEN_W = 623;
const SCREEN_H = 441;

export async function openBezelPreview(fb: FramebufWithFont, palette: RgbPalette): Promise<void> {
  // The bezel preview should show the full C64 output frame, including the border.
  const { imgWidth, imgHeight } = computeOutputImageDims(fb, true);
  const pixBuf = framebufToPixels(fb, palette, true);

  const petsciiCanvas = document.createElement('canvas');
  petsciiCanvas.width = imgWidth;
  petsciiCanvas.height = imgHeight;
  petsciiCanvas.getContext('2d')!.putImageData(
    new ImageData(new Uint8ClampedArray(pixBuf), imgWidth, imgHeight), 0, 0
  );

  const canvas = document.createElement('canvas');
  canvas.width = BEZEL_W;
  canvas.height = BEZEL_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(petsciiCanvas, SCREEN_X, SCREEN_Y, SCREEN_W, SCREEN_H);

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, BEZEL_W, BEZEL_H); resolve(); };
    img.onerror = reject;
    img.src = import.meta.env.BASE_URL + 'assets/commodore_1702_bezel.webp';
  });

  const dataUrl = canvas.toDataURL('image/png');

  // Build an overlay div in the current document so requestFullscreen works
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'height:100%;width:auto;display:block';
  overlay.appendChild(img);

  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.remove();
  };
  overlay.addEventListener('click', close);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) overlay.remove();
  }, { once: true });

  document.body.appendChild(overlay);
  overlay.requestFullscreen().catch(() => {});
}
