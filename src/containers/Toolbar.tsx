
import React, { Component, Fragment, PureComponent } from 'react';
import { connect } from 'react-redux'
import { bindActionCreators, Dispatch } from 'redux'
import classnames from 'classnames'
import { ActionCreators } from 'redux-undo';

import ColorPicker from '../components/ColorPicker'
import * as utils from '../utils'
import * as fp from '../utils/fp'
import { Toolbar } from '../redux/toolbar'
import { Framebuffer } from '../redux/editor'
import * as framebuf from '../redux/editor';
import * as toolbar from '../redux/toolbar';
import * as selectors from '../redux/selectors'
import * as screensSelectors from '../redux/screensSelectors'
import { getEffectiveColorPalette } from '../redux/settingsSelectors'
import * as Root from '../redux/root'
import { framebufIndexMergeProps } from '../redux/utils'
import { Tool, Rgb, RootState, FramebufUIState } from '../redux/types';

import { withHoverFade } from './hoc'

import {
  faBrush, faPencilAlt, faFont, faUndo, faRedo, faBroom, faCog, faArrowsAlt
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import styles from './Toolbar.module.css';
import { IconProp } from '@fortawesome/fontawesome-svg-core';

interface IconProps {
  selected?: boolean;
  tooltip: string | null;
  iconName: IconProp;
  bottom: boolean;
  subIcon?: React.FC<{}>;
  onIconClick: () => void;
}

class Icon extends PureComponent<IconProps> {
  static defaultProps = {
    bottom: false,
    subIcon: undefined
  }
  render () {
    const selectedClass = this.props.selected !== undefined && this.props.selected ? styles.selectedTool : null
    const tooltip = this.props.tooltip !== null ?
      <span className={styles.tooltiptext}>{this.props.tooltip}</span> :
      null
    return (
      <div
        className={classnames(styles.tooltip, selectedClass, this.props.bottom ? styles.end : null)}
        onClick={() => this.props.onIconClick()}
      >
        <FontAwesomeIcon className={styles.icon} icon={this.props.iconName} />
        {this.props.subIcon !== undefined ? <this.props.subIcon /> : null}
        {tooltip}
      </div>
    )
  }
}

interface SelectableToolProps {
  tool: Tool;
  selectedTool: Tool;
  setSelectedTool: (tool: Tool) => void;
}

type Omit<T, K> = Pick<T, Exclude<keyof T, K>>

class SelectableTool extends PureComponent<SelectableToolProps & Omit<IconProps, 'onIconClick'|'bottom'>> {
  handleClick = () => {
    this.props.setSelectedTool(this.props.tool)
  }
  render () {
    const { tool, ...props } = this.props
    return (
      <Icon
        onIconClick={this.handleClick}
        selected={tool === this.props.selectedTool}
        {...props}
      />
    )
  }
}

interface FbColorPickerProps {
  active: boolean;
  fadeOut: boolean;
  colorPalette: Rgb[];

  color: number;
  tooltip: string;

  onSelectColor: (idx: number) => void;
  onToggleActive: () => void;
}

class FbColorPicker_ extends PureComponent<FbColorPickerProps> {
  handleSelectColor = (idx: number) => {
    this.props.onSelectColor(idx)
  }

  render () {
    const { colorPalette } = this.props
    const bg = utils.colorIndexToCssRgb(colorPalette, this.props.color)
    const s = {
      height: '40px',
      marginTop: '10px',
      backgroundColor: bg,
      flex: 1
    }
    let picker = null
    let tooltip = null
    if (this.props.active) {
      picker =
        <div
          className={classnames(styles.colorpicker, this.props.fadeOut ? styles.fadeOut : null)}
          style={{
            top: '9px',
            filter: 'drop-shadow(2.5px 2.5px 1.5px rgba(0,0,0,0.5))',
          }}
        >
          <ColorPicker
            onSelectColor={this.handleSelectColor}
  
            colorPalette={colorPalette}
            selected={this.props.color}
            scale={{scaleX:1.5, scaleY:1.5}}
            twoRows={true}
          />
        </div>
      tooltip = null
    } else {
      tooltip =
        <span className={styles.tooltiptext}>{this.props.tooltip}</span>
    }
    return (
      <Fragment>
        <div style={s} onClick={this.props.onToggleActive} />
        {picker}
        {tooltip}
      </Fragment>
    )
  }
}
const FbColorPicker = withHoverFade(FbColorPicker_)

const renderColorizeSubIcon: React.FC<{}> = () => {
  return (
    <div style={{
      backgroundColor: '#d77',
      position: 'absolute',
      width: '9px',
      height: '9px',
      top: '24px',
      left: '30px',
      borderRadius:'50%'
    }}>
    </div>
  )
}

const renderCharSubIcon: React.FC<{}> = () => {
  return (
    <div style={{
      position: 'absolute',
      width: '9px',
      height: '9px',
      top: '17px',
      left: '30px',
    }}>
      <i
        className='fas fa-font'
        style={{
          fontSize: '10px'
        }}
      />
    </div>
  )
}

interface CanvasFitSubMenuProps {
  fit: FramebufUIState['canvasFit'];
  setFit: (fit: FramebufUIState['canvasFit']) => void;
};

interface SelectButtonProps extends CanvasFitSubMenuProps {
  name: FramebufUIState['canvasFit'];
  children?: React.ReactNode;
}

const SelectButton: React.FC<SelectButtonProps> = (props: SelectButtonProps) => {
  const { name, fit, setFit, children } = props;
  return (
    <div
      className={styles.canvasFitSelectButton} style={{
        borderStyle: 'solid',
        borderWidth: '1px',
        borderColor: name === fit ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.0)'
      }}
      onClick={() => setFit(name)}
    >
      {children}
    </div>
  )
}

