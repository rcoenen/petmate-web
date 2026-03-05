
import React, { Component, PureComponent, useState, useCallback, CSSProperties } from 'react';
import { connect } from 'react-redux'
import { bindActionCreators } from 'redux'
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import classnames from 'classnames'

import ContextMenuArea from './ContextMenuArea'

import CharGrid from '../components/CharGrid'
import * as framebuf from '../redux/editor'
import * as toolbar from '../redux/toolbar'
import * as screens from '../redux/screens'
import * as selectors from '../redux/selectors'
import * as screensSelectors from '../redux/screensSelectors'
import { getSettingsCurrentColorPalette } from '../redux/settingsSelectors'

import * as utils from '../utils'
import * as fp from '../utils/fp'

import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import styles from './FramebufferTabs.module.css'
import { Framebuf, Rgb, Font, RootState } from '../redux/types';

interface NameInputDispatchProps {
  Toolbar: toolbar.PropsFromDispatch;
}

interface NameInputProps {
  name: string;

  onSubmit: (name: string) => void;
  onCancel: () => void;
  onBlur: () => void;
}

interface NameInputState {
  name: string;
}

// This class is a bit funky with how it disables/enables keyboard shortcuts
// globally for the app while the input element has focus.  Maybe there'd be a
// better way to do this, but this seems to work.
class NameInput_ extends Component<NameInputProps & NameInputDispatchProps, NameInputState> {
  state = {
    name: this.props.name
  }

  componentWillUnmount () {
    this.props.Toolbar.setShortcutsActive(true)
  }

  handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    this.props.onSubmit(this.state.name)
    this.props.Toolbar.setShortcutsActive(true)
  }

  handleChange = (e: React.FormEvent<EventTarget>) => {
    let target = e.target as HTMLInputElement;
    this.setState({ name: target.value })
  }

  handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      this.props.onCancel()
      this.props.Toolbar.setShortcutsActive(true)
    }
  }

  handleBlur = (_e: React.FormEvent<HTMLInputElement>) => {
    this.props.onBlur()
    this.props.Toolbar.setShortcutsActive(true)
  }

  handleFocus = (e: React.FormEvent<HTMLInputElement>) => {
    let target = e.target as HTMLInputElement;
    this.props.Toolbar.setShortcutsActive(false)
    target.select()
  }

  render () {
    return (
      <div className={styles.tabNameEditor}>
        <form onSubmit={this.handleSubmit}>
          <input
            autoFocus
            onKeyDown={this.handleKeyDown}
            value={this.state.name}
            onChange={this.handleChange}
            onBlur={this.handleBlur}
            onFocus={this.handleFocus}
            type='text'
            size={14} />
        </form>
      </div>
    )
  }
}

const NameInput = connect(
  null,
  (dispatch) => {
    return {
      Toolbar: bindActionCreators(toolbar.Toolbar.actions, dispatch)
    }
  }
)(NameInput_)


interface NameEditorProps {
  name: string;

  onNameSave: (name: string) => void;
}

interface NameEditorState {
  editing: boolean;
}

class NameEditor extends Component<NameEditorProps, NameEditorState> {
  state = {
    editing: false
  }

  handleEditingClick = () => {
    this.setState({ editing: true })
  }

  handleBlur = () => {
    this.setState({ editing: false})
  }

  handleSubmit = (name: string) => {
    this.setState({ editing: false})
    this.props.onNameSave(name)
  }

  handleCancel = () => {
    this.setState({ editing: false})
  }

  render () {
    const nameElts = this.state.editing ?
      <NameInput
        name={this.props.name}
        onSubmit={this.handleSubmit}
        onBlur={this.handleBlur}
        onCancel={this.handleCancel}
      /> :
      <div className={styles.tabName} onClick={this.handleEditingClick}>
        {this.props.name}
      </div>
    return (
      <div className={styles.tabNameContainer}>
        {nameElts}
      </div>
    )
  }
}

function computeContainerSize(fb: Framebuf, maxHeight: number) {
  const pixWidth = fb.width * 8;
  const pixHeight = fb.height * 8;
  const s = maxHeight / pixHeight;
  return {
    divWidth: pixWidth * s,
    divHeight: maxHeight,
    scaleX: s,
    scaleY: s
  }
}

interface FramebufTabProps {
  id: number;
  active: boolean;
  framebufId: number;
  framebuf: Framebuf;
  colorPalette: Rgb[];
  font: Font;

