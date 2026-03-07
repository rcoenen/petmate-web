
import React, { PureComponent, useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef, CSSProperties } from 'react';
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
import * as ReduxRoot from '../redux/root'
import * as selectors from '../redux/selectors'
import * as screensSelectors from '../redux/screensSelectors'
import { getEffectivePaletteId } from '../redux/settingsSelectors'
import { getColorPaletteById } from '../utils/palette'

import * as utils from '../utils'
import * as fp from '../utils/fp'

import { faPlus } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

import styles from './FramebufferTabs.module.css'
import { Framebuf, Rgb, Font, RootState } from '../redux/types';

interface FileNameLabelProps {
  name: string;
  onOpenInfo: () => void;
}

function FileNameLabel({ name, onOpenInfo }: FileNameLabelProps) {
  return (
    <div className={styles.tabNameContainer}>
      <button
        type='button'
        className={classnames(styles.tabName, styles.tabNameButton)}
        onClick={onOpenInfo}
        title='Open file info'
      >
        {name}
      </button>
    </div>
  );
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
  currentPaletteId: string;
  paletteUpdateOrder: number;
  font: Font;
  showColorModeLabels: boolean;

  setMetadata: (data: any, framebufId: number) => void;
  onSetActiveTab: (id: number) => void;
  onDuplicateTab: (id: number) => void;
  onRemoveTab: (id: number) => void;
  onShareAsUrl: (framebufId: number) => void;
  onSaveAsSdd: (framebufId: number) => void;
  onScreenInfo: (framebufId: number) => void;
};

interface FramebufTabViewProps extends Omit<FramebufTabProps, 'currentPaletteId' | 'paletteUpdateOrder'> {
  colorPalette: Rgb[];
}

class FramebufTabView extends PureComponent<FramebufTabViewProps> {
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

  handleMenuShareAsUrl = () => {
    this.props.onShareAsUrl(this.props.framebufId)
  }

  handleMenuSaveAsSdd = () => {
    this.props.onSaveAsSdd(this.props.framebufId)
  }

  handleMenuScreenInfo = () => {
    this.props.onScreenInfo(this.props.framebufId)
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
      },
      {
        type: 'separator' as const
      },
      {
        label: 'Share as URL',
        click: this.handleMenuShareAsUrl
      },
      {
        label: 'Save as .sdd',
        click: this.handleMenuSaveAsSdd
      },
      {
        type: 'separator' as const
      },
      {
        label: 'Screen Info...',
        click: this.handleMenuScreenInfo
      }
    ];

    return (
      <div
      className={styles.tabItem}
      style={{ width: divWidth + 10 }}
      ref={this.tabRef}
      >
        {this.props.showColorModeLabels && <div style={{
          fontSize: '0.6em',
          color: 'rgb(150,150,150)',
          marginBottom: '3px',
          width: divWidth + 10,
          textAlign: 'center'
        }}>
          {this.props.framebuf.mcmMode ? 'MCM' : this.props.framebuf.ecmMode ? 'ECM' : 'Standard'}
        </div>}
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
                ecmMode={this.props.framebuf.ecmMode}
                mcmMode={this.props.framebuf.mcmMode}
                backgroundColorIndex={backgroundColor}
                extBgColor1={this.props.framebuf.extBgColor1}
                extBgColor2={this.props.framebuf.extBgColor2}
                extBgColor3={this.props.framebuf.extBgColor3}
                mcmColor1={this.props.framebuf.mcmColor1}
                mcmColor2={this.props.framebuf.mcmColor2}
              />
            </div>
          </div>
        </ContextMenuArea>
        <FileNameLabel
          name={fp.maybeDefault(this.props.framebuf.metadata?.name, 'Untitled' as string)}
          onOpenInfo={this.handleMenuScreenInfo}
        />
      </div>
    )
  }
}

function FramebufTab(props: FramebufTabProps) {
  const [displayedPaletteId, setDisplayedPaletteId] = useState(props.currentPaletteId);
  const timeoutRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!props.active) {
      return;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setDisplayedPaletteId(props.currentPaletteId);
  }, [props.active, props.currentPaletteId]);

  useEffect(() => {
    if (props.active || displayedPaletteId === props.currentPaletteId) {
      return;
    }
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setDisplayedPaletteId(props.currentPaletteId);
    }, THUMBNAIL_UPDATE_DELAY_MS * props.paletteUpdateOrder);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [displayedPaletteId, props.active, props.currentPaletteId, props.paletteUpdateOrder]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <FramebufTabView
      {...props}
      colorPalette={getColorPaletteById(displayedPaletteId)}
    />
  );
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
  shareScreenAsUrl: (framebufId: number) => void;
  exportScreenAsSdd: (framebufId: number) => void;
}

