
import React, { Component, Fragment, CSSProperties, PointerEvent, WheelEvent } from 'react';
import { connect } from 'react-redux'
import classNames from 'classnames'

import ColorPicker from '../components/ColorPicker'
import CharGrid from '../components/CharGrid'
import CharPosOverlay, { TextCursorOverlay } from '../components/CharPosOverlay'
import GridOverlay from '../components/GridOverlay'
import CrtOverlay from '../components/CrtOverlay'
import { CanvasStatusbar } from '../components/Statusbar'

import CharSelect from './CharSelect'

import * as framebuf from '../redux/editor'
import { Framebuffer } from '../redux/editor'
import * as selectors from '../redux/selectors'
import * as screensSelectors from '../redux/screensSelectors'
import {
  getSettingsIntegerScale,
  getSettingsCrtFilter,
  getEffectiveColorPalette,
  getEffectivePaletteId
} from '../redux/settingsSelectors'
import { C64_PALETTES } from '../utils/c64Palettes'


import { framebufIndexMergeProps }  from '../redux/utils'

import * as toolbar from '../redux/toolbar'
import { Toolbar } from '../redux/toolbar'
import * as utils from '../utils';
import * as matrix from '../utils/matrix';

import styles from './Editor.module.css';
import {
  RootState,
  BrushRegion,
  Coord2,
  Rgb,
  Brush,
  Font,
  Tool,
  CrtFilter,
  Pixel, Framebuf, FramebufUIState
} from '../redux/types'

const brushOutlineSelectingColor = 'rgba(128, 255, 128, 0.5)';

const gridColor = 'rgba(128, 128, 128, 1)'

const brushOverlayStyleBase: CSSProperties = {
  outlineColor: 'rgba(255, 255, 255, 0.5)',
  outlineStyle: 'solid',
  outlineWidth: 0.5,
  backgroundColor: 'rgba(255,255,255,0)',
  zIndex: 1,
  pointerEvents: 'none'
}

interface BrushSelectOverlayProps {
  framebufWidth: number;
  framebufHeight: number;
  brushRegion: BrushRegion | null;
  charPos: Coord2;
}

class BrushSelectOverlay extends Component<BrushSelectOverlayProps> {
  render () {
    if (this.props.brushRegion === null) {
      return (
        <CharPosOverlay
          charPos={this.props.charPos}
          framebufWidth={this.props.framebufWidth}
          framebufHeight={this.props.framebufHeight}
          color={brushOutlineSelectingColor}
        />
      )
    }
    const { min, max } = utils.sortRegion(this.props.brushRegion)
    const s: CSSProperties = {
      ...brushOverlayStyleBase,
      outlineColor: brushOutlineSelectingColor,
      position: 'absolute',
      left: min.col*8,
      top: min.row*8,
      width: `${(max.col-min.col+1)*8}px`,
      height: `${(max.row-min.row+1)*8}px`
    }
    return (
      <div style={s}>
      </div>
    )
  }
}

function computeBrushDstPos (charPos: Coord2, dims: { width: number, height: number }) {
  return {
    col: charPos.col - Math.floor(dims.width/2),
    row: charPos.row - Math.floor(dims.height/2)
  }
}

interface BrushOverlayProps {
  charPos: Coord2;
  framebufWidth: number;
  framebufHeight: number;
  backgroundColor: string;
  colorPalette: Rgb[];
  brush: Brush | null;
  font: Font;
  ecmMode?: boolean;
  mcmMode?: boolean;
  backgroundColorIndex?: number;
  extBgColor1?: number;
  extBgColor2?: number;
  extBgColor3?: number;
  mcmColor1?: number;
  mcmColor2?: number;
}

class BrushOverlay extends Component<BrushOverlayProps> {
  render () {
    if (this.props.brush === null) {
      return null
    }
    const { charPos, backgroundColor, framebufWidth, framebufHeight } = this.props
    const { min, max } = utils.sortRegion(this.props.brush.brushRegion)
    const brushw = max.col - min.col + 1
    const brushh = max.row - min.row + 1
    let bw = brushw
    let bh = brushh
    const destPos = computeBrushDstPos(charPos, { width: bw, height: bh})
    let dstx = destPos.col
    let dsty = destPos.row
    if (bw + dstx > framebufWidth) {
      bw = framebufWidth - dstx
    }
    if (bh + dsty > framebufHeight) {
      bh = framebufHeight - dsty
    }
    let srcX = 0
    let srcY = 0
    if (dstx < 0) {
      srcX = -dstx
      bw -= srcX
      dstx = 0
    }
    if (dsty < 0) {
      srcY = -dsty
      bh -= srcY
      dsty = 0
    }
    if (bw <= 0 || bh <= 0) {
      return null
    }
    const s: CSSProperties = {
      ...brushOverlayStyleBase,
      position: 'absolute',
      left: dstx*8,
      top: dsty*8,
      width: `${bw*8}px`,
      height: `${bh*8}px`,
    }
    return (
      <div style={s}>
        <CharGrid
          width={bw}
          height={bh}
          srcX={srcX}
          srcY={srcY}
          grid={false}
          backgroundColor={backgroundColor}
          colorPalette={this.props.colorPalette}
          font={this.props.font}
          framebuf={this.props.brush.framebuf}
          ecmMode={this.props.ecmMode}
          mcmMode={this.props.mcmMode}
          backgroundColorIndex={this.props.backgroundColorIndex}
          extBgColor1={this.props.extBgColor1}
          extBgColor2={this.props.extBgColor2}
          extBgColor3={this.props.extBgColor3}
          mcmColor1={this.props.mcmColor1}
          mcmColor2={this.props.mcmColor2}
        />
      </div>
    )
  }
}

