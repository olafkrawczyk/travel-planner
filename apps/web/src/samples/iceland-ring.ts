import type { MultiHotelSampleTripData } from "../tripFactory";

export const icelandRingSample: MultiHotelSampleTripData = {
  name: "Iceland Ring Road 12-Day",
  city: "Iceland",
  days: 12,
  hotels: [
    { name: "Hotel Rangá", lat: 63.8188, lng: -20.3807, daysFromStart: 0, nights: 1 },
    { name: "Hotel Vík í Mýrdal", lat: 63.4168, lng: -19.0016, daysFromStart: 1, nights: 1 },
    { name: "Fosshotel Glacier Lagoon", lat: 63.9054, lng: -16.6214, daysFromStart: 2, nights: 1 },
    { name: "Berjaya Höfn Hotel", lat: 64.2519, lng: -15.2052, daysFromStart: 3, nights: 1 },
    { name: "Gistihúsið - Lake Hotel Egilsstaðir", lat: 65.2573, lng: -14.4042, daysFromStart: 4, nights: 1 },
    { name: "Fosshotel Mývatn", lat: 65.6477, lng: -16.9632, daysFromStart: 5, nights: 1 },
    { name: "Hotel Kea", lat: 65.6806, lng: -18.0899, daysFromStart: 6, nights: 1 },
    { name: "Siglo Hotel", lat: 66.1514, lng: -18.9064, daysFromStart: 7, nights: 1 },
    { name: "Hotel Laugarbakki", lat: 65.3218, lng: -20.9304, daysFromStart: 8, nights: 1 },
    { name: "Fosshotel Hellnar", lat: 64.7505, lng: -23.6450, daysFromStart: 9, nights: 1 },
    { name: "Hotel Húsafell", lat: 64.6997, lng: -20.8672, daysFromStart: 10, nights: 1 },
    { name: "The Reykjavik EDITION", lat: 64.1492, lng: -21.9312, daysFromStart: 11, nights: 1 },
  ],
  places: [
    // Day 1
    { name: "Þingvellir National Park", lat: 64.2559, lng: -21.1295, category: "park", dwellMin: 15, priority: 1, region: "Day 1" },
    { name: "Geysir Geothermal Area", lat: 64.3104, lng: -20.3024, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 1" },
    { name: "Gullfoss Waterfall", lat: 64.3271, lng: -20.1199, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 1" },
    { name: "Kerið Crater", lat: 64.0413, lng: -20.8851, category: "park", dwellMin: 15, priority: 2, region: "Day 1" },
    { name: "Kaffi Krús", lat: 63.9355, lng: -21.0028, category: "cafe", dwellMin: 15, priority: 2, region: "Day 1" },
    { name: "Bónus / Krónan (Selfoss)", lat: 63.9388, lng: -20.9996, category: "shop", dwellMin: 15, priority: 2, region: "Day 1" },

    // Day 2
    { name: "Seljalandsfoss", lat: 63.6156, lng: -19.9886, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 2" },
    { name: "Gljúfrabúi", lat: 63.6209, lng: -19.9864, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 2" },
    { name: "Skógafoss", lat: 63.5321, lng: -19.5114, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 2" },
    { name: "Kvernufoss", lat: 63.5283, lng: -19.4811, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 2" },
    { name: "Dyrhólaey Arch", lat: 63.3996, lng: -19.1269, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 2" },
    { name: "Reynisfjara Black Sand Beach", lat: 63.4057, lng: -19.0716, category: "park", dwellMin: 15, priority: 1, region: "Day 2" },
    { name: "Skool Beans", lat: 63.4182, lng: -19.0069, category: "cafe", dwellMin: 15, priority: 2, region: "Day 2" },
    { name: "Krónan (Vík)", lat: 63.4172, lng: -19.0051, category: "shop", dwellMin: 15, priority: 2, region: "Day 2" },

    // Day 3
    { name: "Fjaðrárgljúfur Canyon", lat: 63.7713, lng: -18.1718, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 3" },
    { name: "Eldhraun Lava Field", lat: 63.6826, lng: -18.1396, category: "park", dwellMin: 15, priority: 2, region: "Day 3" },
    { name: "Svartifoss (Skaftafell)", lat: 64.0275, lng: -16.9753, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 3" },
    { name: "Svínafellsjökull", lat: 64.0048, lng: -16.8814, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 3" },
    { name: "Cafe Vatnajökull", lat: 63.8966, lng: -16.6340, category: "cafe", dwellMin: 15, priority: 2, region: "Day 3" },
    { name: "Kjarval", lat: 63.7891, lng: -18.0531, category: "shop", dwellMin: 15, priority: 2, region: "Day 3" },

    // Day 4
    { name: "Fjallsárlón", lat: 64.0135, lng: -16.3776, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 4" },
    { name: "Jökulsárlón Glacier Lagoon", lat: 64.0484, lng: -16.1794, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 4" },
    { name: "Diamond Beach", lat: 64.0436, lng: -16.1738, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 4" },
    { name: "Stokksnes & Vestrahorn", lat: 64.2405, lng: -14.9749, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 4" },
    { name: "Viking Cafe", lat: 64.2541, lng: -14.9961, category: "cafe", dwellMin: 15, priority: 2, region: "Day 4" },
    { name: "Nettó (Höfn)", lat: 64.2536, lng: -15.2062, category: "shop", dwellMin: 15, priority: 2, region: "Day 4" },

    // Day 5
    { name: "Djúpivogur", lat: 64.6565, lng: -14.2831, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 5" },
    { name: "Berufjörður Coastline", lat: 64.7333, lng: -14.3167, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 5" },
    { name: "Gufufoss", lat: 65.2405, lng: -14.0569, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 5" },
    { name: "Seyðisfjörður Blue Church", lat: 65.2604, lng: -14.0059, category: "temple", dwellMin: 15, priority: 1, region: "Day 5" },
    { name: "Sesam Brauðhús", lat: 65.0347, lng: -14.2185, category: "cafe", dwellMin: 15, priority: 2, region: "Day 5" },
    { name: "Bónus (Egilsstaðir)", lat: 65.2638, lng: -14.3948, category: "shop", dwellMin: 15, priority: 2, region: "Day 5" },

    // Day 6
    { name: "Stuðlagil Canyon", lat: 65.1633, lng: -15.3082, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 6" },
    { name: "Dettifoss & Selfoss", lat: 65.8146, lng: -16.3846, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 6" },
    { name: "Námafjall Hverir", lat: 65.6409, lng: -16.8080, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 6" },
    { name: "Mývatn Nature Baths", lat: 65.6310, lng: -16.8488, category: "other", dwellMin: 15, priority: 1, region: "Day 6" },
    { name: "Kaffihaus at Rjúkandi", lat: 65.3051, lng: -15.2619, category: "cafe", dwellMin: 15, priority: 2, region: "Day 6" },
    { name: "Kvikk / Samkaup", lat: 65.6441, lng: -16.9126, category: "shop", dwellMin: 15, priority: 2, region: "Day 6" },

    // Day 7
    { name: "Dimmuborgir", lat: 65.5912, lng: -16.9126, category: "park", dwellMin: 15, priority: 1, region: "Day 7" },
    { name: "Grjótagjá Cave", lat: 65.6262, lng: -16.8830, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 7" },
    { name: "Hverfjall Crater", lat: 65.6033, lng: -16.8732, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 7" },
    { name: "Goðafoss Waterfall", lat: 65.6828, lng: -17.5502, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 7" },
    { name: "Kaffistofan", lat: 65.6822, lng: -18.0906, category: "cafe", dwellMin: 15, priority: 2, region: "Day 7" },
    { name: "Bónus (Akureyri)", lat: 65.6896, lng: -18.1189, category: "shop", dwellMin: 15, priority: 2, region: "Day 7" },

    // Day 8
    { name: "Route 76 Coastal Cliffs", lat: 66.1557, lng: -18.9958, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 8" },
    { name: "Siglufjörður Harbour", lat: 66.1517, lng: -18.9079, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 8" },
    { name: "Hofsós Infinity Pool", lat: 65.8953, lng: -19.4121, category: "other", dwellMin: 15, priority: 1, region: "Day 8" },
    { name: "Glaumbær Turf Houses", lat: 65.6105, lng: -19.5042, category: "museum", dwellMin: 15, priority: 2, region: "Day 8" },
    { name: "Frida Chocolate", lat: 66.1506, lng: -18.9092, category: "cafe", dwellMin: 15, priority: 2, region: "Day 8" },
    { name: "Kjörbúðin (Siglufjörður)", lat: 66.1498, lng: -18.9103, category: "shop", dwellMin: 15, priority: 2, region: "Day 8" },

    // Day 9
    { name: "Kolugljúfur Canyon", lat: 65.3323, lng: -20.7029, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 9" },
    { name: "Hvítserkur Sea Stack", lat: 65.6046, lng: -20.6358, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 9" },
    { name: "Vatnsnes Seal Colonies", lat: 65.5684, lng: -20.7302, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 9" },
    { name: "Borgarvirki Fortress", lat: 65.4593, lng: -20.5986, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 9" },
    { name: "Sjávarborg Café", lat: 65.3965, lng: -20.9452, category: "cafe", dwellMin: 15, priority: 2, region: "Day 9" },
    { name: "Kjörbúðin (Hvammstangi)", lat: 65.3970, lng: -20.9478, category: "shop", dwellMin: 15, priority: 2, region: "Day 9" },

    // Day 10
    { name: "Stykkishólmur Harbor", lat: 65.0784, lng: -22.7275, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 10" },
    { name: "Berserkjahraun", lat: 64.9622, lng: -22.9557, category: "park", dwellMin: 15, priority: 2, region: "Day 10" },
    { name: "Kirkjufell & Kirkjufellsfoss", lat: 64.9272, lng: -23.3071, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 10" },
    { name: "Saxhóll Crater", lat: 64.8510, lng: -23.9248, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 10" },
    { name: "Café Valeria", lat: 64.9229, lng: -23.2562, category: "cafe", dwellMin: 15, priority: 2, region: "Day 10" },
    { name: "Kjörbúðin (Grundarfjörður)", lat: 64.9224, lng: -23.2595, category: "shop", dwellMin: 15, priority: 2, region: "Day 10" },

    // Day 11
    { name: "Arnarstapi Sea Cliffs", lat: 64.7675, lng: -23.6267, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 11" },
    { name: "Djúpalónssandur Beach", lat: 64.7533, lng: -23.8967, category: "park", dwellMin: 15, priority: 1, region: "Day 11" },
    { name: "Búðakirkja Black Church", lat: 64.8219, lng: -23.3846, category: "temple", dwellMin: 15, priority: 2, region: "Day 11" },
    { name: "Hraunfossar & Barnafoss", lat: 64.7019, lng: -20.9774, category: "viewpoint", dwellMin: 15, priority: 1, region: "Day 11" },
    { name: "Fjöruhúsið Café", lat: 64.7479, lng: -23.6468, category: "cafe", dwellMin: 15, priority: 2, region: "Day 11" },
    { name: "Bónus (Borgarnes)", lat: 64.5422, lng: -21.9169, category: "shop", dwellMin: 15, priority: 2, region: "Day 11" },

    // Day 12
    { name: "Deildartunguhver Hot Spring", lat: 64.6631, lng: -21.4116, category: "viewpoint", dwellMin: 15, priority: 2, region: "Day 12" },
    { name: "Krauma Geothermal Baths", lat: 64.6636, lng: -21.4112, category: "other", dwellMin: 15, priority: 1, region: "Day 12" },
    { name: "Hallgrímskirkja", lat: 64.1417, lng: -21.9266, category: "temple", dwellMin: 15, priority: 1, region: "Day 12" },
    { name: "Harpa Concert Hall", lat: 64.1504, lng: -21.9327, category: "museum", dwellMin: 15, priority: 1, region: "Day 12" },
    { name: "Reykjanes Coast", lat: 63.8164, lng: -22.6844, category: "park", dwellMin: 15, priority: 2, region: "Day 12" },
    { name: "Kaffi Ó-le", lat: 64.1481, lng: -21.9392, category: "cafe", dwellMin: 15, priority: 2, region: "Day 12" },
    { name: "Krónan Grandi", lat: 64.1542, lng: -21.9507, category: "shop", dwellMin: 15, priority: 2, region: "Day 12" },
  ]
};
