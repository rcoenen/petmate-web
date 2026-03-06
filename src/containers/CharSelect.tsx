
import React, { Component, useRef, useCallback, useState, MouseEvent, CSSProperties } from 'react';
import { connect } from 'react-redux'
import { Dispatch, bindActionCreators } from 'redux'

import { RootState, Font, Pixel, Coord2, Rgb, Tool } from '../redux/types'
import * as framebuffer from '../redux/editor'
import * as cfonts from '../redux/customFonts'

import { Toolbar } from '../redux/toolbar'
import { framebufIndexMergeProps } from '../redux/utils'

import CharGrid from '../components/CharGrid'
import CharPosOverlay from '../components/CharPosOverlay'
import ColorPicker from '../components/ColorPicker'

import * as utils from '../utils'
import * as fp from '../utils/fp'
import * as selectors from '../redux/selectors'
import * as screensSelectors from '../redux/screensSelectors'
import {
  getEffectiveColorPalette
} from '../redux/settingsSelectors'
import { ecmScreencode, ecmBgSelector, ecmCharIndex } from '../utils/ecm'

import FontSelector from '../components/FontSelector'

import styles from './CharSelect.module.css'

interface CharSelectProps {
  Toolbar: any; // TODO ts
  Framebuffer: framebuffer.PropsFromDispatch;
  charset: string;
  font: Font;
  customFonts: cfonts.CustomFonts;
  canvasScale: {
    scaleX: number, scaleY: number
  };
  colorPalette: Rgb[];
  selected: Coord2 | null;
  inspectedScreencode?: number;
  inspectedColorIndex?: number;
  selectedTool: Tool;
  backgroundColor: number;
  textColor: number;
  ecmMode: boolean;
  mcmMode: boolean;
  extBgColor1: number;
  extBgColor2: number;
  extBgColor3: number;
  mcmColor1: number;
  mcmColor2: number;
}

// Char position & click hook
function useCharPos(
  charWidth: number,
  charHeight: number,
  initialCharPos: Coord2 | null
) {
  const ref = useRef<HTMLDivElement>(null);
  let [isActive, setIsActive] = useState(true);
  let [charPos, setCharPos] = useState<Coord2|null>(initialCharPos);
  let onMouseMove = useCallback(function(event: MouseEvent) {
    if (isActive && ref.current != null) {
      const bbox = ref.current.getBoundingClientRect();
      const x = Math.floor((event.clientX - bbox.left)/bbox.width * charWidth);
      const y = Math.floor((event.clientY - bbox.top)/bbox.height * charHeight);
      if (x >= 0 && x < charWidth && y >= 0 && y < charHeight) {
        setCharPos({row: y, col: x});
      } else {
        setCharPos(null);
      }
    }
  }, [ref, charWidth, charHeight, setCharPos]);

  let onMouseEnter = useCallback(function() {
    setIsActive(true);
  }, []);

  let onMouseLeave = useCallback(function() {
    setIsActive(false);
    setCharPos(null);
  }, []);

  return {
    charPos,
    divProps: {
      ref,
      onMouseMove,
      onMouseEnter,
      onMouseLeave
    }
  };
}

