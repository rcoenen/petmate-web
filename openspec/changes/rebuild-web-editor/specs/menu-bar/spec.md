# Web Menu Bar

## ADDED Requirements

### Requirement: CSS Dropdown Menu Bar
The system SHALL provide a `src/components/MenuBar.tsx` React component that replaces Electron's native menu.

#### Scenario: Menu structure
- **WHEN** the menu bar renders
- **THEN** it displays File, Edit, View, Help menus matching the Electron menu structure from `public/menu.js`

#### Scenario: Submenus
- **WHEN** the user hovers/clicks a top-level menu item
- **THEN** a dropdown appears with the menu items and keyboard shortcut labels

#### Scenario: Import/Export submenus
- **WHEN** the user hovers the Import or Export menu items
- **THEN** a nested submenu appears listing all supported formats

#### Scenario: Menu command dispatch
- **WHEN** the user clicks a menu item
- **THEN** the corresponding Redux action is dispatched (same actions as the IPC `menu` handler in the old `src/index.ts`)

### Requirement: Browser Keyboard Shortcuts
The system SHALL provide `src/hooks/useKeyboardShortcuts.ts` that registers browser-native keyboard shortcuts matching the original Electron accelerators.

#### Scenario: Standard shortcuts
- **WHEN** the user presses Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Cmd/Ctrl+N, Cmd/Ctrl+O, Cmd/Ctrl+S, Cmd/Ctrl+Shift+S, Cmd/Ctrl+T
- **THEN** the corresponding undo, redo, new, open, save, save-as, new-screen actions are dispatched

#### Scenario: Edit shortcuts
- **WHEN** the user presses Alt+Arrow keys
- **THEN** the corresponding shift-screen actions are dispatched

#### Scenario: Shortcut active state
- **WHEN** the window loses focus or shortcuts are disabled
- **THEN** keyboard shortcuts are not processed

## REMOVED Requirements

### Requirement: Electron IPC Menu System
**Reason**: Electron native menu and IPC `menu` event handler are removed.
**Migration**: Menu structure extracted into declarative data. IPC switch statement in `src/index.ts` becomes `dispatchMenuCommand()` function called by MenuBar and keyboard shortcut handler.
