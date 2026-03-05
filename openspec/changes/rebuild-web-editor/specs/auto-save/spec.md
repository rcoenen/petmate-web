# Auto-Save

## ADDED Requirements

### Requirement: Periodic Auto-Save to localStorage
The system SHALL provide `src/utils/autoSave.ts` that periodically saves the workspace to localStorage.

#### Scenario: Periodic save
- **WHEN** the app is running and has unsaved changes
- **THEN** the workspace state is serialized to JSON and saved to `localStorage` every 60 seconds

#### Scenario: Recovery on startup
- **WHEN** the app starts and auto-save data exists in localStorage
- **THEN** the user is offered a prompt to restore the previous session

#### Scenario: Quota error handling
- **WHEN** localStorage is full
- **THEN** the auto-save fails silently (logged to console) without crashing the app

#### Scenario: Clear on explicit save
- **WHEN** the user explicitly saves/downloads the workspace
- **THEN** the auto-save recovery data is cleared
