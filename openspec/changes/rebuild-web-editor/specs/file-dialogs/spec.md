# File Dialogs and I/O

## MODIFIED Requirements

### Requirement: Web-Based File Operations
All file dialog functions in `src/utils/index.ts` SHALL use browser APIs instead of Electron `remote.dialog`.

#### Scenario: Load workspace
- **WHEN** `dialogLoadWorkspace` is called
- **THEN** it uses `pickAndReadTextFile('.petmate')` to get file content, then dispatches the parsed workspace

#### Scenario: Save workspace
- **WHEN** `dialogSaveAsWorkspace` is called
- **THEN** it serializes the workspace to JSON and calls `downloadBlob()` with `.petmate` filename

#### Scenario: Export file
- **WHEN** `dialogExportFile` is called
- **THEN** it gets data from the exporter (string or Uint8Array or Blob) and calls `downloadBlob()`

#### Scenario: Import file
- **WHEN** `dialogImportFile` is called
- **THEN** it uses `pickAndReadFile()` or `pickAndReadTextFile()` and passes content to the importer

#### Scenario: Read file for PNG import
- **WHEN** `dialogReadFile` is called for PNG import
- **THEN** it uses `pickAndReadFile('.png')` and returns the ArrayBuffer

### Requirement: Settings via localStorage
The system SHALL persist settings to `localStorage` instead of the Electron `userData` filesystem path.

#### Scenario: Load settings
- **WHEN** `loadSettings` is called
- **THEN** it reads from `localStorage.getItem('petmate-settings')` and parses JSON

#### Scenario: Save settings
- **WHEN** `saveSettings` is called
- **THEN** it serializes settings to JSON and writes to `localStorage.setItem('petmate-settings', ...)`

### Requirement: Unsaved Changes Confirmation
The system SHALL use `window.confirm()` instead of `electron.remote.dialog.showMessageBoxSync` for unsaved changes prompts.

#### Scenario: Prompt before destructive action
- **WHEN** `promptProceedWithUnsavedChanges` is called and there are unsaved changes
- **THEN** `window.confirm()` is shown with the appropriate message

### Requirement: Window Title
The system SHALL use `document.title` instead of Electron IPC `set-title` for updating the window title.

#### Scenario: Set workspace filename in title
- **WHEN** `setWorkspaceFilenameWithTitle` is called
- **THEN** `document.title` is set to `Petmate - <filename>`