class CanvasFitSubMenu extends PureComponent<CanvasFitSubMenuProps> {
  render () {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        fontSize: '0.7em',
        color: 'rgb(120,120,120)'
      }}>
        <SelectButton
          name='fitWidth'
          fit={this.props.fit}
          setFit={this.props.setFit}>
          W
        </SelectButton>
        <SelectButton
          name='fitWidthHeight'
          fit={this.props.fit}
          setFit={this.props.setFit}>
          WxH
        </SelectButton>
      </div>
    )
  }
}

interface ToolbarSelectorProps {
  framebufIndex: number | null;
  selectedTool: Tool;
  backgroundColor: number | null;
  borderColor: number | null;

  colorPalette: Rgb[];
  canvasFit: FramebufUIState['canvasFit'];
  ecmMode: boolean;
  extBgColor1: number;
  extBgColor2: number;
  extBgColor3: number;
}

interface ToolbarViewProps extends ToolbarSelectorProps {
  readonly Framebuffer: framebuf.PropsFromDispatch;
  readonly Toolbar: toolbar.PropsFromDispatch;
  setFramebufCanvasFit: (fit: FramebufUIState['canvasFit']) => void;
  // Undoable dispatchers
  undo: () => void;
  redo: () => void;
}

interface ToolbarViewState {
  readonly pickerActive: {
    border: boolean;
    background: boolean;
    extBg1: boolean;
    extBg2: boolean;
    extBg3: boolean;
  };
}

class ToolbarView extends Component<
  ToolbarViewProps & ToolbarSelectorProps,
  ToolbarViewState
