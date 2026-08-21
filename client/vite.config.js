import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "icon-512-maskable.png", "offline.html"],
      manifest: {
        name: "NearHandsAT",
        short_name: "NearHandsAT",
        description:
          "Find trusted, local professionals for any job — or get discovered by clients looking for exactly what you do.",
        theme_color: "#1E2A45",
        background_color: "#F1EFE7",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/offline.html",
        // Never let the app-shell fallback intercept API calls.
        navigateFallbackDenylist: [/^\/api\//],
        // The country-state-city dataset (see manualChunks below) is several MB --
        // it must never be precached/eagerly downloaded by the service worker, or
        // the whole point of lazy-loading it inside LocationPicker is defeated.
        // It's still servable normally the moment its dynamic import() runs.
        globIgnores: ["**/country-state-city-*.js"],
        runtimeCaching: [
          {
            // Personal/time-sensitive data (leads, messages, search, dashboards, auth) --
            // must always hit the network, never serve a stale cached response. Explicit
            // NetworkOnly rather than relying on generateSW's default of simply not
            // precaching these (belt-and-suspenders, per explicit verification requirement).
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Give country-state-city a stable, matchable chunk name so the
        // workbox globIgnores pattern above can reliably exclude it.
        manualChunks(id) {
          if (id.includes("country-state-city")) return "country-state-city";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4000", ws: true },
    },
  },
});
