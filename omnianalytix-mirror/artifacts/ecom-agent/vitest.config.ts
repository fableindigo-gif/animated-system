import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: [
      "src/__tests__/**/*.test.{ts,tsx}",
      "src/pages/__tests__/**/*.test.{ts,tsx}",
    ],
    testTimeout: 10_000,
    setupFiles: ["./src/__tests__/setup.ts"],
    environmentMatchGlobs: [
      ["src/__tests__/writeback-view.test.tsx", "happy-dom"],
      ["src/pages/__tests__/**", "happy-dom"],
    ],
  },
  resolve: {
    alias: {
      "@":                     path.resolve(__dirname, "src"),
      "@/lib/rbac-utils":      path.resolve(__dirname, "src/lib/rbac-utils.ts"),
      "@/lib/dashboard-utils": path.resolve(__dirname, "src/lib/dashboard-utils.ts"),
      "@assets":               path.resolve(__dirname, "..", "..", "attached_assets"),
    },
  },
});
