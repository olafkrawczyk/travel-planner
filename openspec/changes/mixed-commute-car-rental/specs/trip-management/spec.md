## ADDED Requirements

### Requirement: Car rental booking
The system SHALL allow the user to book a car rental for the trip as a date range (start date and end date, both within the trip's date range), expressed through a calendar-like control. A trip MAY hold multiple rentals. Rentals SHALL be stored as first-class trip data so they survive re-solves, persistence, export/import and share links. Each day's car availability SHALL be derived from the rentals: a day on which a rental is active (including its start and end date) SHALL be a car day. Rentals SHALL NOT overlap each other; attempting to save an overlapping rental SHALL be prevented with a visible explanation. For v1 the car SHALL be assumed to be with the traveller for the whole car day: no pickup/dropoff locations, no pickup/dropoff times, and no effect on the day's start/end times or bases. The existing whole-trip `carOnly` setting SHALL remain independent of rentals and behave exactly as before.

#### Scenario: Book a rental for a date range
- **WHEN** the user books a car from 2026-10-12 to 2026-10-14 in a 7-day trip
- **THEN** the rental is stored on the trip, the days covering those dates become car days, and the itinerary re-solves

#### Scenario: Rental availability is calendar-like
- **WHEN** the user opens the rental control
- **THEN** the trip's days are presented as a calendar-style range selection restricted to the trip's dates, and days already covered by another rental are marked as unavailable

#### Scenario: Edit or remove a rental
- **WHEN** the user changes a rental's dates or deletes it
- **THEN** car availability is re-derived for all affected days and the itinerary re-solves

#### Scenario: Overlapping rentals rejected
- **WHEN** the user tries to book a rental whose range overlaps an existing rental
- **THEN** the booking is not saved and the conflict is explained in the UI

#### Scenario: Rental survives persistence
- **WHEN** a trip with a rental is saved, reloaded, or exported and imported
- **THEN** the rental and the derived car days are unchanged

#### Scenario: carOnly is unaffected
- **WHEN** a trip has `carOnly` enabled and any number of rentals
- **THEN** behaviour is identical to a trip with `carOnly` and no rentals (whole trip uses the car curve), and vice versa a trip with rentals but no `carOnly` keeps non-car behaviour on non-car days