interface FramebufferViewProps {
  undoId: number | null;

  altKey: boolean;
  shiftKey: boolean;
  spacebarKey: boolean;

  textCursorPos: Coord2;

  framebuf: Pixel[][];
  framebufWidth: number;
  framebufHeight: number;
  selectedTool: Tool;
  brush: Brush | null;
  brushRegion: BrushRegion | null;
  // Scale and translation for pan/zoom
  framebufUIState: FramebufUIState;

  backgroundColor: number;
  textColor: number;
  curScreencode: number;
  colorPalette: Rgb[];

  font: Font;

  canvasGrid: boolean;

  ecmMode?: boolean;
  mcmMode?: boolean;
  extBgColor1?: number;
  extBgColor2?: number;
  extBgColor3?: number;
  mcmColor1?: number;
  mcmColor2?: number;

  onCharPosChanged: (args: {isActive: boolean, charPos: Coord2}) => void;

  framebufLayout: {
    width: number, height: number,
    pixelScale: number
  };
}

interface FramebufferViewDispatch {
  Framebuffer: framebuf.PropsFromDispatch;
  Toolbar: toolbar.PropsFromDispatch;
}

interface FramebufferViewState {
  // Floor'd to int
  charPos: Coord2;
  isActive: boolean;
}

class FramebufferView extends Component<FramebufferViewProps & FramebufferViewDispatch, FramebufferViewState> {

  state: FramebufferViewState = {
    charPos: { row: -1, col: 0 },
    isActive: false
  }

  prevDragPos: Coord2|null = null;

  setChar = (clickLoc: Coord2) => {
    const { undoId } = this.props;
    const params = {
      ...clickLoc,
    }
    if (this.props.selectedTool === Tool.Draw) {
      this.props.Framebuffer.setPixel({
        ...params,
        color: this.props.textColor,
        screencode: this.props.curScreencode
      }, undoId)
    } else if (this.props.selectedTool === Tool.Colorize) {
      this.props.Framebuffer.setPixel({
        ...params,
        color: this.props.textColor,
      }, undoId)
    } else if (this.props.selectedTool === Tool.CharDraw) {
      this.props.Framebuffer.setPixel({
        ...params,
        screencode: this.props.curScreencode
      }, undoId)
    } else {
      console.error('shouldn\'t get here')
    }
  }

  brushDraw = (coord: Coord2) => {
    const { min, max } = this.props.brush.brushRegion
    const area = {
      width: max.col - min.col + 1,
      height: max.row - min.row + 1
    }
    const destPos = computeBrushDstPos(coord, area)
    this.props.Framebuffer.setBrush({
      ...destPos,
      brush: this.props.brush,
    }, this.props.undoId)
  }

  dragStart = (coord: Coord2) => {
    const { selectedTool } = this.props
    if (selectedTool === Tool.Draw ||
        selectedTool === Tool.Colorize ||
        selectedTool === Tool.CharDraw) {
      this.setChar(coord)
    } else if (selectedTool === Tool.Brush) {
      if (this.props.brush === null) {
        this.props.Toolbar.setBrushRegion({
          min: coord,
          max: coord
        })
      } else {
        this.brushDraw(coord)
      }
    } else if (selectedTool === Tool.Text) {
      this.props.Toolbar.setTextCursorPos(coord)
    }
    this.prevDragPos = coord
  }

  dragMove = (coord: Coord2) => {
    const prevDragPos = this.prevDragPos!; // set in dragStart
    const { selectedTool, brush, brushRegion } = this.props
    if (selectedTool === Tool.Draw ||
        selectedTool === Tool.Colorize ||
        selectedTool === Tool.CharDraw) {
      utils.drawLine((x,y) => {
        this.setChar({ row:y, col:x })
      }, prevDragPos.col, prevDragPos.row, coord.col, coord.row)
    } else if (selectedTool === Tool.Brush) {
      if (brush !== null) {
        this.brushDraw(coord)
      } else if (brushRegion !== null) {
        const clamped = {
          row: Math.max(0, Math.min(coord.row, this.props.framebufHeight-1)),
          col: Math.max(0, Math.min(coord.col, this.props.framebufWidth-1))
        }
        this.props.Toolbar.setBrushRegion({
          ...brushRegion,
          max: clamped
        })
      }
    } else {
      console.error('not implemented')
    }

    this.prevDragPos = coord
  }

  dragEnd = () => {
    const { selectedTool, brush, brushRegion } = this.props
    if (selectedTool === Tool.Brush) {
      if (brush === null && brushRegion !== null) {
        this.props.Toolbar.captureBrush(this.props.framebuf, brushRegion)
      }
    }
    this.props.Toolbar.incUndoId()
  }

