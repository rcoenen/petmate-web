
import { Action } from 'redux'
import { ThunkAction } from 'redux-thunk';
import { ActionCreators } from 'redux-undo';

import * as selectors from './selectors'
import {
  getEffectiveColorPalette
} from '../redux/settingsSelectors'

import {
  Framebuf,
  RootState,
  FileFormat,
  SettingsJson,
  RootStateThunk,
  ColorMode
} from './types'
import { ActionsUnion, createAction } from './typeUtils'
import { Framebuffer } from './editor'
import * as Screens from './screens'
import * as settings from './settings'
import * as workspace from './workspace'
import * as screensSelectors from '../redux/screensSelectors'
import { Toolbar } from './toolbar'
import { showAlert, showConfirm, showManualCopyDialog, showToast } from '../utils/dialog'
import {
  dialogLoadWorkspace,
  dialogSaveAsWorkspace,
  dialogExportFile,
  dialogImportFile,
  saveWorkspace,
  loadSettings,
  setWorkspaceFilenameWithTitle
} from '../utils'

import { importFramebufs } from './workspace'
import { framebufToShareURL } from '../utils/pss1'
import { CHARSET_LOWER, CHARSET_UPPER } from './editor'

export const RESET_STATE = 'RESET_STATE'
export const LOAD_WORKSPACE = 'LOAD_WORKSPACE'
export const UPDATE_LAST_SAVED_SNAPSHOT = 'UPDATE_LAST_SAVED_SNAPSHOT'

function saveAsWorkspace(): ThunkAction<void, RootState, undefined, Action> {
  return (dispatch, getState) => {
    const state = getState();
    const screens = screensSelectors.getScreens(state);
    const getFramebufByIndex = (idx: number) => selectors.getFramebufByIndex(state, idx)!;
    const customFontMap = selectors.getCustomFonts(state);
    dialogSaveAsWorkspace(
      screens,
      getFramebufByIndex,
      customFontMap,
      (filename: string) => dispatch(Toolbar.actions.setWorkspaceFilename(filename)),
      () => dispatch(actionCreators.updateLastSavedSnapshot())
    );
  }
}

export const actionCreators = {
  loadWorkspace: (data: any) => createAction(LOAD_WORKSPACE, data),
  // Snapshot current framebuf and screens state for "ask for unsaved changed"
  // dialog when loading or resetting Petmate workspace.
  updateLastSavedSnapshot: () => createAction(UPDATE_LAST_SAVED_SNAPSHOT),
  resetStateAction: () => createAction(RESET_STATE)
};

export type Actions = ActionsUnion<typeof actionCreators>

