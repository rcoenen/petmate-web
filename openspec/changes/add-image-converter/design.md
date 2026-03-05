## Context

Port the image-to-PETSCII conversion algorithm from `/Users/rob/Dev/c64-image-to-petscii` (vanilla JS, `assets/js/main.js` ~1551 lines) into PetMateOnline as a TypeScript module + React modal.

Source algorithm: 6-stage pipeline — resize → palette map → background search → character+color match → preview render. Uses CIE Lab perceptual color space, saliency weighting, luminance matching, and neighbor repeat penalties for high-quality conversion.

## Goals / Non-Goals

**Goals:**
- Port core conversion algorithm (Lab color, character matching, background search) to TypeScript
- Support Standard (256 chars) and ECM (64 chars, 4 bg colors) modes with side-by-side previews
- Expose tuning parameters (brightness, saturation, detail boost, lum matching, palette, bg override)
- Keep UI responsive during conversion via async chunking
- Import conversion result as a standard PetMateOnline Framebuf

**Non-Goals:**
- BASIC listing generation (not needed in editor context)
- PAL aspect ratio correction (not applicable to web)
- DCT pre-filtering (unused in source algorithm)
- Native ECM mode in editor (ECM imports flatten to standard Framebuf)

## Decisions

### Conversion engine as pure module
- **Decision:** Self-contained TypeScript module (`imageConverter.ts`) with no React/Redux dependencies
- **Why:** Testable in isolation, potentially reusable, clean separation from UI

### Character bitmaps from existing ROM font
- **Decision:** Use PetMateOnline's `getROMFontBits('upper')` to build the 256-char reference array
- **Alternative:** Embed the `petscii_0-255_16x16.png` image from the source project
- **Why:** Avoids an external asset, reuses existing infrastructure, guaranteed correct bit layout

### Async via setTimeout chunking (not Web Worker)
- **Decision:** Background search (16 iterations) yields via `setTimeout(fn, 0)` between candidates
- **Alternative:** Web Worker for full off-thread computation
- **Why:** Matches source app pattern, simpler implementation, character matching itself runs ~200-500ms which is acceptable. Worker can be added later if needed.

### Converter palettes separate from editor palettes
- **Decision:** The converter ships its own palette set (Colodore, Pepto 2004, CCS64 from config.js) rather than reusing PetMateOnline's `colorPalettes`
- **Why:** Converter palettes drive Lab-space color matching; editor palettes drive display rendering. They serve different purposes and have different palette variants. After import, PETSCII renders using whatever editor palette the user has selected.

### Modal width override
- **Decision:** Add optional `width` prop to `Modal.tsx` to allow wider modals
- **Why:** The converter needs ~700px for side-by-side Standard/ECM previews. Other modals keep their 420px default.

### ECM import flattening
- **Decision:** ECM result imports as standard Framebuf with `ecmBgColors[0]` as background
- **Why:** PetMateOnline has no ECM screen mode. The char codes (0-63) and per-cell foreground colors are valid in standard mode. The 4-bg-color benefit is lost but the character art is preserved.

## Key Algorithm Details (from source main.js)

### Color Science
- sRGB → linear RGB (gamma 2.4) → XYZ (D65 illuminant) → CIE Lab
- Brightness/saturation pre-processing in HSV space before palette lookup
- Squared Euclidean distance in Lab = perceptual color difference (ΔE²)

### Character Matching (`findOptimalPetscii`)
Per 8×8 cell, score each (char, fgColor) candidate:
1. Per-pixel Lab error weighted by saliency (edges weighted 1-4× more)
2. Luminance matching penalty (overall brightness preservation)
3. Neighbor repeat penalty (discourage tiling artifacts)
4. Early exit: skip foreground loop if bg-only error already exceeds best

### Background Search (`findOptimalBackground`)
- Standard: test all 16 colors, run full character matching per candidate, pick lowest total error
- ECM: top 4 by frequency after palette mapping, brute-force winner forced to position 0

## Risks / Trade-offs

- **Performance:** Full conversion (16 bg candidates × 1000 cells × 256 chars × 15 fg) takes 3-8 seconds. Async chunking keeps UI responsive but users must wait. Progress bar mitigates perceived slowness.
- **Bundle size:** ~500 lines of conversion code adds ~15KB gzipped. Acceptable.
- **ECM expectations:** Users may expect ECM to look identical in the editor; needs clear labeling that it flattens to standard mode.

## Open Questions
- None — all decisions resolved from source analysis and user requirements.