  altClick = (charPos: Coord2) => {
    const x = charPos.col
    const y = charPos.row
    if (y >= 0 && y < this.props.framebufHeight &&
      x >= 0 && x < this.props.framebufWidth) {
      const pix = this.props.framebuf[y][x]
      this.props.Toolbar.setCurrentScreencodeAndColor(pix)
    }
  }

  //---------------------------------------------------------------------
  // Mechanics of tracking pointer drags with mouse coordinate -> canvas char pos
  // transformation.

  private ref = React.createRef<HTMLDivElement>();
  private prevCharPos: Coord2|null = null;
  private prevCoord: Coord2|null = null;
  private lockStartCoord: Coord2|null = null;
  private shiftLockAxis: 'shift'|'row'|'col'|null = null;
  private dragging = false;

  resetDraggingState = () => {
    this.dragging = false;
    this.prevCoord = null;
    this.prevDragPos = null;
    this.lockStartCoord = null;
    this.shiftLockAxis = null;
  }

  currentCharPos (e: any): { charPos: Coord2 } {
    if (!this.ref.current) {
      throw new Error('impossible?');
    }

    const bbox = this.ref.current.getBoundingClientRect();
    const xx = (e.clientX - bbox.left) / this.props.framebufLayout.pixelScale;
    const yy = (e.clientY - bbox.top) / this.props.framebufLayout.pixelScale;

    const invXform = matrix.invert(this.props.framebufUIState.canvasTransform);
    let [x, y] = matrix.multVect3(invXform, [xx, yy, 1]);
    x /= 8;
    y /= 8;

    return {
      charPos: { row: Math.floor(y), col: Math.floor(x) }
    }
  }

  setCharPos (isActive: boolean, charPos: Coord2) {
    this.setState({ isActive, charPos });
    this.props.onCharPosChanged({ isActive, charPos });
  }

  handleMouseEnter = (e: any) => {
    const { charPos } = this.currentCharPos(e);
    this.setCharPos(true, charPos);
  }

  handleMouseLeave = (e: any) => {
    const { charPos } = this.currentCharPos(e);
    this.setCharPos(false, charPos);
  }

  handlePointerDown = (e: any) => {
    if (this.props.selectedTool === Tool.Inspector) {
      const { charPos } = this.currentCharPos(e);
      this.altClick(charPos);
      this.props.Toolbar.setSelectedTool(Tool.Draw);
      return;
    }
    if (this.props.selectedTool == Tool.PanZoom ||
      (this.props.selectedTool !== Tool.Text && this.props.spacebarKey)) {
      this.handlePanZoomPointerDown(e);
      return;
    }

    const { charPos } = this.currentCharPos(e);
    this.setCharPos(true, charPos);

    // alt-left click doesn't start dragging
    if (this.props.altKey) {
      this.dragging = false;
      this.altClick(charPos);
      return;
    }

    this.dragging = true
    e.currentTarget.setPointerCapture(e.pointerId);
    this.prevCoord = charPos
    this.dragStart(charPos)

    const lock = this.props.shiftKey
    this.shiftLockAxis = lock ? 'shift' : null
    if (lock) {
      this.lockStartCoord = {
        ...charPos
      }
    }
  }

  handlePointerUp = (e: PointerEvent) => {
    if (this.props.selectedTool == Tool.PanZoom || this.panZoomDragging) {
      this.handlePanZoomPointerUp(e);
      return;
    }

    if (this.dragging) {
      this.dragEnd()
    }
    this.resetDraggingState();
  }

  handlePointerMove = (e: PointerEvent) => {
    if (this.props.selectedTool == Tool.PanZoom ||
      (this.props.selectedTool !== Tool.Text && this.props.spacebarKey)) {
      this.handlePanZoomPointerMove(e);
      return;
    }

    const { charPos } = this.currentCharPos(e)
    this.setCharPos(true, charPos);

    if (this.prevCharPos === null ||
      this.prevCharPos.row !== charPos.row ||
      this.prevCharPos.col !== charPos.col) {
      this.prevCharPos = {...charPos}
        this.props.onCharPosChanged({isActive:this.state.isActive, charPos})
    }

    // Defensive: if drag state got stuck but no button is held, abort drag.
    if (this.dragging && e.buttons === 0) {
      this.resetDraggingState();
      return;
    }

    if (!this.dragging) {
      return
    }

    // Note: prevCoord is known to be not null here as it's been set
    // in mouse down
    const coord = charPos;
    if (this.prevCoord!.row !== coord.row || this.prevCoord!.col !== coord.col) {

      if (this.shiftLockAxis === 'shift') {
        if (this.prevCoord!.row === coord.row) {
          this.shiftLockAxis = 'row'
        } else if (this.prevCoord!.col === coord.col) {
          this.shiftLockAxis = 'col'
        }
      }

      if (this.shiftLockAxis !== null) {
        let lockedCharPos = {
          ...this.lockStartCoord!
        }

        if (this.shiftLockAxis === 'row') {
          lockedCharPos.col = charPos.col
        } else if (this.shiftLockAxis === 'col') {
          lockedCharPos.row = charPos.row
        }
        this.dragMove(lockedCharPos)
      } else {
        this.dragMove(charPos)
      }
      this.prevCoord = charPos
    }
  }