> {
  state = {
    pickerActive: {
      border: false,
      background: false,
      extBg1: false,
      extBg2: false,
      extBg3: false
    }
  }

  setPickerActive = (pickerId: 'border'|'background'|'canvasFit'|'extBg1'|'extBg2'|'extBg3', val: boolean) => {
    this.setState(prevState => {
      return {
        pickerActive: {
          ...prevState.pickerActive,
          [pickerId]: val
        }
      }
    })
  }

  handleSelectBgColor = (color: number) => {
    this.setPickerActive('background', false)
    this.props.Framebuffer.setBackgroundColor(color)
  }

  handleSelectBorderColor = (color: number) => {
    this.setPickerActive('border', false)
    this.props.Framebuffer.setBorderColor(color)
  }

  handleToggleEcm = () => {
    this.props.Framebuffer.setEcmMode(!this.props.ecmMode)
  }

  handleSelectExtBgColor = (index: 1|2|3) => (color: number) => {
    const pickerId = `extBg${index}` as 'extBg1'|'extBg2'|'extBg3';
    this.setPickerActive(pickerId, false)
    this.props.Framebuffer.setExtBgColor({ index, color })
  }

  render() {
    if (this.props.backgroundColor === null) {
      return null
    }
    type MkToolArgs = {
      tool: Tool;
      iconName: IconProp;
      tooltip: string;
      subIcon?: React.FC<{}>;
    };
    const mkTool = ({ tool, iconName, tooltip, subIcon }: MkToolArgs) => {
      return (
        <SelectableTool
          key={tool}
          tool={tool}
          setSelectedTool={this.props.Toolbar.setSelectedTool}
          selectedTool={this.props.selectedTool}
          iconName={iconName}
          tooltip={tooltip}
          subIcon={subIcon}
        />
      )
    }
    const tools = [
      mkTool({
        tool: Tool.Draw,
        iconName: faPencilAlt,
        tooltip: 'Char & Color'
      }),
      mkTool({
        tool: Tool.Colorize,
        iconName: faPencilAlt,
        tooltip: 'Color only',
        subIcon: renderColorizeSubIcon
      }),
      mkTool({
        tool: Tool.CharDraw,
        iconName: faPencilAlt,
        tooltip: 'Char only',
        subIcon: renderCharSubIcon
      }),
      mkTool({
        tool: Tool.Brush,
        iconName: faBrush,
        tooltip: 'Brush'
      }),
      mkTool({
        tool: Tool.Text,
        iconName: faFont,
        tooltip: 'Text'
      }),
      mkTool({
        tool: Tool.PanZoom,
        iconName: faArrowsAlt,
        tooltip: 'Pan/zoom'
      })
    ]
    return (
      <div className={styles.toolbar}>
        <Icon
          onIconClick={this.props.undo}
          iconName={faUndo} tooltip='Undo'/>
        <Icon
          onIconClick={this.props.redo}
          iconName={faRedo} tooltip='Redo'/>
        <div
          className={classnames(styles.tooltip, this.props.selectedTool === Tool.Inspector ? styles.selectedTool : null)}
          onClick={() => this.props.Toolbar.setSelectedTool(Tool.Inspector)}
        >
          <svg
            className={styles.icon}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 640 640"
            fill="currentColor"
            width="1em"
            height="1em"
          >
            <path d="M320 48C337.7 48 352 62.3 352 80L352 98.3C450.1 112.3 527.7 189.9 541.7 288L560 288C577.7 288 592 302.3 592 320C592 337.7 577.7 352 560 352L541.7 352C527.7 450.1 450.1 527.7 352 541.7L352 560C352 577.7 337.7 592 320 592C302.3 592 288 577.7 288 560L288 541.7C189.9 527.7 112.3 450.1 98.3 352L80 352C62.3 352 48 337.7 48 320C48 302.3 62.3 288 80 288L98.3 288C112.3 189.9 189.9 112.3 288 98.3L288 80C288 62.3 302.3 48 320 48zM163.2 352C175.9 414.7 225.3 464.1 288 476.8L288 464C288 446.3 302.3 432 320 432C337.7 432 352 446.3 352 464L352 476.8C414.7 464.1 464.1 414.7 476.8 352L464 352C446.3 352 432 337.7 432 320C432 302.3 446.3 288 464 288L476.8 288C464.1 225.3 414.7 175.9 352 163.2L352 176C352 193.7 337.7 208 320 208C302.3 208 288 193.7 288 176L288 163.2C225.3 175.9 175.9 225.3 163.2 288L176 288C193.7 288 208 302.3 208 320C208 337.7 193.7 352 176 352L163.2 352zM320 272C346.5 272 368 293.5 368 320C368 346.5 346.5 368 320 368C293.5 368 272 346.5 272 320C272 293.5 293.5 272 320 272z"/>
          </svg>
          <span className={styles.tooltiptext}>Inspector (I)</span>
        </div>
        <Icon
          onIconClick={this.props.Toolbar.clearCanvas}
          iconName={faBroom} tooltip='Clear canvas'/>
        {tools}

        <CanvasFitSubMenu
            fit={this.props.canvasFit}
            setFit={this.props.setFramebufCanvasFit}
         />

        <FbColorPicker
          pickerId='border'
          containerClassName={styles.tooltip}
          active={this.state.pickerActive.border}
          color={this.props.borderColor!}
          onSetActive={this.setPickerActive}
          onSelectColor={this.handleSelectBorderColor}

          colorPalette={this.props.colorPalette}
          tooltip='Border'
        />
        {!this.props.ecmMode && (
          <FbColorPicker
            pickerId='background'
            containerClassName={styles.tooltip}
            active={this.state.pickerActive.background}
            color={this.props.backgroundColor}
            onSetActive={this.setPickerActive}
            onSelectColor={this.handleSelectBgColor}

            colorPalette={this.props.colorPalette}
            tooltip='Background'
          />
        )}

        <Icon
          bottom={true}
          onIconClick={() => this.props.Toolbar.setShowSettings(true)}
          iconName={faCog} tooltip='Preferences'/>
      </div>
    )
  }
}