function CharSelectView(props: {
  font: Font;
  charset: string;
  customFonts: cfonts.CustomFonts;
  canvasScale: {
    scaleX: number, scaleY: number
  };
  colorPalette: Rgb[];
  selected: Coord2;
  inspectedCharPos?: Coord2 | null;
  backgroundColor: string;
  style: CSSProperties;
  mcmMode?: boolean;
  mcmColor1?: number;
  mcmColor2?: number;
  backgroundColorIndex?: number;

  fb: Pixel[][];
  onCharSelected: (pos: Coord2|null) => void;
  setCharset: (charset: string) => void;
}) {
  const W = props.fb[0]?.length ?? 16;
  const H = props.fb.length;
  const { scaleX, scaleY } = props.canvasScale;

  const { charPos, divProps } = useCharPos(W, H, props.selected);

  let screencode: number|null = null;
  if (W === 16 && H === 16) {
    screencode = utils.charScreencodeFromRowCol(props.font, props.selected);
    if (charPos !== null) {
      screencode = utils.charScreencodeFromRowCol(props.font, charPos);
    }
  } else {
    // ECM mode: screencode from the framebuf directly
    if (charPos !== null && charPos.row >= 0 && charPos.row < H && charPos.col >= 0 && charPos.col < W) {
      screencode = props.fb[charPos.row][charPos.col].code;
    } else if (props.selected && props.selected.row >= 0 && props.selected.row < H && props.selected.col >= 0 && props.selected.col < W) {
      screencode = props.fb[props.selected.row][props.selected.col].code;
    }
  }

  let handleOnClick = useCallback(function() {
    props.onCharSelected(charPos);
  }, [charPos]);

  const customFonts = Object.entries(props.customFonts).map(([id, { name }]) => {
    return {
      id,
      name
    };
  })
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div className={styles.csContainer} style={props.style}>
        <div
          style={{
            imageRendering: 'pixelated',
            transform: `scale(${scaleX}, ${scaleY})`,
            transformOrigin: '0% 0%',
            width: W*9,
            height: H*9
          }}
          {...divProps}
          onClick={handleOnClick}
        >
          <CharGrid
            width={W}
            height={H}
            backgroundColor={props.backgroundColor}
            grid={true}
            framebuf={props.fb}
            font={props.font}
            colorPalette={props.colorPalette}
            mcmMode={props.mcmMode}
            mcmColor1={props.mcmColor1}
            mcmColor2={props.mcmColor2}
            backgroundColorIndex={props.backgroundColorIndex}
          />
          {charPos !== null ?
            <CharPosOverlay
              framebufWidth={W}
              framebufHeight={H}
              grid={true}
              opacity={0.5}
              charPos={charPos!}
            />
            : null}
          {props.selected ?
            <CharPosOverlay
              framebufWidth={W}
              framebufHeight={H}
              grid={true}
              opacity={1.0}
              charPos={props.selected} />
            : null}
          {props.inspectedCharPos ?
            <CharPosOverlay
              framebufWidth={W}
              framebufHeight={H}
              grid={true}
              inspectorPulse={true}
              outlineWidth={2}
              charPos={props.inspectedCharPos} />
            : null}
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'row',
        marginTop:'4px',
        alignItems:'center',
        justifyContent: 'flex-end'
      }}>
        <FontSelector
          currentCharset={props.charset}
          setCharset={props.setCharset}
          customFonts={customFonts}
        />
      </div>
    </div>
  )
}

function buildEcmPageFb(font: Font, textColor: number): Pixel[][] {
  const ecmChars = font.charOrder.filter(c => c < 64);
  return fp.mkArray(8, y =>
    fp.mkArray(8, x => {
      const idx = y * 8 + x;
      return { code: idx < ecmChars.length ? ecmChars[idx] : 0, color: textColor };
    })
  );
}

function buildMcmFb(font: Font, textColor: number): Pixel[][] {
  // Keep charmap glyph geometry stable in MCM preview:
  // always render as multicolor cells, but preserve the selected hue (low 3 bits).
  const mcmTextColor = (textColor & 7) | 8;
  return fp.mkArray(16, y =>
    fp.mkArray(16, x => ({
      code: utils.charScreencodeFromRowCol(font, { row: y, col: x })!,
      color: mcmTextColor
    }))
  );
}

interface CharSelectState {
  ecmPage: number;
  activeBgPicker: number | null;  // 0-3 or null
}

class CharSelect extends Component<CharSelectProps, CharSelectState> {

  fb: Pixel[][]|null = null;
  font: Font|null = null;
  prevTextColor = -1;
  prevEcmMode = false;
  prevMcmMode = false;
  prevEcmPage = 0;

  state: CharSelectState = { ecmPage: 0, activeBgPicker: null };

  constructor (props: CharSelectProps) {
    super(props)
    this.computeCachedFb(0)
  }

  computeCachedFb(textColor: number) {
    const { font, ecmMode, mcmMode } = this.props
    if (ecmMode) {
      // Filter charOrder to only the 64 char shapes available in ECM (codes 0-63)
      const ecmChars = font.charOrder.filter(c => c < 64);
      this.fb = fp.mkArray(8, y => {
        return fp.mkArray(8, x => {
          const idx = y * 8 + x;
          return {
            code: idx < ecmChars.length ? ecmChars[idx] : 0,
            color: textColor
          }
        })
      })
    } else if (mcmMode) {
      this.fb = buildMcmFb(font, textColor);
    } else {
      this.fb = fp.mkArray(16, y => {
        return fp.mkArray(16, x => {
          return {
            code: utils.charScreencodeFromRowCol(font, {row:y, col:x})!,
            color: textColor
          }
        })
      })
    }
    this.prevTextColor = textColor
    this.prevEcmMode = ecmMode
    this.prevMcmMode = mcmMode
    this.prevEcmPage = this.state.ecmPage
    this.font = font
  }

  handleBgSwatchClick = (page: number) => {
    this.setState(prev => ({
      activeBgPicker: prev.activeBgPicker === page ? null : page
    }));
  }

  handleBgColorSelect = (page: number, color: number) => {
    if (page === 0) {
      this.props.Framebuffer.setBackgroundColor(color);
    } else {
      this.props.Framebuffer.setExtBgColor({ index: page as 1|2|3, color });
    }
    this.setState({ activeBgPicker: null });
  }

