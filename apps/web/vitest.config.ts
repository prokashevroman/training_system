import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts on purpose: vitest 2 bundles vite 5 while
// the app builds on vite 6, and mixing the two plugin type worlds in one file
// makes tsc reject the config. The app under test needs no Vite plugins.
export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
