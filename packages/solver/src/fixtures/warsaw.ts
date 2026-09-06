import { TripSchema, type Trip } from "@app/domain";

/**
 * Warsaw fixture: 22 curated real places (approximate coordinates) + the
 * Hotel Bristol base, 4 days based in the city centre. Mirrors the
 * "Load sample: Warsaw" trip in the web app; used by the regression test to
 * guard solver score, travel time and unscheduled count.
 */

const HOTEL_BRISTOL = "plc_hotel_bristol";

interface PlaceSpec {
  id: string;
  name: string;
  lat: number;
  lng: number;
  dwellMin: number;
  priority: 1 | 2 | 3;
  category: "museum" | "viewpoint" | "park" | "temple" | "shop" | "restaurant" | "cafe" | "other";
}

const PLACES: PlaceSpec[] = [
  { id: HOTEL_BRISTOL, name: "Hotel Bristol", lat: 52.2437, lng: 21.0119, dwellMin: 0, priority: 3, category: "other" },
  { id: "old-town-market-square", name: "Old Town Market Square", lat: 52.2497, lng: 21.0122, dwellMin: 60, priority: 1, category: "viewpoint" },
  { id: "royal-castle", name: "Royal Castle", lat: 52.2479, lng: 21.0141, dwellMin: 120, priority: 1, category: "museum" },
  { id: "warsaw-barbican", name: "Warsaw Barbican", lat: 52.2504, lng: 21.0102, dwellMin: 20, priority: 2, category: "viewpoint" },
  { id: "st-johns-archcathedral", name: "St. John's Archcathedral", lat: 52.2489, lng: 21.0136, dwellMin: 30, priority: 3, category: "temple" },
  { id: "lazienki-park", name: "Łazienki Park & Palace on the Isle", lat: 52.2152, lng: 21.0353, dwellMin: 150, priority: 1, category: "park" },
  { id: "wilanow-palace", name: "Wilanów Palace", lat: 52.1653, lng: 21.089, dwellMin: 120, priority: 2, category: "museum" },
  { id: "polin-museum", name: "POLIN Museum of the History of Polish Jews", lat: 52.2495, lng: 20.9929, dwellMin: 150, priority: 2, category: "museum" },
  { id: "uprising-museum", name: "Warsaw Uprising Museum", lat: 52.2323, lng: 20.981, dwellMin: 150, priority: 1, category: "museum" },
  { id: "palace-of-culture-terrace", name: "Palace of Culture and Science (Viewing Terrace)", lat: 52.2318, lng: 21.006, dwellMin: 60, priority: 1, category: "viewpoint" },
  { id: "copernicus-science-centre", name: "Copernicus Science Centre", lat: 52.2419, lng: 21.0287, dwellMin: 150, priority: 2, category: "museum" },
  { id: "krakowskie-przedmiescie", name: "Krakowskie Przedmieście & Nowy Świat", lat: 52.2376, lng: 21.0176, dwellMin: 45, priority: 2, category: "viewpoint" },
  { id: "buw-rooftop-gardens", name: "University Library Rooftop Gardens (BUW)", lat: 52.2424, lng: 21.0234, dwellMin: 45, priority: 3, category: "park" },
  { id: "praga-district", name: "Praga District (Ząbkowska St)", lat: 52.2522, lng: 21.036, dwellMin: 60, priority: 3, category: "other" },
  { id: "vistula-boulevards", name: "Vistula Boulevards", lat: 52.2393, lng: 21.0324, dwellMin: 45, priority: 3, category: "park" },
  { id: "saxon-garden", name: "Saxon Garden", lat: 52.2408, lng: 21.0047, dwellMin: 40, priority: 3, category: "park" },
  { id: "tomb-unknown-soldier", name: "Tomb of the Unknown Soldier", lat: 52.2411, lng: 21.0075, dwellMin: 15, priority: 3, category: "viewpoint" },
  { id: "museum-of-warsaw", name: "Museum of Warsaw", lat: 52.2501, lng: 21.0118, dwellMin: 90, priority: 3, category: "museum" },
  { id: "neon-museum", name: "Neon Museum", lat: 52.2404, lng: 21.0523, dwellMin: 60, priority: 3, category: "museum" },
  { id: "hala-koszyki", name: "Hala Koszyki", lat: 52.2226, lng: 21.0116, dwellMin: 75, priority: 2, category: "restaurant" },
  { id: "bar-mleczny-bambino", name: "Bar Mleczny Bambino", lat: 52.2219, lng: 21.0144, dwellMin: 45, priority: 2, category: "restaurant" },
  { id: "zapiecek-nowy-swiat", name: "Zapiecek (Nowy Świat)", lat: 52.2345, lng: 21.0195, dwellMin: 60, priority: 1, category: "restaurant" },
  { id: "cafe-blikle", name: "Café Blikle", lat: 52.2389, lng: 21.0173, dwellMin: 45, priority: 2, category: "cafe" },
];

const DAY_IDS = ["day1", "day2", "day3", "day4"];

export function warsawTrip(): Trip {
  return TripSchema.parse({
    id: "trip_warsaw",
    schemaVersion: 1,
    name: "Warsaw Essentials",
    timezone: "Europe/Warsaw",
    days: DAY_IDS.map((id, i) => ({
      id,
      date: `2026-06-0${i + 1}`,
      start: "09:00",
      end: "21:00",
      startLocation: "base",
      endLocation: "base",
      baseStartId: HOTEL_BRISTOL,
      baseEndId: HOTEL_BRISTOL,
    })),
    places: PLACES.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      category: p.category,
      dwellMin: p.dwellMin,
      priority: p.priority,
    })),
    travelOverrides: [],
    settings: {
      solverStrategy: "routeFirst",
      walkSpeedKmh: 4.5,
      walkMaxKm: 1.5,
      transitSpeedKmh: 18,
      transitOverheadMin: 12,
      regionalSpeedKmh: 80,
      regionalOverheadMin: 30,
      detourFactor: 1.3,
      initialBudgetMs: 500,
      editBudgetMs: 100,
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
}

export const WARSAW_PLACE_COUNT = PLACES.length;
export const WARSAW_DAY_IDS = DAY_IDS;
