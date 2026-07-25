import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Stamped into the bundle so the running build is identifiable on a phone
// (Data tab, bottom). Without it there's no way to tell whether a device has
// actually picked up a deploy or is still serving a cached older one.
const BUILD_ID = new Date()
  .toISOString()
  .slice(0, 16)
  .replace("T", " ");

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Brick Flow",
        short_name: "Brick Flow",
        description: "Construction expense ledger — offline-first",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#182B3A",
        background_color: "#F2F3EF",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache the app shell (including the pdf.js worker) but NOT the
        // /tesseract assets: those are ~14 MB of OCR cores, of which the
        // browser only ever loads the ONE matching its SIMD support. Precaching
        // all of them made every service-worker update download megabytes on a
        // phone, which is why new versions were slow to reach devices. They're
        // runtime-cached below instead, so they're still offline after one use.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2}"],
        globIgnores: ["**/tesseract/**"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/tesseract/"),
            handler: "CacheFirst",
            options: {
              cacheName: "tesseract-ocr",
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
