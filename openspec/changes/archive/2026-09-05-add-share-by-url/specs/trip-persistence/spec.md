## MODIFIED Requirements

### Requirement: JSON export and import
The system SHALL allow exporting a trip as a JSON file and importing a trip from JSON, validating against the versioned schema and rejecting invalid files with a clear error. The system SHALL additionally allow sharing a trip as a URL carrying the compressed JSON in the fragment (`#trip=...`): generating such a link SHALL copy it to the clipboard; opening such a link SHALL decode, validate, and import the trip locally (fresh id), strip the fragment from the address bar, and confirm with a toast. If the compressed payload exceeds a safe fragment length, the system SHALL fall back to offering the JSON file export instead, with an explanation. Malformed or invalid fragments SHALL be rejected with a clear error and MUST NOT affect existing data.

#### Scenario: Round-trip export/import
- **WHEN** the user exports a trip and imports the resulting file
- **THEN** an equivalent trip (same places, days, overrides and settings) exists in storage

#### Scenario: Invalid import rejected
- **WHEN** the user imports a file that fails schema validation
- **THEN** the import is rejected with an error message and existing data is unchanged

#### Scenario: Share link round-trip
- **WHEN** the user clicks "Share" on a trip and the copied link is opened in a fresh browser
- **THEN** the trip is decoded, validated, imported under a fresh id, and a toast confirms the import

#### Scenario: Oversize link falls back
- **WHEN** a trip's compressed payload exceeds the safe fragment length
- **THEN** the user is offered the JSON file download instead, with an explanation

#### Scenario: Malformed fragment rejected
- **WHEN** the app opens with a corrupt `#trip=` fragment
- **THEN** an error toast is shown and no data changes