  handlePointerCancel = () => {
    this.resetDraggingState();
  }
  //---------------------------------------------------------------------
  // Pan/zoom mouse event handlers.  Called by the bound handlePointerDown/Move/Up
  // functions if the pan/zoom tool is selected.

  private panZoomDragging = false;

  handlePanZoomPointerDown (e: any) {
    this.panZoomDragging = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  handlePanZoomPointerUp (_e: any) {
    this.panZoomDragging = false;
  }

  // Mutable dst
  clampToWindow (xform: matrix.Matrix3x3): matrix.Matrix3x3 {
    const xf = matrix.copy(xform);
    // Clamp translation so that the canvas doesn't go out of the window
    let tx = xf.v[0][2];
    let ty = xf.v[1][2];
    tx = Math.min(tx, 0);
    ty = Math.min(ty, 0);
    const xx = this.props.framebufLayout.width / this.props.framebufLayout.pixelScale;
    const yy = this.props.framebufLayout.height / this.props.framebufLayout.pixelScale;
    const [swidth, sheight] = matrix.multVect3(xform, [this.props.framebufWidth*8, this.props.framebufHeight*8, 0]);
    tx = Math.max(tx, -(swidth - xx));
    ty = Math.max(ty, -(sheight - yy));
    xf.v[0][2] = tx;
    xf.v[1][2] = ty;
    return xf;
  }

  handlePanZoomPointerMove (e: any) {
    if (this.panZoomDragging) {
      const dx = e.nativeEvent.movementX / this.props.framebufLayout.pixelScale;
      const dy = e.nativeEvent.movementY / this.props.framebufLayout.pixelScale;

      const prevUIState = this.props.framebufUIState;
      const prevTransform = prevUIState.canvasTransform;

      const invXform = matrix.invert(prevTransform);
      const srcDxDy = matrix.multVect3(invXform, [dx, dy, 0]);

      const xform =
        matrix.mult(
          prevTransform,
          matrix.translate(srcDxDy[0], srcDxDy[1])
        );
      this.props.Toolbar.setCurrentFramebufUIState({
        ...prevUIState,
        canvasTransform: this.clampToWindow(xform)
      });
    }
  }

  // Reset canvas scale transform to identity on double click.
  handleDoubleClick = () => {
    if (this.props.selectedTool != Tool.PanZoom) {
      return;
    }
    const prevUIState = this.props.framebufUIState;
    this.props.Toolbar.setCurrentFramebufUIState({
      ...prevUIState,
      canvasTransform: matrix.ident()
    })
  }

  handleWheel = (e: WheelEvent) => {
    if (!(this.props.selectedTool == Tool.PanZoom ||
        (this.props.selectedTool !== Tool.Text && this.props.altKey))) {
      return;
    }

    if (!this.ref.current) {
      return;
    }
    if (e.deltaY == 0) {
      return;
    }
    const wheelScale = 200.0;
    const delta = Math.min(Math.abs(e.deltaY), wheelScale);
    const scaleDelta = e.deltaY < 0 ?
      1.0/(1 - (delta / (wheelScale+1))) : (1 - (delta / (wheelScale+1)));

    const bbox = this.ref.current.getBoundingClientRect();
    const mouseX = (e.nativeEvent.clientX - bbox.left) / this.props.framebufLayout.pixelScale;
    const mouseY = (e.nativeEvent.clientY - bbox.top) / this.props.framebufLayout.pixelScale;

    const prevUIState = this.props.framebufUIState;

    const invXform = matrix.invert(prevUIState.canvasTransform);
    const srcPos = matrix.multVect3(invXform, [mouseX, mouseY, 1]);

    let xform =
      matrix.mult(
        prevUIState.canvasTransform,
        matrix.mult(
          matrix.translate(srcPos[0]-scaleDelta*srcPos[0], srcPos[1]-scaleDelta*srcPos[1]),
          matrix.scale(scaleDelta)
        )
      )

    // Clamp scale to 1.0
    if (xform.v[0][0] < 1.0 || xform.v[1][1] < 1.0) {
      const invScale = matrix.scale(1.0 / xform.v[0][0]);
      xform = matrix.mult(xform, invScale);
      // scale is roughly 1.0 now but let's force float values
      // to exact 1.0
      xform.v[0][0] = 1.0;
      xform.v[1][1] = 1.0;
    }

    this.props.Toolbar.setCurrentFramebufUIState({
      ...prevUIState,
      canvasTransform: this.clampToWindow(xform)
    })
  }

  render () {
    // Editor needs to specify a fixed width/height because the contents use
    // relative/absolute positioning and thus seem to break out of the CSS
    // grid.
    const charWidth = this.props.framebufWidth;
    const charHeight = this.props.framebufHeight;
    const backg = utils.colorIndexToCssRgb(this.props.colorPalette, this.props.backgroundColor)
    const { selectedTool } = this.props
    let overlays = null
    let screencodeHighlight: number|undefined = this.props.curScreencode
    let colorHighlight: number|undefined = this.props.textColor
    let highlightCharPos = true
    if (this.state.isActive) {
      if (selectedTool === Tool.Brush) {
        highlightCharPos = false
        if (this.props.brush !== null) {
          overlays =
            <BrushOverlay
              charPos={this.state.charPos}
              framebufWidth={this.props.framebufWidth}
              framebufHeight={this.props.framebufHeight}
              backgroundColor={backg}
              colorPalette={this.props.colorPalette}
              font={this.props.font}
              brush={this.props.brush}
              ecmMode={this.props.ecmMode}
              mcmMode={this.props.mcmMode}
              backgroundColorIndex={this.props.backgroundColor}
              extBgColor1={this.props.extBgColor1}
              extBgColor2={this.props.extBgColor2}
              extBgColor3={this.props.extBgColor3}
              mcmColor1={this.props.mcmColor1}
              mcmColor2={this.props.mcmColor2}
            />
        } else {
          overlays =
            <BrushSelectOverlay
              charPos={this.state.charPos}
              framebufWidth={this.props.framebufWidth}
              framebufHeight={this.props.framebufHeight}
              brushRegion={this.props.brushRegion}
            />
        }
      } else if (selectedTool === Tool.Inspector) {
        const { charPos } = this.state;
        const row = charPos.row;
        const col = charPos.col;
        if (row >= 0 && row < this.props.framebufHeight &&
            col >= 0 && col < this.props.framebufWidth) {
          const pix = this.props.framebuf[row][col];
          screencodeHighlight = pix.code;
          colorHighlight = pix.color;
        } else {
          screencodeHighlight = undefined;
          colorHighlight = undefined;
        }
        highlightCharPos = false;
        overlays =
          <CharPosOverlay
            framebufWidth={this.props.framebufWidth}
            framebufHeight={this.props.framebufHeight}
            charPos={this.state.charPos}
            inspectorPulse={true}
            color='rgba(0, 255, 255, 0.5)'
          />
      } else if (
        selectedTool === Tool.Draw ||
        selectedTool === Tool.Colorize ||
        selectedTool === Tool.CharDraw
      ) {
        overlays =
          <CharPosOverlay
            framebufWidth={this.props.framebufWidth}
            framebufHeight={this.props.framebufHeight}
            charPos={this.state.charPos}
            opacity={0.5}
          />
        if (selectedTool === Tool.Colorize) {
          screencodeHighlight = undefined;
        } else if (selectedTool === Tool.CharDraw) {
          colorHighlight = undefined;
        }
        // Don't show current char/color when the ALT color/char picker is active
        if (this.props.altKey) {
          highlightCharPos = false;
        }
      } else {
        highlightCharPos = false;
        screencodeHighlight = undefined;
        colorHighlight = undefined;
      }
    }

    if (selectedTool === Tool.Text) {
      screencodeHighlight = undefined;
      colorHighlight = undefined;
      const { textCursorPos, textColor } = this.props
      let textCursorOverlay = null
      if (textCursorPos !== null) {
        const color = utils.colorIndexToCssRgb(this.props.colorPalette, textColor)
        textCursorOverlay =
          <TextCursorOverlay
            framebufWidth={this.props.framebufWidth}
            framebufHeight={this.props.framebufHeight}
            charPos={textCursorPos}
            fillColor={color}
            opacity={0.5}
          />
      }
      overlays =
        <Fragment>
          {textCursorOverlay}
          {this.state.isActive ?
            <CharPosOverlay
              framebufWidth={this.props.framebufWidth}
              framebufHeight={this.props.framebufHeight}
              charPos={this.state.charPos}
              opacity={0.5}
            />
            :
            null}
        </Fragment>
    }

    const cx = '100%';
    const cy = '100%';
    // TODO scaleX and Y
    const transform = this.props.framebufUIState.canvasTransform;
    const scale: CSSProperties = {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      width: `${this.props.framebufLayout.width}px`,
      height: `${this.props.framebufLayout.height}px`,
      imageRendering: 'pixelated',
      clipPath: `polygon(0% 0%, ${cx} 0%, ${cx} ${cy}, 0% ${cy})`,
      overflowX: 'hidden',
      overflowY: 'hidden'
    }
    const canvasContainerStyle: CSSProperties = {
      transform: matrix.toCss(
        matrix.mult(
          matrix.scale(this.props.framebufLayout.pixelScale),
            this.clampToWindow(transform)
        )
      )
    };

    return (
      <div
        style={scale}
        ref={this.ref}
        onWheel={this.handleWheel}
        onDoubleClick={this.handleDoubleClick}
        onMouseEnter={this.handleMouseEnter}
        onMouseLeave={this.handleMouseLeave}
        onPointerDown={(e) => this.handlePointerDown(e)}
        onPointerMove={(e) => this.handlePointerMove(e)}
        onPointerUp={(e) => this.handlePointerUp(e)}
        onPointerCancel={this.handlePointerCancel}
      >
        <div style={canvasContainerStyle}>
          <CharGrid
            width={charWidth}
            height={charHeight}
            grid={false}
            backgroundColor={backg}
            framebuf={this.props.framebuf}
            charPos={this.state.isActive && highlightCharPos ? this.state.charPos : undefined}
            curScreencode={screencodeHighlight}
            textColor={colorHighlight}
            font={this.props.font}
            colorPalette={this.props.colorPalette}
            ecmMode={this.props.ecmMode}
            mcmMode={this.props.mcmMode}
            backgroundColorIndex={this.props.backgroundColor}
            extBgColor1={this.props.extBgColor1}
            extBgColor2={this.props.extBgColor2}
            extBgColor3={this.props.extBgColor3}
            mcmColor1={this.props.mcmColor1}
            mcmColor2={this.props.mcmColor2}
          />
          {overlays}
          {this.props.canvasGrid ? <GridOverlay width={charWidth} height={charHeight} color={gridColor} /> : null}
        </div>
      </div>
    )
  }
}

function computeFramebufLayout(args: {
  containerSize: { width: number, height: number },
  framebufSize: { charWidth: number, charHeight: number },
  canvasFit: FramebufUIState['canvasFit']
}) {
  const bottomPad = 60;
  const rightPad = 320;
  const { charWidth, charHeight } = args.framebufSize;
  const maxWidth = args.containerSize.width - rightPad;
  const maxHeight = args.containerSize.height - bottomPad;

  const canvasWidth = charWidth * 8;
  const canvasHeight = charHeight * 8;

  let ws =  maxWidth / canvasWidth;
  let divWidth = canvasWidth * ws;
  let divHeight = canvasHeight * ws;

  const fitWidth = args.canvasFit == 'fitWidth';
  if (fitWidth) {
    if (divHeight > maxHeight) {
      divHeight = maxHeight;
    }
  } else {
    // If height is now larger than what we can fit in vertically, scale further
    if (divHeight > maxHeight) {
      const s = maxHeight  / divHeight;
      divWidth *= s;
      divHeight *= s;
      ws *= s;
    }
  }

  return {
    width: divWidth,
    height: divHeight,
    pixelScale: ws
  }
}

const FramebufferCont = connect(
  (state: RootState) => {
    const selected = state.toolbar.selectedChar
    const charTransform = state.toolbar.charTransform
    const framebuf = selectors.getCurrentFramebuf(state)!
    if (framebuf == null) {
      throw new Error('cannot render FramebufferCont with a null framebuf, see Editor checks.')
    }
    const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(state);
    const { font } = selectors.getCurrentFramebufFont(state)
    return {
      framebufIndex,
      framebuf: framebuf.framebuf,
      framebufWidth: framebuf.width,
      framebufHeight: framebuf.height,
      backgroundColor: framebuf.backgroundColor,
      ecmMode: framebuf.ecmMode,
      mcmMode: framebuf.mcmMode,
      extBgColor1: framebuf.extBgColor1,
      extBgColor2: framebuf.extBgColor2,
      extBgColor3: framebuf.extBgColor3,
      mcmColor1: framebuf.mcmColor1,
      mcmColor2: framebuf.mcmColor2,
      undoId: state.toolbar.undoId,
      curScreencode: selectors.getScreencodeWithTransform(selected, font, charTransform),
      selectedTool: state.toolbar.selectedTool,
      textColor: state.toolbar.textColor,
      brush: selectors.transformBrush(state.toolbar.brush, state.toolbar.brushTransform, font),
      brushRegion: state.toolbar.brushRegion,
      textCursorPos: state.toolbar.textCursorPos,
      shiftKey: state.toolbar.shiftKey,
      altKey: state.toolbar.altKey,
      spacebarKey: state.toolbar.spacebarKey,
      font,
      colorPalette: getEffectiveColorPalette(state, framebufIndex),
      canvasGrid: state.toolbar.canvasGrid
    }
  },
  dispatch => {
    return {
      Framebuffer: Framebuffer.bindDispatch(dispatch),
      Toolbar: Toolbar.bindDispatch(dispatch)
    }
  },
  framebufIndexMergeProps
)(FramebufferView)

interface EditorProps {
  framebuf: Framebuf | null;
  framebufUIState: FramebufUIState | undefined;
  framebufIndex: number | null;
  textColor: number;
  colorPalette: Rgb[];
  paletteId: string;
  selectedTool: Tool;
  crtFilter: CrtFilter;

