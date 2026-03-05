# Entry Point

## MODIFIED Requirements

### Requirement: Browser Entry Point
`src/index.ts` SHALL initialize the app without any Electron IPC handlers.

#### Scenario: Startup sequence
- **WHEN** the app loads
- **THEN** it executes: `await loadAssets()` → `configureStore()` → `createRoot().render(<Root>)` → `loadSettings()` from localStorage

#### Scenario: Window focus/blur
- **WHEN** the browser window gains or loses focus
- **THEN** shortcut active state is updated via `window.addEventListener('focus'/'blur', ...)`

#### Scenario: Unsaved changes warning
- **WHEN** the user attempts to close/navigate away from the tab with unsaved changes
- **THEN** a `beforeunload` event handler triggers a browser confirmation dialog

## REMOVED Requirements

### Requirement: Electron IPC Handlers
**Reason**: No Electron main process exists in a web app.
**Migration**: Remove `ipcRenderer.on('menu', ...)`, `ipcRenderer.on('prompt-unsaved', ...)`, `ipcRenderer.on('window-blur', ...)`, `ipcRenderer.on('window-focus', ...)`, `ipcRenderer.on('open-petmate-file', ...)`, `ipcRenderer.sendSync('get-open-args')`. Menu dispatch moves to `MenuBar.tsx`. Focus/blur uses native window events (already partially present).
