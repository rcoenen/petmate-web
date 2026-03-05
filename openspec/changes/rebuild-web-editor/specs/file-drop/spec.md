# File Drop

## MODIFIED Requirements

### Requirement: Browser File Drop API
`src/containers/FileDrop.tsx` SHALL use browser File API instead of Electron's `file.path`.

#### Scenario: Drop .petmate file
- **WHEN** a user drops a `.petmate` file onto the app
- **THEN** the file content is read via `file.text()` and passed to the workspace loader as a string (not a file path)

#### Scenario: loadDroppedFile signature
- **WHEN** `loadDroppedFile` is called
- **THEN** it accepts file content (string) instead of a filename path
