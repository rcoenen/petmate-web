## ADDED Requirements

### Requirement: ECM Framebuf State
The `Framebuf` interface SHALL include optional ECM fields: `ecmMode` (boolean), `extBgColor1` (number, $D022), `extBgColor2` (number, $D023), `extBgColor3` (number, $D024). When `ecmMode` is falsy, the screen operates in standard mode.

#### Scenario: Standard mode by default
- **WHEN** a new screen is created
- **THEN** `ecmMode` SHALL be `false` and `extBgColor1/2/3` SHALL default to `0`

#### Scenario: ECM mode stores four background colors
- **WHEN** `ecmMode` is `true`
- **THEN** the screen SHALL use `backgroundColor` as bg0 ($D021) and `extBgColor1/2/3` as bg1-bg3 ($D022-$D024)

### Requirement: ECM Helper Utilities
The system SHALL provide utility functions in `src/utils/ecm.ts` for: extracting the 6-bit char index from a screen code (`code & 0x3F`), extracting the 2-bit bg selector (`(code >> 6) & 3`), building a screen code from char index and bg selector, and resolving the background color index for a cell given a Framebuf.

#### Scenario: Round-trip screen code encoding
- **WHEN** a screen code is built from char index 5 and bg selector 2
- **THEN** the screen code SHALL be `(2 << 6) | 5 = 133`
- **AND** extracting the char index SHALL return `5`
- **AND** extracting the bg selector SHALL return `2`

### Requirement: ECM Redux Actions
The editor reducer SHALL support `SET_ECM_MODE` (toggle boolean) and `SET_EXT_BG_COLOR` (set one of 3 extra bg colors by index) actions on a per-framebuf basis. These actions SHALL be undoable via redux-undo.

#### Scenario: Toggle ECM mode
- **WHEN** `SET_ECM_MODE` is dispatched with `true`
- **THEN** the framebuf's `ecmMode` SHALL become `true`

#### Scenario: Set extended background color
- **WHEN** `SET_EXT_BG_COLOR` is dispatched with `{ index: 2, color: 7 }`
- **THEN** `extBgColor2` SHALL become `7`
