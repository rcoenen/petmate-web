# Design: Rebuild PetMateOnline as a browser-based web editor

## Architecture Overview

The rebuild converts a Node.js/Electron renderer process app into a pure browser SPA. The core architecture (React + Redux + Canvas) remains unchanged. All changes are at the platform boundary layer.

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌─────────────────────────────────────────┐ │
│  │ React 18 + Redux (unchanged core)       │ │
│  │  ├─ Canvas rendering (unchanged)        │ │
│  │  ├─ Redux store + reducers (unchanged)  │ │
│  │  └─ Components (minimal changes)        │ │
│  ├─────────────────────────────────────────┤ │
│  │ Platform Abstraction Layer (NEW)        │ │
│  │  ├─ webPlatform.ts (file pick/download) │ │
│  │  ├─ assetLoader.ts (fetch binary assets)│ │
│  │  └─ autoSave.ts (localStorage)          │ │
│  ├─────────────────────────────────────────┤ │
│  │ Web Menu Bar (NEW, replaces IPC)        │ │
│  │  ├─ MenuBar.tsx (CSS dropdown)          │ │
│  │  └─ useKeyboardShortcuts.ts             │ │
│  ├─────────────────────────────────────────┤ │
│  │ Exporters (return data, no fs.write)    │ │
│  │ Importers (accept data, no fs.read)     │ │
│  └─────────────────────────────────────────┘ │
│  Vite (build) → static dist/                 │
└─────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Build System: Vite over Webpack/CRA

**Decision**: Use Vite with `@vitejs/plugin-react`.

**Rationale**: Vite provides fast HMR, native ESM dev server, and simple configuration. CRA is deprecated. Vite's Rollup-based production builds produce optimized static output.

**Trade-offs**: Some CRA-specific conventions (like `%PUBLIC_URL%`) need updating. Minor, well-understood migration.

### 2. File I/O Strategy: Invisible File Inputs + Blob Downloads

**Decision**: Use hidden `<input type="file">` elements for reading and `<a>` + Blob URL for writing.

**Rationale**: This is the standard browser pattern. No dependencies needed. Works across all modern browsers.

- **Reading**: Create temporary `<input type="file" accept=".ext">`, trigger click, read via FileReader
- **Writing**: Create Blob from data, create temporary `<a>` with `download` attribute, trigger click

**Trade-offs**: No "Save" to same file (browser security). "Save" always becomes "Save As" (download). This is acceptable for a web editor — user expectation for web apps.

### 3. Buffer → Uint8Array Migration

**Decision**: Replace all `Buffer` usage with `Uint8Array` and helper functions.

**Rationale**: `Buffer` is Node-only. `Uint8Array` is the browser-native equivalent. Most `Buffer` methods have direct `Uint8Array` equivalents.

**Specifics**:
- `Buffer.alloc(n)` → `new Uint8Array(n)` (zero-filled by default)
- `Buffer.from(arr)` → `new Uint8Array(arr)` or `Uint8Array.from(arr)`
- `buf.fill(v)` → `arr.fill(v)` (same API)
- `buf.slice()` → `arr.slice()` (same API)
- `buf.indexOf(Buffer.from([...]))` → custom `findBytes()` helper (only used in PRG export)
- `new Buffer(arr)` → `new Uint8Array(arr)` (deprecated constructor anyway)

### 4. PNG Export: Canvas API replaces electron.nativeImage

**Decision**: Use an offscreen `<canvas>` + `canvas.toBlob('image/png')`.

**Rationale**: The existing code already produces RGBA pixel buffers via `framebufToPixels()`. We just need to put those pixels into a Canvas ImageData and export.

**Important**: The existing `framebufToPixels()` in `util.ts` outputs BGRA order (for electron.nativeImage). Must change to RGBA order for Canvas ImageData.

### 5. GIF Export: gifenc replaces gif-encoder

**Decision**: Replace `gif-encoder` (Node streams) with `gifenc` (browser-native, indexed palette).

**Rationale**: `gif-encoder` uses Node streams (`fs.createWriteStream`). `gifenc` works with `Uint8Array` buffers directly and supports indexed palette input — which is exactly what `framebufToPixelsIndexed()` already produces.

### 6. PNG Import: Canvas API replaces pngjs

**Decision**: Decode PNG via `<img>` element + Canvas `drawImage` + `getImageData`.

**Rationale**: `pngjs` is Node-only. The browser can natively decode PNG via the Image element. Load PNG data as a blob URL, draw to canvas, read pixel data.

### 7. D64 Import: c1541 Compatibility

**Decision**: Attempt to use `c1541` with Vite's Buffer polyfill. If that fails, inline the D64 directory parsing logic (it's simple: read directory track/sector chain, extract 16-byte filenames).

**Rationale**: `c1541` is a small module that reads D64 disk image directories. Its core logic is simple array manipulation. The only Node dependency is `fs.readFileSync` which we're already replacing by passing data in.

### 8. PRG Export: c64jasm Compatibility

**Decision**: Attempt to use `c64jasm` with Buffer polyfill via `buffer` npm package. The `readFileSync` callback is already overridden with a virtual filesystem — just need to supply `Buffer.from()`.

**Rationale**: c64jasm's API takes a `readFileSync` callback (already mocked in the codebase) and returns `res.prg`. The only Buffer usage is `Buffer.from(sourceFileMap[fname])` which can use the polyfill.

### 9. Menu Bar: CSS Dropdown Component

**Decision**: Build a simple CSS dropdown menu bar component, extracting the menu structure from `public/menu.js` into declarative data.

**Rationale**: The existing menu structure is well-defined (File, Edit, View, Help with known submenus). A CSS dropdown menu with keyboard shortcut display is standard for web editors. No library needed.

**Keyboard shortcuts**: Register via `document.addEventListener('keydown', ...)` with a mapping from key combos to dispatch actions. Use `Cmd` on macOS, `Ctrl` elsewhere (matching original Electron accelerators).

### 10. Context Menu: React Component

**Decision**: Replace `electron.remote.Menu` with a positioned `<div>` rendered on right-click.

**Rationale**: The context menu in `ContextMenuArea.tsx` is simple (just a list of items with click handlers). A positioned div with `position: fixed` at mouse coordinates is straightforward.

### 11. Settings Persistence: localStorage

**Decision**: Use `localStorage` for settings (replacing Electron `userData` path + `fs`).

**Rationale**: Settings are a small JSON blob. localStorage provides 5-10MB of synchronous key-value storage, more than sufficient.

### 12. Auto-Save: localStorage with Recovery

**Decision**: Periodically save workspace to localStorage. On startup, check for recovery data and offer to restore.

**Rationale**: Web apps can lose state on accidental tab close. Auto-save provides a safety net. Combined with `beforeunload` warning for unsaved changes.

## Sequencing Strategy

The changes are ordered to maintain a compilable (though not necessarily runnable) codebase at each step:

1. **Build system first** (Vite) — establishes the new build pipeline
2. **React upgrade** — modernizes the framework before touching components
3. **Platform abstraction + asset loading** — creates the web API layer
4. **Buffer replacement** — removes Node-only type throughout
5. **Exporters/Importers** — refactor to pure functions (return data, accept data)
6. **File dialogs + Redux thunks** — wire up the new platform layer
7. **Menu bar + components** — replace Electron UI
8. **Entry point rewrite** — final integration
9. **Auto-save + deployment** — polish

Steps 5-6 can be partially parallelized. Steps 3-4 are prerequisites for 5-8.
