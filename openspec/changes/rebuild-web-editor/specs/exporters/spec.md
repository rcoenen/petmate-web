# Exporters

## MODIFIED Requirements

### Requirement: Exporters Return Data Instead of Writing Files
Each exporter SHALL return its output data instead of calling `fs.writeFileSync`. The caller is responsible for downloading.

#### Scenario: Text exporters (asm, basic, json, marqC)
- **WHEN** `saveAsm`, `saveBASIC`, `saveJSON`, or `saveMarqC` is called
- **THEN** it returns a `string` containing the export content

#### Scenario: Binary exporters (seq, pet, prg)
- **WHEN** `saveSEQ`, `savePET`, or `saveExecutablePRG` is called
- **THEN** it returns a `Uint8Array` containing the binary content

#### Scenario: PNG export
- **WHEN** `savePNG` is called
- **THEN** it returns a `Promise<Blob>` produced by rendering pixel data to an offscreen Canvas and calling `canvas.toBlob('image/png')`

#### Scenario: PNG pixel format
- **WHEN** `framebufToPixels` generates RGBA pixel data
- **THEN** the pixel order is RGBA (not BGRA as was needed for electron.nativeImage)

#### Scenario: GIF export
- **WHEN** `saveGIF` is called
- **THEN** it returns a `Uint8Array` using `gifenc` library (replacing `gif-encoder` + `fs.createWriteStream`)

### Requirement: Exporter Error Handling
Exporters SHALL throw errors on failure instead of calling `alert()` directly. The caller handles user notification.

#### Scenario: Export failure
- **WHEN** an exporter encounters an error
- **THEN** it throws an Error with a descriptive message, and the calling code displays the error to the user