  integerScale: boolean;
  containerSize: { width: number, height: number };
}

interface EditorDispatch {
  Toolbar: toolbar.PropsFromDispatch;
  setPaletteId: (paletteId: string | undefined, framebufIndex: number) => void;
  setBorderColor: (color: number, framebufIndex: number) => void;
  setBackgroundColor: (color: number, framebufIndex: number) => void;
  setExtBgColor: (index: 1|2|3, color: number, framebufIndex: number) => void;
  setMcmColor: (index: 1|2, color: number, framebufIndex: number) => void;
}

type EditorColorTarget = 'border' | 'bg0' | 'char' | 'ecm1' | 'ecm2' | 'ecm3' | 'mcm1' | 'mcm2';

interface ColorTargetDef {
  id: EditorColorTarget;
  label: string;
  detail: string;
  register: string;
  color: number;
}

interface EditorState {
  isActive: boolean;
  charPos: Coord2;
  activeColorTarget: EditorColorTarget;
}

class Editor extends Component<EditorProps & EditorDispatch, EditorState> {
  state: EditorState = {
    isActive: false,
    charPos: { row: -1, col: 0 },
    activeColorTarget: 'char'
  }

  handleSetPalette = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (this.props.framebufIndex !== null) {
      this.props.setPaletteId(e.target.value || undefined, this.props.framebufIndex);
    }
  }

