import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      // The real `server-only` package throws when imported outside a Next server
      // bundle; swap it for an empty module so server-only files can be unit-tested.
      "server-only": fileURLToPath(new URL("./test/stubs/empty.ts", import.meta.url)),
      "@": root,
    },
  },
});