interface FramebufferTabsProps {
  screens: number[];
  activeScreen: number;
  currentPaletteId: string;
  newScreenSize: { width: number, height: number };
  showColorModeLabels: boolean;

  getFramebufByIndex: (framebufId: number) => Framebuf | null;
  getFont: (framebuf: Framebuf) => { charset: string, font: Font };
  setFramebufMetadata: (data: any, framebufIndex: number) => void;
}

const THUMBNAIL_UPDATE_DELAY_MS = 16;

function orderDeferredThumbnailIds(screens: number[], activeScreen: number) {
  return screens.filter((_id, index) => index !== activeScreen);
}

function FramebufferTabs_(props: FramebufferTabsProps & FramebufferTabsDispatch) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  const paletteUpdateOrder = useMemo(() => {
    const orderedIds = orderDeferredThumbnailIds(props.screens, props.activeScreen);
    const order = new Map<number, number>();
    props.screens.forEach((id) => order.set(id, 0));
    orderedIds.forEach((id, index) => order.set(id, index + 1));
    return order;
  }, [props.activeScreen, props.screens]);

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
    props.Toolbar.setNewModeTarget('screen');
    props.Toolbar.setShowNewDocumentMode(true);
    props.Toolbar.setCtrlKey(false);
  }, [props.Toolbar]);

  const handleRemoveTab = useCallback((idx: number) => {
    props.Screens.removeScreen(idx);
    props.Toolbar.setCtrlKey(false);
  }, [props.Screens, props.Toolbar]);

  const handleDuplicateTab = useCallback((idx: number) => {
    props.Screens.cloneScreen(idx);
    props.Toolbar.setCtrlKey(false);
  }, [props.Screens, props.Toolbar]);

  const handleSaveAsSdd = useCallback((framebufId: number) => {
    props.exportScreenAsSdd(framebufId);
    props.Toolbar.setCtrlKey(false);
  }, [props.exportScreenAsSdd, props.Toolbar]);

  const handleShareAsUrl = useCallback((framebufId: number) => {
    props.shareScreenAsUrl(framebufId);
    props.Toolbar.setCtrlKey(false);
  }, [props.shareScreenAsUrl, props.Toolbar]);

  const handleScreenInfo = useCallback((framebufId: number) => {
    props.Toolbar.setShowScreenInfo({ show: true, framebufIndex: framebufId });
    props.Toolbar.setCtrlKey(false);
  }, [props.Toolbar]);

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
        onShareAsUrl={handleShareAsUrl}
        onSaveAsSdd={handleSaveAsSdd}
        onScreenInfo={handleScreenInfo}
        framebuf={fb}
        active={i === props.activeScreen}
        font={font}
        currentPaletteId={props.currentPaletteId}
        paletteUpdateOrder={paletteUpdateOrder.get(framebufId) ?? 0}
        setMetadata={props.setFramebufMetadata}
        showColorModeLabels={props.showColorModeLabels}
      />
    );
  });

  return (
    <div className={styles.tabHeadings}>
      <div className={styles.tabsScroller}>
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
      currentPaletteId: getEffectivePaletteId(state, null),
      showColorModeLabels: state.toolbar.showColorModeLabels
    }
  },
  (dispatch) => {
    return {
      Toolbar: toolbar.Toolbar.bindDispatch(dispatch),
      Screens: bindActionCreators(screens.actions, dispatch),
      setFramebufMetadata: bindActionCreators(framebuf.actions.setMetadata, dispatch),
      shareScreenAsUrl: (framebufId: number) => {
        dispatch((ReduxRoot.actions.shareURL(framebufId) as any));
      },
      exportScreenAsSdd: (framebufId: number) => {
        dispatch((ReduxRoot.actions.fileExportAsForFramebuf(utils.formats.sdd, framebufId) as any));
      }
    }
  }
)(FramebufferTabs_)