  buildColorTargets = (framebuf: Framebuf): ColorTargetDef[] => {
    const targets: ColorTargetDef[] = [
      {
        id: 'border',
        label: 'Border',
        detail: 'Canvas frame',
        register: '$D020',
        color: framebuf.borderColor
      },
      {
        id: 'bg0',
        label: 'Background',
        detail: 'Global background',
        register: '$D021',
        color: framebuf.backgroundColor
      },
      {
        id: 'char',
        label: framebuf.mcmMode ? 'Cell color' : 'Char color',
        detail: framebuf.mcmMode ? 'Cell value' : 'Draw color',
        register: 'Color RAM',
        color: this.props.textColor
      }
    ];
    if (framebuf.ecmMode) {
      targets.push(
        { id: 'ecm1', label: 'Alt Bg 1', detail: 'ECM background', register: '$D022', color: framebuf.extBgColor1 ?? 0 },
        { id: 'ecm2', label: 'Alt Bg 2', detail: 'ECM background', register: '$D023', color: framebuf.extBgColor2 ?? 0 },
        { id: 'ecm3', label: 'Alt Bg 3', detail: 'ECM background', register: '$D024', color: framebuf.extBgColor3 ?? 0 },
      );
    }
    if (framebuf.mcmMode) {
      targets.push(
        { id: 'mcm1', label: 'Shared 1', detail: 'MCM shared color', register: '$D022', color: framebuf.mcmColor1 ?? 0 },
        { id: 'mcm2', label: 'Shared 2', detail: 'MCM shared color', register: '$D023', color: framebuf.mcmColor2 ?? 0 },
      );
    }
    return targets;
  }

