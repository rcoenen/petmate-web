# Changelog

## 1.0.0 (2026-03)

First release of PetMate Online — a browser-based C64 PETSCII editor rebuilt from [Petmate](https://github.com/nurpax/petmate) by Janne Hellsten.

### Platform

- Rebuilt as a browser web app (no Electron, no server)
- Vite build system replacing react-scripts
- React 18 with modern hooks
- All file I/O via browser APIs (file pickers, downloads, drag & drop)
- Settings stored in localStorage
- Auto-deployed to GitHub Pages

### Editor

- Full PETSCII character set (upper + lower) with drawing tools
- Draw, colorize, character draw, brush, text, and pan/zoom tools
- Multi-screen workspaces with tabbed navigation
- Undo/redo history per screen
- Custom font (.64c) support
- Canvas grid overlay
- CRT display filters (scanlines, color TV, B&W TV)
- Custom HTML dialogs replacing system dialogs

### Import

- PetMate workspace (.petmate)
- D64 disk image (.d64)
- PETSCII (.c / Marq's PETSCII Editor)
- Screen Designer (.sdd)
- SEQ (.seq)

### Export

- Assembler source (.asm)
- BASIC listing (.bas)
- Executable (.prg)
- GIF animation (.gif)
- JSON (.json)
- PETSCII (.c)
- PNG (.png)
- SEQ (.seq)
- PET (.pet)
- Screen Designer (.sdd)

## 1.1.0 (2026-03)

### Added

- **Image-to-PETSCII converter** (File > Convert Image...)
  - Load any image (PNG, JPG, GIF, WebP) and convert to PETSCII
  - CIE Lab perceptual color matching for accurate palette mapping
  - Saliency-weighted character optimization (detail boost)
  - Luminance matching penalty for better tonal accuracy
  - Automatic or manual background color selection (brute-force 16 candidates)
  - Standard mode (256 chars) and ECM mode (64 chars, 4 backgrounds)
  - Live side-by-side previews
  - Three C64 palettes: Colodore (2017), Pepto (2004), CCS64
  - Presets: Rob's Favorite, True Neutral
  - Settings persisted across sessions
  - Drag & drop image support
  - Import result directly into editor as new screen
- Screen name used as export filename
