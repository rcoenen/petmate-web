
import { chunkArray } from '../../utils'
import { getExecutablePrgTemplate } from '../assetLoader'

import { Framebuf, FileFormat, FileFormatPrg, FramebufWithFont } from '../../redux/types'
import { CHARSET_LOWER } from '../../redux/editor'

import { saveAsm, genAsm } from './asm'
import { saveBASIC } from './basic'
import { saveGIF } from './gif'
import { savePNG } from './png'
import { saveJSON } from './json'
import { saveSEQ } from './seq'
import { savePET } from './pet'

import * as c64jasm from 'c64jasm';

function findBytes(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function bytesToCommaDelimited(dstLines: string[], bytes: number[], bytesPerLine: number) {
  let lines = chunkArray(bytes, bytesPerLine)
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].join(',')
    if (i === lines.length-1) {
      dstLines.push(s)
    } else {
      dstLines.push(`${s},`)
    }
  }
}

function convertToMarqC(lines: string[], fb: Framebuf, idx: number) {
  const { width, height, framebuf, backgroundColor, borderColor } = fb

  const num = String(idx).padStart(4, '0')
  lines.push(`unsigned char frame${num}[]={// border,bg,chars,colors`)

  let bytes = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bytes.push(framebuf[y][x].code)
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      bytes.push(framebuf[y][x].color)
    }
  }
  lines.push(`${borderColor},${backgroundColor},`)
  bytesToCommaDelimited(lines, bytes, width)
  lines.push('};')
}

function saveMarqC(fbs: Framebuf[], _options: FileFormat): string {
  let lines: string[] = []
  fbs.forEach((fb,idx) => convertToMarqC(lines, fb, idx))
  let width = 0
  let height = 0
  let charset = 'upper';
  if (fbs.length >= 1) {
    width = fbs[0].width;
    height = fbs[0].height;
    if (fbs[0].charset === 'lower') {
      charset = 'lower';
    }
  }
  lines.push(`// META: ${width} ${height} C64 ${charset}`)
  return lines.join('\n') + '\n'
}

function exportC64jasmPRG(fb: FramebufWithFont, fmt: FileFormatPrg): Uint8Array {
  const source = genAsm([fb], {
    ...fmt,
    ext: 'asm',
    exportOptions: {
      currentScreenOnly: true,
      standalone: true,
      hex: true,
      assembler: 'c64jasm'
    }
  });

  const sourceFileMap: {[index: string]: string } = {
    "main.asm": source
  }
  const options = {
    readFileSync: (fname: string) => {
      if (fname in sourceFileMap) {
        return new TextEncoder().encode(sourceFileMap[fname]);
      }
      throw new Error(`File not found ${fname}`);
    }
  }
  const res = c64jasm.assemble("main.asm", options);
  if (res.errors.length !== 0) {
    throw new Error("c64jasm.assemble failed, this should not happen.");
  }
  return new Uint8Array(res.prg);
}

function saveExecutablePRG(fb: FramebufWithFont, options: FileFormatPrg): Uint8Array {
  const {
    width,
    height,
    framebuf,
    backgroundColor,
    borderColor,
    charset
  } = fb

  if (width !== 40 || height !== 25) {
    throw new Error('Only 40x25 framebuffer widths are supported!')
  }

  if (!(charset == 'upper' || charset == 'lower')) {
    return exportC64jasmPRG(fb, options);
  }

  let buf = getExecutablePrgTemplate().slice(0)
  // Search for STA $d020
  const d020idx = findBytes(buf, [0x8d, 0x20, 0xd0])
  buf[d020idx - 1] = borderColor
  // Search for STA $d021
  const d021idx = findBytes(buf, [0x8d, 0x21, 0xd0])
  buf[d021idx - 1] = backgroundColor

  if (charset == CHARSET_LOWER) {
    // LDA #$14 -> LDA #$17
    const offs = findBytes(buf, [0x8d, 0x18, 0xd0])
    buf[offs - 1] = 0x17;
  }

  let screencodeOffs = 0x62
  let colorOffs = screencodeOffs + 1000

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      buf[screencodeOffs++] = framebuf[y][x].code
      buf[colorOffs++] = framebuf[y][x].color
    }
  }

  return buf;
}

export {
  savePNG,
  saveMarqC,
  saveExecutablePRG,
  saveAsm,
  saveBASIC,
  saveGIF,
  saveJSON,
  saveSEQ,
  savePET
}
