import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next preserves JSX for its own compiler; component regression tests need
  // the same React automatic runtime when running directly under Vite.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
  },
});
