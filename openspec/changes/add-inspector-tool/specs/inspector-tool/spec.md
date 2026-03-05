## ADDED Requirements

### Requirement: Inspector Tool Selection
The toolbar SHALL include an Inspector tool icon (crosshair/target SVG) that activates Inspector mode when clicked. The icon SHALL appear visually selected when active. The user SHALL also be able to activate Inspector mode by pressing the `i` key.

### Requirement: Inspector Cursor Overlay
When Inspector mode is active and the mouse is over the canvas, a pulsing cyan outline SHALL appear around the character cell under the cursor. The canvas cursor SHALL be `crosshair`.

### Requirement: Inspector Read-Only Behavior
When Inspector mode is active, mouse interactions (click, drag) on the canvas SHALL NOT modify the framebuffer.

### Requirement: Inspector CharSelect Highlight
When Inspector mode is active and the mouse hovers over a canvas cell, the CharSelect component SHALL highlight the character at that cell's screencode with a cyan border, visually distinct from the normal selection indicator.

### Requirement: Inspector ColorPicker Highlight
When Inspector mode is active and the mouse hovers over a canvas cell, the ColorPicker component SHALL highlight the color swatch matching that cell's color index with a cyan border, visually distinct from the normal selected color indicator.

### Requirement: Inspector Statusbar Information
When Inspector mode is active and the mouse hovers over a canvas cell, the statusbar SHALL display the cell's screencode (hex) and color index.
