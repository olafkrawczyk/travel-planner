import type { SampleTripData } from "../tripFactory";
import { tokyoHotel } from "./tokyo";

export const tokyoCustomSample: SampleTripData = {
  name: "Tokyo Custom 5-Day",
  city: "Tokyo",
  days: 5,
  hotel: { ...tokyoHotel },
  places: [
    // Day 1
    { name: "Harajuku (Takeshita St)", lat: 35.6715, lng: 139.7031, category: "shop", dwellMin: 60, priority: 1, region: "Day 1" },
    { name: "Omotesando Hills", lat: 35.6669, lng: 139.7127, category: "shop", dwellMin: 45, priority: 2, region: "Day 1" },
    { name: "Meiji Jingu", lat: 35.6764, lng: 139.6993, category: "temple", dwellMin: 75, priority: 1, region: "Day 1" },
    { name: "Shibuya Scramble Crossing", lat: 35.6595, lng: 139.7005, category: "viewpoint", dwellMin: 45, priority: 1, region: "Day 1" },

    // Day 2
    { name: "Shinjuku Station", lat: 35.6896, lng: 139.7005, category: "other", dwellMin: 45, priority: 2, region: "Day 2" },
    { name: "Shimokitazawa", lat: 35.6613, lng: 139.6683, category: "shop", dwellMin: 90, priority: 1, region: "Day 2" },
    { name: "Gotokuji Temple", lat: 35.6432, lng: 139.6497, category: "temple", dwellMin: 45, priority: 1, region: "Day 2" },

    // Day 3
    { name: "Sensō-ji", lat: 35.7148, lng: 139.7967, category: "temple", dwellMin: 90, priority: 1, region: "Day 3" },
    { name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, category: "viewpoint", dwellMin: 90, priority: 1, region: "Day 3" },
    { name: "Akihabara", lat: 35.7022, lng: 139.7745, category: "shop", dwellMin: 90, priority: 1, region: "Day 3" },
    { name: "Nezu Shrine", lat: 35.7202, lng: 139.7607, category: "temple", dwellMin: 45, priority: 2, region: "Day 3" },

    // Day 4
    { name: "Tsukiji Outer Market", lat: 35.6654, lng: 139.7707, category: "restaurant", dwellMin: 90, priority: 1, region: "Day 4" },
    { name: "teamLab Planets", lat: 35.6492, lng: 139.7897, category: "museum", dwellMin: 120, priority: 1, region: "Day 4" },
    { name: "Tokyo Tower", lat: 35.6586, lng: 139.7454, category: "viewpoint", dwellMin: 75, priority: 1, region: "Day 4" },
    { name: "Ginza", lat: 35.6694, lng: 139.7659, category: "shop", dwellMin: 60, priority: 1, region: "Day 4" },

    // Day 5
    { name: "Hie Shrine", lat: 35.6747, lng: 139.7400, category: "temple", dwellMin: 45, priority: 2, region: "Day 5" },
    { name: "Tokyo Station", lat: 35.6812, lng: 139.7671, category: "viewpoint", dwellMin: 30, priority: 2, region: "Day 5" },
    { name: "Ikebukuro", lat: 35.7299, lng: 139.7109, category: "shop", dwellMin: 60, priority: 1, region: "Day 5" },
    { name: "Pokémon Center Mega Tokyo", lat: 35.7289, lng: 139.7198, category: "shop", dwellMin: 60, priority: 1, region: "Day 5" },
    { name: "Imperial Palace", lat: 35.6852, lng: 139.7528, category: "park", dwellMin: 75, priority: 1, region: "Day 5" },
  ]
};
