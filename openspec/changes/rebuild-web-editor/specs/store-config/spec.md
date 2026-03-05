# Store Configuration

## MODIFIED Requirements

### Requirement: Unified Store Configuration
The system SHALL merge `configureStore.js`, `configureStore.dev.js`, `configureStore.prod.js` into a single `configureStore.ts`.

#### Scenario: Dev mode
- **WHEN** `import.meta.env.DEV` is true
- **THEN** redux-logger middleware is included and Redux DevTools extension is connected

#### Scenario: Prod mode
- **WHEN** `import.meta.env.DEV` is false
- **THEN** only thunk middleware is applied, no logger
