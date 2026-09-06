/**
 * Curated Tokyo sample trip: 5 days, 24 places, hotel in Shinjuku.
 * Source of truth for the "Load sample: Tokyo" trip and mirrored in the
 * solver's regression fixtures.
 */
import type { SampleTripData } from "../tripFactory";

export const TOKYO_DAYS = 5;

export const tokyoHotel = {
  name: "Hotel Gracery Shinjuku",
  lat: 35.6951,
  lng: 139.7018,
  notes: "Shinjuku base — good transit hub (Shinjuku Station).",
} as const;

export const tokyoPlaces = [
  { name: "Senso-ji Temple", lat: 35.7148, lng: 139.7967, category: "temple", dwellMin: 90, priority: 1, notes: "Tokyo's oldest temple; Kaminarimon gate." },
  { name: "Nakamise Shopping Street", lat: 35.7122, lng: 139.7964, category: "shop", dwellMin: 45, priority: 2, notes: "Snack and souvenir approach to Senso-ji." },
  { name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, category: "viewpoint", dwellMin: 90, priority: 2, notes: "350m/450m decks; go near sunset." },
  { name: "Ueno Park", lat: 35.7148, lng: 139.7734, category: "park", dwellMin: 90, priority: 2, notes: "Cherry blossoms, ponds, museums." },
  { name: "Tokyo National Museum", lat: 35.7188, lng: 139.7766, category: "museum", dwellMin: 150, priority: 1, notes: "Honkan gallery is the core." },
  { name: "Ameya-Yokocho Market", lat: 35.7089, lng: 139.7744, category: "shop", dwellMin: 60, priority: 3, notes: "Street food and discount stalls under the tracks." },
  { name: "Meiji Shrine", lat: 35.6764, lng: 139.6993, category: "temple", dwellMin: 75, priority: 1, notes: "Forest walk to the main shrine." },
  { name: "Takeshita Street", lat: 35.6715, lng: 139.7031, category: "shop", dwellMin: 45, priority: 2, notes: "Harajuku youth fashion; crepes." },
  { name: "Shibuya Crossing", lat: 35.6595, lng: 139.7005, category: "viewpoint", dwellMin: 30, priority: 1, notes: "Watch from the Starbucks or Mag's Park." },
  { name: "Shibuya Sky", lat: 35.6585, lng: 139.7022, category: "viewpoint", dwellMin: 75, priority: 2, notes: "Book ahead; rooftop open-air deck." },
  { name: "Shinjuku Gyoen", lat: 35.6852, lng: 139.71, category: "park", dwellMin: 90, priority: 2, notes: "Three garden styles; small entry fee." },
  { name: "Tokyo Metropolitan Government Building", lat: 35.6896, lng: 139.6921, category: "viewpoint", dwellMin: 45, priority: 2, notes: "Free observatories, Fuji on clear days." },
  { name: "Omoide Yokocho", lat: 35.6931, lng: 139.6995, category: "restaurant", dwellMin: 60, priority: 3, notes: "Lantern-lit yakitori alleys by Shinjuku station." },
  { name: "teamLab Planets", lat: 35.6492, lng: 139.7897, category: "museum", dwellMin: 120, priority: 1, notes: "Timed tickets essential; barefoot water areas." },
  { name: "Tsukiji Outer Market", lat: 35.6654, lng: 139.7707, category: "restaurant", dwellMin: 90, priority: 2, notes: "Go hungry; street sushi and tamagoyaki." },
  { name: "Ginza Shopping District", lat: 35.6694, lng: 139.7659, category: "shop", dwellMin: 60, priority: 3, notes: "Flagship stores; weekend pedestrian paradise." },
  { name: "Imperial Palace East Gardens", lat: 35.6852, lng: 139.7528, category: "park", dwellMin: 75, priority: 2, notes: "Free; closed Mon/Fri." },
  { name: "Tokyo Station Marunouchi", lat: 35.6812, lng: 139.7671, category: "viewpoint", dwellMin: 20, priority: 3, notes: "Red-brick facade, best from Gyoko-dori." },
  { name: "Akihabara Electric Town", lat: 35.7022, lng: 139.7745, category: "shop", dwellMin: 90, priority: 2, notes: "Anime, retro games, electronics." },
  { name: "Odaiba (DiverCity Gundam)", lat: 35.6248, lng: 139.7751, category: "viewpoint", dwellMin: 60, priority: 3, notes: "Life-size Unicorn Gundam; bay views." },
  { name: "Hama-rikyu Gardens", lat: 35.6597, lng: 139.7637, category: "park", dwellMin: 60, priority: 3, notes: "Tidal pond; water bus to Asakusa." },
  { name: "Tokyo Tower", lat: 35.6586, lng: 139.7454, category: "viewpoint", dwellMin: 75, priority: 2, notes: "Classic; night illumination." },
  { name: "Ichiran Ramen Shibuya", lat: 35.6611, lng: 139.7006, category: "restaurant", dwellMin: 45, priority: 2, notes: "Solo-booth tonkotsu ramen." },
  { name: "Fuglen Tokyo", lat: 35.6667, lng: 139.6932, category: "cafe", dwellMin: 45, priority: 3, notes: "Norwegian coffee bar near Yoyogi Park." },
] as const;

export const tokyoSample: SampleTripData = {
  name: "Tokyo Highlights",
  city: "Tokyo",
  days: TOKYO_DAYS,
  hotel: tokyoHotel,
  places: tokyoPlaces,
};
