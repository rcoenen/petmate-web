# Change: Add Inspector Tool

## Why
Users need a way to identify which character and color is used at any position on the canvas without accidentally modifying it. Currently the only way to find out is to select the draw tool and click (which overwrites the cell). An Inspector tool provides a read-only hover mode that highlights the character in CharSelect and color in ColorPicker, giving instant visual feedback.

## What Changes
- Add `Tool.Inspector` to the tool enum
- Wire existing toolbar icon (crosshair SVG, already placed 3rd from top) to tool selection
- CSS pulse animation on CharPosOverlay when Inspector is active
- Suppress all editing in pointer handlers when Inspector is selected
- Pass hovered cell's screencode/color to CharSelect and ColorPicker as inspection highlights
- Show character code and color index in the statusbar
- Add `i` keyboard shortcut
- Crosshair cursor style on canvas

## Impact
- Affected code:
  - `src/redux/types.ts` — Tool enum
  - `src/containers/Toolbar.tsx` — icon wiring
  - `src/components/CharPosOverlay.tsx` — pulse animation
  - `src/containers/Editor.tsx` — suppress editing, pass inspection data
  - `src/containers/CharSelect.tsx` — inspected highlight
  - `src/components/ColorPicker.tsx` — inspected highlight
  - `src/components/Statusbar.tsx` — char/color info display
