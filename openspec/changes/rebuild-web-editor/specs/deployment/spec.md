# Deployment

## ADDED Requirements

### Requirement: Static Deployment
The system SHALL produce a fully static `dist/` directory deployable to any web host (GitHub Pages, Netlify, Vercel, etc.).

#### Scenario: Build output
- **WHEN** `npm run build` completes
- **THEN** `dist/` contains `index.html`, bundled JS/CSS, and `assets/` directory with binary files

#### Scenario: Relative paths
- **WHEN** the build is deployed to a subdirectory
- **THEN** all asset references use relative paths (`base: './'` in Vite config)

#### Scenario: No server required
- **WHEN** the `dist/` directory is served by any static file server
- **THEN** the app loads and functions correctly with no server-side logic
