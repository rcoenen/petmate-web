import { framebufFromJson } from '../../redux/workspace';
import { Framebuf } from '../../redux/types';

export function loadSDD(content: string): Framebuf[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  const screenModeEl = doc.querySelector('ScreenMode');
  const isExtended = screenModeEl ? parseInt(screenModeEl.textContent ?? '0') === 2 : false;

  const screenEls = doc.querySelectorAll('Screen');
  const framebufs: Framebuf[] = [];

  screenEls.forEach(screenEl => {
    const width = 40;
    const height = 25;

    const bgEl = screenEl.querySelector('BackgroundColour');
    const borderEl = screenEl.querySelector('BorderColour');
    const nameEl = screenEl.querySelector('Description');
    const d022El = screenEl.querySelector('D022Colour');
    const d023El = screenEl.querySelector('D023Colour');
    const d024El = screenEl.querySelector('D024Colour');

    const backgroundColor = bgEl ? parseInt(bgEl.textContent ?? '6') : 6;
    const borderColor = borderEl ? parseInt(borderEl.textContent ?? '14') : 14;
    const name = nameEl ? (nameEl.textContent?.trim() ?? 'Screen') : 'Screen';
    const extBgColor1 = d022El ? parseInt(d022El.textContent ?? '0') : 0;
    const extBgColor2 = d023El ? parseInt(d023El.textContent ?? '0') : 0;
    const extBgColor3 = d024El ? parseInt(d024El.textContent ?? '0') : 0;

    const rowEls = screenEl.querySelectorAll('RowData');
    const pixels: { code: number; color: number }[][] = [];

    rowEls.forEach(rowEl => {
      const cells = (rowEl.textContent ?? '').split(',');
      const rowPixels: { code: number; color: number }[] = [];
      for (let col = 0; col < width; col++) {
        const cell = cells[col] ?? '200E700';
        // Token: [0][1]=charHex, [2]=padding, [3]=colorHex, [4]=luminance, [5]=bank, [6]=padding
        let code = parseInt(cell[0] + cell[1], 16);
        const color = parseInt(cell[3], 16);
        if (isExtended && cell[5]) {
          if (cell[5] === '1') code += 64;
          else if (cell[5] === '2') code += 128;
          else if (cell[5] === '3') code += 192;
        }
        rowPixels.push({
          code: isNaN(code) ? 32 : code,
          color: isNaN(color) ? 14 : color,
        });
      }
      pixels.push(rowPixels);
    });

    const fbData: any = {
      width,
      height,
      backgroundColor,
      borderColor,
      charset: 'upper',
      name,
      framebuf: pixels,
    };
    if (isExtended) {
      fbData.ecmMode = true;
      fbData.extBgColor1 = extBgColor1;
      fbData.extBgColor2 = extBgColor2;
      fbData.extBgColor3 = extBgColor3;
    }
    framebufs.push(framebufFromJson(fbData));
  });

  return framebufs;
}
