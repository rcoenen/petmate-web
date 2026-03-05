## 1. Types and palette utility
- [ ] 1.1 Widen `PaletteName` from union to `string` in `types.ts`
- [ ] 1.2 Add `paletteId?: string` to `Framebuf` interface in `types.ts`
- [ ] 1.3 Replace hardcoded 4-palette map in `palette.ts` with dynamic lookup over all 9 `C64_PALETTES`
- [ ] 1.4 Add `getColorPaletteById(id)` function to `palette.ts`

## 2. Redux state management
- [ ] 2.1 Add `SET_PALETTE_ID` action and `setPaletteId` creator in `editor.ts`
- [ ] 2.2 Update `fbReducer` default state to include `paletteId: undefined`
- [ ] 2.3 Handle `paletteId` in `IMPORT_FILE` reducer case
- [ ] 2.4 Handle `SET_PALETTE_ID` in reducer
- [ ] 2.5 Add `getEffectiveColorPalette(state, fbIndex)` selector in `settingsSelectors.ts`
- [ ] 2.6 Add `getEffectivePaletteId(state, fbIndex)` selector
- [ ] 2.7 Add `normalizePaletteId()` migration in `settings.ts` (`'pepto'` → `'pepto-pal'`)

## 3. Persistence
- [ ] 3.1 Add `paletteId` to `framebufFields()` in `utils/index.ts`
- [ ] 3.2 Add `paletteId` to `framebufFromJson()` in `workspace.ts`
- [ ] 3.3 Add `<PaletteId>` element to SDD export (inside `<Screen>`, after `<Description>`)
- [ ] 3.4 Read `<PaletteId>` in SDD import (gracefully absent = undefined)

## 4. Image converter
- [ ] 4.1 Pass `settings.paletteId` to `resultToFramebuf()` in `ImageConverterModal.tsx`
- [ ] 4.2 Store `paletteId` on the resulting `Framebuf`

## 5. UI — Settings modal
- [ ] 5.1 Update `ColorPaletteSelector` in `Settings.tsx` to show all 9 `C64_PALETTES`
- [ ] 5.2 Use `getColorPaletteById` for swatch rendering

## 6. UI — Rendering components
- [ ] 6.1 `Editor.tsx` — use `getEffectiveColorPalette` instead of global palette
- [ ] 6.2 `FramebufferTabs.tsx` — resolve per-screen palette for each thumbnail
- [ ] 6.3 `Toolbar.tsx` — use per-screen palette for colour picker
- [ ] 6.4 `CharSelect.tsx` — use per-screen palette
- [ ] 6.5 `ImportModal.tsx` — use per-screen palette