const undoActions = {
  undo: (framebufIndex: number) => {
    return {
      ...ActionCreators.undo(),
      framebufIndex
    }
  },
  redo: (framebufIndex: number) => {
    return {
      ...ActionCreators.redo(),
      framebufIndex
    }
  }
}
const mapDispatchToProps = (dispatch: any) => {
  function setCanvasFit(canvasFit: FramebufUIState['canvasFit']) {
    return (dispatch: Dispatch, getState: any) => {
      const state = getState();
      const fbIndex = screensSelectors.getCurrentScreenFramebufIndex(state)!;
      const prevState = selectors.getFramebufUIState(getState(), fbIndex);
      dispatch(Toolbar.actions.setFramebufUIState(fbIndex, {
        ...prevState!,
        canvasFit
      }))
    }
  }
  return {
    ...bindActionCreators(undoActions, dispatch),
    ...bindActionCreators(Root.actions, dispatch),
    Toolbar:     Toolbar.bindDispatch(dispatch),
    Framebuffer: Framebuffer.bindDispatch(dispatch),
    setFramebufCanvasFit: (f: FramebufUIState['canvasFit']) => dispatch(setCanvasFit(f))
  }
}

const mapStateToProps = (state: RootState): ToolbarSelectorProps => {
  const framebuf = selectors.getCurrentFramebuf(state);
  const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(state);
  let canvasFit: FramebufUIState['canvasFit'] = 'fitWidth';
  if (framebufIndex !== null) {
    const uis = selectors.getFramebufUIState(state, framebufIndex);
    canvasFit = uis!.canvasFit;
  }
  return {
    framebufIndex,
    backgroundColor: fp.maybe(framebuf, null, fb => fb.backgroundColor),
    borderColor:     fp.maybe(framebuf, null, fb => fb.borderColor),
    selectedTool:    state.toolbar.selectedTool,
    colorPalette:    getEffectiveColorPalette(state, framebufIndex),
    canvasFit,
    ecmMode:      fp.maybe(framebuf, false, fb => fb.ecmMode ?? false),
    extBgColor1:  fp.maybe(framebuf, 0, fb => fb.extBgColor1 ?? 0),
    extBgColor2:  fp.maybe(framebuf, 0, fb => fb.extBgColor2 ?? 0),
    extBgColor3:  fp.maybe(framebuf, 0, fb => fb.extBgColor3 ?? 0),
  }
}
export default connect(
  mapStateToProps,
  mapDispatchToProps,
  framebufIndexMergeProps
)(ToolbarView)
