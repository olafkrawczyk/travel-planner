import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const r = (p: string) => resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      "@app/domain": r("packages/domain/src/index.ts"),
      "@app/geo": r("packages/geo/src/index.ts"),
      "@app/solver": r("packages/solver/src/index.ts"),
      "@app/storage": r("packages/storage/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "apps/web/src/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
  },
});
