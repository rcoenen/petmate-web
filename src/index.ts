import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './containers/Root';
import './app.global.css';

import { loadSettings, promptProceedWithUnsavedChanges } from './utils';
import * as Screens from './redux/screens';
import * as settings from './redux/settings';
import * as ReduxRoot from './redux/root';
import { Toolbar } from './redux/toolbar';

import configureStore from './store/configureStore';
import { loadAssets } from './utils/assetLoader';
import { startAutoSave, loadAutoSave, clearAutoSave } from './utils/autoSave';

async function main() {
  await loadAssets();

  const store = configureStore();
  const dispatch = store.dispatch as any;

  // Offer to restore auto-saved workspace if one exists
  const saved = loadAutoSave();
  if (saved) {
    if (window.confirm('A previous session was auto-saved. Restore it?')) {
      try {
        const data = JSON.parse(saved);
        dispatch(ReduxRoot.actions.openWorkspace(data));
      } catch {
        dispatch(Screens.actions.newScreen());
      }
    } else {
      clearAutoSave();
      dispatch(Screens.actions.newScreen());
    }
  } else {
    dispatch(Screens.actions.newScreen());
  }
  dispatch(ReduxRoot.actions.updateLastSavedSnapshot());
  loadSettings((j: any) => dispatch(settings.actions.load(j)));

  // Periodic auto-save
  startAutoSave(store.getState as any);

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

  // Warn before closing with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (!promptProceedWithUnsavedChanges(store.getState(), {
      title: 'Quit',
      detail: "Your changes will be lost if you don't save them."
    })) {
      e.preventDefault();
    }
  });
}

main().catch(console.error);
