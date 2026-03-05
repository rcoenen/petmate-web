## ADDED Requirements

### Requirement: ECM Workspace Persistence
The workspace serializer SHALL include `ecmMode`, `extBgColor1`, `extBgColor2`, `extBgColor3` fields when saving an ECM screen. The deserializer SHALL read these fields with defaults of `undefined` (standard mode) when absent.

#### Scenario: Save and reload ECM workspace
- **WHEN** a workspace containing an ECM screen is saved and reopened
- **THEN** the screen SHALL retain `ecmMode: true` and all 4 background color values
- **AND** per-cell background rendering SHALL be identical to before saving

#### Scenario: Open old workspace without ECM fields
- **WHEN** a workspace saved before ECM support is opened
- **THEN** all screens SHALL load in standard mode (`ecmMode` falsy)
- **AND** no errors SHALL occur

### Requirement: ECM SDD Import
The SDD importer SHALL set `ecmMode: true` and populate `extBgColor1/2/3` from the XML `D022Colour`, `D023Colour`, `D024Colour` elements when `ScreenMode` is `2`. Character codes SHALL include the bank offset in upper bits (already implemented).

#### Scenario: Import SDD ECM file
- **WHEN** an SDD file with `<ScreenMode>2</ScreenMode>` is imported
- **THEN** the resulting screen SHALL have `ecmMode: true`
- **AND** `extBgColor1/2/3` SHALL match the D022/D023/D024 values from the file
