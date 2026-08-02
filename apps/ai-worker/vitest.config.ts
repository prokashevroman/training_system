import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    // Tests call the fetch handler directly with a fake env, so they need no
    // workerd, no wrangler and no network. AI_PROVIDER defaults to `mock`.
    environment: "node",
  },
});
