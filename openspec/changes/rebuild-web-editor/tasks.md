# Tasks: Rebuild PetMateOnline as a Web Editor

## Phase 1: Build Foundation

- [ ] **1.1** Fill out `openspec/project.md` with project context
- [ ] **1.2** Create `vite.config.ts` with React plugin and `base: './'`
- [ ] **1.3** Move `public/index.html` → root `index.html` with Vite conventions (remove `%PUBLIC_URL%`, add `<script type="module" src="/src/index.ts">`)
- [ ] **1.4** Update `tsconfig.json`: set `"jsx": "react-jsx"`, add `"types": ["vite/client"]`
- [ ] **1.5** Update `package.json`: remove Electron/CRA deps (`electron`, `electron-builder`, `electron-devtools-installer`, `react-scripts`, `react-dev-utils`, `concurrently`, `cross-env`, `wait-on`), add Vite deps (`vite`, `@vitejs/plugin-react`), update scripts to `dev`, `build`, `preview`
- [ ] **1.6** Replace `process.env.NODE_ENV` with `import.meta.env.MODE`/`import.meta.env.DEV` across codebase
- [ ] **1.7** Add `src/vite-env.d.ts` for Vite type declarations

**Validation**: `npx tsc --noEmit` passes (may have errors from electron imports — expected, fixed in Phase 3)

## Phase 2: React Upgrade

- [ ] **2.1** Update `react`, `react-dom` to ^18, `@types/react` and `@types/react-dom` to ^18
- [ ] **2.2** Update `react-redux` to ^8, `@types/react-redux` to latest compatible
- [ ] **2.3** Update `redux-undo` from `1.0.0-beta9-9-7` to `^1.1.0` (stable)
- [ ] **2.4** Replace `ReactDOM.render()` with `createRoot()` in `src/index.ts`
- [ ] **2.5** Replace all `StatelessComponent`/`SFC` imports with `React.FC` (in `CustomFontsModal.tsx`, `ImportModal.tsx`, and any others)

**Validation**: TypeScript compiles without React-related type errors

## Phase 3: Platform Abstraction Layer

- [ ] **3.1** Create `src/utils/webPlatform.ts` with `pickAndReadFile()`, `pickAndReadTextFile()`, `downloadBlob()`, `setTitle()`
- [ ] **3.2** Create `src/utils/assetLoader.ts` with async `loadAssets()` that fetches `system-charset.bin`, `system-charset-lower.bin`, `template.prg` via `fetch()`
- [ ] **3.3** Delete `src/utils/electronImports.js`
- [ ] **3.4** Remove `loadAppFile()` and synchronous asset constants (`systemFontData`, `systemFontDataLower`, `executablePrgTemplate`) from `src/utils/index.ts`; replace with async-loaded exports from `assetLoader.ts`

**Validation**: `webPlatform.ts` and `assetLoader.ts` compile. Asset fetch works in dev server.

## Phase 4: Buffer → Uint8Array Migration

- [ ] **4.1** Replace `Buffer` usage in `src/utils/exporters/util.ts` (`Buffer.alloc` → `new Uint8Array`, pixel order BGRA → RGBA)
- [ ] **4.2** Replace `Buffer` usage in `src/utils/exporters/seq.ts` (`new Buffer(bytes)` → `new Uint8Array(bytes)`)
- [ ] **4.3** Replace `Buffer` usage in `src/utils/exporters/pet.ts` (`Buffer.from(bytes)` → `new Uint8Array(bytes)`)
- [ ] **4.4** Replace `Buffer` usage in `src/utils/exporters/index.ts` (`Buffer.from()` in c64jasm callback, `buf.indexOf(Buffer.from(...))` → `findBytes()` helper)
- [ ] **4.5** Replace `Buffer` usage in `src/containers/ImportModal.tsx` (`Buffer.from(data)` → `new Uint8Array(data)`, remove `PNG` import)
- [ ] **4.6** Add `findBytes(haystack: Uint8Array, needle: number[]): number` helper utility

**Validation**: No `Buffer` references remain in `src/` except polyfill for c64jasm

## Phase 5: Refactor Exporters (return data, no fs.write)

