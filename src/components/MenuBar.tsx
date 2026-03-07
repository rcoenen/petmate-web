import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { dispatchMenuCommand } from '../utils/menuCommands';
import { getSettingsCrtFilter } from '../redux/settingsSelectors';
import { RootState } from '../redux/types';
import s from './MenuBar.module.css';

interface MenuItemDef {
  label: string;
  defaultTag?: boolean;
  cmd?: string;
  accelerator?: string;
  submenu?: MenuItemDef[];
  separator?: never;
  href?: string;
  heading?: boolean;
}
interface SeparatorDef {
  separator: true;
}
type ItemDef = MenuItemDef | SeparatorDef;

function isSep(item: ItemDef): item is SeparatorDef {
  return 'separator' in item && item.separator === true;
}

const importers: MenuItemDef[] = [
  { label: 'ScreenDesigner (.sdd)', defaultTag: true, cmd: 'import-sdd', accelerator: 'Ctrl+Shift+I' },
  { label: 'D64 disk image (.d64)', cmd: 'import-d64' },
  { label: 'PETSCII (.c)',           cmd: 'import-marq-c' },
  { label: 'SEQ (.seq)',             cmd: 'import-seq' },
  { label: 'Retro Debugger (.vce)', cmd: 'import-vce' },
];

