import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Test runner config. Tests are plain Node (no browser) and live next to the
 * code they cover as `*.test.ts`. The `@/` alias mirrors tsconfig so tests
 * import modules exactly the way the app does.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Let tests import server-only modules (e.g. the BOQ parser) without the
      // RSC guard throwing under plain Node.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
