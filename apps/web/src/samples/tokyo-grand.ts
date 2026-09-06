/**
 * Curated "Tokyo Grand Tour" sample trip: 12 days, exactly 100 places, two
 * hotels (Shinjuku for nights 1-6, Asakusa for nights 7-12 — travel day is
 * calendar day 7, which wakes in Shinjuku and sleeps in Asakusa). Source of
 * truth for the "Load sample: Tokyo 100" trip.
 *
 * Two things this sample deliberately exercises:
 *
 * - 100 places + 2 hotels = 102 matrix nodes for the travel-time solver,
 *   which exceeds the default `osrmMaxNodes` dev-panel flag (100 — the
 *   public OSRM demo server's practical limit). Unless that flag is raised,
 *   this sample plans on heuristic (straight-line) travel times rather than
 *   routed OSRM times.
 * - 100 candidate places across 12 days is deliberately more than fits in
 *   the available day-hours. The lower-priority places are expected to land
 *   in the "couldn't fit" tray — that's the intended demonstration of how
 *   the solver triages an over-full wishlist, not a bug.
 *
 * Places are spread across eleven real Tokyo districts so the solver's
 * day-clustering produces geographically coherent days: Asakusa/Ueno/Yanaka,
 * Akihabara/Kanda/Jimbocho, Nihonbashi/Marunouchi/Ginza/Tsukiji,
 * Roppongi/Azabu/Toranomon, Shibuya/Harajuku/Omotesando/Daikanyama/
 * Nakameguro, Shinjuku/Yoyogi/Kagurazaka, Ikebukuro/Sugamo,
 * Odaiba/Toyosu/Tsukishima, Ryogoku/Kiyosumi/Fukagawa,
 * Shimokitazawa/Kichijoji/Nakano/Koenji, and Meguro/Gotanda/Setagaya.
 */
import type { MultiHotelSampleTripData } from "../tripFactory";

export const TOKYO_GRAND_DAYS = 12;

export const tokyoGrandHotels = [
  {
    name: "Hotel Gracery Shinjuku",
    lat: 35.6951,
    lng: 139.7018,
    notes: "Nights 1–6 in Shinjuku; travel to Asakusa on day 7.",
    daysFromStart: 0,
    nights: 6,
  },
  {
    name: "Asakusa View Hotel",
    lat: 35.7134,
    lng: 139.7937,
    notes: "Nights 7–12 near Senso-ji, footsteps from the Sumida riverside. Check in on day 7.",
    daysFromStart: 7,
    nights: 6,
  },
] as const;

