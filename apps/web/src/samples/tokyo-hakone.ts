/**
 * Curated Tokyo → Hakone sample trip: 5 days with a mid-trip hotel change
 * (Hotel Gracery Shinjuku → Hakone Yuryo Ryokan). Day 3 is the travel day:
 * it wakes in Tokyo and sleeps at the Hakone ryokan. Source of truth for the
 * "Load sample: Tokyo → Hakone" trip.
 */
import type { MultiHotelSampleTripData } from "../tripFactory";

export const TOKYO_HAKONE_DAYS = 5;

export const tokyoHakoneHotels = [
  {
    name: "Hotel Gracery Shinjuku",
    lat: 35.6951,
    lng: 139.7018,
    notes: "Nights 1–2 in Shinjuku; travel to Hakone on day 3.",
    daysFromStart: 0,
    nights: 2,
  },
  {
    name: "Hakone Yuryo Ryokan",
    lat: 35.239,
    lng: 139.103,
    notes: "Nights 3–5 near Hakone-Yumoto; onsen ryokan. Check in on day 3.",
    daysFromStart: 3,
    nights: 3,
  },
] as const;

export const tokyoHakonePlaces = [
  { name: "Senso-ji Temple", lat: 35.7148, lng: 139.7967, category: "temple", dwellMin: 90, priority: 1, notes: "Tokyo's oldest temple." },
  { name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, category: "viewpoint", dwellMin: 90, priority: 2, notes: "Sunset decks." },
  { name: "Meiji Shrine", lat: 35.6764, lng: 139.6993, category: "temple", dwellMin: 75, priority: 1, notes: "Forest shrine near Harajuku." },
  { name: "Shibuya Crossing", lat: 35.6595, lng: 139.7005, category: "viewpoint", dwellMin: 30, priority: 1, notes: "The scramble." },
  { name: "Shinjuku Gyoen", lat: 35.6852, lng: 139.71, category: "park", dwellMin: 90, priority: 2, notes: "Three garden styles." },
  { name: "Tsukiji Outer Market", lat: 35.6654, lng: 139.7707, category: "restaurant", dwellMin: 90, priority: 2, notes: "Street sushi breakfast." },
  { name: "teamLab Planets", lat: 35.6492, lng: 139.7897, category: "museum", dwellMin: 120, priority: 1, notes: "Timed tickets essential." },
  { name: "Akihabara Electric Town", lat: 35.7022, lng: 139.7745, category: "shop", dwellMin: 90, priority: 2, notes: "Anime and retro games." },
  { name: "Tokyo National Museum", lat: 35.7188, lng: 139.7766, category: "museum", dwellMin: 150, priority: 1, notes: "Ueno Park." },
  { name: "Tokyo Tower", lat: 35.6586, lng: 139.7454, category: "viewpoint", dwellMin: 75, priority: 2, notes: "Night illumination." },
  { name: "Ichiran Ramen Shibuya", lat: 35.6611, lng: 139.7006, category: "restaurant", dwellMin: 45, priority: 2, notes: "Solo booths." },
  { name: "Hakone Open-Air Museum", lat: 35.2444, lng: 139.0513, category: "museum", dwellMin: 120, priority: 1, notes: "Sculpture park, Picasso pavilion." },
  { name: "Hakone Shrine (Torii on Lake Ashi)", lat: 35.2041, lng: 139.0254, category: "temple", dwellMin: 60, priority: 1, notes: "Iconic floating torii photo." },
  { name: "Owakudani Valley", lat: 35.2445, lng: 139.0191, category: "viewpoint", dwellMin: 75, priority: 1, notes: "Volcanic vents, black eggs; ropeway." },
  { name: "Lake Ashi Sightseeing Cruise", lat: 35.2107, lng: 139.0016, category: "viewpoint", dwellMin: 60, priority: 2, notes: "Pirate-ship cruise, Moto-Hakone port." },
  { name: "Hakone Ropeway (Sounzan station)", lat: 35.2524, lng: 139.0173, category: "viewpoint", dwellMin: 45, priority: 2, notes: "Owakudani ↔ Togendai leg." },
  { name: "Gora Park", lat: 35.25, lng: 139.0461, category: "park", dwellMin: 60, priority: 3, notes: "French-style park near Gora station." },
  { name: "Hakone-Yumoto Shopping Street", lat: 35.2323, lng: 139.1037, category: "shop", dwellMin: 45, priority: 3, notes: "Snacks and souvenirs by the station." },
  { name: "Narukawa Art Museum", lat: 35.2064, lng: 139.0097, category: "museum", dwellMin: 90, priority: 3, notes: "Nihonga with Lake Ashi panorama." },
  { name: "Bakery & Table Hakone", lat: 35.2094, lng: 139.0018, category: "cafe", dwellMin: 45, priority: 3, notes: "Lakeside bakery at Togendai." },
] as const;

export const tokyoHakoneSample: MultiHotelSampleTripData = {
  name: "Tokyo → Hakone",
  city: "Tokyo",
  days: TOKYO_HAKONE_DAYS,
  hotels: tokyoHakoneHotels,
  places: tokyoHakonePlaces,
};
