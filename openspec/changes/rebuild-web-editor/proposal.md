# Change: Rebuild PetMateOnline as a browser-based web editor

## Why
PetMateOnline is currently an Electron desktop app. Converting it to a static web app eliminates the install barrier, enables sharing via URL, and simplifies deployment (GitHub Pages, Netlify, etc.). The React+Redux+Canvas core is already web-friendly; the Electron surface is small and well-contained.

## What Changes
- **Build system**: Migrate from react-scripts (CRA) to Vite
- **React upgrade**: React 16 → 18, react-redux 5 → 8+, redux-undo beta → stable
- **Platform abstraction**: Replace `electronImports.js` (fs, path, electron) with web platform utilities (File API, Blob downloads, document.title)
- **Asset loading**: Replace `fs.readFileSync` for binary assets with async `fetch()`
- **Buffer removal**: Replace all `Buffer` usage with `Uint8Array` throughout
- **Exporters**: Refactor to return data instead of writing files; replace `electron.nativeImage` (PNG) with Canvas API; replace `gif-encoder` + `fs.createWriteStream` (GIF) with `gifenc`
- **Importers**: Refactor to accept data instead of filenames; replace `pngjs` with Canvas API for PNG decoding
- **File dialogs**: Replace Electron `dialog.showOpenDialogSync/showSaveDialogSync` with `<input type="file">` and Blob download
- **Redux thunks**: Convert file operation thunks to async, use new web platform APIs
- **Menu bar**: Replace Electron native menu + IPC dispatch with a CSS dropdown menu React component + browser keyboard shortcuts
- **Context menu**: Replace `electron.remote.Menu` with a React context menu component
- **Custom fonts modal**: Replace Electron file dialog + `fs.readFileSync` with File API
- **File drop**: Replace `file.path` (Electron-only) with `file.text()`/`file.arrayBuffer()`
- **Entry point**: Remove all IPC handlers, add async asset loading, `createRoot()`, `beforeunload` listener
- **Auto-save**: Add localStorage-based periodic auto-save with recovery on startup
- **Browser dependencies**: Replace/polyfill `c1541`, `c64jasm`, `gif-encoder`, `pngjs`
- **Store config**: Merge dev/prod store configs into single `configureStore.ts` using `import.meta.env`
- **Deployment**: Configure Vite for static output deployable to any web host
- **BREAKING**: Remove Electron desktop app support entirely

## Impact
- Affected specs: all (new project, no existing specs)
- Affected code: Every file that imports from `electronImports.js` (20 files), plus `public/electron.js`, `public/menu.js`, `package.json`, `tsconfig.json`, store config files
- Key files:
  - Delete: `public/electron.js`, `public/menu.js`, `src/utils/electronImports.js`
  - Heavy rewrite: `src/index.ts`, `src/utils/index.ts`, `src/redux/root.ts`, `src/redux/settings.ts`
  - Moderate rewrite: all exporters (9 files), all importers (4 files)
  - New files: `vite.config.ts`, `src/utils/webPlatform.ts`, `src/utils/assetLoader.ts`, `src/components/MenuBar.tsx`, `src/hooks/useKeyboardShortcuts.ts`, `src/utils/autoSave.ts`
  - Component updates: `ContextMenuArea.tsx`, `CustomFontsModal.tsx`, `FileDrop.tsx`, `ImportModal.tsx`
