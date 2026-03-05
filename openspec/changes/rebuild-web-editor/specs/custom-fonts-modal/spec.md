# Custom Fonts Modal

## MODIFIED Requirements

### Requirement: Web File API for Font Loading
`src/containers/CustomFontsModal.tsx` SHALL use `pickAndReadFile('.64c')` instead of Electron's `dialog.showOpenDialogSync` + `fs.readFileSync`.

#### Scenario: Load custom font
- **WHEN** the user clicks "Load .64c" or "New Font from .64c"
- **THEN** a browser file picker opens filtered to `.64c` files, the file is read as ArrayBuffer, and parsed into font data

#### Scenario: Font name extraction
- **WHEN** a font file is loaded
- **THEN** the font name is extracted from the filename using string manipulation (`name.replace(/\.64c$/i, '')`) instead of `path.basename()`
