# Project Context

## Purpose
PetMateOnline is a C64 PETSCII graphics editor. Originally forked from Petmate (an Electron desktop app), the goal is to convert it into a browser-based web application with full feature parity — no server, no Electron.

## Tech Stack
- TypeScript (~9,400 LOC)
- React 16 + ReactDOM (class components, some SFC)
- Redux 4 + redux-thunk + redux-undo (beta)
- react-redux 5
- Canvas API for rendering PETSCII characters
- Build: react-scripts 3.4.1 (Create React App)
- Runtime: Electron 12 (Node integration, remote module)
- c64jasm (6502 assembler for PRG export)
- c1541 (D64 disk image reading)
- gif-encoder (GIF export via Node streams)
- pngjs (PNG import decoding)

## Project Conventions

### Code Style
- TypeScript strict mode with noImplicitAny, strictNullChecks
- CSS Modules for component styling (`*.module.css`)
- Global styles in `src/app.global.css`
- Mix of class components and stateless functional components (SFC)

### Architecture Patterns
- Redux store with thunks for async/side-effect operations
- Framebuffer-based rendering: each screen is a 2D array of `{code, color}` pixels
- Exporters: functions that take framebuf data + options, write to filesystem
- Importers: functions that read files from filesystem, return framebuf data
- Electron IPC bridge: main process menu sends commands to renderer via `ipcRenderer.on('menu', ...)`
- Settings persisted via `fs.writeFileSync` to Electron `userData` path

### Testing Strategy
- No automated tests currently in the project

### Git Workflow
- Single `master` branch
- Conventional commit messages (imperative mood, short description)

## Domain Context
- PETSCII: the character set used by Commodore 64 computers (256 characters, upper and lower case variants)
- Screencode: numeric index (0-255) into the character ROM
- Framebuffer: a width x height grid of `{code: screencode, color: C64 color index}` pixels
- C64 colors: 16-color fixed palette (multiple palette variants supported)
- Workspace: a `.petmate` JSON file containing multiple screens (framebufs) and custom fonts
- Custom fonts: `.64c` files (2-byte header + 2048 bytes of 8x8 character bitmaps)

## Important Constraints
- Must work as a fully static web app (no server-side component)
- All file I/O must use browser APIs (File API, Blob downloads, localStorage)
- Binary assets (charset ROM files, PRG template) loaded via fetch()
- No Node.js APIs (fs, path, Buffer) available in browser

## External Dependencies
- `c64jasm`: 6502 macro assembler — used for PRG export with custom fonts. Uses `Buffer` in its API.
- `c1541`: D64 disk image reader — uses `fs.readFileSync` internally. Node-only.
- `gif-encoder`: GIF encoding via Node streams — Node-only.
- `pngjs`: PNG decode/encode — Node-only. Can be replaced with Canvas API.
