import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Installable from the phone home screen, and the shell keeps working
      // offline so History and manual entry survive a dropped connection.
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Training log",
        short_name: "Training",
        description: "Voice-first personal training log",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Supabase responses are never precached: training data must not go
        // stale behind a service worker.
        navigateFallbackDenylist: [/^\/rest\//, /^\/auth\//],
      },
    }),
  ],
  server: { port: 5173 },
});
