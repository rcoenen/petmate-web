import { RootState } from '../redux/types';

const UI_STATE_KEY = 'petsciishop-ui-state';

interface PersistedUIState {
  screenIndex: number;
  selectedTool: number;
}

export function saveUIState(state: RootState): void {
  try {
    const ui: PersistedUIState = {
      screenIndex: state.screens.current,
      selectedTool: state.toolbar.selectedTool,
    };
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(ui));
  } catch {
    // ignore
  }
}

export function loadUIState(): PersistedUIState | null {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedUIState;
  } catch {
    return null;
  }
}

export function startUIStatePersistence(
  getState: () => RootState,
  subscribe: (cb: () => void) => () => void
): () => void {
  let prevScreenIndex = -1;
  let prevTool = -1;

  return subscribe(() => {
    const state = getState();
    const screenIndex = state.screens.current;
    const tool = state.toolbar.selectedTool;
    if (screenIndex !== prevScreenIndex || tool !== prevTool) {
      prevScreenIndex = screenIndex;
      prevTool = tool;
      saveUIState(state);
    }
  });
}
