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
  build: { target: "es2022" },
});
