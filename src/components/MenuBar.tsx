import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { dispatchMenuCommand } from '../utils/menuCommands';
import s from './MenuBar.module.css';

interface MenuItemDef {
  label: string;
  cmd?: string;
  accelerator?: string;
  submenu?: MenuItemDef[];
  separator?: never;
  href?: string;
}
interface SeparatorDef {
  separator: true;
}
type ItemDef = MenuItemDef | SeparatorDef;

function isSep(item: ItemDef): item is SeparatorDef {
  return 'separator' in item && item.separator === true;
}

const importers: MenuItemDef[] = [
  { label: 'D64 disk image (.d64)', cmd: 'import-d64' },
  { label: 'PETSCII (.c)',           cmd: 'import-marq-c' },
  { label: 'PNG (.png)',             cmd: 'import-png' },
  { label: 'SEQ (.seq)',             cmd: 'import-seq' },
];

const exporters: MenuItemDef[] = [
  { label: 'Assembler source (.asm)', cmd: 'export-asm' },
  { label: 'BASIC (.bas)',            cmd: 'export-basic' },
  { label: 'Executable (.prg)',       cmd: 'export-prg' },
  { label: 'GIF (.gif)',              cmd: 'export-gif' },
  { label: 'JSON (.json)',            cmd: 'export-json' },
  { label: 'PETSCII (.c)',            cmd: 'export-marq-c' },
  { label: 'PNG (.png)',              cmd: 'export-png' },
  { label: 'SEQ (.seq)',              cmd: 'export-seq' },
  { label: 'PET (.pet)',              cmd: 'export-pet' },
];

const menuDefs: Array<{ label: string; items: ItemDef[] }> = [
  {
    label: 'File',
    items: [
      { label: 'New',           cmd: 'new',       accelerator: 'Ctrl+N' },
      { label: 'New Screen',    cmd: 'new-screen', accelerator: 'Ctrl+T' },
      { separator: true },
      { label: 'Open...',       cmd: 'open',      accelerator: 'Ctrl+O' },
      { separator: true },
      { label: 'Save',          cmd: 'save',      accelerator: 'Ctrl+S' },
      { label: 'Save As...',    cmd: 'save-as',   accelerator: 'Ctrl+Shift+S' },
      { separator: true },
      { label: 'Import',  submenu: importers },
      { label: 'Export As', submenu: exporters },
      { separator: true },
      { label: 'Fonts...',      cmd: 'custom-fonts' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo',         cmd: 'undo',              accelerator: 'Ctrl+Z' },
      { label: 'Redo',         cmd: 'redo',              accelerator: 'Ctrl+Y' },
      { separator: true },
      { label: 'Shift Left',   cmd: 'shift-screen-left',  accelerator: 'Alt+←' },
      { label: 'Shift Right',  cmd: 'shift-screen-right', accelerator: 'Alt+→' },
      { label: 'Shift Up',     cmd: 'shift-screen-up',    accelerator: 'Alt+↑' },
      { label: 'Shift Down',   cmd: 'shift-screen-down',  accelerator: 'Alt+↓' },
      { separator: true },
      { label: 'Preferences',  cmd: 'preferences',        accelerator: 'Ctrl+P' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Documentation', href: 'https://nurpax.github.io/petmate/' },
      { label: 'Search Issues',  href: 'https://github.com/nurpax/petmate/issues' },
    ],
  },
];

interface DropdownProps {
  items: ItemDef[];
  onCommand: (cmd: string) => void;
}

function Dropdown({ items, onCommand }: DropdownProps) {
  return (
    <ul className={s.dropdown}>
      {items.map((item, i) => {
        if (isSep(item)) {
          return <li key={i} className={s.separator} />;
        }
        const hasSubmenu = item.submenu && item.submenu.length > 0;
        return (
          <li
            key={i}
            className={s.item}
            onClick={() => {
              if (!hasSubmenu && item.cmd) onCommand(item.cmd);
              if (!hasSubmenu && item.href) window.open(item.href, '_blank');
            }}
          >
            <span>{item.label}</span>
            <span>
              {item.accelerator && <span className={s.accelerator}>{item.accelerator}</span>}
              {hasSubmenu && <span className={s.arrow}>▶</span>}
            </span>
            {hasSubmenu && (
              <ul className={s.submenu}>
                {item.submenu!.map((sub, j) =>
                  isSep(sub) ? (
                    <li key={j} className={s.separator} />
                  ) : (
                    <li
                      key={j}
                      className={s.item}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (sub.cmd) onCommand(sub.cmd);
                      }}
                    >
                      <span>{sub.label}</span>
                    </li>
                  )
                )}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export default function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const dispatch = useDispatch();
  const store = useStore();

  const handleCommand = useCallback((cmd: string) => {
    setOpenMenu(null);
    dispatchMenuCommand(cmd, dispatch, store.getState as any);
  }, [dispatch, store]);

  // Close on outside click
  useEffect(() => {
    if (openMenu === null) return;
    const close = () => setOpenMenu(null);
    document.addEventListener('click', close, { capture: true });
    return () => document.removeEventListener('click', close, { capture: true });
  }, [openMenu]);

  return (
    <nav className={s.menuBar}>
      {menuDefs.map((menu, i) => (
        <div key={i} className={s.menu}>
          <button
            className={`${s.menuButton} ${openMenu === i ? s.menuButtonActive : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu(openMenu === i ? null : i);
            }}
          >
            {menu.label}
          </button>
          {openMenu === i && (
            <Dropdown items={menu.items} onCommand={handleCommand} />
          )}
        </div>
      ))}
    </nav>
  );
}
