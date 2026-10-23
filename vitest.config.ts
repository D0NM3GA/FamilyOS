import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "node:path";

// Vitest doesn't load .env into process.env by default (unlike Next's dev/build) — needed
// so lib/crypto.ts's module-level INTEGRATION_ENCRYPTION_KEY check passes under `npm test`.
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Next resolves `import "server-only"` itself (no package); tests run on the server side.
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    // Phase 49: one zone with daylight saving for every run, whatever the machine's (or .env's),
    // so date tests mean the same everywhere. The app's own zone follows the household's.
    env: { ...loadEnv(mode, process.cwd(), ""), TZ: "America/New_York" },
  },
}));
