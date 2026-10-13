import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@db": path.resolve(templateRoot, "db"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    /* `src/**` is included so a pure module under `src/lib` can be unit-tested
     * directly (csv.ts is the first). Until this line the frontend had NO unit
     * tests at all — `npm test` exited 1 with "No test files found", so the
     * pure-function layer (format, csv, permissions) had no gate whatsoever.
     * Only pure modules belong here; anything touching the DOM needs its own
     * jsdom environment. */
    include: [
      "api/**/*.test.ts",
      "api/**/*.spec.ts",
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
    ],
    // The seed inserts 240 patients + hundreds of appointments/invoices on a
    // cold database; give the first test room to complete the bootstrap.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
