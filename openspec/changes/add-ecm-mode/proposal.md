# Change: Add ECM (Extended Color Mode) Support

## Why
Petsciishop currently only supports C64 Standard Character Mode (1 global background color, 256 characters). The C64's Extended Color Mode (ECM) allows 4 background colors per screen with per-cell background selection, at the cost of limiting the charset to 64 characters. The image converter already generates ECM output internally but discards it on import. Adding full ECM support enables richer PETSCII artwork and accurate C64 hardware representation.

## What Changes
- Add per-screen `ecmMode` toggle with 3 extra background color fields (`extBgColor1/2/3`) to the `Framebuf` type
- ECM-aware rendering: per-cell background color derived from upper 2 bits of the character code (matching real VIC-II hardware behavior)
- Toolbar UI: ECM toggle button and 3 additional background color pickers (visible in ECM mode)
- Character selector: 4-page tabbed view (64 chars per page) in ECM mode, one page per background
- Image converter: preserve ECM data on import instead of flattening to standard mode
- All exporters updated: BASIC, ASM, SDD, JSON, PNG, GIF produce correct ECM output
- Workspace save/load: persist and restore ECM fields
- SDD import: complete existing partial ECM support with background color reading

## Impact
- Affected specs: none (no existing specs)
- Affected code:
  - `src/redux/types.ts` — Framebuf interface extension
  - `src/redux/editor.ts` — new actions and reducer cases
  - `src/components/CharGrid.tsx` — ECM-aware rendering
  - `src/containers/Editor.tsx` — prop threading
  - `src/containers/Toolbar.tsx` — ECM toggle + color pickers
  - `src/containers/CharSelect.tsx` — 4-page charmap
  - `src/containers/ImageConverterModal.tsx` — ECM import fix
  - `src/utils/exporters/*` — all exporters
  - `src/utils/importers/importSdd.ts` — ECM bg color reading
  - `src/utils/index.ts` — workspace serialization
  - `src/redux/workspace.ts` — workspace deserialization
  - New file: `src/utils/ecm.ts` — helper functions
