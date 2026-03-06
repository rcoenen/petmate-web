import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './containers/Root';
import './app.global.css';

import { loadSettings } from './utils';
import { loadSDD } from './utils/importers';
import * as selectors from './redux/selectors';
import * as Screens from './redux/screens';
import * as settings from './redux/settings';
import * as ReduxRoot from './redux/root';
import { Toolbar } from './redux/toolbar';
import { Tool } from './redux/types';

import configureStore from './store/configureStore';
import { loadAssets } from './utils/assetLoader';
import { startAutoSave, loadAutoSave, clearAutoSave } from './utils/autoSave';
import { loadUIState, startUIStatePersistence } from './utils/uiState';
import { parseShareURL } from './utils/pss1';
import { showAlert } from './utils/dialog';
import MobileShareViewer from './containers/MobileShareViewer';

function isMobileDevice(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  const uaMobile = /android|iphone|ipad|ipod|mobile/.test(ua);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return uaMobile || coarse;
}

function clearLocationHash() {
  if (!window.location.hash) {
    return;
  }
  const clean = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, document.title, clean);
}

async function main() {
  await loadAssets();

  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root element');
  const root = createRoot(container);

  const sharedHash = window.location.hash;
  const hasShareHash = sharedHash.startsWith('#/v/');

  if (hasShareHash && isMobileDevice()) {
    try {
      const sharedFramebuf = parseShareURL(sharedHash);
      if (!sharedFramebuf) {
        throw new Error('Missing shared data.');
      }
      root.render(React.createElement(MobileShareViewer, { framebuf: sharedFramebuf }, null));
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await showAlert(`Could not load shared URL.\n\n${msg}`);
      clearLocationHash();
    }
  }

  const store = configureStore();
  const dispatch = store.dispatch as any;

  // Hash share URL has startup priority.
  if (hasShareHash) {
    try {
      const sharedFramebuf = parseShareURL(sharedHash);
      if (!sharedFramebuf) {
        throw new Error('Missing shared data.');
      }
      dispatch(ReduxRoot.actions.importFramebufsAsNewWorkspace([sharedFramebuf]));
      clearLocationHash();
    } catch (e) {
      clearLocationHash();
      const msg = e instanceof Error ? e.message : String(e);
      await showAlert(`Could not load shared URL.\n\n${msg}`);
      dispatch(Screens.actions.newScreen());
    }
  } else {
    // Always restore auto-saved workspace if one exists.
    const saved = loadAutoSave();
    if (saved) {
      try {
        const data = JSON.parse(saved);
        dispatch(ReduxRoot.actions.openWorkspace(data));
      } catch {
        dispatch(Screens.actions.newScreen());
      }
    } else {
      try {
        const text = await fetch(import.meta.env.BASE_URL + 'demo/Petscii_logo_std.sdd').then(r => r.text());
        const framebufs = loadSDD(text);
        dispatch(ReduxRoot.actions.importFramebufsAppend(framebufs));
      } catch {
        dispatch(Screens.actions.newScreen());
      }
      dispatch(Toolbar.actions.setSelectedTool(Tool.Inspector));
    }
  }
  dispatch(ReduxRoot.actions.updateLastSavedSnapshot());
  loadSettings((j: any) => dispatch(settings.actions.load(j)));

  // Restore last active screen and tool
  const uiState = loadUIState();
  if (uiState) {
    const numScreens = store.getState().screens.list.length;
    if (uiState.screenIndex >= 0 && uiState.screenIndex < numScreens) {
      dispatch(Screens.actions.setCurrentScreenIndex(uiState.screenIndex));
    }
    dispatch(Toolbar.actions.setSelectedTool(uiState.selectedTool));
  }

  // Persist active screen and tool on change
  startUIStatePersistence(store.getState as any, store.subscribe);

  // Periodic auto-save
  startAutoSave(store.getState as any, store.subscribe);

  root.render(React.createElement(Root, { store }, null));

  // Focus/blur: manage keyboard shortcut activation
  window.addEventListener('focus', () => {
    store.dispatch(Toolbar.actions.setShortcutsActive(true));
    store.dispatch(Toolbar.actions.clearModKeyState());
  });
  window.addEventListener('blur', () => {
    store.dispatch(Toolbar.actions.setShortcutsActive(false));
    store.dispatch(Toolbar.actions.clearModKeyState());
  });

}

main().catch(console.error);
