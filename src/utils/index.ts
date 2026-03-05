
import { loadMarqCFramebuf, loadD64Framebuf, loadSeq, loadSDD } from './importers'
import {
  savePNG,
  saveMarqC,
  saveExecutablePRG,
  saveAsm,
  saveBASIC,
  saveGIF,
  saveJSON,
  saveSEQ,
  savePET
} from './exporters'
import { saveSDD } from './exporters/exportSdd'
import { showAlert } from './dialog'

import {
  drawLine
} from './line'

import { colorPalettes } from './palette'

import {
  pickAndReadFile,
  pickAndReadTextFile,
  downloadBlob,
  setTitle
} from './webPlatform'

import {
  FileFormat, Rgb, Font, Coord2, Framebuf, Settings,
  FramebufWithFont,
  RootState,
  WsCustomFontsV2
} from '../redux/types';

import * as ReduxRoot from '../redux/root';
import * as selectors from '../redux/selectors';
import * as customFonts from '../redux/customFonts'

const defaultExportCommon = {
  selectedFramebufIndex: 0
}

export const formats: { [index: string]: FileFormat } = {
  png: {
    name: 'PNG .png',
    ext: 'png',
    commonExportParams: defaultExportCommon,
    exportOptions: {
      borders: false,
      alphaPixel: false,
      scale: 1
    }
  },
  seq: {
    name: 'PETSCII .seq',
    ext: 'seq',
    commonExportParams: defaultExportCommon,
    exportOptions: {
      insCR: false,
      insClear: true,
      stripBlanks: false
    }
  },
  c: {
    name: 'PETSCII .c',
    ext: 'c',
    commonExportParams: defaultExportCommon,
  },
  d64: {
    name: 'D64 disk image .d64',
    ext: 'd64',
    commonExportParams: defaultExportCommon,
  },
  prg: {
    name: 'Executable .prg',
    ext: 'prg',
    commonExportParams: defaultExportCommon,
  },
  asm: {
    name: 'Assembler source .asm',
    ext: 'asm',
    commonExportParams: defaultExportCommon,
    exportOptions: {
      currentScreenOnly: true,
      standalone: false,
      hex: false,
      assembler: 'kickass'
    }
  },
  bas: {
    name: 'BASIC listing .bas',
    ext: 'bas',
    commonExportParams: defaultExportCommon,
    exportOptions: {
      currentScreenOnly: true,
      standalone: true
    }
  },
  gif: {
    name: 'GIF .gif',
    ext: 'gif',
    commonExportParams: defaultExportCommon,
    exportOptions: {
      borders: false,
      animMode: 'single',
      loopMode: 'loop',
      delayMS: '250'
    }
  },
  json: {
    name: 'JSON .json',
    ext: 'json',
    commonExportParams: defaultExportCommon,
    exportOptions: {
      currentScreenOnly: true
    }
  },
  pet: {
    name: 'C64 Raster Effect Editor .pet',
    ext: 'pet',
    commonExportParams: defaultExportCommon,
  },
  sdd: {
    name: 'Screen Designer Data .sdd',
    ext: 'sdd',
    commonExportParams: defaultExportCommon,
  },
}

export function rgbToCssRgb(o: Rgb) {
  return `rgb(${o.r}, ${o.g}, ${o.b}`
}

export function colorIndexToCssRgb(palette: Rgb[], idx: number) {
  return rgbToCssRgb(palette[idx])
}

export function luminance (color: Rgb): number {
  const r = color.r / 255
  const g = color.g / 255
  const b = color.b / 255
  return (r + r + b + g + g + g) / 6
}

export const charOrderUpper = [ 32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 46, 44, 59, 33, 63, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 34, 35, 36, 37, 38, 39, 112, 110, 108, 123, 85, 73, 79, 80, 113, 114, 40, 41, 60, 62, 78, 77, 109, 125, 124, 126, 74, 75, 76, 122, 107, 115, 27, 29, 31, 30, 95, 105, 100, 111, 121, 98, 120, 119, 99, 116, 101, 117, 97, 118, 103, 106, 91, 43, 82, 70, 64, 45, 67, 68, 69, 84, 71, 66, 93, 72, 89, 47, 86, 42, 61, 58, 28, 0, 127, 104, 92, 102, 81, 87, 65, 83, 88, 90, 94, 96, 160, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 174, 172, 187, 161, 191, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 162, 163, 164, 165, 166, 167, 240, 238, 236, 251, 213, 201, 207, 208, 241, 242, 168, 169, 188, 190, 206, 205, 237, 253, 252, 254, 202, 203, 204, 250, 235, 243, 155, 157, 159, 158, 223, 233, 228, 239, 249, 226, 248, 247, 227, 244, 229, 245, 225, 246, 231, 234, 219, 171, 210, 198, 192, 173, 195, 196, 197, 212, 199, 194, 221, 200, 217, 175, 214, 170, 189, 186, 156, 128, 255, 232, 220, 230, 209, 215, 193, 211, 216, 218, 222, 224 ]
export const charOrderLower = [ 32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 46, 44, 59, 33, 63, 96, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 34, 35, 36, 37, 38, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 43, 45, 42, 61, 39, 0, 112, 110, 108, 123, 113, 114, 40, 41, 95, 105, 92, 127, 60, 62, 28, 47, 109, 125, 124, 126, 107, 115, 27, 29, 94, 102, 104, 58, 30, 31, 91, 122, 100, 111, 121, 98, 99, 119, 120, 101, 116, 117, 97, 103, 106, 118, 64, 93, 160, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 174, 172, 187, 161, 191, 224, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 162, 163, 164, 165, 166, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 171, 173, 170, 189, 167, 128, 240, 238, 236, 251, 241, 242, 168, 169, 223, 233, 220, 255, 188, 190, 156, 175, 237, 253, 252, 254, 235, 243, 155, 157, 222, 230, 232, 186, 158, 159, 219, 250, 228, 239, 249, 226, 227, 247, 248, 229, 244, 245, 225, 231, 234, 246, 192, 221 ]

