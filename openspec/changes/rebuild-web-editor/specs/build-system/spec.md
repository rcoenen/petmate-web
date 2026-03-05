# Build System

## ADDED Requirements

### Requirement: Vite Build Pipeline
The system SHALL use Vite with `@vitejs/plugin-react` as the build tool, replacing react-scripts (CRA).

#### Scenario: Development server
- **WHEN** the developer runs `npm run dev`
- **THEN** Vite starts an HMR dev server and the app loads in the browser

#### Scenario: Production build
- **WHEN** the developer runs `npm run build`
- **THEN** Vite produces an optimized static build in `dist/` with relative base paths (`base: './'`)

#### Scenario: Preview production build
- **WHEN** the developer runs `npm run preview`
- **THEN** Vite serves the production build locally for testing

### Requirement: HTML Entry Point
The system SHALL use a root-level `index.html` (Vite convention) with a `<script type="module">` entry point, replacing CRA's `public/index.html` with `%PUBLIC_URL%` placeholders.

#### Scenario: Index HTML structure
- **WHEN** the app is built
- **THEN** `index.html` at project root contains `<div id="root">`, `<div id="modal-root">`, and a module script tag pointing to `src/index.ts`

### Requirement: TypeScript Configuration
The system SHALL update `tsconfig.json` for Vite compatibility: `"jsx": "react-jsx"`, `"types": ["vite/client"]`.

#### Scenario: Environment variables
- **WHEN** code checks the environment mode
- **THEN** it uses `import.meta.env.MODE` or `import.meta.env.DEV` instead of `process.env.NODE_ENV`

## REMOVED Requirements

### Requirement: Electron Build Infrastructure
**Reason**: No longer a desktop app.
**Migration**: Delete `public/electron.js`, `public/menu.js`. Remove `electron`, `electron-builder`, `electron-devtools-installer`, `react-scripts`, `react-dev-utils`, `concurrently`, `cross-env`, `wait-on` from dependencies. Remove `dist-macos`, `dist-win`, `dist-linux` scripts.
