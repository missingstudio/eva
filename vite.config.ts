import { defineConfig } from "vite-plus"
import type { OxlintOverride } from "vite-plus/lint"

// The layer rule: each layer may import only the layers
// below it. A pattern group starting with "!" exempts that package.
const internal = "@missingstudio/*"
const layer = (files: string[], allowed: string[], message: string): OxlintOverride => ({
  files,
  rules: {
    "no-restricted-imports": [
      "error",
      { patterns: [{ group: [internal, ...allowed.map((p) => `!${p}`)], message }] },
    ],
  },
})

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
    include: [
      "apps/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
      "plugins/*/src/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["apps/**/src/**/*.ts", "packages/**/src/**/*.ts", "plugins/**/src/**/*.ts"],
      exclude: ["**/index.ts", "**/*.test.ts", "**/*.test.tsx"],
    },
  },

  lint: {
    // The exit-test fixture inputs are vendored data the measurement reads,
    // not code in the tree — one of them is a source file with deliberate
    // smells for a review Workflow to find.
    ignorePatterns: ["dist/**", "coverage/**", "packages/exit-test/fixture/inputs/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Bun", message: "Nothing may use the Bun global. Use node: APIs." },
      ],
    },
    overrides: [
      layer(["packages/schema/**"], [], "schema imports nothing internal"),
      layer(["packages/acp/**"], ["@missingstudio/eva-schema"], "acp imports schema only"),
      layer(
        ["packages/core/**"],
        ["@missingstudio/eva-schema", "@missingstudio/eva-acp"],
        "core imports schema and acp only",
      ),
      layer(
        ["packages/kernel/**", "packages/sdk/**"],
        ["@missingstudio/eva-schema", "@missingstudio/eva-core"],
        "kernel and sdk import schema and core only",
      ),
      layer(
        ["packages/tui-core/**"],
        ["@missingstudio/eva-schema"],
        "tui-core imports schema only",
      ),
      // The kernel and the sdk are siblings, and boot is where they meet:
      // it assembles the extension points the kernel runs and the sdk
      // declares. It knows no plugin, so every app can call it.
      layer(
        ["packages/boot/**"],
        [
          "@missingstudio/eva-schema",
          "@missingstudio/eva-core",
          "@missingstudio/eva-kernel",
          "@missingstudio/eva-sdk",
        ],
        "boot imports the kernel, the sdk, and the contracts below them",
      ),
      // The testkit boots the plugins under test so their `effect` bodies can
      // be tested. It sits above boot and is a devDependency everywhere it is
      // used, so nothing it reaches ends up in a shipped plugin.
      layer(
        ["packages/testkit/**"],
        [
          "@missingstudio/eva-schema",
          "@missingstudio/eva-core",
          "@missingstudio/eva-kernel",
          "@missingstudio/eva-sdk",
          "@missingstudio/eva-boot",
        ],
        "the testkit imports boot and the contracts below it",
      ),
      // packages/conformance has no import rule on purpose, and only
      // packages/exit-test, which is the same test-only shape, shares
      // that. Holding two adapters to one
      // contract is the job that needs several plugins at once: a plugin may
      // not import another plugin, and the testkit may not import one at all,
      // so before this package the only place a TraceSink suite could run was
      // an app — which is how apps/cli came to own 482 lines of tests that
      // were never about the command line. It ships nothing: no `pack`
      // script, no exports, test files only.
      // tui-core is a contract package like core and sdk, so a surface
      // plugin may draw through it. The rule that holds is contracts yes,
      // implementations no: no plugin imports another plugin or the kernel.
      layer(
        ["plugins/**"],
        [
          "@missingstudio/eva-schema",
          "@missingstudio/eva-core",
          "@missingstudio/eva-sdk",
          "@missingstudio/eva-tui-core",
        ],
        "a plugin imports the contract packages only — never the kernel, never another plugin",
      ),
      // A plugin's own tests may boot it. The rule above governs what ships;
      // this is test files only, and it is how an `effect` body gets a test
      // at all — without it the half of a plugin that touches domains, slots,
      // and hooks is reachable only from the composition root's tests.
      layer(
        ["plugins/**/*.test.ts"],
        [
          "@missingstudio/eva-schema",
          "@missingstudio/eva-core",
          "@missingstudio/eva-sdk",
          "@missingstudio/eva-tui-core",
          "@missingstudio/eva-testkit",
        ],
        "a plugin test may also import the testkit — still never the kernel or another plugin",
      ),
      // The terminal draws the contracts and knows nothing else about Eva.
      // It is the only package that may name OpenTUI, and the plugin layer
      // above has no import for it, so a surface can never pull FFI in.
      layer(
        ["packages/tui/**"],
        ["@missingstudio/eva-tui-core"],
        "the terminal imports tui-core only",
      ),
      // apps/* has no import rule on purpose: an app is the composition
      // root, and composing is the one job that needs every layer at once.
    ],
  },

  fmt: {
    semi: false,
  },

  staged: {
    "*.{ts,tsx,js,json}": "vp check --fix",
  },
})
