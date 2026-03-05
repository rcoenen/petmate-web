import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './containers/Root';
import './app.global.css';

import { loadSettings } from './utils';
import * as selectors from './redux/selectors';
import * as Screens from './redux/screens';
import * as settings from './redux/settings';
import * as ReduxRoot from './redux/root';
import { Toolbar } from './redux/toolbar';

import configureStore from './store/configureStore';
import { loadAssets } from './utils/assetLoader';
import { startAutoSave, loadAutoSave, clearAutoSave } from './utils/autoSave';
import { loadUIState, startUIStatePersistence } from './utils/uiState';

async function main() {
  await loadAssets();

  const store = configureStore();
  const dispatch = store.dispatch as any;

  // Always restore auto-saved workspace if one exists
  const saved = loadAutoSave();
  if (saved) {
    try {
      const data = JSON.parse(saved);
      dispatch(ReduxRoot.actions.openWorkspace(data));
    } catch {
      dispatch(Screens.actions.newScreen());
    }
  } else {
    dispatch(Screens.actions.newScreen());
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

  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root element');
  const root = createRoot(container);
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
