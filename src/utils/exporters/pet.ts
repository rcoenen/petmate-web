
import { FramebufWithFont, FileFormatPet, Pixel } from  '../../redux/types';

function flatten2d(arr: Pixel[][], field: 'code' | 'color'): number[] {
  const res = [];
  for (let y = 0; y < arr.length; y++) {
    const row = arr[y];
    for (let x = 0; x < row.length; x++) {
      res.push(row[x][field]);
    }
  }
  return res;
}

export function savePET(fbs: FramebufWithFont[], fmt: FileFormatPet): Uint8Array {
  const fb = fbs[fmt.commonExportParams.selectedFramebufIndex]
  let bytes:number[] = []

  bytes.push(fb.width)
  bytes.push(fb.height)
  bytes.push(fb.borderColor)
  bytes.push(fb.backgroundColor)
  bytes.push(fb.charset === 'lower' ? 0 : 1)
  Array.prototype.push.apply(bytes, flatten2d(fb.framebuf, 'code'))
  Array.prototype.push.apply(bytes, flatten2d(fb.framebuf, 'color'))

  return new Uint8Array(bytes);
}
