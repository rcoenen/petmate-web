![Petsciishop](docs/img/petsciishop_logo.png)

# Petsciishop

> The best-in-class, fully web-based, open source C64 PETSCII graphics editor. No install needed — runs entirely in your browser.

Petsciishop is our attempt to take the best ideas from across the C64 community, combine them with original research and new features, and package it all into a single accessible tool that anyone can use — no setup, no downloads, just open a URL and create.

### Highlights
- 🖼️ **Best-in-class image-to-PETSCII converter** — original research into perceptual color matching and character optimization
- 🌐 **100% web-based** — nothing to install, no platform restrictions, just open the URL and go
- 🔓 **Open source** — the ultimate PETSCII editor, built for everyone

**Try it now:** [https://rcoenen.github.io/Petsciishop/](https://rcoenen.github.io/Petsciishop/)

## Features

- **Runs in the browser** — no Electron, no server, just open the URL and start creating
- **State-of-the-art image-to-PETSCII converter** — CIE Lab perceptual color matching, saliency-weighted character optimization, multiple C64 palettes. Supports Standard and ECM modes with live previews
- **Inspector tool** — hover over any cell to read its character and color; click to pick it up as your active drawing settings
- **Per-screen palette support** — 9 industry-standard C64 palettes (Colodore, Pepto PAL/NTSC, VICE, and more), assignable per screen
- **ECM (Extended Color Mode)** — full support with 2×2 background grid in the character picker
- **SDD import/export** — full support for the [SDD (Screen Designer Data)](https://www.c64-wiki.com/wiki/Screen_Designer_(CBM_prg_Studio)) file format, ensuring interoperability with the broader C64 toolchain
- **Multi-screen workspace** — work on multiple screens, export individually or together
- **CRT display filters** — scanlines, color TV, and B&W TV effects
- **Drag & drop** — drop `.petmate` files directly into the editor

## Standing on the shoulders of giants

Petsciishop would not exist without the incredible work of the C64 community and those who came before:

- **[Petmate](https://github.com/nurpax/petmate)** by Janne Hellsten — the original foundation this project was built on
- **[PETSCII Editor](https://petscii.krissz.hu/)** by Krissz — a great web-based PETSCII editor that inspired many of our features
- **[Image-to-PETSCII](https://lysebo.xyz/tools/image-to-petscii/)** by lysebo — inspiration for the image converter approach
- **[c64-image-to-petscii](https://github.com/mkeke/c64-image-to-petscii)** by mkeke — the image converter algorithm we built upon
- **[CBM prg Studio](https://www.ajordison.co.uk/)** by Arthur Jordison — creator of the SDD file format we use for interoperability
- **[Colodore](http://www.pepto.de/projects/colorvic/)** palette by Philip "Pepto" Timmermann — the most accurate modern C64 color reference
- The entire **Commodore 64 demoscene and PETSCII art community** — for keeping this art form alive and thriving for over 40 years

## Contributing

Ideas, feedback, and showcase of your work are welcome in [GitHub Discussions](https://github.com/rcoenen/Petsciishop/discussions). Bug reports and PRs go to [Issues](https://github.com/rcoenen/Petsciishop/issues).
