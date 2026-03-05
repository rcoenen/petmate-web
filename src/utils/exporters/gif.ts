
import { framebufToPixelsIndexed, computeOutputImageDims } from './util'
import { FramebufWithFont, RgbPalette, FileFormatGif } from  '../../redux/types';
import { GIFEncoder } from 'gifenc';

export function saveGIF(fbs: FramebufWithFont[], palette: RgbPalette, fmt: FileFormatGif): Uint8Array {
  const options = fmt.exportOptions;
  const selectedFb = fbs[fmt.commonExportParams.selectedFramebufIndex]

  const { imgWidth, imgHeight } = computeOutputImageDims(selectedFb, options.borders);

  // gifenc palette: array of [r, g, b] tuples
  const gifPalette: [number, number, number][] = palette.map(({r, g, b}) => [r, g, b]);

  const delayMS = (() => {
    if (options.delayMS === '') return 250;
    const delay = parseInt(options.delayMS, 10)
    return (!isNaN(delay) && delay > 0 && delay < 10*1000) ? delay : 250;
  })();

  // repeat: -1=once, 0=forever
  const repeat = options.loopMode === 'once' ? -1 : 0;

  // GIFEncoder in auto mode: writeFrame handles header automatically on first frame
  const encoder = GIFEncoder();

  function addFrame(fb: FramebufWithFont, isFirst: boolean) {
    const indexed = framebufToPixelsIndexed(fb, options.borders);
    encoder.writeFrame(indexed, imgWidth, imgHeight, {
      palette: isFirst ? gifPalette : undefined,
      delay: delayMS,
      repeat,
      first: isFirst,
    });
  }

  if (options.animMode !== 'anim' || fbs.length == 1) {
    addFrame(selectedFb, true);
  } else {
    for (let fidx = 0; fidx < fbs.length; fidx++) {
      addFrame(fbs[fidx], fidx === 0);
    }
    if (options.loopMode === 'pingpong') {
      for (let fidx = fbs.length-2; fidx >= 1; fidx--) {
        addFrame(fbs[fidx], false);
      }
    }
  }

  encoder.finish();
  return encoder.bytes();
}
