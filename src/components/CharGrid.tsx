
import React, { Component } from 'react';
import { Rgb, Font, Pixel, Coord2 } from '../redux/types';
import { ecmCharIndex, ecmBgSelector } from '../utils/ecm';
import { mcmForegroundColor, mcmIsMulticolorCell, mcmResolveBitPairColor } from '../utils/mcm';

class CharsetCache {
  private images: ImageData[][] = Array(16);
  private fontBits: number[];
  private palette: Rgb[];

  constructor (
    ctx: CanvasRenderingContext2D,
    fontBits: number[],
    colorPalette: Rgb[]
  ) {
    const data = fontBits
    this.fontBits = fontBits
    this.palette = colorPalette

    for (let colorIdx = 0; colorIdx < 16; colorIdx++) {
      const color = colorPalette[colorIdx]
      this.images[colorIdx] = []

      for (let c = 0; c < 256; c++) {
        const boffs = c*8;

        let dstIdx = 0
        let img = ctx.createImageData(8, 8);
        let bits = img.data

        for (let y = 0; y < 8; y++) {
          const p = data[boffs+y]
          for (let i = 0; i < 8; i++) {
            const v = ((128 >> i) & p) ? 255 : 0
            bits[dstIdx+0] = color.r
            bits[dstIdx+1] = color.g
            bits[dstIdx+2] = color.b
            bits[dstIdx+3] = v
            dstIdx += 4
          }
        }
        this.images[colorIdx].push(img)
      }
    }
  }

  getImage(screencode: number, color: number) {
    return this.images[color][screencode]
  }

  /** ECM: render char shape (lower 6 bits) with explicit bg color */
  getImageWithBg(screencode: number, fgColor: number, bgColor: Rgb, useEcmCharIndex: boolean = true): ImageData {
    const charIdx = useEcmCharIndex ? ecmCharIndex(screencode) : screencode;
    const src = this.images[fgColor][charIdx];
    const img = new ImageData(8, 8);
    const srcData = src.data;
    const dstData = img.data;
    for (let i = 0; i < srcData.length; i += 4) {
      if (srcData[i + 3] === 0) {
        // Transparent pixel = background
        dstData[i]     = bgColor.r;
        dstData[i + 1] = bgColor.g;
        dstData[i + 2] = bgColor.b;
        dstData[i + 3] = 255;
      } else {
        dstData[i]     = srcData[i];
        dstData[i + 1] = srcData[i + 1];
        dstData[i + 2] = srcData[i + 2];
        dstData[i + 3] = 255;
      }
    }
    return img;
  }

  getImageHiresOnMcm(screencode: number, fgColor: number, bgColor: Rgb): ImageData {
    return this.getImageWithBg(screencode, fgColor, bgColor, false);
  }

  getImageMcm(screencode: number, fgColor: number, bgColor: Rgb, mc1Color: Rgb, mc2Color: Rgb): ImageData {
    const img = new ImageData(8, 8);
    const bits = img.data;
    const boffs = screencode * 8;
    const fg = this.palette[fgColor] ?? this.palette[0];
    for (let y = 0; y < 8; y++) {
      const rowBits = this.fontBits[boffs + y];
      for (let pair = 0; pair < 4; pair++) {
        const bitPair = (rowBits >> (6 - pair * 2)) & 0x03;
        const colorIdx = mcmResolveBitPairColor(bitPair, 0, 1, 2, 3);
        const paint =
          colorIdx === 0 ? bgColor :
          colorIdx === 1 ? mc1Color :
          colorIdx === 2 ? mc2Color :
          fg;
        const x0 = pair * 2;
        for (let dx = 0; dx < 2; dx++) {
          const idx = ((y * 8) + x0 + dx) * 4;
          bits[idx + 0] = paint.r;
          bits[idx + 1] = paint.g;
          bits[idx + 2] = paint.b;
          bits[idx + 3] = 255;
        }
      }
    }
    return img;
  }
}

interface CharGridProps {
  width: number;
  height: number;
  srcX: number;
  srcY: number;
  charPos: Coord2;
  curScreencode?: number;
  textColor?: number;
  backgroundColor: string;
  grid: boolean;
  colorPalette: Rgb[];
  font: Font;
  framebuf: Pixel[][];
  ecmMode?: boolean;
  mcmMode?: boolean;
  backgroundColorIndex?: number;
  extBgColor1?: number;
  extBgColor2?: number;
  extBgColor3?: number;
  mcmColor1?: number;
  mcmColor2?: number;
}

export default class CharGrid extends Component<CharGridProps> {
  static defaultProps = {
    srcX: 0,
    srcY: 0,
    charPos: null
  }

  private font: CharsetCache | null = null;
  private canvasRef = React.createRef<HTMLCanvasElement>();

  private resolveEcmBg(code: number): number {
    const sel = ecmBgSelector(code);
    switch (sel) {
      case 0: return this.props.backgroundColorIndex ?? 0;
      case 1: return this.props.extBgColor1 ?? 0;
      case 2: return this.props.extBgColor2 ?? 0;
      case 3: return this.props.extBgColor3 ?? 0;
      default: return this.props.backgroundColorIndex ?? 0;
    }
  }

  private getCellImage(c: { code: number, color: number }): ImageData {
    const ecm = this.props.ecmMode;
    const mcm = this.props.mcmMode;
    if (mcm) {
      const bgIdx = this.props.backgroundColorIndex ?? 0;
      const bgColor = this.props.colorPalette[bgIdx];
      if (mcmIsMulticolorCell(c.color)) {
        const fgColor = mcmForegroundColor(c.color);
        const mc1 = this.props.colorPalette[this.props.mcmColor1 ?? 0];
        const mc2 = this.props.colorPalette[this.props.mcmColor2 ?? 0];
        return this.font!.getImageMcm(c.code, fgColor, bgColor, mc1, mc2);
      }
      return this.font!.getImageHiresOnMcm(c.code, c.color, bgColor);
    }
    if (ecm) {
      const bgIdx = this.resolveEcmBg(c.code);
      return this.font!.getImageWithBg(c.code, c.color, this.props.colorPalette[bgIdx]);
    }
    return this.font!.getImage(c.code, c.color);
  }

