# Importers

## MODIFIED Requirements

### Requirement: Importers Accept Data Instead of Filenames
Each importer SHALL accept file content (string or Uint8Array) instead of a filename, removing all `fs.readFileSync` calls.

#### Scenario: PETSCII .c import
- **WHEN** `loadMarqCFramebuf` is called
- **THEN** it accepts a `string` parameter (file content) instead of a filename, parses it, and returns `Framebuf[]`

#### Scenario: D64 import
- **WHEN** `loadD64Framebuf` is called
- **THEN** it accepts a `Uint8Array` parameter (file content) instead of a filename

#### Scenario: SEQ import
- **WHEN** `loadSeq` is called
- **THEN** it accepts a `Uint8Array` parameter (file content) instead of a filename

#### Scenario: PNG import
- **WHEN** a PNG file is imported via ImportModal
- **THEN** the PNG is decoded using Canvas API (`<img>` + `drawImage` + `getImageData`) instead of `pngjs` (`PNG.sync.read`)

### Requirement: Importer Return Values
Importers SHALL return framebuf data directly instead of calling a callback dispatch.

#### Scenario: loadMarqCFramebuf return
- **WHEN** `loadMarqCFramebuf` is called
- **THEN** it returns `Framebuf[]` directly instead of calling an `importFile` callback
