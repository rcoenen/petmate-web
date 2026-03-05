## 1. Conversion Engine
- [ ] 1.1 Create `src/utils/importers/imageConverter.ts`
- [ ] 1.2 Port color science: `sRGBtoLab`, `labDistSq`, `RGBtoHSV`, `HSVtoRGB`
- [ ] 1.3 Port palette data: Colodore, Pepto 2004, CCS64 hex arrays with Lab precomputation
- [ ] 1.4 Port `resizeToCanvas` — scale input image to 320×200 canvas (center, aspect-preserve, black fill)
- [ ] 1.5 Port `getNearestColor` — brightness/saturation adjust in HSV, then nearest palette entry in Lab space
- [ ] 1.6 Port `applyPalette` — map all 64000 pixels to C64 indexed + frequency counts
- [ ] 1.7 Port `computeCellWeights` — per-cell saliency/variance for background search weighting
- [ ] 1.8 Port `findOptimalBackground` — async brute-force all 16 bg colors via setTimeout chunking
- [ ] 1.9 Port `selectEcmBackgrounds` — top 4 frequent colors for ECM mode
- [ ] 1.10 Port `findOptimalPetscii` — core character+color matcher with Lab error, saliency, lum penalty, repeat penalty, early exit
- [ ] 1.11 Implement `buildRefChars` — extract 256 boolean[][] bitmaps from PetMateOnline's ROM font bits
- [ ] 1.12 Implement `renderPreview` — draw 320×200 ImageData from screencodes+colors
- [ ] 1.13 Implement `convertImage` — top-level async orchestrator with progress callbacks
- [ ] 1.14 Export types: `ConverterSettings`, `ConverterPalette`, `ConversionResult`, `FullConversionResult`
- [ ] 1.15 Export presets: `CONVERTER_DEFAULTS`, `TRUE_NEUTRAL`

## 2. Redux State
- [ ] 2.1 Add `showImageConverter: boolean` to toolbar state in `src/redux/toolbar.ts`
- [ ] 2.2 Add `setShowImageConverter` action creator and reducer case
- [ ] 2.3 Add `showImageConverter` to `inModal` keyboard check (Escape closes)

## 3. Menu Integration
- [ ] 3.1 Add `{ label: 'Convert Image...', cmd: 'convert-image' }` to File menu in `src/components/MenuBar.tsx`
- [ ] 3.2 Remove `{ label: 'PNG (.png)', cmd: 'import-png' }` from importers array
- [ ] 3.3 Add `case 'convert-image':` to `src/utils/menuCommands.ts`
- [ ] 3.4 Remove `case 'import-png':` from menuCommands.ts

## 4. Modal Component
- [ ] 4.1 Add optional `width` prop to `src/components/Modal.tsx`
- [ ] 4.2 Create `src/containers/ImageConverterModal.module.css`
- [ ] 4.3 Create `src/containers/ImageConverterModal.tsx`
- [ ] 4.4 File picker (accepts .png, .jpg, .jpeg, .gif, .webp) + drag-drop support
- [ ] 4.5 Settings panel: brightness, saturation, detail boost, lum matching sliders
- [ ] 4.6 Palette dropdown (Colodore / Pepto 2004 / CCS64)
- [ ] 4.7 Background color override (16 swatches, click to force / click again for auto)
- [ ] 4.8 Progress bar with stage + detail text
- [ ] 4.9 Dual Standard/ECM preview canvases (320×200, image-rendering: pixelated)
- [ ] 4.10 "Import Standard" / "Import ECM" buttons → convert result to Framebuf, dispatch importFramebufsAppend, close modal
- [ ] 4.11 ECM label noting it flattens to standard mode on import
- [ ] 4.12 Auto re-convert on settings change (debounced ~300ms)
- [ ] 4.13 Settings persistence to localStorage

## 5. App Wiring
- [ ] 5.1 Import and render `<ImageConverterModal />` in `src/containers/App.tsx`

## 6. Verification
- [ ] 6.1 `npm run build` + `npx tsc --noEmit` both pass
- [ ] 6.2 File > Convert Image... opens modal
- [ ] 6.3 Load a photo — conversion runs with progress, two previews appear
- [ ] 6.4 Adjust sliders — previews update after re-conversion
- [ ] 6.5 Import Standard → Framebuf in editor with correct chars/colors
- [ ] 6.6 Import ECM → Framebuf in editor (flattened)
- [ ] 6.7 Settings persist across page reloads
- [ ] 6.8 Escape closes modal
- [ ] 6.9 PNG import removed from Import submenu
