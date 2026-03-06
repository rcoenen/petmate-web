import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { dispatchMenuCommand } from '../utils/menuCommands';
import { getSettingsCrtFilter } from '../redux/settingsSelectors';
import { RootState } from '../redux/types';
import s from './MenuBar.module.css';

interface MenuItemDef {
  label: string;
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
  { label: 'D64 disk image (.d64)', cmd: 'import-d64' },
  { label: 'PETSCII (.c)',           cmd: 'import-marq-c' },
  { label: 'Screen Designer (.sdd)', cmd: 'import-sdd' },
  { label: 'SEQ (.seq)',             cmd: 'import-seq' },
  { label: 'Retro Debugger (.vce)', cmd: 'import-vce' },
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
  { label: 'Screen Designer (.sdd)', cmd: 'export-sdd' },
];

const petsciiCompo25Entries: MenuItemDef[] = [
  { label: '01 Graces', cmd: 'load-demo-sdd:petscii-compo-25/01_graces.sdd' },
  { label: '02 Future Proof', cmd: 'load-demo-sdd:petscii-compo-25/02_FutureProof.sdd' },
  { label: '03 ATROTOS', cmd: 'load-demo-sdd:petscii-compo-25/03_ATROTOS.sdd' },
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
        { label: 'The Three Graces', cmd: 'load-demo-three-graces' },
        { label: "PETSCII Compo '25", submenu: petsciiCompo25Entries },
      ]},
    ],
  },
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
      { label: 'Share URL',     cmd: 'share-url', accelerator: 'Ctrl+Shift+U' },
      { separator: true },
      { label: 'Convert Image...', cmd: 'convert-image' },
      { separator: true },
      { label: 'Import',  submenu: importers },
      { label: 'Export As', submenu: exporters },
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
      { label: 'Reset Workspace...', cmd: 'reset-workspace' },
    ],
  },
];

interface DropdownProps {
  items: ItemDef[];
  onCommand: (cmd: string) => void;
}

function Dropdown({ items, onCommand }: DropdownProps) {
  const renderMenuItems = (menuItems: ItemDef[], keyPrefix = ''): React.ReactNode =>
    menuItems.map((item, i) => {
      const key = `${keyPrefix}${i}`;
      if (isSep(item)) {
        return <li key={key} className={s.separator} />;
      }
      if (item.heading) {
        return <li key={key} className={s.heading}>{item.label}</li>;
      }
      const hasSubmenu = item.submenu && item.submenu.length > 0;
      return (
        <li
          key={key}
          className={s.item}
          onClick={(e) => {
            if (hasSubmenu) return;
            e.stopPropagation();
            if (item.cmd) onCommand(item.cmd);
            if (item.href) window.open(item.href, '_blank');
          }}
        >
          <span>{item.label}</span>
          <span>
            {item.accelerator && <span className={s.accelerator}>{item.accelerator}</span>}
            {hasSubmenu && <span className={s.arrow}>▶</span>}
          </span>
          {hasSubmenu && (
            <ul className={s.submenu}>
              {renderMenuItems(item.submenu!, `${key}-`)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <ul className={s.dropdown}>
      {renderMenuItems(items)}
    </ul>
  );
}

export default function MenuBar() {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const dispatch = useDispatch();
  const store = useStore();
  const navRef = React.useRef<HTMLElement>(null);
  const crtFilter = useSelector((state: RootState) => getSettingsCrtFilter(state));
  const showColorModeLabels = useSelector((state: RootState) => state.toolbar.showColorModeLabels);
  const canvasGrid = useSelector((state: RootState) => state.toolbar.canvasGrid);

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
    { label: `${canvasGrid ? '\u2022 ' : '  '}Show Grid`, cmd: 'toggle-preview-grid' },
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

  return (
    <nav className={s.menuBar} ref={navRef}>
      {menus.map((menu, i) => (
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
