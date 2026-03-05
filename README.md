# PetMate Online

A browser-based C64 PETSCII editor. No install needed — runs entirely in your browser.

**Try it now:** [https://rcoenen.github.io/petmate-web/](https://rcoenen.github.io/petmate-web/)

## About

PetMate Online is based on [Petmate](https://nurpax.github.io/petmate/) by Janne Hellsten (nurpax), originally an Electron desktop app. This version has been rebuilt as a standalone web application — no Electron, no server, just open the URL and start creating.

## What's New

- **Runs in the browser** — rebuilt on Vite with all file I/O replaced by browser APIs (file pickers, downloads, localStorage)
- **Image-to-PETSCII converter** — File > Convert Image... loads any image and converts it using CIE Lab perceptual color matching, saliency-weighted character optimization, and three C64 palettes (Colodore, Pepto, CCS64). Supports Standard (256 chars) and ECM (64 chars, 4 backgrounds) modes with live side-by-side previews
- **SDD import/export** — full Screen Designer Data file support
- **CRT display filters** — scanlines, color TV, and B&W TV effects
- **Custom HTML dialogs** — native-feeling modals replacing system dialogs
- **Drag & drop** — drop .petmate files directly into the editor

## Credits

Original Petmate by [Janne Hellsten](https://github.com/nurpax/petmate). Image converter algorithm ported from [c64-image-to-petscii](https://github.com/niclas2109/c64-image-to-petscii).