  handleClick = (charPos: Coord2 | null) => {
    if (this.props.ecmMode && charPos && this.fb) {
      // Get the base char code (0-63) from what's displayed in the grid
      const baseCode = this.fb[charPos.row][charPos.col].code;
      // Encode the bg page into the upper 2 bits
      const screencode = ecmScreencode(baseCode, this.state.ecmPage);
      // Map back to the 16x16 charOrder position for the toolbar
      const mappedPos = utils.rowColFromScreencode(this.props.font, screencode);
      this.props.Toolbar.setCurrentChar(mappedPos);
    } else {
      this.props.Toolbar.setCurrentChar(charPos);
    }
  }

  render () {
    const { colorPalette, ecmMode, mcmMode } = this.props
    const { scaleX, scaleY } = this.props.canvasScale
    const gridSize = ecmMode ? 8 : 16;
    const w = `${Math.floor(scaleX*8*gridSize+scaleX*gridSize)}px`
    const h = `${Math.floor(scaleY*8*gridSize+scaleY*gridSize)}px`

    // In ECM, show the bg color for the current page
    let bgColorIdx = this.props.backgroundColor;
    if (ecmMode) {
      const page = this.state.ecmPage;
      if (page === 1) bgColorIdx = this.props.extBgColor1;
      else if (page === 2) bgColorIdx = this.props.extBgColor2;
      else if (page === 3) bgColorIdx = this.props.extBgColor3;
    }
    const backg = utils.colorIndexToCssRgb(colorPalette, bgColorIdx)

    const s = {width: w, height:h}
    const charmapColor = this.props.inspectedColorIndex ?? this.props.textColor;

    if (this.prevTextColor !== charmapColor ||
      this.font !== this.props.font ||
      this.prevEcmMode !== ecmMode ||
      this.prevMcmMode !== mcmMode ||
      this.prevEcmPage !== this.state.ecmPage) {
      this.computeCachedFb(charmapColor)
    }
    if (!this.fb) {
      throw new Error('FB cannot be null here');
    }

    const selected = ecmMode ? null : this.props.selected;

    const isInspector = this.props.selectedTool === Tool.Inspector;
    const showAllEcmPages = ecmMode;

    // For inspector + ECM: determine which page the inspected char is on
    let inspectedPage = -1;
    let inspectedBaseCharPos: Coord2 | null = null;
    if (showAllEcmPages && this.props.inspectedScreencode !== undefined) {
      inspectedPage = ecmBgSelector(this.props.inspectedScreencode);
      const baseChar = ecmCharIndex(this.props.inspectedScreencode);
      // Find position in 8x8 grid
      if (this.fb) {
        for (let y = 0; y < this.fb.length; y++) {
          for (let x = 0; x < this.fb[y].length; x++) {
            if (this.fb[y][x].code === baseChar) {
              inspectedBaseCharPos = { row: y, col: x };
              break;
            }
          }
          if (inspectedBaseCharPos) break;
        }
      }
    }

    // Normal inspected char pos (non-ECM)
    const inspectedCharPos = (!ecmMode && this.props.inspectedScreencode !== undefined)
      ? utils.rowColFromScreencode(this.props.font, this.props.inspectedScreencode)
      : null;

    if (showAllEcmPages) {
      const bgColors = [
        this.props.backgroundColor,
        this.props.extBgColor1,
        this.props.extBgColor2,
        this.props.extBgColor3
      ];
      // Use the actual inspected color so the grid matches the canvas
      const displayColor = this.props.inspectedColorIndex ?? this.props.textColor;
      const ecmFb = buildEcmPageFb(this.props.font, displayColor);
      const halfScale = 0.85;
      const cellW = Math.floor(scaleX * halfScale * 8 * 9);
      const cellH = Math.floor(scaleY * halfScale * 8 * 9);
      const handlePageClick = (page: number, e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const col = Math.floor((e.clientX - rect.left) / rect.width * 8);
        const row = Math.floor((e.clientY - rect.top) / rect.height * 8);
        if (row >= 0 && row < 8 && col >= 0 && col < 8 && ecmFb[row]) {
          const baseCode = ecmFb[row][col].code;
          const screencode = ecmScreencode(baseCode, page);
          const mappedPos = utils.rowColFromScreencode(this.props.font, screencode);
          this.props.Toolbar.setCurrentChar(mappedPos);
        }
      };
      const renderPage = (page: number) => {
        const pageBg = utils.colorIndexToCssRgb(colorPalette, bgColors[page]);
        const pageInspectedPos = page === inspectedPage ? inspectedBaseCharPos : null;
        return (
          <div key={page} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.6em',
              color: page === inspectedPage ? 'rgba(0,255,255,0.9)' : 'rgb(120,120,120)',
              marginBottom: '4px',
              position: 'relative'
            }}>
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  backgroundColor: pageBg,
                  border: '1px solid rgba(255,255,255,0.3)',
                  borderRadius: '1px',
                  flexShrink: 0,
                  cursor: 'pointer'
                }}
                onClick={() => this.handleBgSwatchClick(page)}
              />
              Bg{page}
              {this.state.activeBgPicker === page && (
                <div style={{
                  position: 'absolute',
                  top: '20px',
                  left: 0,
                  zIndex: 10,
                  filter: 'drop-shadow(2px 2px 2px rgba(0,0,0,0.5))',
                }}>
                  <ColorPicker
                    colorPalette={colorPalette}
                    selected={bgColors[page]}
                    onSelectColor={(c: number) => this.handleBgColorSelect(page, c)}
                    scale={{ scaleX: 1.0, scaleY: 1.0 }}
                    twoRows={true}
                  />
                </div>
              )}
            </div>
            <div style={{ width: cellW, height: cellH, cursor: 'pointer' }}
              onClick={(e) => handlePageClick(page, e)}
            >
              <div style={{
                imageRendering: 'pixelated' as any,
                transform: `scale(${scaleX * halfScale}, ${scaleY * halfScale})`,
                transformOrigin: '0% 0%',
                width: 8*9,
                height: 8*9,
                pointerEvents: 'none',
              }}>
                <CharGrid
                  width={8}
                  height={8}
                  backgroundColor={pageBg}
                  grid={true}
                  framebuf={ecmFb}
                  font={this.props.font}
                  colorPalette={colorPalette}
                />
                {pageInspectedPos &&
                  <CharPosOverlay
                    framebufWidth={8}
                    framebufHeight={8}
                    grid={true}
                    inspectorPulse={true}
                    outlineWidth={2}
                    charPos={pageInspectedPos}
                  />
                }
              </div>
            </div>
          </div>
        );
      };
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '4px', rowGap: '10px' }}>
            {renderPage(0)}
            {renderPage(1)}
            {renderPage(2)}
            {renderPage(3)}
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            marginTop:'4px',
            alignItems:'center',
            justifyContent: 'flex-end'
          }}>
            <FontSelector
              currentCharset={this.props.charset}
              setCharset={this.props.Framebuffer.setCharset}
              customFonts={Object.entries(this.props.customFonts).map(([id, { name }]) => ({ id, name }))}
            />
          </div>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <CharSelectView
          canvasScale={this.props.canvasScale}
          backgroundColor={backg}
          style={s}
          fb={this.fb}
          charset={this.props.charset}
          font={this.props.font}
          customFonts={this.props.customFonts}
          colorPalette={colorPalette}
          selected={selected!}
          inspectedCharPos={inspectedCharPos}
          mcmMode={this.props.mcmMode}
          mcmColor1={this.props.mcmColor1}
          mcmColor2={this.props.mcmColor2}
          backgroundColorIndex={this.props.backgroundColor}
          onCharSelected={this.handleClick}
          setCharset={this.props.Framebuffer.setCharset}
        />
      </div>
    )
  }
}

