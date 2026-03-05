# Change: Add per-screen palette support

## Why
The image converter's colour matching is palette-dependent — converting with Colodore vs Pepto produces different colour index assignments. Currently the palette is a single global setting and not stored per screen, so switching palettes makes converted screens look wrong. Users need per-screen palette storage and access to all 9 industry-standard C64 palettes.

## What Changes
- `PaletteName` type widened from 4-value union to `string` to accommodate all palette IDs
- `Framebuf` gains optional `paletteId?: string` field (per-screen palette override)
- `palette.ts` replaces hardcoded 4-palette map with dynamic lookup over all 9 palettes in `c64Palettes.ts`
- New selector `getEffectiveColorPalette(state, fbIndex)` checks per-screen first, falls back to global
- Settings modal shows all 9 palettes instead of 4
- Image converter stamps `paletteId` on imported framebufs
- Workspace JSON and auto-save persist `paletteId` per screen
- SDD format extended with optional `<PaletteId>` element per `<Screen>` (backward-compatible — other tools ignore unknown XML elements)
- All rendering components use per-screen palette with global fallback

## Impact
- Affected specs: palette (new capability)
- Affected code:
  - `src/redux/types.ts` — widen PaletteName, add paletteId to Framebuf
  - `src/utils/palette.ts` — dynamic palette lookup
  - `src/redux/editor.ts` — SET_PALETTE_ID action
  - `src/redux/settingsSelectors.ts` — per-screen palette selector
  - `src/redux/settings.ts` — legacy name migration
  - `src/utils/index.ts` — persist paletteId in workspace JSON
  - `src/redux/workspace.ts` — read paletteId from JSON
  - `src/utils/exporters/exportSdd.ts` — write PaletteId element
  - `src/utils/importers/importSdd.ts` — read PaletteId element
  - `src/containers/ImageConverterModal.tsx` — stamp paletteId on import
  - `src/containers/Settings.tsx` — show all 9 palettes
  - `src/containers/Editor.tsx`, `FramebufferTabs.tsx`, `Toolbar.tsx`, `CharSelect.tsx`, `ImportModal.tsx` — use per-screen palette
