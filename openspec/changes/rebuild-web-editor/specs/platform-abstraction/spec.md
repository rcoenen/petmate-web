# Platform Abstraction Layer

## ADDED Requirements

### Requirement: Web Platform Utilities
The system SHALL provide `src/utils/webPlatform.ts` with browser-native file I/O functions replacing Electron dialog/fs APIs.

#### Scenario: Pick and read binary file
- **WHEN** `pickAndReadFile(accept)` is called
- **THEN** a hidden `<input type="file">` is created with the given accept filter, the user selects a file, and the function resolves with an `{ data: ArrayBuffer, name: string }` object

#### Scenario: Pick and read text file
- **WHEN** `pickAndReadTextFile(accept)` is called
- **THEN** a hidden `<input type="file">` is created, the user selects a file, and the function resolves with a `{ text: string, name: string }` object

#### Scenario: Download blob
- **WHEN** `downloadBlob(data, filename, mimeType)` is called
- **THEN** a Blob is created from `data`, a temporary `<a>` element with `download` attribute triggers a browser download with the given filename

#### Scenario: Set window title
- **WHEN** `setTitle(title)` is called
- **THEN** `document.title` is set to the given title

### Requirement: Asset Loader
The system SHALL provide `src/utils/assetLoader.ts` that asynchronously loads binary assets via `fetch()`.

#### Scenario: Load charset and template assets
- **WHEN** `loadAssets()` is called at startup
- **THEN** `system-charset.bin`, `system-charset-lower.bin`, and `template.prg` are fetched from the `assets/` directory and made available as `Uint8Array` exports

#### Scenario: App waits for assets before rendering
- **WHEN** the app starts
- **THEN** `await loadAssets()` completes before the React tree is rendered

## REMOVED Requirements

### Requirement: Electron Imports Module
**Reason**: `src/utils/electronImports.js` exports `electron`, `fs`, `path` via `window.require()`. None of these exist in a browser.
**Migration**: Delete file. All 20 importing files updated to use `webPlatform.ts`, `assetLoader.ts`, or direct browser APIs.

### Requirement: loadAppFile utility
**Reason**: `loadAppFile()` in `src/utils/index.ts` uses `electron.remote.app.getAppPath()` + `fs.readFileSync`. Replaced by `assetLoader.ts`.
**Migration**: Remove function. Update `systemFontData`, `systemFontDataLower`, `executablePrgTemplate` to use async-loaded assets.