const mapDispatchToProps = (dispatch: Dispatch) => {
  return {
    Framebuffer: bindActionCreators(framebuffer.actions, dispatch),
    Toolbar: Toolbar.bindDispatch(dispatch)
  }
}

const mapStateToProps = (state: RootState) => {
  const framebuf = selectors.getCurrentFramebuf(state)
  const { charset, font } = selectors.getCurrentFramebufFont(state)
  const selected =
    selectors.getCharRowColWithTransform(
      state.toolbar.selectedChar,
      font,
      state.toolbar.charTransform
    );
  const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(state);
  return {
    framebufIndex,
    backgroundColor: framebuf ? framebuf.backgroundColor : framebuffer.DEFAULT_BACKGROUND_COLOR,
    selected,
    textColor: state.toolbar.textColor,
    charset,
    font,
    customFonts: selectors.getCustomFonts(state),
    colorPalette: getEffectiveColorPalette(state, framebufIndex),
    selectedTool: state.toolbar.selectedTool,
    ecmMode: framebuf?.ecmMode ?? false,
    mcmMode: framebuf?.mcmMode ?? false,
    extBgColor1: framebuf?.extBgColor1 ?? 0,
    extBgColor2: framebuf?.extBgColor2 ?? 0,
    extBgColor3: framebuf?.extBgColor3 ?? 0,
    mcmColor1: framebuf?.mcmColor1 ?? 0,
    mcmColor2: framebuf?.mcmColor2 ?? 0,
  }
}

export default connect(
  mapStateToProps,
  mapDispatchToProps,
  framebufIndexMergeProps
)(CharSelect)
