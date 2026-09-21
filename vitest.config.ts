import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: new URL("./tests/mocks/obsidian.ts", import.meta.url).pathname,
      // tsconfig の baseUrl（`import ... from "src/..."`）は Vite が読まないので、ここで同じ解決を与える。
      src: new URL("./src", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,mjs}"],
    coverage: {
      provider: "v8",
      include: [
        "src/**/*.ts",
        "scripts/validate-release.mjs",
        "scripts/version-bump.mjs",
        "scripts/preflight.mjs",
        "scripts/jev-accuracy.mjs",
      ],
      exclude: ["src/excalibrain-main.ts", "src/lang/locale/**"],
      reporter: ["text", "html"],
    },
  },
});
