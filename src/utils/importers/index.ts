
import { framebufFromJson } from '../../redux/workspace'
import { chunkArray } from '../../utils'
import { Framebuf } from '../../redux/types'

function screencodeColorMap(charcodes: number[], colors: number[]) {
  return charcodes.map((c,i) => {
    return {
      code: c,
      color: colors[i]
    }
  })
}

export function loadMarqCFramebuf(content: string): Framebuf[] {
  const lines = content.split('\n')

  let width = 40;
  let height = 25;
  let frames: number[][] = [];
  let charset = 'upper';
  let bytes: number[] = []
  for (let li = 0; li < lines.length; li++) {
    let line = lines[li]
    if (/unsigned char (.*)\[\].*/.exec(line)) {
      continue
    }
    if (/};.*/.exec(line)) {
      frames.push(bytes)
      bytes = []
      continue
    }
    let m = line.match(/^\/\/ META:(.*)/);
    if (m) {
      m = m[1].match(/\s*(\d+) (\d+) .* (upper|lower)/);
      if (m) {
        width = parseInt(m[1]);
        height = parseInt(m[2]);
        charset = m[3];
      }
      break;
    }
    let str = line.trim()
    if (str[str.length-1] === ',') {
      str = str.substring(0, str.length - 1);
    }
    let arr = JSON.parse(`[${str}]`)
    arr.forEach((byte: number) => {
      bytes.push(byte)
    })
  }

  return frames.map(frame => {
    const bytes = frame;
    const nb = width*height;
    const charcodes = bytes.slice(2, nb+2)
    const colors = bytes.slice(nb+2, nb*2+2)
    const codes = screencodeColorMap(charcodes, colors)
    return framebufFromJson({
      width,
      height,
      backgroundColor: bytes[1],
      borderColor: bytes[0],
      charset,
      framebuf: chunkArray(codes, width)
    })
  })
}

export { loadD64Framebuf } from './d64'
export { loadSeq } from './seq2petscii'
export { loadSDD } from './importSdd'
export { loadVCE } from './vce'
export { analyzeVCE } from './vce'