  resolveActiveColorTarget = (targets: ColorTargetDef[]): EditorColorTarget => {
    return targets.some(t => t.id === this.state.activeColorTarget)
      ? this.state.activeColorTarget
      : 'char';
  }

  handleSelectColorTarget = (target: EditorColorTarget) => {
    this.setState({ activeColorTarget: target });
  }

  setColorForTarget = (target: EditorColorTarget, color: number) => {
    const { framebufIndex } = this.props;
    if (framebufIndex === null) {
      return;
    }
    switch (target) {
      case 'border':
        this.props.setBorderColor(color, framebufIndex);
        return;
      case 'bg0':
        this.props.setBackgroundColor(color, framebufIndex);
        return;
      case 'char':
        this.props.Toolbar.setCurrentColor(color);
        return;
      case 'ecm1':
        this.props.setExtBgColor(1, color, framebufIndex);
        return;
      case 'ecm2':
        this.props.setExtBgColor(2, color, framebufIndex);
        return;
      case 'ecm3':
        this.props.setExtBgColor(3, color, framebufIndex);
        return;
      case 'mcm1':
        this.props.setMcmColor(1, color, framebufIndex);
        return;
      case 'mcm2':
        this.props.setMcmColor(2, color, framebufIndex);
        return;
      default:
        return;
    }
  }

  handlePaletteColorPick = (color: number) => {
    if (!this.props.framebuf) {
      return;
    }
    const targets = this.buildColorTargets(this.props.framebuf);
    const target = this.resolveActiveColorTarget(targets);
    this.setColorForTarget(target, color);
  }

  handleCharPosChanged = (args: { isActive: boolean, charPos: Coord2 }) => {
    this.setState({
      charPos: args.charPos,
      isActive: args.isActive
    })
  }

