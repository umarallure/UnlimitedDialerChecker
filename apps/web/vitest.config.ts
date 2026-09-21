import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      /**
       * `server-only` exists to throw if a server module is pulled into a client bundle. Under
       * test there is no client bundle to protect, and the guard would otherwise make every
       * server-side module untestable — including the ones most worth testing.
       */
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
