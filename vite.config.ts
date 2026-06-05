/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Pure static site: no server code, no env-baked secrets.
  base: "./",
  build: {
    outDir: "dist",
    target: "es2021",
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