- [ ] **5.1** Refactor `asm.ts`: remove `fs` import, return `string` from `saveAsm`
- [ ] **5.2** Refactor `basic.ts`: remove `fs` import, return `string` from `saveBASIC`
- [ ] **5.3** Refactor `json.ts`: remove `fs` import, return `string` from `saveJSON`
- [ ] **5.4** Refactor `seq.ts`: remove `fs` import, return `Uint8Array` from `saveSEQ`
- [ ] **5.5** Refactor `pet.ts`: remove `fs` import, return `Uint8Array` from `savePET`
- [ ] **5.6** Refactor `index.ts` (exporters): remove `fs` import, `saveMarqC` returns `string`, `saveExecutablePRG` returns `Uint8Array`, `exportC64jasmPRG` returns `Uint8Array`
- [ ] **5.7** Rewrite `png.ts`: remove `electron.nativeImage` + `fs`, use offscreen Canvas to return `Promise<Blob>`
- [ ] **5.8** Rewrite `gif.ts`: replace `gif-encoder` + `fs.createWriteStream` with `gifenc`, return `Uint8Array`
- [ ] **5.9** Install `gifenc` dependency; remove `gif-encoder` dependency
- [ ] **5.10** Update `saveFramebufs` in `src/utils/index.ts` to handle new return types

**Validation**: All exporters compile, no `fs` or `electronImports` references remain in exporters

## Phase 6: Refactor Importers (accept data, no fs.read)

- [ ] **6.1** Refactor `src/utils/importers/index.ts`: `loadMarqCFramebuf` accepts `string` content, returns `Framebuf[]`
- [ ] **6.2** Refactor `src/utils/importers/d64.ts`: `loadD64Framebuf` accepts `Uint8Array` content
- [ ] **6.3** Refactor `src/utils/importers/seq2petscii.ts`: `loadSeq` accepts `Uint8Array` content
- [ ] **6.4** Rewrite PNG import in `ImportModal.tsx`: decode PNG via Canvas API instead of `pngjs`
- [ ] **6.5** Remove `pngjs` and `@types/pngjs` dependencies
- [ ] **6.6** Update `loadFramebuf` in `src/utils/index.ts` to accept content + extension instead of filename
- [ ] **6.7** Handle `c1541` browser compatibility for D64 import (polyfill or inline)

**Validation**: All importers compile, no `fs` or `electronImports` references remain in importers

## Phase 7: Rewrite File Dialog Functions

- [ ] **7.1** Rewrite `dialogLoadWorkspace` to use `pickAndReadTextFile('.petmate')`
- [ ] **7.2** Rewrite `dialogSaveAsWorkspace` to use `downloadBlob()`
- [ ] **7.3** Rewrite `saveWorkspace` to return JSON string (remove `fs.writeFileSync`, `electron.remote.app.addRecentDocument`)
- [ ] **7.4** Rewrite `dialogExportFile` to get data from exporter + `downloadBlob()`
- [ ] **7.5** Rewrite `dialogImportFile` to use `pickAndReadFile()` + pass content to importer
- [ ] **7.6** Rewrite `dialogReadFile` to use `pickAndReadFile()`
- [ ] **7.7** Rewrite `loadSettings`/`saveSettings` to use `localStorage`
- [ ] **7.8** Rewrite `promptProceedWithUnsavedChanges` to use `window.confirm()`
- [ ] **7.9** Rewrite `setWorkspaceFilenameWithTitle` to use `document.title`
- [ ] **7.10** Remove all `electron`, `fs`, `path` imports from `src/utils/index.ts`

**Validation**: `src/utils/index.ts` compiles with no Electron references

## Phase 8: Update Redux Thunks

- [ ] **8.1** Update `openWorkspace` in `src/redux/root.ts`: accept content string, remove `fs.readFileSync`
- [ ] **8.2** Update `fileOpenWorkspace`, `fileSaveAsWorkspace`, `fileSaveWorkspace` to use async dialog functions
- [ ] **8.3** Update `fileExportAs` to use async export + download flow
- [ ] **8.4** Update `fileImportAppend` and `fileImport` to use async import flow
- [ ] **8.5** Update `src/redux/settings.ts`: replace `electron`/`fs`/`path` imports with localStorage calls
- [ ] **8.6** Remove `electronImports` import from `src/redux/root.ts`

**Validation**: `src/redux/root.ts` and `src/redux/settings.ts` compile with no Electron references

## Phase 9: Build Web Menu Bar

