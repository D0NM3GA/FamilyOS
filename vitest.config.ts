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
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