  setName: (name: string, framebufId: number) => void;
  onSetActiveTab: (id: number) => void;
  onDuplicateTab: (id: number) => void;
  onRemoveTab: (id: number) => void;
};

class FramebufTab extends PureComponent<FramebufTabProps> {
  tabRef = React.createRef<HTMLDivElement>();

  handleSelect = () => {
    this.props.onSetActiveTab(this.props.id)
  }

  handleMenuDuplicate = () => {
    this.props.onDuplicateTab(this.props.id)
  }

  handleMenuRemove = () => {
    this.props.onRemoveTab(this.props.id)
  }

  handleNameSave = (name: string) => {
    if (name !== '') {
      this.props.setName(name, this.props.framebufId)
    }
  }

  componentDidUpdate() {
    if (this.props.active && this.tabRef.current) {
      this.tabRef.current.scrollIntoView();
    }
  }

  render () {
    const {
      width,
      height,
      framebuf,
      backgroundColor,
      borderColor
    } = this.props.framebuf
    const font = this.props.font
    const colorPalette = this.props.colorPalette
    const backg = utils.colorIndexToCssRgb(colorPalette, backgroundColor)
    const bord = utils.colorIndexToCssRgb(colorPalette, borderColor)
    const maxHeight = 25*2*1.5;
    const {
      divWidth, divHeight, scaleX, scaleY
    } = computeContainerSize(this.props.framebuf, maxHeight);
    const s = {
      width: divWidth,
      height: divHeight,
      backgroundColor: '#000',
      borderStyle: 'solid',
      borderWidth: '5px',
      borderColor: bord
    };
    const scaleStyle: CSSProperties = {
      transform: `scale(${scaleX}, ${scaleY})`,
      transformOrigin: '0% 0%',
      imageRendering: 'pixelated'
    };

    const menuItems = [
      {
        label: "Duplicate",
        click: this.handleMenuDuplicate
      },
      {
        label: "Remove",
        click: this.handleMenuRemove
      }
    ];

    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        marginRight: '4px'
      }}
      ref={this.tabRef}
      >
        <ContextMenuArea menuItems={menuItems}>
          <div
            onClick={this.handleSelect}
            className={classnames(styles.tab, this.props.active ? styles.active : null)}
            style={s}
          >
            <div style={scaleStyle}>
              <CharGrid
                width={width}
                height={height}
                backgroundColor={backg}
                grid={false}
                framebuf={framebuf}
                font={font}
                colorPalette={colorPalette}
              />
            </div>
          </div>
        </ContextMenuArea>
        <NameEditor
          name={fp.maybeDefault(this.props.framebuf.name, 'Untitled' as string)}
          onNameSave={this.handleNameSave}
        />
      </div>
    )
  }
}

function SortableFramebufTab(props: FramebufTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.framebufId,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <FramebufTab {...props} />
    </div>
  );
}

type ScreenDimsProps = {
  dims: {
    width: number,
    height: number
  };
  Toolbar: toolbar.PropsFromDispatch;
};

type ScreenDimsEditProps = {
  stopEditing: () => void;
};

function ScreenDimsEdit (props: ScreenDimsProps & ScreenDimsEditProps) {
  const { width, height } = props.dims;
  const [dimsText, setDimsText] = useState(`${width}x${height}`);

  const handleBlur = useCallback(() => {
    props.stopEditing();
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    props.stopEditing();
    const numsRe = /^([0-9]+)x([0-9]+)/;
    const matches = numsRe.exec(dimsText);
    if (matches) {
      const width = Math.max(1, Math.min(1024, parseInt(matches[1])));
      const height = Math.max(1, Math.min(1024, parseInt(matches[2])));
      props.Toolbar.setNewScreenSize({ width, height });
    }
  }, [dimsText]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDimsText(e.target.value);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      props.stopEditing();
    }
  }, []);

  const handleFocus = useCallback((e: React.FormEvent<HTMLInputElement>) => {
    let target = e.target as HTMLInputElement;
    props.Toolbar.setShortcutsActive(false);
    target.select();
  }, []);

  return (
    <div className={styles.tabNameEditor}>
      <form
        onSubmit={handleSubmit}
      >
        <input
          autoFocus
          type='text'
          pattern='[0-9]+x[0-9]+'
          title='Specify screen width x height (e.g., 40x25)'
          value={dimsText}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onChange={handleChange}
        />
      </form>
    </div>
  );
}

