import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node", globals: true },
  resolve: {
    alias: {
      // Mock-Alias gehoert in vitest, NIE in tsconfig.json (PROF-OBS-08):
      // ein Mock-Alias im Produktions-tsconfig erzeugt eine no-unsafe-*-Kaskade im Store-Review.
      obsidian: fileURLToPath(new URL("./tests/__mocks__/obsidian.ts", import.meta.url)),
    },
  },
});
