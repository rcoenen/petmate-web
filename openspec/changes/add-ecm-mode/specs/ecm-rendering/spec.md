## ADDED Requirements

### Requirement: Per-Cell Background Rendering
When a screen is in ECM mode, the `CharGrid` component SHALL render each cell with its own background color determined by the upper 2 bits of the cell's screen code. Bits 7-6 = 00 uses `backgroundColor`, 01 uses `extBgColor1`, 10 uses `extBgColor2`, 11 uses `extBgColor3`.

#### Scenario: Cell with bg selector 0
- **WHEN** a cell has screen code 10 (binary 00001010) and ECM mode is active
- **THEN** the cell SHALL render char shape 10 with the primary background color ($D021)

#### Scenario: Cell with bg selector 2
- **WHEN** a cell has screen code 140 (binary 10001100) and ECM mode is active
- **THEN** the cell SHALL render char shape 12 with `extBgColor2` ($D023)

### Requirement: ECM Character Shape Indexing
In ECM mode, the `CharsetCache` SHALL use only the lower 6 bits of the screen code (bits 5-0) to look up the character bitmap, yielding 64 unique shapes regardless of the bg selector in bits 7-6.

#### Scenario: Same shape for different bg selectors
- **WHEN** cells have screen codes 5, 69, 133, and 197
- **THEN** all four cells SHALL render the same character shape (index 5) but with different background colors

### Requirement: Standard Mode Rendering Unchanged
When `ecmMode` is falsy, rendering SHALL behave identically to the current implementation: single canvas background color, full 256-character set, no per-cell background logic.

#### Scenario: No ECM rendering in standard mode
- **WHEN** `ecmMode` is `false` or `undefined`
- **THEN** all cells SHALL use the global `backgroundColor` and full screen code (0-255) as char index