const exporters: MenuItemDef[] = [
  { label: 'ScreenDesigner (.sdd)', defaultTag: true, cmd: 'export-sdd', accelerator: 'Ctrl+Shift+E' },
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

const petsciiCompo25Entries: MenuItemDef[] = [
  { label: 'About', href: 'https://csdb.dk/event/?id=3527' },
  { separator: true },
  { label: '01 The Three Graces', cmd: 'load-demo-sdd:petscii-compo-25/01_The_Three_Graces.sdd' },
  { label: '02 Future Proof', cmd: 'load-demo-sdd:petscii-compo-25/02_FutureProof.sdd' },
  { label: '03 Ατρωτος', cmd: 'load-demo-sdd:petscii-compo-25/03_ATROTOS.sdd' },
  { label: '04 The Milkshake Man', cmd: 'load-demo-sdd:petscii-compo-25/04_TheMilkshakeManPet-msm.sdd' },
  { label: '05 Shady Chars', cmd: 'load-demo-sdd:petscii-compo-25/05_ShadyChars.sdd' },
  { label: '06 Missing Something', cmd: 'load-demo-sdd:petscii-compo-25/06_plain.sdd' },
  { label: '07 The Race', cmd: 'load-demo-sdd:petscii-compo-25/07_theracemyd.sdd' },
  { label: '08 CPU END', cmd: 'load-demo-sdd:petscii-compo-25/08_CPUend.sdd' },
  { label: '09 Technomancy', cmd: 'load-demo-sdd:petscii-compo-25/09_Technomancy_Skleptoid.sdd' },
  { label: '10 Hohenzollern', cmd: 'load-demo-sdd:petscii-compo-25/10_hohenzollern.sdd' },
  { label: '11 I C U', cmd: 'load-demo-sdd:petscii-compo-25/11_TRIAD-ICU.sdd' },
  { label: '12 I Yam What I Yam', cmd: 'load-demo-sdd:petscii-compo-25/12_I_yam_what_I_yam.sdd' },
  { label: '13 Sloot Compiler', cmd: 'load-demo-sdd:petscii-compo-25/13_TRIAD-Sloot.sdd' },
  { label: '14 Cathode Ray Mission', cmd: 'load-demo-sdd:petscii-compo-25/14_cathode_ray_mission_ldx40.sdd' },
  { label: '15 Whoo Hoo!', cmd: 'load-demo-sdd:petscii-compo-25/15_whohoo_myd.sdd' },
  { label: '16 Homage a Otl Aicher', cmd: 'load-demo-sdd:petscii-compo-25/16_otl_aicher.sdd' },
  { label: '17 Rain!', cmd: 'load-demo-sdd:petscii-compo-25/17_rain.sdd' },
  { label: '18 Who Ya Gonna Call?', cmd: 'load-demo-sdd:petscii-compo-25/18_who_ya_gonna_call.sdd' },
  { label: '19 ...but I found it in time!', cmd: 'load-demo-sdd:petscii-compo-25/19_plain2.sdd' },
  { label: '20 Mallorca', cmd: 'load-demo-sdd:petscii-compo-25/20_Mallorca.sdd' },
];

const menuDefs: Array<{ label: string; items: ItemDef[] }> = [
  {
    label: 'Petsciishop',
    items: [
      { label: 'About Petsciishop', cmd: 'about' },
      { separator: true },
      { label: 'Demo', submenu: [
        { label: 'Petsciishop Logo', cmd: 'load-demo-logo' },
        { label: 'Plain PETSCII 2025', submenu: petsciiCompo25Entries },
      ]},
    ],
  },
  {
    label: 'File',
    items: [
      { label: 'New',           cmd: 'new',       accelerator: 'Ctrl+N' },
      { label: 'New Screen',    cmd: 'new-screen', accelerator: 'Ctrl+T' },
      { separator: true },
      { label: 'Workspace', heading: true },
      { label: 'Open...',    cmd: 'open',    accelerator: 'Ctrl+O' },
      { label: 'Save',       cmd: 'save',    accelerator: 'Ctrl+S' },
      { label: 'Save As...', cmd: 'save-as', accelerator: 'Ctrl+Shift+S' },
      { separator: true },
      { label: 'Current Screen', heading: true },
      { label: 'Share via URL', cmd: 'share-url' },
      { label: 'Import',  submenu: importers },
      { label: 'Export As', submenu: exporters },
      { separator: true },
      { label: 'Convert', heading: true },
      { label: 'Bitmap to PETSKII', cmd: 'convert-image' },
      { separator: true },
      { label: 'Fonts...',      cmd: 'custom-fonts' },
    ],
  },
  {
    label: 'Edit',
    items: [], // populated dynamically
  },
  {
    label: 'Display',
    items: [], // populated dynamically with CRT filter state
  },
  {
    label: 'Help',
    items: [
      { label: 'GitHub',                    href: 'https://github.com/rcoenen/Petsciishop' },
      { label: 'Search Issues',             href: 'https://github.com/rcoenen/Petsciishop/issues' },
      { label: 'Feedback, Ideas & Showcase', href: 'https://github.com/rcoenen/Petsciishop/discussions' },
      { separator: true },
      { label: 'Open All Demo Files', cmd: 'load-demo-all-2025' },
      { separator: true },
      { label: 'Reset Workspace...', cmd: 'reset-workspace' },
    ],
  },
];

interface DropdownProps {
  items: ItemDef[];
  onCommand: (cmd: string) => void;
  onRequestClose: () => void;
  menuIndex?: number;
}

function getDirectMenuButtons(menu: HTMLElement): HTMLButtonElement[] {
  const buttons: HTMLButtonElement[] = [];
  for (const child of Array.from(menu.children)) {
    const first = (child as HTMLElement).firstElementChild;
    if (first instanceof HTMLButtonElement && first.dataset.menuItem === 'true') {
      buttons.push(first);
    }
  }
  return buttons;
}

function focusAdjacentMenuItem(current: HTMLButtonElement, direction: 1 | -1): void {
  const menu = current.closest('ul');
  if (!(menu instanceof HTMLElement)) return;
  const buttons = getDirectMenuButtons(menu);
  const currentIdx = buttons.indexOf(current);
  if (currentIdx === -1 || buttons.length === 0) return;
  const nextIdx = (currentIdx + direction + buttons.length) % buttons.length;
  buttons[nextIdx].focus();
}

function focusFirstSubmenuItem(button: HTMLButtonElement): void {
  const item = button.parentElement;
  if (!(item instanceof HTMLElement)) return;
  const submenu = item.querySelector(':scope > ul');
  if (!(submenu instanceof HTMLElement)) return;
  const first = getDirectMenuButtons(submenu)[0];
  if (first) first.focus();
}

function focusParentMenuItem(button: HTMLButtonElement): void {
  const parentSubmenu = button.closest('ul.submenu');
  if (!(parentSubmenu instanceof HTMLElement)) return;
  const parentItem = parentSubmenu.parentElement;
  if (!(parentItem instanceof HTMLElement)) return;
  const parentButton = parentItem.querySelector(':scope > button');
  if (parentButton instanceof HTMLButtonElement) {
    parentButton.focus();
  }
}

function Dropdown({ items, onCommand, onRequestClose, menuIndex }: DropdownProps) {
  const activateItem = (item: MenuItemDef) => {
    if (item.cmd) onCommand(item.cmd);
    if (item.href) window.open(item.href, '_blank');
  };

  const renderMenuItems = (menuItems: ItemDef[], keyPrefix = ''): React.ReactNode =>
    menuItems.map((item, i) => {
      const key = `${keyPrefix}${i}`;
      if (isSep(item)) {
        return <li key={key} className={s.separator} role='separator' />;
      }
      if (item.heading) {
        return <li key={key} className={s.heading}>{item.label}</li>;
      }
      const hasSubmenu = item.submenu && item.submenu.length > 0;
      return (
        <li
          key={key}
          className={s.item}
          role='none'
        >
          <button
            type='button'
            className={s.itemButton}
            data-menu-item='true'
            role='menuitem'
            aria-haspopup={hasSubmenu ? 'menu' : undefined}
            onMouseEnter={(e) => {
              // Keep keyboard navigation aligned with the item currently highlighted by hover.
              e.currentTarget.focus({ preventScroll: true });
            }}
            onClick={(e) => {
              if (hasSubmenu) return;
              e.stopPropagation();
              activateItem(item);
            }}
            onKeyDown={(e) => {
              const target = e.currentTarget;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusAdjacentMenuItem(target, 1);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                focusAdjacentMenuItem(target, -1);
                return;
              }
              if (e.key === 'ArrowRight') {
                if (hasSubmenu) {
                  e.preventDefault();
                  focusFirstSubmenuItem(target);
                }
                return;
              }
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                focusParentMenuItem(target);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onRequestClose();
                return;
              }
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (hasSubmenu) {
                  focusFirstSubmenuItem(target);
                } else {
                  activateItem(item);
                }
              }
            }}
          >
            <span className={s.itemLabel}>
              {item.label}
              {item.defaultTag && <span className={s.defaultTag}> default</span>}
            </span>
            <span>
              {item.accelerator && <span className={s.accelerator}>{item.accelerator}</span>}
              {hasSubmenu && <span className={s.arrow}>▶</span>}
            </span>
          </button>
          {hasSubmenu && (
            <ul className={s.submenu} role='menu'>
              {renderMenuItems(item.submenu!, `${key}-`)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <ul className={s.dropdown} role='menu' data-menu-index={menuIndex}>
      {renderMenuItems(items)}
    </ul>
  );
}

export default function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const dispatch = useDispatch();
  const store = useStore();
  const navRef = React.useRef<HTMLElement>(null);
  const menuButtonRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const crtFilter = useSelector((state: RootState) => getSettingsCrtFilter(state));
  const showColorModeLabels = useSelector((state: RootState) => state.toolbar.showColorModeLabels);


  const handleCommand = useCallback((cmd: string) => {
    setOpenMenu(null);
    dispatchMenuCommand(cmd, dispatch, store.getState as any);
  }, [dispatch, store]);

  // Close when clicking outside the menu bar
  useEffect(() => {
    if (openMenu === null) return;
    const close = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openMenu]);

  const editItems: ItemDef[] = [
    { label: 'Undo',         cmd: 'undo',              accelerator: 'Ctrl+Z' },
    { label: 'Redo',         cmd: 'redo',              accelerator: 'Ctrl+Y' },
    { separator: true },
    { label: 'Shift Left',   cmd: 'shift-screen-left',  accelerator: 'Alt+\u2190' },
    { label: 'Shift Right',  cmd: 'shift-screen-right', accelerator: 'Alt+\u2192' },
    { label: 'Shift Up',     cmd: 'shift-screen-up',    accelerator: 'Alt+\u2191' },
    { label: 'Shift Down',   cmd: 'shift-screen-down',  accelerator: 'Alt+\u2193' },
  ];

  const crtSubmenu: MenuItemDef[] = [
    { label: `${crtFilter === 'none' ? '\u2022 ' : '  '}Normal`, cmd: 'crt-none' },
    { label: `${crtFilter === 'scanlines' ? '\u2022 ' : '  '}Scanlines`, cmd: 'crt-scanlines' },
    { label: `${crtFilter === 'colorTv' ? '\u2022 ' : '  '}Color TV`, cmd: 'crt-colorTv' },
    { label: `${crtFilter === 'bwTv' ? '\u2022 ' : '  '}B&W TV`, cmd: 'crt-bwTv' },
  ];

  const displayItems: ItemDef[] = [
    { label: 'CRT Filter', submenu: crtSubmenu },
    { separator: true },
    { separator: true },
    { label: 'Color Mode Labels', submenu: [
      { label: `${showColorModeLabels ? '\u2022 ' : '  '}Show`, cmd: 'toggle-color-mode-labels' },
      { label: `${!showColorModeLabels ? '\u2022 ' : '  '}Hide`, cmd: 'toggle-color-mode-labels' },
    ]},
  ];

  const menus = menuDefs.map(menu => {
    if (menu.label === 'Display') return { ...menu, items: displayItems };
    if (menu.label === 'Edit') return { ...menu, items: editItems };
    return menu;
  });

  const focusFirstItemInOpenMenu = (menuIdx: number) => {
    window.setTimeout(() => {
      const nav = navRef.current;
      if (!nav) return;
      const list = nav.querySelector(`ul[data-menu-index="${menuIdx}"]`);
      if (!(list instanceof HTMLElement)) return;
      const firstItem = getDirectMenuButtons(list)[0];
      if (firstItem) firstItem.focus();
    }, 0);
  };

  return (
    <nav className={s.menuBar} ref={navRef} role='menubar' aria-label='Main menu'>
      {menus.map((menu, i) => (
        <div key={i} className={s.menu}>
          <button
            ref={(el) => { menuButtonRefs.current[i] = el; }}
            className={`${s.menuButton} ${openMenu === i ? s.menuButtonActive : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu(openMenu === i ? null : i);
            }}
            role='menuitem'
            aria-haspopup='menu'
            aria-expanded={openMenu === i}
            onKeyDown={(e) => {
              const count = menus.length;
              if (e.key === 'ArrowRight') {
                e.preventDefault();
                const next = (i + 1) % count;
                menuButtonRefs.current[next]?.focus();
                if (openMenu !== null) setOpenMenu(next);
                return;
              }
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const prev = (i - 1 + count) % count;
                menuButtonRefs.current[prev]?.focus();
                if (openMenu !== null) setOpenMenu(prev);
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpenMenu(i);
                focusFirstItemInOpenMenu(i);
                return;
              }
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const nextOpen = openMenu === i ? null : i;
                setOpenMenu(nextOpen);
                if (nextOpen !== null) {
                  focusFirstItemInOpenMenu(i);
                }
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setOpenMenu(null);
              }
            }}
          >
            {menu.label}
          </button>
          {openMenu === i && (
            <Dropdown
              items={menu.items}
              onCommand={handleCommand}
              onRequestClose={() => {
                setOpenMenu(null);
                menuButtonRefs.current[i]?.focus();
              }}
              menuIndex={i}
            />
          )}
        </div>
      ))}
    </nav>
  );
}