export const charScreencodeFromRowCol = (font: Font, {row, col}: Coord2) => {
  if (font === null) {
    return 0xa0
  }
  if (row < 0 || row >= 16 ||
      col < 0 || col >= 16) {
    return null
  }
  const idx = row*16 + col
  return font.charOrder[idx]
}

export const rowColFromScreencode = (font: Font, code: number) => {
  const charOrder = font.charOrder
  for (let i = 0; i < charOrder.length; i++) {
    if (charOrder[i] === code) {
      return {
        row: Math.floor(i >> 4),
        col: Math.floor(i & 15)
      }
    }
  }
  throw new Error('rowColFromScreencode - the impossible happened');
}

const framebufFields = (framebuf: Framebuf) => {
  return {
    width: framebuf.width,
    height: framebuf.height,
    backgroundColor: framebuf.backgroundColor,
    borderColor: framebuf.borderColor,
    charset: framebuf.charset,
    name: framebuf.name,
    framebuf: framebuf.framebuf,
  }
}

// Returns data for the given format. The caller downloads it.
async function getExportData(
  fmt: FileFormat,
  framebufs: FramebufWithFont[],
  fonts: customFonts.CustomFonts,
  palette: Rgb[]
): Promise<{ data: string | Uint8Array | Blob; mimeType: string }> {
  const { selectedFramebufIndex } = fmt.commonExportParams;
  const selectedFramebuf = framebufs[selectedFramebufIndex];

  if (fmt.ext === 'png') {
    return { data: await savePNG(selectedFramebuf, palette, fmt as any), mimeType: 'image/png' };
  } else if (fmt.ext === 'seq') {
    return { data: saveSEQ(selectedFramebuf, fmt as any), mimeType: 'application/octet-stream' };
  } else if (fmt.ext === 'gif') {
    return { data: saveGIF(framebufs, palette, fmt as any), mimeType: 'image/gif' };
  } else if (fmt.ext === 'c') {
    return { data: saveMarqC(framebufs, fmt), mimeType: 'text/plain' };
  } else if (fmt.ext === 'asm') {
    return { data: saveAsm(framebufs, fmt as any), mimeType: 'text/plain' };
  } else if (fmt.ext === 'prg') {
    return { data: saveExecutablePRG(selectedFramebuf, fmt as any), mimeType: 'application/octet-stream' };
  } else if (fmt.ext === 'bas') {
    return { data: saveBASIC(framebufs, fmt as any), mimeType: 'text/plain' };
  } else if (fmt.ext === 'json') {
    return { data: saveJSON(framebufs, fonts, fmt as any), mimeType: 'application/json' };
  } else if (fmt.ext === 'pet') {
    return { data: savePET(framebufs, fmt as any), mimeType: 'application/octet-stream' };
  } else if (fmt.ext === 'sdd') {
    return { data: saveSDD(selectedFramebuf), mimeType: 'application/xml' };
  }
  throw new Error("shouldn't happen");
}

type GetFramebufByIdFunc = (fbidx: number) => Framebuf;

function customFontsToJson(cf: customFonts.CustomFonts): WsCustomFontsV2 {
  const res: {[id: string]: any} = {};
  Object.entries(cf).forEach(([id, { name, font }]) => {
    let f: { bits: number[], charOrder: number[] } = font;
    let n: string = name;
    res[id] = { name: n, font: f };
  });
  return res;
}

const WORKSPACE_VERSION = 2;

export function buildWorkspaceJson(
  screens: number[],
  getFramebufById: GetFramebufByIdFunc,
  cf: customFonts.CustomFonts,
): string {
  return JSON.stringify({
    version: WORKSPACE_VERSION,
    screens: screens.map((_t,idx) => idx),
    framebufs: screens.map(fbid => ({ ...framebufFields(getFramebufById(fbid)) })),
    customFonts: customFontsToJson(cf)
  });
}

