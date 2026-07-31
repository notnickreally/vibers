import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The suite used to need no configuration at all: everything under test was a
 * pure module in `lib/`, imported by relative path. A route is not that — it
 * imports itself by the `@/` alias `tsconfig.json` declares, and vitest has no
 * reason to know about it. This file is that one line, and nothing else: no
 * environment, no setup, no globals, so the existing tests run exactly as they
 * did.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
