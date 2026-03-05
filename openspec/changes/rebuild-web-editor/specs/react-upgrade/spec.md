# React Upgrade

## MODIFIED Requirements

### Requirement: React 18 Runtime
The system SHALL use React 18, ReactDOM 18, react-redux 8+, and redux-undo ^1.1.0 (stable).

#### Scenario: Entry point rendering
- **WHEN** the app initializes
- **THEN** it uses `createRoot(document.getElementById('root')!).render(...)` instead of `ReactDOM.render()`

#### Scenario: Component type aliases
- **WHEN** components use `StatelessComponent` or `SFC` type aliases
- **THEN** they are replaced with `React.FC`

#### Scenario: Type packages
- **WHEN** the project is built
- **THEN** `@types/react` and `@types/react-dom` are version 18+
