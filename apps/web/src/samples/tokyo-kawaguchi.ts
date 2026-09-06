import type { SampleTripData } from "../tripFactory";
import { tokyoHotel } from "./tokyo";

export const tokyoKawaguchiSample: SampleTripData = {
  name: "Tokyo & Lake Kawaguchi 5-Day",
  city: "Tokyo",
  days: 5,
  hotel: { ...tokyoHotel },
  places: [
    // Day 1
    { name: "Meiji Jingu", lat: 35.6764, lng: 139.6993, category: "temple", dwellMin: 90, priority: 1, region: "Day 1" },
    { name: "Nezu Museum", lat: 35.6653, lng: 139.7168, category: "museum", dwellMin: 60, priority: 2, region: "Day 1" },
    { name: "Shibuya Sky", lat: 35.6585, lng: 139.7022, category: "viewpoint", dwellMin: 60, priority: 1, region: "Day 1" },
    { name: "Shinjuku Gyoen National Garden", lat: 35.6852, lng: 139.7100, category: "park", dwellMin: 90, priority: 1, region: "Day 1" },
    { name: "Omoide Yokocho", lat: 35.6931, lng: 139.6995, category: "restaurant", dwellMin: 60, priority: 2, region: "Day 1" },
    { name: "Tokyo Metro Gov Bldg", lat: 35.6896, lng: 139.6921, category: "viewpoint", dwellMin: 45, priority: 2, region: "Day 1" },

    // Day 2
    { name: "Sensō-ji", lat: 35.7148, lng: 139.7967, category: "temple", dwellMin: 90, priority: 1, region: "Day 2" },
    { name: "Natl Museum of Western Art", lat: 35.7153, lng: 139.7758, category: "museum", dwellMin: 90, priority: 2, region: "Day 2" },
    { name: "Ameyoko Market", lat: 35.7089, lng: 139.7744, category: "shop", dwellMin: 60, priority: 2, region: "Day 2" },
    { name: "Kanda Myoujin Shrine", lat: 35.7020, lng: 139.7679, category: "temple", dwellMin: 45, priority: 3, region: "Day 2" },
    { name: "Cafe de L'ambre", lat: 35.6696, lng: 139.7616, category: "cafe", dwellMin: 45, priority: 2, region: "Day 2" },
    { name: "GINZA SIX", lat: 35.6696, lng: 139.7641, category: "shop", dwellMin: 60, priority: 2, region: "Day 2" },
    { name: "Tokyo Station", lat: 35.6812, lng: 139.7671, category: "viewpoint", dwellMin: 30, priority: 2, region: "Day 2" },

    // Day 3: Lake Kawaguchi
    { name: "Shinjuku Station (Departure)", lat: 35.6896, lng: 139.7005, category: "other", dwellMin: 30, priority: 1, region: "Day 3 (Fuji)" },
    { name: "Arakurayama Sengen Park", lat: 35.5015, lng: 138.8016, category: "park", dwellMin: 60, priority: 1, region: "Day 3 (Fuji)" },
    { name: "Chureito Pagoda", lat: 35.5014, lng: 138.8015, category: "viewpoint", dwellMin: 45, priority: 1, region: "Day 3 (Fuji)" },
    { name: "Kawaguchiko Station", lat: 35.4981, lng: 138.7686, category: "other", dwellMin: 15, priority: 2, region: "Day 3 (Fuji)" },
    { name: "Hoto Fudo", lat: 35.4984, lng: 138.7684, category: "restaurant", dwellMin: 60, priority: 2, region: "Day 3 (Fuji)" },
    { name: "Oishi Park", lat: 35.5229, lng: 138.7454, category: "park", dwellMin: 60, priority: 1, region: "Day 3 (Fuji)" },
    { name: "Mt. Fuji Panoramic Ropeway", lat: 35.5036, lng: 138.7750, category: "viewpoint", dwellMin: 60, priority: 1, region: "Day 3 (Fuji)" },
    { name: "Lake Kawaguchi", lat: 35.5186, lng: 138.7561, category: "viewpoint", dwellMin: 60, priority: 1, region: "Day 3 (Fuji)" },

    // Day 4
    { name: "Tsukiji Outer Market", lat: 35.6654, lng: 139.7707, category: "restaurant", dwellMin: 90, priority: 1, region: "Day 4" },
    { name: "teamLab Planets TOKYO DMM", lat: 35.6492, lng: 139.7897, category: "museum", dwellMin: 120, priority: 1, region: "Day 4" },
    { name: "Odaiba Marine Park", lat: 35.6307, lng: 139.7745, category: "park", dwellMin: 60, priority: 2, region: "Day 4" },
    { name: "The National Art Center, Tokyo", lat: 35.6652, lng: 139.7263, category: "museum", dwellMin: 90, priority: 2, region: "Day 4" },
    { name: "21_21 Design Sight", lat: 35.6665, lng: 139.7303, category: "museum", dwellMin: 60, priority: 2, region: "Day 4" },
    { name: "Roppongi Hills Mori Tower", lat: 35.6605, lng: 139.7291, category: "viewpoint", dwellMin: 60, priority: 1, region: "Day 4" },

    // Day 5
    { name: "Inokashira Park", lat: 35.7001, lng: 139.5772, category: "park", dwellMin: 90, priority: 1, region: "Day 5" },
    { name: "Nakano Broadway", lat: 35.7087, lng: 139.6658, category: "shop", dwellMin: 90, priority: 1, region: "Day 5" },
    { name: "Shimokitazawa", lat: 35.6613, lng: 139.6683, category: "shop", dwellMin: 90, priority: 1, region: "Day 5" },
    { name: "GLITCH COFFEE & ROASTERS", lat: 35.6946, lng: 139.7601, category: "cafe", dwellMin: 45, priority: 2, region: "Day 5" },
    { name: "DAIKANYAMA T-SITE", lat: 35.6488, lng: 139.6995, category: "shop", dwellMin: 60, priority: 2, region: "Day 5" },
  ]
};
