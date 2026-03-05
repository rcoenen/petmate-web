## ADDED Requirements

### Requirement: Per-Screen Palette Storage
Each screen (framebuf) SHALL store an optional `paletteId` identifying which C64 colour palette it was designed or converted with. When `paletteId` is not set, the screen SHALL use the global palette from application settings.

#### Scenario: Screen created by image converter
- **WHEN** a user imports a conversion result from the image converter
- **THEN** the resulting screen's `paletteId` SHALL be set to the palette used during conversion

#### Scenario: Screen without palette override
- **WHEN** a screen has no `paletteId` set (e.g. hand-drawn or loaded from old workspace)
- **THEN** the screen SHALL render using the global palette from Settings

#### Scenario: Screen with palette override
- **WHEN** a screen has `paletteId` set to a valid palette ID
- **THEN** the screen SHALL render using that palette regardless of the global setting

### Requirement: All Industry-Standard Palettes Available
The application SHALL expose all palettes defined in `c64Palettes.ts` (currently 9: Colodore, Pepto PAL, Pepto PAL old, Pepto NTSC, Pepto NTSC Sony, VICE, Frodo, CCS64, Petmate) in both the Settings modal and the image converter palette picker.

#### Scenario: Settings modal palette list
- **WHEN** the user opens the Settings modal
- **THEN** all 9 palettes SHALL be shown as selectable options with name and colour swatches

#### Scenario: Converter palette list
- **WHEN** the user opens the image converter
- **THEN** the palette dropdown SHALL list all 9 palettes (already implemented)

### Requirement: Palette Persistence in Workspace JSON
The `paletteId` field SHALL be persisted in workspace JSON files (`.petmate`) and auto-save data when present on a screen.

#### Scenario: Save workspace with per-screen palette
- **WHEN** a workspace is saved containing screens with `paletteId` set
- **THEN** the JSON SHALL include `paletteId` in each screen's framebuf data

#### Scenario: Load old workspace without palette data
- **WHEN** a workspace file without `paletteId` fields is loaded
- **THEN** all screens SHALL default to `paletteId: undefined` (global fallback)

### Requirement: Backward-Compatible SDD Palette Extension
The SDD XML format SHALL be extended with an optional `<PaletteId>` element inside each `<Screen>`. The extension SHALL NOT break compatibility with other tools that consume SDD files.

#### Scenario: Export SDD with palette
- **WHEN** an SDD file is exported for a screen with `paletteId` set
- **THEN** a `<PaletteId>` element SHALL be written inside the `<Screen>` element

#### Scenario: Import SDD without palette element
- **WHEN** an SDD file without `<PaletteId>` elements is imported
- **THEN** the imported screens SHALL have `paletteId: undefined`

#### Scenario: Other tools reading our SDD files
- **WHEN** another tool (e.g. CBM prg Studio) opens an SDD file containing `<PaletteId>`
- **THEN** the tool SHALL ignore the unknown element per standard XML behaviour

### Requirement: Legacy Palette Name Migration
The system SHALL migrate legacy palette name `'pepto'` to `'pepto-pal'` when loading settings from localStorage, ensuring continuity with the palette IDs defined in `c64Palettes.ts`.

#### Scenario: Settings with legacy pepto name
- **WHEN** settings are loaded from localStorage with `selectedColorPalette: 'pepto'`
- **THEN** the value SHALL be normalized to `'pepto-pal'`
