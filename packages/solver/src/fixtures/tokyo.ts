import { TripSchema, type Trip } from "@app/domain";

/**
 * Tokyo-like fixture: ~30 real places (approximate coordinates), 5 days with
 * a mid-trip hotel change. Used by the regression test to guard solver score,
 * travel time and unscheduled count, and by performance tests.
 */

const HOTEL_SHINJUKU = "plc_hotel_shinjuku";
const HOTEL_UENO = "plc_hotel_ueno";

interface PlaceSpec {
  id: string;
  name: string;
  lat: number;
  lng: number;
  dwellMin: number;
  priority: 1 | 2 | 3;
  category?: "museum" | "viewpoint" | "park" | "temple" | "shop" | "restaurant" | "other";
  appointment?: { dayId: string; start: string };
}

const PLACES: PlaceSpec[] = [
  { id: HOTEL_SHINJUKU, name: "Hotel Shinjuku", lat: 35.6896, lng: 139.697, dwellMin: 0, priority: 3, category: "other" },
  { id: HOTEL_UENO, name: "Hotel Ueno", lat: 35.7118, lng: 139.7867, dwellMin: 0, priority: 3, category: "other" },
  { id: "sensoji", name: "Sensō-ji Temple", lat: 35.7148, lng: 139.7967, dwellMin: 90, priority: 1, category: "temple" },
  { id: "skytree", name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, dwellMin: 120, priority: 2, category: "viewpoint" },
  { id: "asakusa-market", name: "Nakamise Shopping Street", lat: 35.7133, lng: 139.7966, dwellMin: 60, priority: 2, category: "shop" },
  { id: "ueno-park", name: "Ueno Park", lat: 35.7156, lng: 139.7745, dwellMin: 90, priority: 2, category: "park" },
  { id: "tokyo-national-museum", name: "Tokyo National Museum", lat: 35.7188, lng: 139.7765, dwellMin: 120, priority: 2, category: "museum" },
  { id: "ameyoko", name: "Ameya-Yokochō Market", lat: 35.7133, lng: 139.7735, dwellMin: 60, priority: 3, category: "shop" },
  { id: "akihabara", name: "Akihabara Electric Town", lat: 35.6989, lng: 139.7731, dwellMin: 120, priority: 2, category: "shop" },
  { id: "imperial-palace", name: "Imperial Palace East Gardens", lat: 35.6852, lng: 139.7528, dwellMin: 90, priority: 2, category: "park" },
  { id: "ginza", name: "Ginza Shopping District", lat: 35.6717, lng: 139.765, dwellMin: 120, priority: 2, category: "shop" },
  { id: "tsukiji", name: "Tsukiji Outer Market", lat: 35.6654, lng: 139.7707, dwellMin: 90, priority: 1, category: "restaurant" },
  { id: "teamlab", name: "teamLab Planets", lat: 35.6488, lng: 139.7866, dwellMin: 120, priority: 1, category: "museum" },
  { id: "odaiba", name: "Odaiba Seaside Park", lat: 35.6297, lng: 139.7756, dwellMin: 90, priority: 3, category: "park" },
  { id: "shibuya-crossing", name: "Shibuya Scramble Crossing", lat: 35.6595, lng: 139.7005, dwellMin: 45, priority: 1, category: "other" },
  { id: "hachiko", name: "Hachikō Statue", lat: 35.6589, lng: 139.7015, dwellMin: 15, priority: 3, category: "other" },
  { id: "meiji", name: "Meiji Jingū Shrine", lat: 35.6764, lng: 139.6993, dwellMin: 90, priority: 1, category: "temple" },
  { id: "harajuku", name: "Takeshita Street", lat: 35.6712, lng: 139.703, dwellMin: 90, priority: 2, category: "shop" },
  { id: "shinjuku-gyoen", name: "Shinjuku Gyoen", lat: 35.6852, lng: 139.71, dwellMin: 120, priority: 2, category: "park" },
  { id: "tocho", name: "Tokyo Metropolitan Government Building", lat: 35.6896, lng: 139.6919, dwellMin: 60, priority: 3, category: "viewpoint" },
  { id: "golden-gai", name: "Golden Gai", lat: 35.6938, lng: 139.7036, dwellMin: 60, priority: 3, category: "restaurant" },
  { id: "roppongi-hills", name: "Roppongi Hills Mori Tower", lat: 35.6604, lng: 139.7292, dwellMin: 90, priority: 2, category: "viewpoint" },
  { id: "tokyo-tower", name: "Tokyo Tower", lat: 35.6586, lng: 139.7454, dwellMin: 90, priority: 1, category: "viewpoint" },
  { id: "zojoji", name: "Zōjō-ji Temple", lat: 35.6587, lng: 139.7477, dwellMin: 45, priority: 3, category: "temple" },
  { id: "ghibli", name: "Ghibli Museum", lat: 35.6961, lng: 139.5704, dwellMin: 120, priority: 2, category: "museum", appointment: { dayId: "day3", start: "13:00" } },
  { id: "kichijoji", name: "Inokashira Park", lat: 35.7008, lng: 139.5745, dwellMin: 90, priority: 3, category: "park" },
  { id: "nakano-broadway", name: "Nakano Broadway", lat: 35.7083, lng: 139.6653, dwellMin: 90, priority: 3, category: "shop" },
  { id: "yanaka", name: "Yanaka Ginza", lat: 35.7277, lng: 139.7657, dwellMin: 60, priority: 3, category: "shop" },
  { id: "tokyo-station", name: "Tokyo Station Marunouchi", lat: 35.6812, lng: 139.7671, dwellMin: 45, priority: 2, category: "other" },
  { id: "yasukuni", name: "Yasukuni Shrine", lat: 35.6933, lng: 139.7434, dwellMin: 60, priority: 3, category: "temple" },
  { id: "kabukicho", name: "Kabukichō", lat: 35.6955, lng: 139.7024, dwellMin: 60, priority: 3, category: "other" },
  { id: "sumida-river", name: "Sumida River Walk", lat: 35.7129, lng: 139.8016, dwellMin: 45, priority: 3, category: "park" },
];

const DAY_IDS = ["day1", "day2", "day3", "day4", "day5"];

export function tokyoTrip(): Trip {
  return TripSchema.parse({
    id: "trip_tokyo",
    schemaVersion: 1,
    name: "Tokyo",
    timezone: "Asia/Tokyo",
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
    days: DAY_IDS.map((id, i) => ({
      id,
      date: `2026-04-0${i + 1}`,
      start: "09:00",
      end: "21:00",
      startLocation: "base",
      endLocation: "base",
      // Hotel change on day 4: wake up in Shinjuku, sleep in Ueno.
      baseStartId: i <= 3 ? HOTEL_SHINJUKU : HOTEL_UENO,
      baseEndId: i <= 2 ? HOTEL_SHINJUKU : HOTEL_UENO,
    })),
    places: PLACES.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      category: p.category ?? "other",
      dwellMin: p.dwellMin,
      priority: p.priority,
      ...(p.appointment ? { appointment: p.appointment } : {}),
    })),
    travelOverrides: [],
    
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });
}

export const TOKYO_PLACE_COUNT = PLACES.length;
export const TOKYO_DAY_IDS = DAY_IDS;