- [ ] **9.1** Create `src/components/MenuBar.tsx` with CSS dropdown menu bar
- [ ] **9.2** Create `src/components/MenuBar.module.css` for menu styling
- [ ] **9.3** Extract menu structure from `public/menu.js` into declarative data structure
- [ ] **9.4** Create `src/hooks/useKeyboardShortcuts.ts` with browser keyboard shortcut handling
- [ ] **9.5** Move IPC switch statement from `src/index.ts` into `dispatchMenuCommand()` function
- [ ] **9.6** Integrate MenuBar into `src/containers/App.tsx`

**Validation**: Menu renders, items dispatch correct Redux actions

## Phase 10: Update Remaining Components

- [ ] **10.1** Rewrite `ContextMenuArea.tsx`: replace `electron.remote.Menu` with React context menu
- [ ] **10.2** Rewrite `CustomFontsModal.tsx`: replace Electron dialog + `fs.readFileSync` with `pickAndReadFile('.64c')`; replace `path.basename()` with string manipulation
- [ ] **10.3** Rewrite `FileDrop.tsx`: replace `file.path` with `file.text()` for reading dropped files
- [ ] **10.4** Update `ImportModal.tsx`: replace `dialogReadFile` call with web platform equivalent

**Validation**: All components compile with no Electron references

## Phase 11: Rewrite Entry Point

- [ ] **11.1** Remove all IPC handler registrations from `src/index.ts`
- [ ] **11.2** Add `await loadAssets()` before store creation
- [ ] **11.3** Use `createRoot().render()` for React 18
- [ ] **11.4** Add `beforeunload` event listener for unsaved changes warning
- [ ] **11.5** Keep window `focus`/`blur` listeners (remove duplicate IPC-based ones)
- [ ] **11.6** Remove `electron` import entirely

**Validation**: Entry point compiles, app boots in browser

## Phase 12: Merge Store Configuration

- [ ] **12.1** Create single `src/store/configureStore.ts` using `import.meta.env.DEV`
- [ ] **12.2** Delete `configureStore.js`, `configureStore.dev.js`, `configureStore.prod.js`

**Validation**: Store configures correctly in both dev and prod modes

## Phase 13: Add Auto-Save

- [ ] **13.1** Create `src/utils/autoSave.ts` with periodic localStorage save (60s interval)
- [ ] **13.2** Add recovery check on startup (prompt to restore)
- [ ] **13.3** Handle localStorage quota errors gracefully
- [ ] **13.4** Clear auto-save data on explicit workspace download

**Validation**: Auto-save writes to localStorage, recovery prompt appears after page reload

## Phase 14: Cleanup and Deployment

- [ ] **14.1** Delete `public/electron.js`, `public/menu.js`
- [ ] **14.2** Move `assets/` into `public/assets/` for Vite static serving
- [ ] **14.3** Remove all electron-builder config from `package.json` (`build` section, `main` field)
- [ ] **14.4** Verify `npm run build` produces working `dist/`
- [ ] **14.5** Verify all 13 acceptance criteria from the plan pass

**Validation**: Full end-to-end test per verification checklist:
1. `npm run dev` — app loads, renders empty 40x25 canvas
2. Drawing tools work
3. Character selector + color picker functional
4. Multi-screen tabs work
5. All export formats produce correct downloads
6. All import formats load correctly
7. Custom fonts load from .64c files
8. Undo/redo works per-screen
9. Auto-save persists and recovers
10. Keyboard shortcuts match original
11. Context menu works on right-click
12. Drag-and-drop .petmate files works
13. `npm run build` produces static `dist/`

## Dependencies

- Phase 2 depends on Phase 1 (Vite must be set up before React upgrade)
- Phase 3 depends on Phase 1 (need Vite for `import.meta.env`)
- Phase 4 can run in parallel with Phase 3
- Phases 5-6 depend on Phases 3-4 (need platform layer and Uint8Array)
- Phase 7 depends on Phases 5-6 (dialog functions call exporters/importers)
- Phase 8 depends on Phase 7 (thunks call dialog functions)
- Phase 9 can run in parallel with Phases 7-8
- Phase 10 depends on Phase 3 (needs webPlatform.ts)
- Phase 11 depends on Phases 8-10 (all pieces must be ready)
- Phase 12 can run any time after Phase 1
- Phase 13 can run any time after Phase 11
- Phase 14 depends on all other phases
