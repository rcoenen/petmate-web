import { useEffect } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { dispatchMenuCommand } from '../utils/menuCommands';

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  cmd: string;
}

const shortcuts: Shortcut[] = [
  { key: 'n', ctrl: true, cmd: 'new' },
  { key: 't', ctrl: true, cmd: 'new-screen' },
  { key: 'o', ctrl: true, cmd: 'open' },
  { key: 's', ctrl: true, shift: false, cmd: 'save' },
  { key: 's', ctrl: true, shift: true,  cmd: 'save-as' },
  { key: 'u', ctrl: true, shift: true,  cmd: 'share-url' },
  { key: 'z', ctrl: true, cmd: 'undo' },
  { key: 'y', ctrl: true, cmd: 'redo' },
  { key: 'p', ctrl: true, cmd: 'preferences' },
  { key: 'ArrowLeft',  alt: true, cmd: 'shift-screen-left' },
  { key: 'ArrowRight', alt: true, cmd: 'shift-screen-right' },
  { key: 'ArrowUp',    alt: true, cmd: 'shift-screen-up' },
  { key: 'ArrowDown',  alt: true, cmd: 'shift-screen-down' },
];

function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false;
  if ((s.ctrl ?? false) !== (e.ctrlKey || e.metaKey)) return false;
  if (s.shift !== undefined && s.shift !== e.shiftKey) return false;
  if ((s.alt ?? false) !== e.altKey) return false;
  return true;
}

export function useKeyboardShortcuts() {
  const dispatch = useDispatch();
  const store = useStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      for (const shortcut of shortcuts) {
        if (matchesShortcut(e, shortcut)) {
          e.preventDefault();
          dispatchMenuCommand(shortcut.cmd, dispatch, store.getState as any);
          return;
        }
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dispatch, store]);
}
