import { framebufFromJson } from '../../redux/workspace';
import { Framebuf } from '../../redux/types';

export function loadSDD(content: string): Framebuf[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  const screenModeEl = doc.querySelector('ScreenMode');
  const screenMode = screenModeEl ? parseInt(screenModeEl.textContent ?? '0') : 0;
  const isExtended = screenMode === 2;
  const isMcm = screenMode === 1 || screenMode === 4;

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
    const bk1El = screenEl.querySelector('BK1Colour');
    const bk2El = screenEl.querySelector('BK2Colour');
    const paletteIdEl = screenEl.querySelector('PaletteId');

    const backgroundColor = bgEl ? parseInt(bgEl.textContent ?? '6') : 6;
    const borderColor = borderEl ? parseInt(borderEl.textContent ?? '14') : 14;
    const name = nameEl ? (nameEl.textContent?.trim() ?? 'Screen') : 'Screen';
    const d022Color = d022El ? parseInt(d022El.textContent ?? '0') : 0;
    const d023Color = d023El ? parseInt(d023El.textContent ?? '0') : 0;
    const d024Color = d024El ? parseInt(d024El.textContent ?? '0') : 0;
    const bk1Color = bk1El ? parseInt(bk1El.textContent ?? '0') : NaN;
    const bk2Color = bk2El ? parseInt(bk2El.textContent ?? '0') : NaN;
    const paletteId = paletteIdEl?.textContent?.trim() || undefined;

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
      fbData.extBgColor1 = d022Color;
      fbData.extBgColor2 = d023Color;
      fbData.extBgColor3 = d024Color;
    }
    if (isMcm) {
      fbData.mcmMode = true;
      // Screen Designer stores MCM shared colors in BK1/BK2.
      // D022/D023 may differ in some files, so prefer BK1/BK2 and fallback.
      fbData.mcmColor1 = Number.isNaN(bk1Color) ? d022Color : bk1Color;
      fbData.mcmColor2 = Number.isNaN(bk2Color) ? d023Color : bk2Color;
    }
    if (paletteId) {
      fbData.paletteId = paletteId;
    }
    framebufs.push(framebufFromJson(fbData));
  });

  return framebufs;
}
