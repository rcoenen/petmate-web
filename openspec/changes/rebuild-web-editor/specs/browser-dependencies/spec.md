# Browser-Incompatible Dependencies

## MODIFIED Requirements

### Requirement: Replace gif-encoder with gifenc
The system SHALL use `gifenc` for GIF encoding instead of `gif-encoder` (which requires Node streams).

#### Scenario: GIF export
- **WHEN** a GIF is exported
- **THEN** `gifenc` encodes the indexed palette frames into a `Uint8Array`

### Requirement: Replace pngjs with Canvas API
The system SHALL use browser Canvas API for PNG decoding instead of `pngjs`.

#### Scenario: PNG import
- **WHEN** a PNG file is imported
- **THEN** it is decoded via `createImageBitmap()` or `<img>` + Canvas `drawImage` + `getImageData` to obtain RGBA pixel data

### Requirement: c64jasm Browser Compatibility
The system SHALL make `c64jasm` work in the browser, using a `buffer` npm polyfill if needed for `Buffer.from()` in the assembler's `readFileSync` callback.

#### Scenario: PRG export with custom font
- **WHEN** a PRG is exported for a framebuf using a custom font
- **THEN** `c64jasm.assemble()` runs successfully with a virtual file system callback

### Requirement: c1541 Browser Compatibility
The system SHALL make `c1541` work in the browser. If the polyfill approach fails, the D64 directory parsing logic SHALL be inlined.

#### Scenario: D64 import
- **WHEN** a D64 file is imported
- **THEN** the directory entries are read and converted to framebufs

## REMOVED Requirements

### Requirement: gif-encoder dependency
**Reason**: Node-only (uses streams). Replaced by `gifenc`.
**Migration**: `npm remove gif-encoder && npm add gifenc`

### Requirement: pngjs dependency
**Reason**: Node-only. Replaced by Canvas API.
**Migration**: `npm remove pngjs @types/pngjs`
