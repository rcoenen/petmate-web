# Petsciishop

A web-based C64 PETSCII graphics editor. No install needed — runs entirely in your browser.

**Try it now:** [https://rcoenen.github.io/Petsciishop/](https://rcoenen.github.io/Petsciishop/)

## About

Petsciishop is a C64 PETSCII graphics editor that runs entirely in your browser — no Electron, no server, just open the URL and start creating.

## Features

- **Runs in the browser** — built on Vite with all file I/O using browser APIs (file pickers, downloads, localStorage)
- **[Image-to-PETSCII converter](docs/image-converter.md)** — File > Convert Image... loads any image and converts it using CIE Lab perceptual color matching, saliency-weighted character optimization, and three C64 palettes (Colodore, Pepto, CCS64). Supports Standard (256 chars) and ECM (64 chars, 4 backgrounds) modes with live side-by-side previews
- **SDD import/export** — full Screen Designer Data file support
- **CRT display filters** — scanlines, color TV, and B&W TV effects
- **Custom HTML dialogs** — native-feeling modals replacing system dialogs
- **Drag & drop** — drop .petmate files directly into the editor

## Credits

Originally inspired by [Petmate](https://github.com/nurpax/petmate) by Janne Hellsten. Image converter algorithm ported from [c64-image-to-petscii](https://github.com/niclas2109/c64-image-to-petscii).
