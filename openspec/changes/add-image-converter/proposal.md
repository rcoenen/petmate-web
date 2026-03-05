# Change: Add Image-to-PETSCII Converter

## Why
PetMateOnline's current PNG import only works with pixel-perfect PETSCII screenshots (exact 8×8 block matching, RGB Euclidean distance). Users want to convert arbitrary photos and artwork into PETSCII art with high quality results. The standalone converter at `c64-image-to-petscii` already solves this with a sophisticated perceptual algorithm — we port its core engine into PetMateOnline and expose it via a "Convert Image..." modal.

## What Changes
- **Add** conversion engine: CIE Lab color science, saliency-weighted character+color co-optimization, async background search, Standard (256 chars) and ECM (64 chars, 4 bg colors) modes
- **Add** "Convert Image..." modal with file picker, tuning sliders (brightness, saturation, detail boost, luminance matching), palette selector, background color override, dual Standard/ECM previews, and import buttons
- **Add** "Convert Image..." menu item under File menu
- **Remove** "PNG (.png)" from Import submenu (superseded by the converter)
- **Modify** Modal component to accept optional width override

## Impact
- Affected specs: new `image-converter` capability
- Affected code:
  - `src/utils/importers/imageConverter.ts` (new — conversion engine)
  - `src/containers/ImageConverterModal.tsx` (new — modal UI)
  - `src/containers/ImageConverterModal.module.css` (new — modal styles)
  - `src/components/Modal.tsx` (add optional `width` prop)
  - `src/redux/toolbar.ts` (add `showImageConverter` state/action)
  - `src/components/MenuBar.tsx` (add menu item, remove PNG import)
  - `src/utils/menuCommands.ts` (add command, remove `import-png`)
  - `src/containers/App.tsx` (render new modal)
