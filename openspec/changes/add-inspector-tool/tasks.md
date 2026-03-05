## 1. Foundation
- [x] 1.1 Add `Inspector = 6` to `Tool` enum in `src/redux/types.ts`
- [x] 1.2 Wire toolbar icon onClick to `setSelectedTool(Tool.Inspector)` with selected styling in `src/containers/Toolbar.tsx`

## 2. Canvas Behavior
- [x] 2.1 Add CSS `@keyframes inspectorPulse` animation to `src/components/CharPosOverlay.module.css` — cycles border opacity 0.3→1.0→0.3 over ~1s, cyan border
- [x] 2.2 Show pulsing CharPosOverlay when `Tool.Inspector` is active and mouse is over canvas in `src/containers/Editor.tsx`
- [x] 2.3 Suppress all editing dispatches (draw/colorize/text) in pointer handlers when `selectedTool === Tool.Inspector` in `src/containers/Editor.tsx`
- [x] 2.4 Set `cursor: 'crosshair'` on canvas when Inspector is active

## 3. Sidebar Highlights
- [x] 3.1 Read `framebuf[row][col]` pixel at hover position, pass `inspectedScreencode` and `inspectedColorIndex` props from `Editor.tsx`
- [x] 3.2 Add `inspectedScreencode` prop to `CharSelect.tsx` — render distinct cyan highlight on that character
- [x] 3.3 Add `inspectedColorIndex` prop to `ColorPicker.tsx` — render distinct cyan highlight on that color swatch

## 4. Statusbar
- [x] 4.1 Show `Char: $XX Color: N` in `CanvasStatusbar` when Inspector is active and hovering

## 5. Polish
- [x] 5.1 Add `i` keyboard shortcut to select Inspector tool
