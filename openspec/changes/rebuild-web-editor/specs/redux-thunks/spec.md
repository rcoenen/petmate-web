# Redux Thunks

## MODIFIED Requirements

### Requirement: Async File Operation Thunks
File operation thunks in `src/redux/root.ts` SHALL be async and use web platform APIs.

#### Scenario: openWorkspace
- **WHEN** `openWorkspace` is called
- **THEN** it accepts a content string (not a filename), parses JSON, and dispatches workspace load. No `fs.readFileSync` or `addRecentDocument`.

#### Scenario: fileOpenWorkspace
- **WHEN** `fileOpenWorkspace` is dispatched
- **THEN** it calls async `dialogLoadWorkspace` which uses File API

#### Scenario: fileSaveWorkspace
- **WHEN** `fileSaveWorkspace` is dispatched
- **THEN** it always triggers a download (web apps cannot silently save to a previously opened file path). Equivalent to "Save As" behavior.

#### Scenario: fileExportAs
- **WHEN** `fileExportAs` is dispatched
- **THEN** it gets data from the exporter and triggers a download via `downloadBlob()`

#### Scenario: fileImportAppend
- **WHEN** `fileImportAppend` is dispatched
- **THEN** it uses async file picker, passes content to importer, dispatches import

### Requirement: Remove Electron Imports from root.ts
The `src/redux/root.ts` file SHALL NOT import from `electronImports`.

#### Scenario: No electron references
- **WHEN** root.ts is compiled
- **THEN** it has no imports from `../utils/electronImports`
