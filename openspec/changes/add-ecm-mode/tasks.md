## 1. Foundation (Types & Redux)
- [ ] **1.1** Add `ecmMode?`, `extBgColor1?`, `extBgColor2?`, `extBgColor3?` to `Framebuf` interface in `src/redux/types.ts`
- [ ] **1.2** Create `src/utils/ecm.ts` with helpers: `ecmCharIndex`, `ecmBgSelector`, `ecmScreencode`, `ecmCellBgColor`, `ecmBgColorArray`
- [ ] **1.3** Add `SET_ECM_MODE` and `SET_EXT_BG_COLOR` actions to `src/redux/editor.ts` with reducer cases
- [ ] **1.4** Update default framebuf state and `IMPORT_FILE` reducer case to include ECM fields

## 2. Rendering
- [ ] **2.1** Add `getImageWithBg(screencode, fgColor, bgColor, palette)` method to `CharsetCache` in `src/components/CharGrid.tsx`
- [ ] **2.2** Add ECM props (`ecmMode`, `extBgColor1/2/3`, `backgroundColorIndex`, `colorPalette`) to `CharGrid` component
- [ ] **2.3** Update `CharGrid.draw()` loop: when `ecmMode`, resolve per-cell bg and use `getImageWithBg()`
- [ ] **2.4** Thread ECM props from framebuf state through `Editor.tsx` → `CharGrid`
- [ ] **2.5** Forward ECM props to `BrushOverlay`'s `CharGrid` instance
- [ ] **2.6** Verify: toggle ECM on a screen → cells render with per-cell backgrounds

## 3. Workspace Persistence
- [ ] **3.1** Update `framebufFields()` in `src/utils/index.ts` to include ECM fields when `ecmMode` is true
- [ ] **3.2** Update `framebufFromJson()` in `src/redux/workspace.ts` to read ECM fields with `?? undefined` defaults
- [ ] **3.3** Verify: save workspace with ECM screen → reopen → ECM state preserved

## 4. Toolbar UI
- [ ] **4.1** Add ECM toggle button to `src/containers/Toolbar.tsx`, wired to `setEcmMode`
- [ ] **4.2** Add 3 `FbColorPicker` instances for extBg1/2/3 (visible when `ecmMode` is true)
- [ ] **4.3** Wire `ecmMode`, `extBgColor1/2/3` from framebuf state to `Toolbar` props
- [ ] **4.4** Add ECM indicator to `src/components/Statusbar.tsx`
- [ ] **4.5** Verify: toggle ECM → pickers appear, select colors → rendering updates

## 5. Character Selector
- [ ] **5.1** Update `CharSelect` to show 8×8 grid with 4 page tabs when `ecmMode` is true
- [ ] **5.2** Each page shows 64 chars with corresponding bg color; clicking yields `charIndex + page*64`
- [ ] **5.3** Wire `ecmMode` and bg colors from framebuf state to `CharSelect` props
- [ ] **5.4** Verify: select char on Bg2 page → draw on canvas → cell has correct bg

## 6. Image Converter Import
- [ ] **6.1** Update `resultToFramebuf()` in `src/containers/ImageConverterModal.tsx` to encode `bgIndices` into screen code upper bits when mode is `ecm`
- [ ] **6.2** Set `ecmMode: true` and `extBgColor1/2/3` from `ecmBgColors[1..3]` on ECM import
- [ ] **6.3** Remove "flattened to standard mode" disclaimer from modal
- [ ] **6.4** Verify: convert image → Import ECM → screen shows per-cell backgrounds

## 7. SDD Import
- [ ] **7.1** Read `D022Colour`, `D023Colour`, `D024Colour` from XML in `src/utils/importers/importSdd.ts`
- [ ] **7.2** Pass `ecmMode: true` and bg colors to `framebufFromJson` when `ScreenMode` is `2`
- [ ] **7.3** Verify: import ECM SDD file → screen loads with correct mode and colors

## 8. Exporters
- [ ] **8.1** Update `framebufToPixelsIndexed()` in `src/utils/exporters/util.ts` for ECM per-cell bg (fixes PNG + GIF)
- [ ] **8.2** Update BASIC exporter (`src/utils/exporters/basic.ts`) with ECM register POKEs
- [ ] **8.3** Update ASM exporter (`src/utils/exporters/asm.ts`) with ECM register init
- [ ] **8.4** Update SDD exporter (`src/utils/exporters/exportSdd.ts`): ScreenMode=2, D022-D024, bank field
- [ ] **8.5** Update JSON exporter (`src/utils/exporters/json.ts`) with ECM metadata fields
- [ ] **8.6** Verify: export ECM screen in each format → output contains correct ECM data
