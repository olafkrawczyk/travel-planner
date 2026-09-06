## MODIFIED Requirements

### Requirement: Local trip storage
The system SHALL persist trips in IndexedDB behind a repository interface, so a future remote implementation can replace the local one without changes to UI or solver. Every stored record SHALL carry a schema version to support migrations. The UI SHALL surface save status (saving / saved with time) after any change is persisted, including changes that also trigger a worker re-solve.

#### Scenario: Trip survives reload
- **WHEN** the user creates a trip, adds places, and reloads the page
- **THEN** the trip and all its places, days and settings are restored from IndexedDB

#### Scenario: Repository abstraction
- **WHEN** any part of the app loads or saves a trip
- **THEN** it does so only through the repository interface, never by accessing storage directly

#### Scenario: Save status visible
- **WHEN** the user edits a place (or a worker-driven change persists the trip)
- **THEN** a "Saving…" then "Saved HH:MM" indicator appears in the UI
