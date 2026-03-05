## ADDED Requirements

### Requirement: ECM Mode Toggle
The toolbar SHALL include an ECM toggle button that activates or deactivates Extended Color Mode for the current screen. The toggle state SHALL be visually distinct when active.

#### Scenario: Enable ECM mode
- **WHEN** the user clicks the ECM toggle
- **THEN** the current screen's `ecmMode` SHALL become `true`
- **AND** three additional background color pickers SHALL appear in the toolbar

#### Scenario: Disable ECM mode
- **WHEN** the user clicks the ECM toggle while ECM is active
- **THEN** `ecmMode` SHALL become `false`
- **AND** the extra background color pickers SHALL be hidden

### Requirement: ECM Background Color Pickers
When ECM mode is active, the toolbar SHALL display three additional color pickers labeled for bg1 ($D022), bg2 ($D023), and bg3 ($D024). Each picker SHALL allow selecting any of the 16 C64 palette colors.

#### Scenario: Change ECM bg1 color
- **WHEN** the user selects color 3 in the bg1 picker
- **THEN** `extBgColor1` SHALL become `3`
- **AND** affected cells SHALL re-render with the new background

### Requirement: ECM Character Selector
When ECM mode is active, the character selector SHALL display a tabbed view with 4 pages (Bg0, Bg1, Bg2, Bg3). Each page SHALL show the 64 available character shapes rendered with the corresponding background color. Selecting a character on page N SHALL produce screen code `charIndex + N * 64`.

#### Scenario: Select character on bg2 page
- **WHEN** ECM mode is active and the user selects char shape 10 on the Bg2 tab
- **THEN** the active screen code SHALL be `10 + 2*64 = 138`
- **AND** drawing with this code SHALL render with `extBgColor2` as background

#### Scenario: Standard mode character selector unchanged
- **WHEN** ECM mode is not active
- **THEN** the character selector SHALL display the full 16×16 grid of 256 characters as before

### Requirement: ECM Statusbar Indicator
The statusbar SHALL display an "ECM" label when the current screen is in Extended Color Mode.

#### Scenario: ECM indicator shown
- **WHEN** the current screen has `ecmMode: true`
- **THEN** the statusbar SHALL display "ECM"
