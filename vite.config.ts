import { defineConfig } from "vite-plus"

export default defineConfig({
  run: {
    cache: { tasks: true, scripts: true },
  },

  pack: {
    dts: true,
    format: ["esm"],
    sourcemap: true,
  },

  test: {
    silent: "passed-only",
    passWithNoTests: true,
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts", "apps/**/src/**/*.ts"],
      exclude: ["**/index.ts"],
    },
  },

  lint: {
    ignorePatterns: ["dist/**", "coverage/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  fmt: {
    semi: false,
  },

  staged: {
    "*.{ts,tsx,js,json}": "vp check --fix",
  },
})