  componentDidMount() {
    this.draw()
  }

  componentDidUpdate (prevProps: Readonly<CharGridProps>) {
    if (this.props.width !== prevProps.width ||
      this.props.height !== prevProps.height ||
      this.props.srcX !== prevProps.srcX ||
      this.props.srcY !== prevProps.srcY ||
      this.props.framebuf !== prevProps.framebuf ||
      this.props.charPos !== prevProps.charPos ||
      this.props.curScreencode !== prevProps.curScreencode ||
      this.props.textColor !== prevProps.textColor ||
      this.props.backgroundColor !== prevProps.backgroundColor ||
      this.props.font !== prevProps.font ||
      this.props.colorPalette !== prevProps.colorPalette ||
      this.props.ecmMode !== prevProps.ecmMode ||
      this.props.extBgColor1 !== prevProps.extBgColor1 ||
      this.props.extBgColor2 !== prevProps.extBgColor2 ||
      this.props.extBgColor3 !== prevProps.extBgColor3 ||
      this.props.mcmMode !== prevProps.mcmMode ||
      this.props.mcmColor1 !== prevProps.mcmColor1 ||
      this.props.mcmColor2 !== prevProps.mcmColor2) {
      this.draw(prevProps)
    }
  }

  draw (prevProps?: CharGridProps) {
    const canvas = this.canvasRef.current
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d")!
    const framebuf = this.props.framebuf
    let invalidate = false
    if (this.font === null ||
      this.props.font !== prevProps!.font ||
      this.props.colorPalette !== prevProps!.colorPalette) {
      this.font = new CharsetCache(ctx, this.props.font.bits, this.props.colorPalette)
      invalidate = true
    }

    const { grid, srcX, srcY } = this.props

    const xScale = grid ? 9 : 8
    const yScale = grid ? 9 : 8

    const modeOrColorChanged =
      prevProps !== undefined &&
      (this.props.ecmMode !== prevProps.ecmMode ||
       this.props.mcmMode !== prevProps.mcmMode ||
       this.props.backgroundColorIndex !== prevProps.backgroundColorIndex ||
       this.props.extBgColor1 !== prevProps.extBgColor1 ||
       this.props.extBgColor2 !== prevProps.extBgColor2 ||
       this.props.extBgColor3 !== prevProps.extBgColor3 ||
       this.props.mcmColor1 !== prevProps.mcmColor1 ||
       this.props.mcmColor2 !== prevProps.mcmColor2);

    const redrawAll =
      prevProps === undefined ||
      this.props.width !== prevProps.width ||
      this.props.height !== prevProps.height ||
      this.props.srcX !== prevProps.srcX ||
      this.props.srcY !== prevProps.srcY ||
      this.props.framebuf !== prevProps.framebuf ||
      modeOrColorChanged ||
      invalidate;

    if (redrawAll) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    for (var y = 0; y < this.props.height; y++) {
      const charRow = framebuf[y + srcY]
      if (!redrawAll && charRow === prevProps!.framebuf[y + srcY]) {
        continue
      }
      for (var x = 0; x < this.props.width; x++) {
        const c = charRow[x + srcX]
        const img = this.getCellImage(c);
        ctx.putImageData(img, x*xScale, y*yScale)
      }
    }

    // Delete previous char highlighter (skip if we already redrew everything).
    if (!redrawAll && prevProps !== undefined && prevProps.charPos !== null) {
      const charPos = prevProps.charPos
      if (charPos.row >= 0 && charPos.row < this.props.height &&
          charPos.col >= 0 && charPos.col < this.props.width) {
        const c = framebuf[charPos.row + srcY][charPos.col + srcX]
        const img = this.getCellImage(c);
        ctx.putImageData(img, charPos.col*xScale, charPos.row*yScale)
      }
    }
    // Render current char highlighter
    if (this.props.charPos !== null) {
      const charPos = this.props.charPos
      if (charPos.row >= 0 && charPos.row < this.props.height &&
          charPos.col >= 0 && charPos.col < this.props.width) {
        const c = {
          code: this.props.curScreencode !== undefined ?
            this.props.curScreencode :
            framebuf[charPos.row + srcY][charPos.col + srcX].code,
          color: this.props.textColor !== undefined ?
            this.props.textColor :
            framebuf[charPos.row + srcY][charPos.col + srcX].color
        }
        const img = this.getCellImage(c);
        ctx.putImageData(img, charPos.col*xScale, charPos.row*yScale)
      }
    }

    if (grid) {
      ctx.fillStyle = 'rgba(0,0,0,255)'
      for (var y = 0; y < this.props.height; y++) {
        ctx.fillRect(0, y*yScale+8, this.props.width*xScale, 1)
      }
      for (var x = 0; x < this.props.width; x++) {
        ctx.fillRect(x*xScale+8, 0, 1, this.props.height*yScale)
      }
    }
  }

  render () {
    const scale = this.props.grid ? 9 : 8
    return (
      <canvas
        ref={this.canvasRef}
        style={{
          backgroundColor: this.props.backgroundColor,
          position: 'absolute',
          top: '0px',
          left: '0px',
          width: `${this.props.width*scale}px`,
          height: `${this.props.height*scale}px`,
        }}
        width={this.props.width*scale}
        height={this.props.height*scale}>
      </canvas>
    )
  }
}