function ScreenDims (props: ScreenDimsProps) {
  const [editing, setEditing] = useState(false);
  const stopEditing = useCallback(() => {
    setEditing(false);
    props.Toolbar.setShortcutsActive(true);
  }, []);
  return (
    <div
      className={styles.screenDimContainer}
      onClick={() => setEditing(true)}
    >
      {editing ?
        <ScreenDimsEdit
          {...props}
          stopEditing={stopEditing}
        /> :
        <div className={styles.screenDimText}>{props.dims.width}x{props.dims.height}</div>}
    </div>
  );
}

function NewTabButton (props: {
  dims: { width: number, height: number },
  onClick: () => void,
  Toolbar: toolbar.PropsFromDispatch
}) {
  const typingWorkaround = { onClick: props.onClick };
  return (
    <div className={classnames(styles.tab, styles.newScreen)}>
      <FontAwesomeIcon {...typingWorkaround} icon={faPlus} />
      <ScreenDims
        dims={props.dims}
        Toolbar={props.Toolbar}
      />
    </div>
  )
}

interface FramebufferTabsDispatch {
  Screens: screens.PropsFromDispatch;
  Toolbar: toolbar.PropsFromDispatch;
}

interface FramebufferTabsProps {
  screens: number[];
  activeScreen: number;
  colorPalette: Rgb[];
  newScreenSize: { width: number, height: number };

  getFramebufByIndex: (framebufId: number) => Framebuf | null;
  getFont: (framebuf: Framebuf) => { charset: string, font: Font };
  setFramebufName: (name: string, framebufIndex: number) => void;
}

function FramebufferTabs_(props: FramebufferTabsProps & FramebufferTabsDispatch) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = props.screens.indexOf(active.id as number);
      const newIndex = props.screens.indexOf(over.id as number);
      props.Screens.setScreenOrder(arrayMove(props.screens, oldIndex, newIndex));
    }
  }, [props.screens, props.Screens]);

  const handleActiveClick = useCallback((idx: number) => {
    props.Screens.setCurrentScreenIndex(idx);
  }, [props.Screens]);

  const handleNewTab = useCallback(() => {
    props.Screens.newScreen();
    props.Toolbar.setCtrlKey(false);
  }, [props.Screens, props.Toolbar]);

  const handleRemoveTab = useCallback((idx: number) => {
    props.Screens.removeScreen(idx);
    props.Toolbar.setCtrlKey(false);
  }, [props.Screens, props.Toolbar]);

  const handleDuplicateTab = useCallback((idx: number) => {
    props.Screens.cloneScreen(idx);
    props.Toolbar.setCtrlKey(false);
  }, [props.Screens, props.Toolbar]);

  const lis = props.screens.map((framebufId, i) => {
    const fb = props.getFramebufByIndex(framebufId)!;
    const { font } = props.getFont(fb);
    return (
      <SortableFramebufTab
        key={framebufId}
        id={i}
        framebufId={framebufId}
        onSetActiveTab={handleActiveClick}
        onRemoveTab={handleRemoveTab}
        onDuplicateTab={handleDuplicateTab}
        framebuf={fb}
        active={i === props.activeScreen}
        font={font}
        colorPalette={props.colorPalette}
        setName={props.setFramebufName}
      />
    );
  });

  return (
    <div className={styles.tabHeadings}>
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={props.screens} strategy={horizontalListSortingStrategy}>
          <div className={styles.tabs}>
            {lis}
            <NewTabButton
              dims={props.newScreenSize}
              Toolbar={props.Toolbar}
              onClick={handleNewTab}
            />
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

export default connect(
  (state: RootState) => {
    return {
      newScreenSize: state.toolbar.newScreenSize,
      activeScreen: screensSelectors.getCurrentScreenIndex(state),
      screens: screensSelectors.getScreens(state),
      getFramebufByIndex: (idx: number) => selectors.getFramebufByIndex(state, idx),
      getFont: (fb: Framebuf) => selectors.getFramebufFont(state, fb),
      colorPalette: getSettingsCurrentColorPalette(state)
    }
  },
  (dispatch) => {
    return {
      Toolbar: toolbar.Toolbar.bindDispatch(dispatch),
      Screens: bindActionCreators(screens.actions, dispatch),
      setFramebufName: bindActionCreators(framebuf.actions.setName, dispatch)
    }
  }
)(FramebufferTabs_)
