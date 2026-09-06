## MODIFIED Requirements

### Requirement: Place management
The system SHALL allow adding places by geocoding search or map click, and editing each place's name, category (including `hotel`), dwell time in minutes, priority tier (must / want / nice-to-have), optional notes, and opening hours. Opening hours SHALL be entered primarily as a weekly-recurring pattern (per weekday: closed, or one or more open windows) which the system expands onto every date the trip covers, including any date not present when the pattern was set. A specific date MAY be overridden individually (a holiday closure, a one-off late opening); a date override SHALL take precedence over the weekly pattern for that date. Every place's opening-hours state SHALL be legible as exactly one of three states: **unknown** (nothing set), **always open** (the user has explicitly confirmed no restriction), or **has hours** (a weekly pattern and/or date overrides are set) — closed and unknown SHALL be visually and semantically distinct, never collapsed into the same undefined value. Any place SHALL be markable as a hotel via a "This is a hotel" toggle; hotel places are candidates in the stays editor and do not show opening-hours controls. For places with an OSM id, the system SHALL offer to fetch and derive a weekly pattern (plus exceptions) from the OSM `opening_hours` tag as a **reviewable proposal**: the derived pattern and what it would change are shown before anything is written, and the user explicitly applies or discards it — fetching SHALL NOT silently overwrite existing hand-entered hours. The editor SHALL show a note that opening hours are treated as local to the trip's timezone, visible at the point the user enters or reviews hours. Geocoding searches SHALL be debounced and results cached, and the map SHALL display required OSM attribution.

#### Scenario: Add a place via search
- **WHEN** the user searches for "Senso-ji" and selects a result
- **THEN** a place is created with name, coordinates, and default dwell time and priority, editable afterwards

#### Scenario: Add a place via map click
- **WHEN** the user clicks on the map and confirms
- **THEN** a place is created at the clicked coordinates

#### Scenario: Set opening windows
- **WHEN** the user sets a museum's weekly pattern to open 09:00–17:00 Tuesday through Sunday and closed Monday
- **THEN** subsequent solves only schedule that museum inside 09:00–17:00 on Tuesday–Sunday trip dates, and it is never scheduled on a Monday trip date

#### Scenario: Weekly pattern covers a date added after it was set
- **WHEN** a weekly pattern is set on a place and the trip's date range later grows to include a new date
- **THEN** the new date is covered by the weekly pattern according to its weekday, with no separate action required to extend coverage to it

#### Scenario: Date override beats the weekly pattern
- **WHEN** a place has a weekly pattern open every day 09:00–17:00, and the user sets a one-off exception closing it on a specific date (a holiday)
- **THEN** that date is closed regardless of the weekly pattern, and every other date still follows the weekly pattern

#### Scenario: Closed is distinct from unknown
- **WHEN** the user marks a place closed on a given weekday (or closed on a specific overridden date)
- **THEN** the editor shows that day/date as explicitly closed, distinct from a place whose hours are simply not set, and the solver never schedules a visit there on that day/date
- **AND WHEN** the user has entered nothing for a place
- **THEN** the editor shows its hours as unknown, not as "always open"

#### Scenario: User confirms always open
- **WHEN** the user explicitly marks a place as always open (no restriction)
- **THEN** the editor shows "always open" distinctly from "unknown," and the solver may schedule the place at any hour

#### Scenario: Prefill from OSM
- **WHEN** the user clicks "Fetch opening hours from OSM" on a place with an OSM id whose tag is `Mo-Fr 09:00-17:00`
- **THEN** the editor shows the derived weekly pattern (open 09:00–17:00 Monday–Friday, closed Saturday–Sunday) and what it would replace, as a proposal, without writing anything until the user applies it

#### Scenario: OSM proposal discarded leaves existing hours untouched
- **WHEN** the user has hand-entered hours, fetches from OSM, and discards the resulting proposal instead of applying it
- **THEN** the place's stored opening hours are unchanged

#### Scenario: OSM tag unusable
- **WHEN** the place's OSM element has no `opening_hours` tag or the expression cannot be parsed
- **THEN** the editor tells the user the hours are unknown (not that the place is always open) and leaves any existing opening-hours data untouched

#### Scenario: Mark a place as hotel
- **WHEN** the user toggles "This is a hotel" on a place and saves
- **THEN** the place's category is `hotel` and it becomes selectable in the stays editor
