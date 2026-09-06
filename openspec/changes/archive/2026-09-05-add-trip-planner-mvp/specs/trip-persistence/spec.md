# Capability: trip-persistence

## Purpose

Keeps trips durable and portable in a local-only app: structured browser storage with versioned schemas, JSON export/import, and undo/redo for all edits.

## ADDED Requirements

### Requirement: Local trip storage
The system SHALL persist trips in IndexedDB behind a repository interface, so a future remote implementation can replace the local one without changes to UI or solver. Every stored record SHALL carry a schema version to support migrations.

#### Scenario: Trip survives reload
- **WHEN** the user creates a trip, adds places, and reloads the page
- **THEN** the trip and all its places, days and settings are restored from IndexedDB

#### Scenario: Repository abstraction
- **WHEN** any part of the app loads or saves a trip
- **THEN** it does so only through the repository interface, never by accessing storage directly

### Requirement: JSON export and import
The system SHALL allow exporting a trip as a JSON file and importing a trip from JSON, validating against the versioned schema and rejecting invalid files with a clear error.

#### Scenario: Round-trip export/import
- **WHEN** the user exports a trip and imports the resulting file
- **THEN** an equivalent trip (same places, days, overrides and settings) exists in storage

#### Scenario: Invalid import rejected
- **WHEN** the user imports a file that fails schema validation
- **THEN** the import is rejected with an error message and existing data is unchanged

### Requirement: Undo/redo
The system SHALL support undo and redo across all trip edits (places, days, settings, overrides, manual tweaks) using immutable snapshots.

#### Scenario: Undo an edit
- **WHEN** the user deletes a place and then undoes
- **THEN** the place is restored exactly, including its dwell, priority and appointments, and the itinerary re-solves
