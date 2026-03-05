
import React, { Component, useRef, useCallback, useState, MouseEvent, CSSProperties } from 'react';
import { connect } from 'react-redux'
import { Dispatch, bindActionCreators } from 'redux'

import { RootState, Font, Pixel, Coord2, Rgb } from '../redux/types'
import * as framebuffer from '../redux/editor'
import * as cfonts from '../redux/customFonts'

import { Toolbar } from '../redux/toolbar'
import { framebufIndexMergeProps } from '../redux/utils'

import CharGrid from '../components/CharGrid'
import CharPosOverlay from '../components/CharPosOverlay'
import { CharSelectStatusbar } from '../components/Statusbar'

import * as utils from '../utils'
import * as fp from '../utils/fp'
import * as selectors from '../redux/selectors'
import * as screensSelectors from '../redux/screensSelectors'
import {
  getSettingsCurrentColorPalette
} from '../redux/settingsSelectors'
import { ecmScreencode } from '../utils/ecm'

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
  backgroundColor: number;
  textColor: number;
  ecmMode: boolean;
  extBgColor1: number;
  extBgColor2: number;
  extBgColor3: number;
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
  backgroundColor: string;
  style: CSSProperties;

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
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'row',
        marginTop:'4px',
        alignItems:'center',
        justifyContent: 'space-between'
      }}>
        <CharSelectStatusbar
          curScreencode={screencode}
        />
        <FontSelector
          currentCharset={props.charset}
          setCharset={props.setCharset}
          customFonts={customFonts}
        />
      </div>
    </div>
  )
}

class CharSelect extends Component<CharSelectProps, { ecmPage: number }> {

  fb: Pixel[][]|null = null;
  font: Font|null = null;
  prevTextColor = -1;
  prevEcmMode = false;
  prevEcmPage = 0;

  state = { ecmPage: 0 };

  constructor (props: CharSelectProps) {
    super(props)
    this.computeCachedFb(0)
  }

  computeCachedFb(textColor: number) {
    const { font, ecmMode } = this.props
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
    this.prevEcmPage = this.state.ecmPage
    this.font = font
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
    const { colorPalette, ecmMode } = this.props
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
    if (this.prevTextColor !== this.props.textColor ||
      this.font !== this.props.font ||
      this.prevEcmMode !== ecmMode ||
      this.prevEcmPage !== this.state.ecmPage) {
      this.computeCachedFb(this.props.textColor)
    }
    if (!this.fb) {
      throw new Error('FB cannot be null here');
    }

    const selected = ecmMode ? null : this.props.selected;

    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {ecmMode && (
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            marginBottom: '4px',
            gap: '2px'
          }}>
            {[0, 1, 2, 3].map(page => (
              <button
                key={page}
                onClick={() => this.setState({ ecmPage: page })}
                style={{
                  flex: 1,
                  padding: '2px 4px',
                  fontSize: '0.7em',
                  backgroundColor: this.state.ecmPage === page ? 'rgba(255,255,255,0.2)' : 'transparent',
                  color: this.state.ecmPage === page ? '#fff' : 'rgb(120,120,120)',
                  border: this.state.ecmPage === page ? '1px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '3px',
                  cursor: 'pointer'
                }}
              >
                Bg {page}
              </button>
            ))}
          </div>
        )}
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
  return {
    framebufIndex: screensSelectors.getCurrentScreenFramebufIndex(state),
    backgroundColor: framebuf ? framebuf.backgroundColor : framebuffer.DEFAULT_BACKGROUND_COLOR,
    selected,
    textColor: state.toolbar.textColor,
    charset,
    font,
    customFonts: selectors.getCustomFonts(state),
    colorPalette: getSettingsCurrentColorPalette(state),
    ecmMode: framebuf?.ecmMode ?? false,
    extBgColor1: framebuf?.extBgColor1 ?? 0,
    extBgColor2: framebuf?.extBgColor2 ?? 0,
    extBgColor3: framebuf?.extBgColor3 ?? 0,
  }
}

export default connect(
  mapStateToProps,
  mapDispatchToProps,
  framebufIndexMergeProps
)(CharSelect)
