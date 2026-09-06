import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Offline scope: app shell + trip data (IndexedDB lives outside the SW).
      // Map tiles are network-first and never pre-cached.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            // Vector tiles: cache-first with a cap, but never precached.
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 512, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
        ],
      },
      manifest: {
        name: "Travel Planner",
        short_name: "Trips",
        description: "Day-by-day trip planner with an itinerary solver",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#2563eb",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          // NOTE: reuses the existing 512 icon; it does not have the ~40%
          // safe-zone padding a true maskable icon needs, so some OS masks
          // may crop it. Replace with a purpose-built asset when available.
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@app/domain": r("../../packages/domain/src/index.ts"),
      "@app/geo": r("../../packages/geo/src/index.ts"),
      "@app/solver": r("../../packages/solver/src/index.ts"),
      "@app/storage": r("../../packages/storage/src/index.ts"),
    },
  },
  worker: { format: "es" },
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // Vendor splitting: two dependencies — maplibre-gl and the
        // `opening_hours` parser (pulled in transitively via @app/geo) —
        // account for nearly all of the pre-split ~1.9 MB main chunk
        // (~800 kB and ~630 kB respectively). Both are still static imports
        // in files this agent does not own (MapView.tsx and
        // packages/geo/src/openingHours.ts), so splitting cannot defer
        // *when* they load, only how they're packaged. Isolating them —
        // plus the remaining node_modules deps in one smaller "vendor"
        // chunk — shrinks the actual app-code entry chunk from ~1.9 MB to
        // ~130 kB, and means a plain app-code release no longer busts the
        // browser's/PWA's cache of these large, rarely-changing chunks.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("maplibre-gl")) return "maplibre";
          if (id.includes("/node_modules/opening_hours/")) return "opening-hours";
          return "vendor";
        },
      },
    },
  },
});
