/**
 * Curated Warsaw sample trip: 4 days, 22 places, Hotel Bristol
 * (Krakowskie Przedmieście, next to the Old Town). Source of truth for the
 * "Load sample: Warsaw" trip and mirrored in the solver's regression fixtures.
 */
import type { SampleTripData } from "../tripFactory";

export const WARSAW_DAYS = 4;

export const warsawHotel = {
  name: "Hotel Bristol",
  lat: 52.2437,
  lng: 21.0119,
  notes: "Landmark hotel on Krakowskie Przedmieście, next to the Old Town.",
} as const;

export const warsawPlaces = [
  { name: "Old Town Market Square", lat: 52.2497, lng: 21.0122, category: "viewpoint", dwellMin: 60, priority: 1, notes: "Mermaid statue; reconstructed facades." },
  { name: "Royal Castle", lat: 52.2479, lng: 21.0141, category: "museum", dwellMin: 120, priority: 1, notes: "Castle Square; royal apartments." },
  { name: "Warsaw Barbican", lat: 52.2504, lng: 21.0102, category: "viewpoint", dwellMin: 20, priority: 2, notes: "Old Town walls; street artists." },
  { name: "St. John's Archcathedral", lat: 52.2489, lng: 21.0136, category: "temple", dwellMin: 30, priority: 3, notes: "Gothic brick cathedral." },
  { name: "Łazienki Park & Palace on the Isle", lat: 52.2152, lng: 21.0353, category: "park", dwellMin: 150, priority: 1, notes: "Peacocks, Chopin monument, free Sunday piano concerts." },
  { name: "Wilanów Palace", lat: 52.1653, lng: 21.089, category: "museum", dwellMin: 120, priority: 2, notes: "Baroque royal palace; gardens." },
  { name: "POLIN Museum of the History of Polish Jews", lat: 52.2495, lng: 20.9929, category: "museum", dwellMin: 150, priority: 2, notes: "Core exhibition ~2.5h." },
  { name: "Warsaw Uprising Museum", lat: 52.2323, lng: 20.981, category: "museum", dwellMin: 150, priority: 1, notes: "Immersive 1944 uprising history; closed Tuesdays." },
  { name: "Palace of Culture and Science (Viewing Terrace)", lat: 52.2318, lng: 21.006, category: "viewpoint", dwellMin: 60, priority: 1, notes: "30th-floor terrace panorama." },
  { name: "Copernicus Science Centre", lat: 52.2419, lng: 21.0287, category: "museum", dwellMin: 150, priority: 2, notes: "Interactive; planetarium separate ticket." },
  { name: "Krakowskie Przedmieście & Nowy Świat", lat: 52.2376, lng: 21.0176, category: "viewpoint", dwellMin: 45, priority: 2, notes: "Royal Route walk: churches, Presidential Palace." },
  { name: "University Library Rooftop Gardens (BUW)", lat: 52.2424, lng: 21.0234, category: "park", dwellMin: 45, priority: 3, notes: "One of Europe's largest roof gardens; river views." },
  { name: "Praga District (Ząbkowska St)", lat: 52.2522, lng: 21.036, category: "other", dwellMin: 60, priority: 3, notes: "Pre-war tenements, street art, Soho Factory nearby." },
  { name: "Vistula Boulevards", lat: 52.2393, lng: 21.0324, category: "park", dwellMin: 45, priority: 3, notes: "Riverside promenade; seasonal bars." },
  { name: "Saxon Garden", lat: 52.2408, lng: 21.0047, category: "park", dwellMin: 40, priority: 3, notes: "Oldest public park; fountains." },
  { name: "Tomb of the Unknown Soldier", lat: 52.2411, lng: 21.0075, category: "viewpoint", dwellMin: 15, priority: 3, notes: "Piłsudski Square; hourly guard change." },
  { name: "Museum of Warsaw", lat: 52.2501, lng: 21.0118, category: "museum", dwellMin: 90, priority: 3, notes: "On the Old Town square; city history via objects." },
  { name: "Neon Museum", lat: 52.2404, lng: 21.0523, category: "museum", dwellMin: 60, priority: 3, notes: "Cold War neon signs, Praga Soho Factory." },
  { name: "Hala Koszyki", lat: 52.2226, lng: 21.0116, category: "restaurant", dwellMin: 75, priority: 2, notes: "Restored market hall turned food court." },
  { name: "Bar Mleczny Bambino", lat: 52.2219, lng: 21.0144, category: "restaurant", dwellMin: 45, priority: 2, notes: "Classic milk bar; cheap pierogi and żurek." },
  { name: "Zapiecek (Nowy Świat)", lat: 52.2345, lng: 21.0195, category: "restaurant", dwellMin: 60, priority: 1, notes: "Pierogi institution; expect a queue." },
  { name: "Café Blikle", lat: 52.2389, lng: 21.0173, category: "cafe", dwellMin: 45, priority: 2, notes: "Since 1869; pączki with rose filling." },
] as const;

export const warsawSample: SampleTripData = {
  name: "Warsaw Essentials",
  city: "Warsaw",
  days: WARSAW_DAYS,
  hotel: warsawHotel,
  places: warsawPlaces,
};
