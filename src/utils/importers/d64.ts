
import * as c1541 from 'c1541';
import { framebufFromJson } from '../../redux/workspace';
import { DEFAULT_BACKGROUND_COLOR, DEFAULT_BORDER_COLOR } from '../../redux/editor';
import { Pixel, Framebuf } from '../../redux/types';

export function loadD64Framebuf(content: Uint8Array): Framebuf | undefined {
  try {
    const dirEntries = c1541.readDirectory(content);
    return framebufFromJson({
      width: 16,
      height: dirEntries.length,
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
      borderColor: DEFAULT_BORDER_COLOR,
      framebuf: dirEntries.map((de: any) => {
        const pixels: Pixel[] = [];
        de.screencodeName.forEach((code: number) => {
          pixels.push({ code, color: DEFAULT_BORDER_COLOR });
        });
        return pixels;
      })
    })
  } catch(e) {
    console.error('Failed to load D64:', e)
    return undefined;
  }
}
