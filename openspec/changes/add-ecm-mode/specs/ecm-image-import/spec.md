## ADDED Requirements

### Requirement: ECM Image Converter Import
When the user imports an ECM result from the image converter, the system SHALL preserve all ECM data: per-cell background indices encoded in screen code upper bits, and the 4 background colors set on the Framebuf.

#### Scenario: Import ECM conversion result
- **WHEN** the user clicks "Import ECM" in the image converter modal
- **THEN** a new screen SHALL be created with `ecmMode: true`
- **AND** `backgroundColor` SHALL be set to `ecmBgColors[0]`
- **AND** `extBgColor1/2/3` SHALL be set to `ecmBgColors[1..3]`
- **AND** each cell's screen code SHALL encode `(bgIndices[cell] << 6) | screencodes[cell]`

#### Scenario: Standard import unchanged
- **WHEN** the user clicks "Import Standard" in the image converter modal
- **THEN** the screen SHALL be created in standard mode with no ECM fields
