import { defineConfig } from "vitest/config";
import path from "path";
import { promises as fs } from "node:fs";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/__tests__/**/*.test.ts"],
    testTimeout: 15_000,
  },
  resolve: {
    alias: [
      { find: "@workspace/db/schema", replacement: path.resolve(__dirname, "../../lib/db/src/schema/index.ts") },
      { find: "@workspace/db", replacement: path.resolve(__dirname, "../../lib/db/src/index.ts") },
    ],
  },
  plugins: [
    {
      name: "load-prompt-as-text",
      enforce: "pre",
      async load(id) {
        const cleanId = id.split("?")[0];
        if (cleanId.endsWith(".prompt")) {
          const source = await fs.readFile(cleanId, "utf8");
          return `export default ${JSON.stringify(source)};`;
        }
        return null;
      },
    },
  ],
});
