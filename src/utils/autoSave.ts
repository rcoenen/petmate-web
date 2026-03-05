import { buildWorkspaceJson } from './index';
import * as selectors from '../redux/selectors';
import * as screensSelectors from '../redux/screensSelectors';
import { RootState } from '../redux/types';

const AUTO_SAVE_KEY = 'petsciishop-autosave';
const AUTO_SAVE_INTERVAL_MS = 60_000;

export function startAutoSave(getState: () => RootState): () => void {
  const id = setInterval(() => {
    try {
      const state = getState();
      const screens = screensSelectors.getScreens(state);
      const getFramebufById = (fbid: number) => selectors.getFramebufByIndex(state, fbid)!;
      const cf = selectors.getCustomFonts(state);
      const json = buildWorkspaceJson(screens, getFramebufById, cf);
      localStorage.setItem(AUTO_SAVE_KEY, json);
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }, AUTO_SAVE_INTERVAL_MS);

  return () => clearInterval(id);
}

export function loadAutoSave(): string | null {
  return localStorage.getItem(AUTO_SAVE_KEY);
}

export function clearAutoSave(): void {
  localStorage.removeItem(AUTO_SAVE_KEY);
}
