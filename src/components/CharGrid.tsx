
import React, { Component } from 'react';
import { Rgb, Font, Pixel, Coord2 } from '../redux/types';
import { ecmCharIndex, ecmBgSelector } from '../utils/ecm';

class CharsetCache {
  private images: ImageData[][] = Array(16);

  constructor (
    ctx: CanvasRenderingContext2D,
    fontBits: number[],
    colorPalette: Rgb[]
  ) {
    const data = fontBits

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
  getImageWithBg(screencode: number, fgColor: number, bgColor: Rgb): ImageData {
    const charIdx = ecmCharIndex(screencode);
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
  backgroundColorIndex?: number;
  extBgColor1?: number;
  extBgColor2?: number;
  extBgColor3?: number;
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
      this.props.extBgColor3 !== prevProps.extBgColor3) {
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

    const dstSrcChanged =
      prevProps !== undefined ?
        (this.props.width !== prevProps.width ||
         this.props.height !== prevProps.height ||
         this.props.srcX !== prevProps.srcX ||
         this.props.srcY !== prevProps.srcY ||
         invalidate)
        :
        true
    const ecm = this.props.ecmMode;
    for (var y = 0; y < this.props.height; y++) {
      const charRow = framebuf[y + srcY]
      if (!dstSrcChanged && charRow === prevProps!.framebuf[y + srcY]) {
        continue
      }
      for (var x = 0; x < this.props.width; x++) {
        const c = charRow[x + srcX]
        let img: ImageData;
        if (ecm) {
          const bgIdx = this.resolveEcmBg(c.code);
          img = this.font.getImageWithBg(c.code, c.color, this.props.colorPalette[bgIdx]);
        } else {
          img = this.font.getImage(c.code, c.color);
        }
        ctx.putImageData(img, x*xScale, y*yScale)
      }
    }

    // Delete previous char highlighter
    if (prevProps !== undefined && prevProps.charPos !== null) {
      const charPos = prevProps.charPos
      if (charPos.row >= 0 && charPos.row < this.props.height &&
          charPos.col >= 0 && charPos.col < this.props.width) {
        const c = framebuf[charPos.row][charPos.col]
        let img: ImageData;
        if (ecm) {
          const bgIdx = this.resolveEcmBg(c.code);
          img = this.font.getImageWithBg(c.code, c.color, this.props.colorPalette[bgIdx]);
        } else {
          img = this.font.getImage(c.code, c.color);
        }
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
            framebuf[charPos.row][charPos.col].code,
          color: this.props.textColor !== undefined ?
            this.props.textColor :
            framebuf[charPos.row][charPos.col].color
        }
        let img: ImageData;
        if (ecm) {
          const bgIdx = this.resolveEcmBg(c.code);
          img = this.font.getImageWithBg(c.code, c.color, this.props.colorPalette[bgIdx]);
        } else {
          img = this.font.getImage(c.code, c.color);
        }
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
