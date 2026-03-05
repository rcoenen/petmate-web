## Context

The C64 VIC-II chip supports Extended Color Mode (ECM), enabled by setting bit 6 of register $D011. In ECM:
- The upper 2 bits of each screen code byte select one of 4 background colors ($D021-$D024)
- The lower 6 bits index into only the first 64 character shapes from ROM
- Each cell still has exactly one foreground color from color RAM

This hardware behavior means the existing `Pixel.code` field (0-255) **already encodes ECM background selection** — no separate per-cell background array is needed. A code of 130 means "character shape 2, background color 2."

## Goals / Non-Goals

**Goals:**
- Full ECM editing: toggle mode, pick 4 backgrounds, draw with per-cell bg selection
- Correct rendering matching real C64 hardware
- Round-trip persistence (workspace save/load, SDD import/export)
- All export formats produce valid ECM output
- Image converter ECM import preserves bg data

**Non-Goals:**
- Multicolor mode (separate feature, different constraints)
- Mixed standard/ECM within a single screen (not possible on real C64)
- Custom character editing in ECM mode (future enhancement)

## Decisions

### 1. No separate per-cell background array
**Decision:** Encode ECM bg selection in upper 2 bits of `Pixel.code`, matching C64 hardware.
**Alternatives:** Separate `bgIndex` field on Pixel, or parallel `bgIndices[]` array.
**Rationale:** The reference editor (c64-petscii-editor) uses this approach successfully. It avoids type changes to Pixel, keeps memory layout simple, and ensures exported screen codes are directly valid for the C64.

### 2. Optional fields on Framebuf (not a union type)
**Decision:** Add `ecmMode?: boolean` and `extBgColor1/2/3?: number` as optional fields on the existing `Framebuf` interface.
**Alternatives:** Create separate `StandardFramebuf | EcmFramebuf` union type.
**Rationale:** Optional fields preserve backward compatibility — all existing code ignoring ECM continues to work. No discriminated union refactoring needed across dozens of consumers.

### 3. ECM rendering via per-cell ImageData composition
**Decision:** In ECM mode, `CharsetCache.getImageWithBg()` clones the pre-rendered character ImageData and fills transparent (background) pixels with the resolved bg color.
**Alternatives:** Pre-cache all 64×16×4 = 4096 ECM variants; use CSS per-cell background.
**Rationale:** 4096 pre-cached entries is feasible and may be added as optimization. CSS per-cell bg would require DOM elements per cell, breaking the canvas approach. The clone approach is correct-first and simple.

### 4. CharSelect: 4-page tabbed view in ECM mode
**Decision:** When ECM is active, the 16×16 charmap becomes an 8×8 grid with 4 tabs (Bg0-Bg3). Each page shows the same 64 char shapes with different background colors. Clicking char N on page P yields screencode `N + P*64`.
**Alternatives:** Show all 256 codes in a flat grid; show 64 chars with a separate bg selector.
**Rationale:** The tabbed approach matches the reference editor's UX and makes the bg-per-char relationship visually obvious.

### 5. No workspace version bump
**Decision:** Keep WORKSPACE_VERSION at 2. ECM fields are optional in the JSON.
**Rationale:** Old workspaces load with `ecmMode: undefined` (standard). New workspaces opened by old versions just ignore unknown fields — screencodes are still valid 0-255.

## Risks / Trade-offs

- **Performance:** ECM rendering creates per-cell ImageData clones instead of using cached images. Mitigation: 40×25 = 1000 clones per frame is fast; add LRU cache if profiling shows issues.
- **Copy/paste between modes:** Pasting ECM cells (code > 63) into standard mode shows wrong chars. Acceptable — no data loss, user can undo.
- **Undo:** ECM toggle is undoable via redux-undo. This is correct behavior.

## Open Questions
- None — design is validated against reference editor and C64 hardware docs.