  render() {
    if (this.props.framebuf === null
      || this.props.containerSize == null
      || !this.props.framebufUIState) {
      return null
    }
    const { colorPalette } = this.props
    const borderColor =
      utils.colorIndexToCssRgb(colorPalette, this.props.framebuf.borderColor)

    const framebufSize = computeFramebufLayout({
      containerSize: this.props.containerSize,
      framebufSize: {
        charWidth: this.props.framebuf.width,
        charHeight: this.props.framebuf.height
      },
      canvasFit: this.props.framebufUIState.canvasFit
    });

    const { crtFilter } = this.props;
    const useCrt = crtFilter !== 'none' && crtFilter !== 'scanlines';
    const modeLabel = this.props.framebuf.mcmMode ? 'MCM' : this.props.framebuf.ecmMode ? 'ECM' : 'Standard';
    const colorTargets = this.buildColorTargets(this.props.framebuf);
    const activeColorTarget = this.resolveActiveColorTarget(colorTargets);
    const selectedTarget = colorTargets.find(t => t.id === activeColorTarget) ?? colorTargets[0];
    const framebufStyle: CSSProperties = {
      width: `${framebufSize.width}px`,
      height: `${framebufSize.height}px`,
      borderColor: borderColor,
      borderStyle: 'solid',
      borderWidth: `${16}px`, // TODO scale border width
      imageRendering: useCrt ? 'auto' : undefined,
      filter: crtFilter === 'colorTv'
        ? 'brightness(1.2) contrast(1.2)'
        : crtFilter === 'bwTv'
          ? 'brightness(1.4) contrast(1.2) grayscale(1)'
          : undefined,
    };
    const scaleX = 1.8;
    const scaleY = scaleX;
    const fbContainerClass =
      classNames(
        styles.fbContainer,
        this.props.selectedTool == Tool.PanZoom ? styles.panzoom : null,
        this.props.selectedTool === Tool.Inspector ? styles.inspector : null
      );
    // Inspector: read hovered cell data
    let inspectedScreencode: number | undefined = undefined;
    let inspectedColorIndex: number | undefined = undefined;
    if (this.props.selectedTool === Tool.Inspector && this.state.isActive) {
      const { row, col } = this.state.charPos;
      const fb = this.props.framebuf;
      if (fb && row >= 0 && row < fb.height && col >= 0 && col < fb.width) {
        const pix = fb.framebuf[row][col];
        inspectedScreencode = pix.code;
        inspectedColorIndex = pix.color;
      }
    }
    return (
      <div
        className={styles.editorLayoutContainer}
      >
        <div>
          <div
            className={fbContainerClass}
            style={framebufStyle}>
            {this.props.framebuf ?
              <FramebufferCont
                framebufLayout={framebufSize}
                framebufUIState={this.props.framebufUIState}
                onCharPosChanged={this.handleCharPosChanged} /> :
              null}
            <CrtOverlay
              width={framebufSize.width}
              height={framebufSize.height}
              filter={crtFilter}
            />
          </div>
          <CanvasStatusbar
            framebuf={this.props.framebuf}
            isActive={this.state.isActive}
            charPos={this.state.charPos}
            inspectedScreencode={inspectedScreencode}
            inspectedColorIndex={inspectedColorIndex}
          />
        </div>
        <div style={{marginLeft: '8px', marginRight: '16px'}}>
          <div style={{marginBottom: '10px'}}>
            <div className={styles.modeBadge}>Mode: {modeLabel}</div>
            <div style={{marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px'}}>
              <span style={{fontSize: '0.75em', color: 'rgb(160,160,160)'}}>Palette:</span>
              <select
                value={this.props.paletteId}
                onChange={this.handleSetPalette}
                style={{
                  flex: 1,
                  fontSize: '0.75em',
                  backgroundColor: 'rgb(40,40,40)',
                  color: '#ccc',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '3px',
                  padding: '2px 4px',
                }}
              >
                {C64_PALETTES.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.colorTargets}>
              {colorTargets.map((target) => (
                <button
                  key={target.id}
                  type='button'
                  onClick={() => this.handleSelectColorTarget(target.id)}
                  className={classNames(
                    styles.colorTarget,
                    target.id === activeColorTarget ? styles.colorTargetActive : null
                  )}
                  title={`${target.label} (${target.register}) - ${target.detail}`}
                >
                  <div
                    className={styles.colorSwatch}
                    style={{ backgroundColor: utils.colorIndexToCssRgb(colorPalette, target.color) }}
                  />
                  <div className={styles.colorTargetText}>
                    <div className={styles.colorTargetLabel}>{target.label}</div>
                    <div className={styles.colorTargetReg}>{target.detail} - {target.register}</div>
                  </div>
                </button>
              ))}
            </div>
            {this.props.framebuf.ecmMode && (
              <div className={styles.modeHint}>ECM uses shared backgrounds Bg0-Bg3.</div>
            )}
            {this.props.framebuf.mcmMode && (
              <div className={styles.modeHint}>Cell color: 0-7 hires, 8-15 multicolor.</div>
            )}
            <ColorPicker
              selected={selectedTarget.color}
              colorPalette={colorPalette}
              onSelectColor={this.handlePaletteColorPick}
              twoRows={true}
              scale={{scaleX, scaleY}}
              inspectedColorIndex={activeColorTarget === 'char' ? inspectedColorIndex : undefined}
            />
          </div>
          <CharSelect canvasScale={{scaleX, scaleY}} inspectedScreencode={inspectedScreencode} inspectedColorIndex={inspectedColorIndex}/>
        </div>
      </div>
    )
  }
}

export default connect(
  (state: RootState) => {
    const framebuf = selectors.getCurrentFramebuf(state)
    const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(state);
    return {
      framebuf,
      framebufIndex,
      textColor: state.toolbar.textColor,
      selectedTool: state.toolbar.selectedTool,
      colorPalette: getEffectiveColorPalette(state, framebufIndex),
      paletteId: getEffectivePaletteId(state, framebufIndex),
      integerScale: getSettingsIntegerScale(state),
      crtFilter: getSettingsCrtFilter(state),
      framebufUIState: selectors.getFramebufUIState(state, framebufIndex)
    }
  },
  dispatch => {
    return {
      Toolbar: Toolbar.bindDispatch(dispatch),
      setPaletteId: (paletteId: string | undefined, framebufIndex: number) =>
        dispatch(Framebuffer.actions.setPaletteId(paletteId, framebufIndex)),
      setBorderColor: (color: number, framebufIndex: number) =>
        dispatch(Framebuffer.actions.setBorderColor(color, framebufIndex)),
      setBackgroundColor: (color: number, framebufIndex: number) =>
        dispatch(Framebuffer.actions.setBackgroundColor(color, framebufIndex)),
      setExtBgColor: (index: 1|2|3, color: number, framebufIndex: number) =>
        dispatch(Framebuffer.actions.setExtBgColor({ index, color }, framebufIndex)),
      setMcmColor: (index: 1|2, color: number, framebufIndex: number) =>
        dispatch(Framebuffer.actions.setMcmColor({ index, color }, framebufIndex)),
    }
  }
)(Editor)