export function saveWorkspace(
  screens: number[],
  getFramebufById: GetFramebufByIdFunc,
  cf: customFonts.CustomFonts,
  updateLastSavedSnapshot: () => void
) {
  const content = buildWorkspaceJson(screens, getFramebufById, cf);
  downloadBlob(content, 'workspace.petmate', 'application/json');
  updateLastSavedSnapshot();
}

export async function loadFramebuf(content: string | Uint8Array, ext: string): Promise<Framebuf[]> {
  if (ext === '.c') {
    return loadMarqCFramebuf(content as string);
  } else if (ext === '.d64') {
    const fb = loadD64Framebuf(content as Uint8Array);
    return fb !== undefined ? [fb] : [];
  } else if (ext === '.seq') {
    const fb = loadSeq(content as Uint8Array);
    return [fb];
  } else if (ext === '.sdd') {
    return loadSDD(content as string);
  }
  return [];
}

export const sortRegion = (region: { min: Coord2, max: Coord2}) => {
  const { min, max } = region;
  const minx = Math.min(min.col, max.col)
  const miny = Math.min(min.row, max.row)
  const maxx = Math.max(min.col, max.col)
  const maxy = Math.max(min.row, max.row)
  return {
    min: {row: miny, col: minx},
    max: {row: maxy, col: maxx},
  }
}

export function chunkArray<T>(myArray: T[], chunk_size: number){
    var index = 0;
    var arrayLength = myArray.length;
    var tempArray = [];
    for (index = 0; index < arrayLength; index += chunk_size) {
        const myChunk = myArray.slice(index, index+chunk_size);
        tempArray.push(myChunk);
    }
    return tempArray;
}

export function setWorkspaceFilenameWithTitle(setWorkspaceFilename: (fname: string) => void, filename: string) {
  setWorkspaceFilename(filename)
  setTitle(`Petsciishop - ${filename}`)
}

type StoreDispatch = any;

export async function loadWorkspaceNoDialog(dispatch: StoreDispatch, content: string, name: string) {
  try {
    const c = JSON.parse(content);
    dispatch(ReduxRoot.actions.openWorkspace(c, name));
  } catch(e) {
    console.error('Failed to load workspace:', e);
  }
}

export async function dialogLoadWorkspace(dispatch: StoreDispatch) {
  try {
    const { text, name } = await pickAndReadTextFile('.petmate');
    const c = JSON.parse(text);
    dispatch(ReduxRoot.actions.openWorkspace(c, name));
  } catch (_e) {
    // User cancelled or parse error — no action
  }
}

export async function dialogSaveAsWorkspace(
  screens: number[],
  getFramebufByIndex: (fbidx: number) => Framebuf,
  cf: customFonts.CustomFonts,
  setWorkspaceFilename: (fname: string) => void,
  updateLastSavedSnapshot: () => void
) {
  const content = buildWorkspaceJson(screens, getFramebufByIndex, cf);
  downloadBlob(content, 'workspace.petmate', 'application/json');
  updateLastSavedSnapshot();
  setWorkspaceFilenameWithTitle(setWorkspaceFilename, 'workspace.petmate');
}

export async function dialogExportFile(
  fmt: FileFormat,
  framebufs: FramebufWithFont[],
  cf: customFonts.CustomFonts,
  palette: Rgb[]
) {
  try {
    const { data, mimeType } = await getExportData(fmt, framebufs, cf, palette);
    const screenName = framebufs[fmt.commonExportParams.selectedFramebufIndex]?.name;
    const baseName = screenName ? screenName.replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim() || 'export' : 'export';
    downloadBlob(data, `${baseName}.${fmt.ext}`, mimeType);
  } catch(e: any) {
    showAlert(`Export failed: ${e.message ?? e}`);
    console.error(e);
  }
}

export async function dialogImportFile(type: FileFormat, importFile: (fbs: Framebuf[]) => void) {
  try {
    const ext = `.${type.ext}`;
    if (type.ext === 'c' || type.ext === 'sdd') {
      const { text } = await pickAndReadTextFile(`.${type.ext}`);
      const fbs = await loadFramebuf(text, ext);
      if (fbs.length > 0) importFile(fbs);
    } else {
      const { data } = await pickAndReadFile(`.${type.ext}`);
      const fbs = await loadFramebuf(new Uint8Array(data), ext);
      if (fbs.length > 0) importFile(fbs);
    }
  } catch(_e) {
    // User cancelled — no action
  }
}

const SETTINGS_KEY = 'petsciishop-settings';

export function loadSettings(dispatchSettingsLoad: (json: Settings) => void) {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      dispatchSettingsLoad(JSON.parse(raw));
    }
  } catch(e) {
    console.error('Failed to load settings:', e);
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch(e) {
    console.error('Failed to save settings:', e);
  }
}

export async function promptProceedWithUnsavedChanges(state: RootState, msg: { title: string, detail: string }): Promise<boolean> {
  if (selectors.anyUnsavedChanges(state)) {
    return (await import('./dialog')).showConfirm(`Workspace contains unsaved changes.\n\n${msg.detail}`);
  }
  return true;
}

export { drawLine, colorPalettes }
