import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// PORT and BASE_PATH are required at runtime (dev / preview server) but not
// during a production `vite build` — the build emits static assets only and
// the deploy pipeline runs `vite build` without setting these. Falling back
// to safe defaults keeps the build green; the dev/preview workflows still
// receive the real values from the artifact runner.
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,

  // ── Phase 3: Drop all console.* calls and debugger statements in production ─
  esbuild: process.env.NODE_ENV === "production"
    ? { drop: ["console", "debugger"] }
    : {},

  plugins: [
    react(),
    tailwindcss(),
    // PERF-02: NOTE on `splitVendorChunkPlugin`. Vite removed that plugin in
    // v5 and it is no longer exported in v7 (this project's version). Its
    // entire job — bucket every `node_modules` import into a separate vendor
    // chunk so app-code edits don't bust vendor caches — is now performed by
    // the `manualChunks` function in `build.rollupOptions.output` below: the
    // named rules (vendor-recharts, vendor-radix, …) handle the heavy libs,
    // and the catch-all `return "vendor"` at the end of that function covers
    // everything else, exactly as `splitVendorChunkPlugin` used to.
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Only split out recharts/d3 — they're heavy (~400 kB) and almost
          // never change, so a separate chunk is a real cache win.
          //
          // Everything else (React, Radix, Framer Motion, Lucide, TanStack,
          // Wouter, …) goes into ONE `vendor` chunk. Splitting React-consuming
          // libs into separate chunks repeatedly broke production with
          // "Cannot read properties of undefined (reading 'forwardRef' /
          // 'Children' / …)" because Rollup's cross-chunk init order does
          // not guarantee React evaluates first when a sibling chunk imports
          // it via `import * as React from 'react'`. A single vendor chunk
          // makes the init order intra-chunk and removes the entire bug
          // class. The size cost is negligible vs the reliability win.
          if (id.includes("/recharts/") || id.includes("/d3-")) {
            return "vendor-recharts";
          }
          return "vendor";
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