export const actions = {
  ...actionCreators,

  createNewWorkspace: (mode: ColorMode): RootStateThunk => {
    return (dispatch, _getState) => {
      dispatch(actionCreators.resetStateAction());
      dispatch(Toolbar.actions.setWorkspaceFilename(null));
      dispatch(Screens.actions.newScreen(mode));
      dispatch(actionCreators.updateLastSavedSnapshot());
    }
  },

  importFramebufsAsNewWorkspace: (framebufs: Framebuf[]): RootStateThunk => {
    return (dispatch, _getState) => {
      dispatch(actionCreators.resetStateAction());
      dispatch(Toolbar.actions.setWorkspaceFilename(null));
      dispatch(importFramebufs(framebufs, true));
      dispatch(actionCreators.updateLastSavedSnapshot());
    }
  },

  // Load workspace from parsed JSON data (file reading happens in dialogLoadWorkspace)
  openWorkspace: (data: any, filename?: string): RootStateThunk => {
    return (dispatch) => {
      try {
        dispatch(workspace.load(data));
        if (filename) {
          setWorkspaceFilenameWithTitle(
            (fname) => dispatch(Toolbar.actions.setWorkspaceFilename(fname)),
            filename
          );
        }
      } catch(e) {
        console.error(e)
        showAlert('Failed to load workspace!')
      }
    }
  },


  // Same as openWorkspace but pop a dialog asking for the filename
  fileOpenWorkspace: (): RootStateThunk => {
    return async (dispatch, getState) => {
      if (selectors.anyUnsavedChanges(getState())) {
        const proceed = await showConfirm(
          'You have unsaved changes. Open a new file anyway?',
          { okLabel: 'Open', cancelLabel: 'Cancel' }
        );
        if (!proceed) return;
      }
      dialogLoadWorkspace(dispatch);
    }
  },

  fileSaveAsWorkspace: saveAsWorkspace,

  fileSaveWorkspace: (): RootStateThunk => {
    return (dispatch, getState) => {
      const state = getState();
      const screens = screensSelectors.getScreens(state);
      const getFramebufByIndex = (idx: number) => selectors.getFramebufByIndex(state, idx)!;
      const customFonts = selectors.getCustomFonts(state);
      saveWorkspace(
        screens,
        getFramebufByIndex,
        customFonts,
        () => dispatch(actionCreators.updateLastSavedSnapshot())
      );
    }
  },

  fileImport: (type: FileFormat): RootStateThunk => {
    return (dispatch, getState) => {
      const state = getState()
      const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(state)
      if (framebufIndex === null) {
        return;
      }
      dialogImportFile(type, (framebufs: Framebuf[]) => {
        dispatch(Framebuffer.actions.importFile(framebufs[0], framebufIndex))
      })
    }
  },

  importFramebufsAppend: (framebufs: Framebuf[]): RootStateThunk => {
    return (dispatch, _getState) => {
      dispatch(importFramebufs(framebufs, true));
    };
  },

  fileImportAppend: (type: FileFormat): RootStateThunk => {
    return (dispatch, _getState) => {
      dialogImportFile(type, (framebufs: Framebuf[]) => {
        dispatch(actions.importFramebufsAppend(framebufs));
      })
    }
  },

  fileImportAsNewWorkspace: (type: FileFormat): RootStateThunk => {
    return async (dispatch, getState) => {
      if (selectors.anyUnsavedChanges(getState())) {
        const proceed = await showConfirm(
          'You have unsaved changes. Import and replace the current workspace?',
          { okLabel: 'Import', cancelLabel: 'Cancel' }
        );
        if (!proceed) {
          return;
        }
      }
      dialogImportFile(type, (framebufs: Framebuf[]) => {
        dispatch(actions.importFramebufsAsNewWorkspace(framebufs));
      });
    };
  },

  fileExportAs: (fmt: FileFormat): RootStateThunk => {
    return (_dispatch, getState) => {
      const state = getState()
      const screens = screensSelectors.getScreens(state)
      let remappedFbIndex = 0
      const selectedFramebufIndex = screensSelectors.getCurrentScreenFramebufIndex(state)
      const framebufs = screens.map((fbIdx, i) => {
        const framebuf = selectors.getFramebufByIndex(state, fbIdx)
        if (!framebuf) {
          throw new Error('invalid framebuf');
        }
        if (selectedFramebufIndex === fbIdx) {
          remappedFbIndex = i
        }
        const { font } = selectors.getFramebufFont(state, framebuf);
        return {
          ...framebuf,
          font
        }
      })
      const palette = getEffectiveColorPalette(state, selectedFramebufIndex)
      const amendedFormatOptions: FileFormat = {
        ...fmt,
        commonExportParams: {
          selectedFramebufIndex: remappedFbIndex
        }
      }
      dialogExportFile(amendedFormatOptions, framebufs, state.customFonts, palette);
    }
  },

  shareURL: (): RootStateThunk => {
    return async (_dispatch, getState) => {
      const state = getState();
      const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(state);
      if (framebufIndex === null) {
        return;
      }
      const framebuf = selectors.getFramebufByIndex(state, framebufIndex);
      if (!framebuf) {
        return;
      }
      if (framebuf.width !== 40 || framebuf.height !== 25) {
        await showAlert('Only 40x25 screens can be shared via URL.');
        return;
      }
      if (framebuf.charset !== CHARSET_UPPER && framebuf.charset !== CHARSET_LOWER) {
        await showAlert('Screens using custom fonts cannot be shared via URL.');
        return;
      }

      let url: string;
      try {
        url = framebufToShareURL(framebuf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await showAlert(`Could not build share URL.\n\n${msg}`);
        return;
      }

      try {
        if (!window.isSecureContext || !navigator.clipboard?.writeText) {
          throw new Error('Clipboard API unavailable.');
        }
        await navigator.clipboard.writeText(url);
        showToast('Share URL copied to clipboard.');
      } catch {
        await showManualCopyDialog(url);
      }
    };
  },

  resetState: (): RootStateThunk => {
    return (dispatch, _getState) => {
      dispatch(actionCreators.resetStateAction());
      loadSettings((j: SettingsJson) => dispatch(settings.actions.load(j)))
    }
  },

  undo: ():  RootStateThunk => {
    return (dispatch, getState) => {
      const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(getState())
      dispatch({
        ...ActionCreators.undo(),
        framebufIndex
      })
    }
  },
  redo: (): RootStateThunk => {
    return (dispatch, getState) => {
      const framebufIndex = screensSelectors.getCurrentScreenFramebufIndex(getState())
      dispatch({
        ...ActionCreators.redo(),
        framebufIndex
      })
    }
  }
}
