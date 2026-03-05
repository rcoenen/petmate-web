## ADDED Requirements

### Requirement: Image Conversion Engine
The system SHALL convert arbitrary raster images (PNG, JPEG, GIF, WebP) to PETSCII art using perceptual color matching in CIE Lab color space.

The conversion SHALL support two modes:
- **Standard** — 256 PETSCII characters, 1 background color, 15 foreground colors
- **ECM** — 64 characters (0-63), 4 background colors, 15 foreground colors

The engine SHALL optimize character+color selection per 8×8 cell by minimizing a composite score of:
- Per-pixel Lab color error weighted by saliency (edge/contrast emphasis)
- Luminance matching penalty (preserve overall brightness structure)
- Neighbor repeat penalty (reduce tiling artifacts)

#### Scenario: Standard mode conversion
- **WHEN** a user loads a photograph and selects Standard mode
- **THEN** the system converts it to a 40×25 grid of screencodes (0-255) and foreground colors (0-15) with a single auto-detected or user-forced background color

#### Scenario: ECM mode conversion
- **WHEN** a user loads a photograph and selects ECM mode
- **THEN** the system converts it to a 40×25 grid of screencodes (0-63) with per-cell background selection from 4 auto-detected background colors

#### Scenario: Async background search
- **WHEN** background color is set to auto-detect
- **THEN** the system tests all 16 C64 colors as background candidates asynchronously and selects the one producing lowest total perceptual error

### Requirement: Conversion Settings
The system SHALL expose the following tunable parameters:
- **Brightness** (0.5–2.0, default 1.1) — scales pixel RGB before palette mapping
- **Saturation** (0.5–3.0, default 1.4) — scales color saturation in HSV space
- **Detail Boost** (0–10, default 3.0) — saliency weighting alpha for edge emphasis
- **Luminance Matching** (0–50, default 12) — penalty weight for brightness accuracy
- **Palette** — selectable from Colodore, Pepto 2004, CCS64
- **Background Color Override** — force a specific C64 color (0-15) or leave as auto

Settings SHALL persist in localStorage across sessions.

#### Scenario: Adjusting brightness
- **WHEN** the user changes the brightness slider to 1.5
- **THEN** the conversion re-runs with the new brightness factor and previews update

#### Scenario: Forcing background color
- **WHEN** the user clicks the blue (6) color swatch in the background override
- **THEN** background search is skipped and blue is used as the background color for Standard mode

#### Scenario: Settings persistence
- **WHEN** the user changes settings and reloads the page
- **THEN** the previously saved settings are restored

### Requirement: Convert Image Modal
The system SHALL provide a "Convert Image..." modal accessible from the File menu.

The modal SHALL display:
- A file picker accepting PNG, JPEG, GIF, WebP images
- Settings controls (sliders, dropdowns, color swatches)
- A progress indicator during conversion
- Side-by-side Standard and ECM preview canvases (320×200 pixels)
- "Import Standard" and "Import ECM" buttons

#### Scenario: Opening the modal
- **WHEN** the user clicks File > Convert Image...
- **THEN** a modal opens with file picker and settings controls

#### Scenario: Loading an image
- **WHEN** the user selects an image file
- **THEN** the conversion runs automatically and dual previews appear

#### Scenario: Importing Standard result
- **WHEN** the user clicks "Import Standard"
- **THEN** the Standard conversion result is added to the workspace as a new screen (40×25 Framebuf with screencodes, colors, and background color)

#### Scenario: Importing ECM result
- **WHEN** the user clicks "Import ECM"
- **THEN** the ECM result is imported as a standard Framebuf using `ecmBgColors[0]` as background color, with a note that ECM multi-background is flattened

#### Scenario: Closing the modal
- **WHEN** the user presses Escape or clicks Close
- **THEN** the modal closes without importing

### Requirement: Menu Integration
The File menu SHALL include a "Convert Image..." item between "Save As..." and "Import".

The "PNG (.png)" entry SHALL be removed from the Import submenu.

#### Scenario: Menu structure
- **WHEN** the user opens the File menu
- **THEN** "Convert Image..." appears as a menu item and "PNG (.png)" does not appear in the Import submenu
