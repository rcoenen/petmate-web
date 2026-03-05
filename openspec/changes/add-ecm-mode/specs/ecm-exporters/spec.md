## ADDED Requirements

### Requirement: ECM Pixel Rendering for Export
The `framebufToPixelsIndexed` utility SHALL resolve per-cell background colors in ECM mode using the screen code's upper 2 bits and the Framebuf's ECM color fields. This SHALL automatically produce correct PNG and GIF exports.

#### Scenario: Export PNG with ECM backgrounds
- **WHEN** an ECM screen is exported as PNG
- **THEN** each cell's background color SHALL match its ECM bg selector
- **AND** character shapes SHALL be derived from the lower 6 bits of the screen code

### Requirement: ECM BASIC Export
The BASIC exporter SHALL generate ECM register setup when the source framebuf has `ecmMode: true`: `POKE 53265,PEEK(53265) OR 64` to enable ECM, and `POKE 53282/53283/53284` for the 3 extra background colors.

#### Scenario: BASIC listing with ECM
- **WHEN** an ECM screen is exported as BASIC
- **THEN** the listing SHALL include `POKE 53265,PEEK(53265) OR 64`
- **AND** the listing SHALL include `POKE 53282,<extBgColor1>`
- **AND** screen codes in DATA statements SHALL include the full 0-255 range with ECM bg encoding

### Requirement: ECM ASM Export
The ASM exporter SHALL include ECM VIC-II register initialization when the source framebuf has `ecmMode: true`: set bit 6 of $D011, and write $D022/$D023/$D024.

#### Scenario: ASM with ECM init
- **WHEN** an ECM screen is exported as ASM
- **THEN** the init code SHALL set $D011 bit 6 and write the 3 ECM background color registers

### Requirement: ECM SDD Export
The SDD exporter SHALL write `<ScreenMode>2</ScreenMode>` and populate `D022Colour`, `D023Colour`, `D024Colour` elements when ECM mode is active. Cell tokens SHALL encode the bg selector in the bank field (position 5) as `0`-`3`.

#### Scenario: SDD export round-trip
- **WHEN** an ECM screen is exported as SDD and re-imported
- **THEN** the re-imported screen SHALL have `ecmMode: true` with the same background colors and per-cell bg selections

### Requirement: ECM JSON Export
The JSON exporter SHALL include `ecmMode`, `extBgColor1`, `extBgColor2`, `extBgColor3` fields when the source framebuf is in ECM mode.

#### Scenario: JSON with ECM metadata
- **WHEN** an ECM screen is exported as JSON
- **THEN** the output SHALL contain `"ecmMode": true` and the 3 extra bg color values