export const tokyoGrandPlaces = [
  // Asakusa / Ueno / Yanaka
  { name: "Senso-ji Temple", lat: 35.7148, lng: 139.7967, category: "temple", dwellMin: 90, priority: 1, notes: "Tokyo's oldest temple; Kaminarimon gate." },
  { name: "Nakamise Shopping Street", lat: 35.7122, lng: 139.7964, category: "shop", dwellMin: 45, priority: 2, notes: "Snack and souvenir approach to Senso-ji." },
  { name: "Asakusa Shrine", lat: 35.7141, lng: 139.7972, category: "temple", dwellMin: 30, priority: 3, notes: "Quiet Shinto shrine beside Senso-ji's main hall." },
  { name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, category: "viewpoint", dwellMin: 90, priority: 1, notes: "350m/450m decks; go near sunset." },
  { name: "Ueno Park", lat: 35.7148, lng: 139.7734, category: "park", dwellMin: 90, priority: 1, notes: "Cherry blossoms, ponds, museums." },
  { name: "Tokyo National Museum", lat: 35.7188, lng: 139.7766, category: "museum", dwellMin: 150, priority: 1, notes: "Honkan gallery is the core." },
  { name: "Ueno Zoo", lat: 35.7161, lng: 139.7712, category: "park", dwellMin: 90, priority: 2, notes: "Japan's oldest zoo; giant pandas draw queues." },
  { name: "Ameya-Yokocho Market", lat: 35.7089, lng: 139.7744, category: "shop", dwellMin: 60, priority: 2, notes: "Street food and discount stalls under the tracks." },
  { name: "Yanaka Ginza", lat: 35.728, lng: 139.7669, category: "shop", dwellMin: 45, priority: 2, notes: "Retro shopping street in the Yanesen old-town area." },
  { name: "Yanaka Cemetery", lat: 35.7266, lng: 139.7695, category: "park", dwellMin: 45, priority: 3, notes: "Cherry-lined paths through a historic cemetery." },

  // Akihabara / Kanda / Jimbocho
  { name: "Akihabara Electric Town", lat: 35.7022, lng: 139.7745, category: "shop", dwellMin: 90, priority: 1, notes: "Anime, retro games, electronics." },
  { name: "Kanda Myojin Shrine", lat: 35.702, lng: 139.7674, category: "temple", dwellMin: 45, priority: 2, notes: "Historic shrine popular with tech workers for luck." },
  { name: "Jimbocho Book Town", lat: 35.6969, lng: 139.7573, category: "shop", dwellMin: 60, priority: 2, notes: "Dozens of secondhand bookshops along Yasukuni-dori." },
  { name: "Nikolai Cathedral", lat: 35.6975, lng: 139.7663, category: "other", dwellMin: 30, priority: 3, notes: "Byzantine-style Orthodox cathedral near Ochanomizu." },
  { name: "Yushima Seido", lat: 35.6996, lng: 139.7677, category: "temple", dwellMin: 30, priority: 3, notes: "Edo-era Confucian academy; serene tree-lined grounds." },
  { name: "mAAch ecute Kanda Manseibashi", lat: 35.6969, lng: 139.7724, category: "shop", dwellMin: 30, priority: 3, notes: "Old station platform turned boutique shops and river deck." },
  { name: "Akihabara Radio Kaikan", lat: 35.6989, lng: 139.7717, category: "shop", dwellMin: 45, priority: 3, notes: "Multi-floor figure and hobby shop tower." },
  { name: "Kanda Yabusoba", lat: 35.7, lng: 139.7695, category: "restaurant", dwellMin: 45, priority: 3, notes: "Historic soba restaurant dating to 1880." },
  { name: "2k540 Aki-Oka Artisan", lat: 35.6996, lng: 139.7754, category: "shop", dwellMin: 45, priority: 3, notes: "Craft workshops under the tracks between Akihabara and Okachimachi." },

  // Nihonbashi / Marunouchi / Ginza / Tsukiji
  { name: "Tokyo Station Marunouchi", lat: 35.6812, lng: 139.7671, category: "viewpoint", dwellMin: 20, priority: 2, notes: "Red-brick facade, best from Gyoko-dori." },
  { name: "Imperial Palace East Gardens", lat: 35.6852, lng: 139.7528, category: "park", dwellMin: 75, priority: 1, notes: "Free; closed Mon/Fri." },
  { name: "Nihonbashi Bridge", lat: 35.6835, lng: 139.7737, category: "viewpoint", dwellMin: 20, priority: 3, notes: "Historic bridge; zero-mile marker for Japan's roads." },
  { name: "Mitsukoshi Nihonbashi Main Store", lat: 35.6847, lng: 139.7735, category: "shop", dwellMin: 45, priority: 3, notes: "Japan's oldest department store; ornate lion statue entrance." },
  { name: "Ginza Shopping District", lat: 35.6694, lng: 139.7659, category: "shop", dwellMin: 60, priority: 1, notes: "Flagship stores; weekend pedestrian paradise." },
  { name: "Kabuki-za Theatre", lat: 35.6693, lng: 139.7671, category: "other", dwellMin: 45, priority: 2, notes: "Iconic kabuki theatre; single-act tickets available." },
  { name: "Tsukiji Outer Market", lat: 35.6654, lng: 139.7707, category: "restaurant", dwellMin: 90, priority: 1, notes: "Go hungry; street sushi and tamagoyaki." },
  { name: "Hama-rikyu Gardens", lat: 35.6597, lng: 139.7637, category: "park", dwellMin: 60, priority: 2, notes: "Tidal pond; water bus to Asakusa." },
  { name: "Mitsubishi Ichigokan Museum", lat: 35.679, lng: 139.7639, category: "museum", dwellMin: 90, priority: 3, notes: "Restored red-brick Meiji-era bank building; rotating art exhibits." },
  { name: "Artizon Museum", lat: 35.6802, lng: 139.7712, category: "museum", dwellMin: 90, priority: 2, notes: "Ishibashi Foundation's collection in a sleek Kyobashi tower." },

  // Roppongi / Azabu / Toranomon
  { name: "Mori Art Museum", lat: 35.6604, lng: 139.7292, category: "museum", dwellMin: 90, priority: 1, notes: "Contemporary art atop Roppongi Hills; combo ticket with the deck." },
  { name: "Tokyo Tower", lat: 35.6586, lng: 139.7454, category: "viewpoint", dwellMin: 75, priority: 1, notes: "Classic; night illumination." },
  { name: "Nogi Shrine", lat: 35.6683, lng: 139.7263, category: "temple", dwellMin: 30, priority: 3, notes: "Small shrine dedicated to General Nogi, near Roppongi." },
  { name: "Azabu-Juban Shopping Street", lat: 35.6559, lng: 139.735, category: "shop", dwellMin: 45, priority: 2, notes: "Neighborhood shotengai famous for its summer festival." },
  { name: "Toranomon Hills", lat: 35.669, lng: 139.7495, category: "viewpoint", dwellMin: 30, priority: 3, notes: "Modern tower complex with a rooftop garden plaza." },
  { name: "National Art Center Tokyo", lat: 35.6657, lng: 139.7266, category: "museum", dwellMin: 90, priority: 2, notes: "No permanent collection; undulating glass facade." },
  { name: "Suntory Museum of Art", lat: 35.6663, lng: 139.7305, category: "museum", dwellMin: 75, priority: 2, notes: "Traditional Japanese art inside Tokyo Midtown." },
  { name: "Tokyo Midtown Garden", lat: 35.6669, lng: 139.731, category: "park", dwellMin: 45, priority: 3, notes: "Green lawn plaza between Midtown's towers." },
  { name: "Zojo-ji Temple", lat: 35.6578, lng: 139.7492, category: "temple", dwellMin: 45, priority: 2, notes: "Historic temple gate framed by Tokyo Tower." },

  // Shibuya / Harajuku / Omotesando / Daikanyama / Nakameguro
  { name: "Shibuya Crossing", lat: 35.6595, lng: 139.7005, category: "viewpoint", dwellMin: 30, priority: 1, notes: "Watch from the Starbucks or Mag's Park." },
  { name: "Shibuya Sky", lat: 35.6585, lng: 139.7022, category: "viewpoint", dwellMin: 75, priority: 1, notes: "Book ahead; rooftop open-air deck." },
  { name: "Meiji Shrine", lat: 35.6764, lng: 139.6993, category: "temple", dwellMin: 75, priority: 1, notes: "Forest walk to the main shrine." },
  { name: "Takeshita Street", lat: 35.6715, lng: 139.7031, category: "shop", dwellMin: 45, priority: 1, notes: "Harajuku youth fashion; crepes." },
  { name: "Omotesando Hills", lat: 35.6669, lng: 139.7127, category: "shop", dwellMin: 45, priority: 2, notes: "Tadao Ando-designed sloped-atrium mall." },
  { name: "Cat Street", lat: 35.669, lng: 139.7057, category: "shop", dwellMin: 30, priority: 3, notes: "Backstreet boutiques between Harajuku and Shibuya." },
  { name: "Nezu Museum", lat: 35.6653, lng: 139.7168, category: "museum", dwellMin: 75, priority: 2, notes: "Japanese and Asian art with a garden behind Omotesando." },
  { name: "Daikanyama T-Site", lat: 35.6494, lng: 139.7027, category: "shop", dwellMin: 45, priority: 2, notes: "Tsutaya's flagship bookstore campus; leafy and quiet." },
  { name: "Nakameguro Canal", lat: 35.644, lng: 139.6989, category: "viewpoint", dwellMin: 30, priority: 2, notes: "Riverside path lined with cherry trees and cafes." },
  { name: "Yoyogi Park", lat: 35.6716, lng: 139.6949, category: "park", dwellMin: 60, priority: 2, notes: "Broad lawns; street performers on weekends." },
  { name: "Fuglen Tokyo", lat: 35.6667, lng: 139.6932, category: "cafe", dwellMin: 45, priority: 3, notes: "Norwegian coffee bar near Yoyogi Park." },
  { name: "Shibuya Center-gai", lat: 35.6598, lng: 139.6982, category: "shop", dwellMin: 30, priority: 3, notes: "Neon-lit pedestrian street packed with shops and arcades." },

  // Shinjuku / Yoyogi / Kagurazaka
  { name: "Shinjuku Gyoen", lat: 35.6852, lng: 139.71, category: "park", dwellMin: 90, priority: 1, notes: "Three garden styles; small entry fee." },
  { name: "Tokyo Metropolitan Government Building", lat: 35.6896, lng: 139.6921, category: "viewpoint", dwellMin: 45, priority: 1, notes: "Free observatories, Fuji on clear days." },
  { name: "Omoide Yokocho", lat: 35.6931, lng: 139.6995, category: "restaurant", dwellMin: 60, priority: 2, notes: "Lantern-lit yakitori alleys by Shinjuku station." },
  { name: "Golden Gai", lat: 35.6942, lng: 139.7043, category: "other", dwellMin: 45, priority: 2, notes: "Maze of tiny themed bars across six narrow alleys." },
  { name: "Kabukicho Ichiban-gai", lat: 35.6947, lng: 139.7025, category: "other", dwellMin: 30, priority: 3, notes: "Tokyo's largest entertainment district; neon and arcades." },
  { name: "Hanazono Shrine", lat: 35.6939, lng: 139.7042, category: "temple", dwellMin: 30, priority: 3, notes: "Shrine tucked amid Kabukicho's nightlife." },
  { name: "Kagurazaka Street", lat: 35.702, lng: 139.74, category: "shop", dwellMin: 45, priority: 2, notes: "Cobblestone former geisha district with French cafes." },
  { name: "Akagi Shrine", lat: 35.7025, lng: 139.7386, category: "temple", dwellMin: 30, priority: 3, notes: "Modern Kuma-designed shrine renewal in Kagurazaka." },
  { name: "Don Quijote Shinjuku", lat: 35.6944, lng: 139.7036, category: "shop", dwellMin: 30, priority: 3, notes: "Discount variety megastore, open late." },

  // Ikebukuro / Sugamo
  { name: "Sunshine City", lat: 35.7295, lng: 139.7189, category: "shop", dwellMin: 60, priority: 2, notes: "Massive complex with aquarium, planetarium, observatory." },
  { name: "Rikugien Garden", lat: 35.728, lng: 139.7436, category: "park", dwellMin: 75, priority: 1, notes: "One of Tokyo's finest Edo-period strolling gardens." },
  { name: "Sugamo Jizo-dori Shopping Street", lat: 35.7368, lng: 139.7392, category: "shop", dwellMin: 45, priority: 2, notes: "Popular with elderly shoppers; 'Harajuku for grandmas.'" },
  { name: "Togenuki Jizo Temple", lat: 35.7375, lng: 139.7394, category: "temple", dwellMin: 30, priority: 3, notes: "Statue believers wash for health; on Sugamo's main street." },
  { name: "Animate Ikebukuro Main Store", lat: 35.7305, lng: 139.7168, category: "shop", dwellMin: 45, priority: 3, notes: "Flagship anime and manga goods store, nine floors." },
  { name: "Ancient Orient Museum", lat: 35.7296, lng: 139.7194, category: "museum", dwellMin: 60, priority: 3, notes: "Small museum of Middle Eastern antiquities inside Sunshine City." },
  { name: "Zoshigaya Cemetery", lat: 35.7218, lng: 139.7178, category: "park", dwellMin: 30, priority: 3, notes: "Quiet historic cemetery; Natsume Soseki's grave." },

  // Odaiba / Toyosu / Tsukishima
  { name: "teamLab Planets", lat: 35.6492, lng: 139.7897, category: "museum", dwellMin: 120, priority: 1, notes: "Timed tickets essential; barefoot water areas." },
  { name: "Odaiba DiverCity Gundam", lat: 35.6248, lng: 139.7751, category: "viewpoint", dwellMin: 45, priority: 2, notes: "Life-size Unicorn Gundam; bay views." },
  { name: "Rainbow Bridge Promenade", lat: 35.6367, lng: 139.7631, category: "viewpoint", dwellMin: 30, priority: 2, notes: "Walk the bridge's pedestrian deck for bay views." },
  { name: "Toyosu Market", lat: 35.6453, lng: 139.7745, category: "restaurant", dwellMin: 90, priority: 2, notes: "Tuna auction viewing deck and sushi restaurants." },
  { name: "Odaiba Seaside Park", lat: 35.628, lng: 139.7752, category: "park", dwellMin: 45, priority: 3, notes: "Sandy beach with a Statue of Liberty replica." },
  { name: "Miraikan", lat: 35.6194, lng: 139.7756, category: "museum", dwellMin: 90, priority: 2, notes: "Hands-on science museum with ASIMO and a giant globe display." },
  { name: "Tsukishima Monja Street", lat: 35.6636, lng: 139.783, category: "restaurant", dwellMin: 60, priority: 2, notes: "Alley of shops serving monjayaki, a Tokyo specialty." },
  { name: "Fuji TV Building", lat: 35.627, lng: 139.7745, category: "viewpoint", dwellMin: 30, priority: 3, notes: "Futuristic Kenzo Tange building with a spherical observation deck." },

  // Ryogoku / Kiyosumi / Fukagawa
  { name: "Ryogoku Kokugikan", lat: 35.6971, lng: 139.7933, category: "other", dwellMin: 60, priority: 2, notes: "National sumo stadium; tournament tickets or the adjacent museum." },
  { name: "Edo-Tokyo Museum", lat: 35.6961, lng: 139.7938, category: "museum", dwellMin: 90, priority: 2, notes: "Scale models and dioramas of Edo-era Tokyo life." },
  { name: "Kiyosumi Gardens", lat: 35.6817, lng: 139.8007, category: "park", dwellMin: 60, priority: 2, notes: "Edo-era garden with stepping-stone pond paths." },
  { name: "Fukagawa Edo Museum", lat: 35.6773, lng: 139.7975, category: "museum", dwellMin: 60, priority: 3, notes: "Life-size reconstructed Edo-period neighborhood street." },
  { name: "Tomioka Hachimangu Shrine", lat: 35.6725, lng: 139.7998, category: "temple", dwellMin: 45, priority: 2, notes: "Tokyo's largest Hachiman shrine; sumo history monuments." },
  { name: "Kiba Park", lat: 35.6706, lng: 139.7987, category: "park", dwellMin: 45, priority: 3, notes: "Riverside park near the old lumber district." },
  { name: "Sumida Hokusai Museum", lat: 35.6975, lng: 139.7962, category: "museum", dwellMin: 75, priority: 2, notes: "Sleek Sejima-designed museum devoted to the ukiyo-e master." },

  // Shimokitazawa / Kichijoji / Nakano / Koenji
  { name: "Shimokitazawa Shopping Streets", lat: 35.6613, lng: 139.6683, category: "shop", dwellMin: 60, priority: 2, notes: "Vintage clothing and live-music bars in a maze of alleys." },
  { name: "Inokashira Park", lat: 35.7009, lng: 139.5704, category: "park", dwellMin: 75, priority: 2, notes: "Boating pond next to Kichijoji; Ghibli Museum nearby." },
  { name: "Ghibli Museum", lat: 35.6962, lng: 139.5703, category: "museum", dwellMin: 120, priority: 1, notes: "Timed tickets sell out months ahead; whimsical Miyazaki-designed building." },
  { name: "Kichijoji Harmonica Yokocho", lat: 35.7028, lng: 139.5797, category: "restaurant", dwellMin: 45, priority: 3, notes: "Tiny postwar-market alley of bars and eateries." },
  { name: "Nakano Broadway", lat: 35.7078, lng: 139.6656, category: "shop", dwellMin: 60, priority: 2, notes: "Otaku shopping mecca; vintage toys and manga." },
  { name: "Koenji Shopping Arcade", lat: 35.7052, lng: 139.6497, category: "shop", dwellMin: 45, priority: 2, notes: "Bohemian secondhand-clothing and record shops." },
  { name: "Tetsugakudo Park", lat: 35.6997, lng: 139.6448, category: "park", dwellMin: 45, priority: 3, notes: "Quirky park with philosophy-themed statues and structures." },
  { name: "Suginami Animation Museum", lat: 35.7168, lng: 139.6382, category: "museum", dwellMin: 60, priority: 3, notes: "Free museum on the history of Japanese anime, in Ogikubo." },
  { name: "Kichijoji Sun Road", lat: 35.7033, lng: 139.5798, category: "shop", dwellMin: 30, priority: 3, notes: "Covered arcade linking Kichijoji station to nearby shops." },
  { name: "Arai Yakushi Baishoin Temple", lat: 35.7112, lng: 139.6467, category: "temple", dwellMin: 30, priority: 3, notes: "Neighborhood temple famous for spring plum blossoms." },

  // Meguro / Gotanda / Setagaya
  { name: "Meguro Sky Garden", lat: 35.6221, lng: 139.7161, category: "park", dwellMin: 30, priority: 3, notes: "Rooftop garden atop a highway junction; unusual urban green space." },
  { name: "Tokyo Metropolitan Teien Art Museum", lat: 35.6376, lng: 139.7211, category: "museum", dwellMin: 75, priority: 2, notes: "Former Art Deco imperial residence turned museum, near Meguro." },
  { name: "Meguro Parasitological Museum", lat: 35.6208, lng: 139.6996, category: "museum", dwellMin: 45, priority: 3, notes: "Quirky one-of-a-kind museum devoted entirely to parasites." },
  { name: "Institute for Nature Study", lat: 35.6355, lng: 139.7208, category: "park", dwellMin: 60, priority: 3, notes: "Protected forest reserve near Meguro Station." },
  { name: "Gotokuji Temple", lat: 35.6432, lng: 139.6497, category: "temple", dwellMin: 45, priority: 1, notes: "Birthplace legend of the maneki-neko lucky cat; hundreds of figurines." },
  { name: "Sangenjaya Shopping District", lat: 35.6437, lng: 139.6699, category: "shop", dwellMin: 45, priority: 2, notes: "Dense retro bar and shotengai neighborhood." },
  { name: "Setagaya Park", lat: 35.6296, lng: 139.6425, category: "park", dwellMin: 45, priority: 3, notes: "Includes a small transportation museum with retired trams." },
  { name: "Kuhonbutsu Temple", lat: 35.6183, lng: 139.6664, category: "temple", dwellMin: 30, priority: 3, notes: "Three halls each housing three Amida Buddha statues." },
  { name: "Meguro Gajoen", lat: 35.6303, lng: 139.7159, category: "viewpoint", dwellMin: 30, priority: 3, notes: "Ornate 1930s banquet hall famed for lavish interior murals." },
] as const;

export const tokyoGrandSample: MultiHotelSampleTripData = {
  name: "Tokyo Grand Tour",
  city: "Tokyo",
  days: TOKYO_GRAND_DAYS,
  hotels: tokyoGrandHotels,
  places: tokyoGrandPlaces,
};
