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
      "apps/*/src/**/*.test.tsx",
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
      "plugins/*/src/**/*.test.ts",
      // `scripts/` is not a workspace package, so the patterns above miss it.
      // skills.test.ts sat here unrun for as long as it existed.
      "scripts/**/*.test.ts",
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
    ignorePatterns: [
      "dist/**",
      "coverage/**",
      "apps/*/.output/**",
      "apps/*/.tanstack/**",
      "apps/*/src/routeTree.gen.ts",
      "packages/exit-test/fixture/inputs/**",
    ],
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
        ["packages/kernel/**"],
        ["@missingstudio/eva-schema", "@missingstudio/eva-core"],
        "the kernel imports schema and core only",
      ),
      // The sdk names the client runtime in one signature: a surface row is
      // started with the handle a surface holds. The runtime imports schema
      // and core alone, so the dependency points down.
      layer(
        ["packages/sdk/**"],
        [
          "@missingstudio/eva-schema",
          "@missingstudio/eva-core",
          "@missingstudio/eva-client-runtime",
        ],
        "the sdk imports schema, core, and the client runtime only",
      ),
      layer(
        ["packages/tui-core/**"],
        ["@missingstudio/eva-schema"],
        "tui-core imports schema only",
      ),
      // Every non-visual client concern, so a terminal, a web page, and a
      // phone differ only in platform and pixels. It holds what the server
      // needs to hear about, and no pixels: no renderer import, ever.
      layer(
        ["packages/client-runtime/**"],
        ["@missingstudio/eva-schema", "@missingstudio/eva-core"],
        "the client runtime imports schema and core only",
      ),
      // The one fold that decides what a Run did. It reads the record and
      // nothing that draws: a fold that named a renderer would be a fold
      // with a favourite surface.
      layer(
        ["packages/session-view/**"],
        ["@missingstudio/eva-schema", "@missingstudio/eva-core"],
        "the session view imports schema and core only — never a renderer",
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
          "@missingstudio/eva-client-runtime",
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
          "@missingstudio/eva-client-runtime",
          "@missingstudio/eva-tui-core",
          "@missingstudio/eva-testkit",
        ],
        "a plugin test may also import the testkit — still never the kernel or another plugin",
      ),
      // The terminal draws the contracts and knows nothing else about Eva.
      // It is the only package that may name OpenTUI, and the plugin layer
      // above has no import for it, so a surface can never pull FFI in.
      // It names the session view because that is where the one fold over
      // the record lives; a terminal with a fold of its own would be a
      // second answer to what a Run did.
      layer(
        ["packages/tui/**"],
        ["@missingstudio/eva-tui-core", "@missingstudio/eva-session-view"],
        "the terminal imports tui-core and the session view only",
      ),
      // apps/cli has no import rule on purpose: an app is the composition
      // root, and composing is the one job that needs every layer at once.
      // The other three apps are the exception. They compose nothing, and they
      // must never pull the kernel or boot into a browser bundle, so each
      // reaches the packages its own surface needs and no other. The sites'
      // generated reference arrives as MDX.
      layer(
        ["packages/ui/**"],
        ["@missingstudio/ui"],
        "ui imports nothing internal — its own subpaths only",
      ),
      // machine holds what both sites are built from: the origins, the
      // vocabulary, the documents an agent reads, and the content types a
      // route answers with. It imports nothing, which is what lets a build
      // config read it through Node.
      layer(
        ["packages/machine/**"],
        ["@missingstudio/machine"],
        "machine imports nothing internal — its own subpaths only",
      ),
      layer(
        ["apps/www/**", "apps/docs/**"],
        ["@missingstudio/ui", "@missingstudio/machine"],
        "a site imports ui and machine only — reference arrives as MDX",
      ),
      // The page is a client, not a composition root. It draws the contracts,
      // holds the client runtime's handle, folds the record through the
      // session view, and reaches the server through the client half of the
      // two plugins that serve it. The kernel, boot, and a plugin's server
      // half stay out of the browser bundle.
      layer(
        ["apps/web/**"],
        [
          "@missingstudio/eva-schema",
          "@missingstudio/eva-core",
          "@missingstudio/eva-sdk",
          "@missingstudio/eva-client-runtime",
          "@missingstudio/eva-session-view",
          "@missingstudio/eva-api/client",
          "@missingstudio/ui",
        ],
        "the web app imports the contracts, the client runtime, the session view, the wire's client half, and ui",
      ),
      {
        files: ["apps/web/**", "apps/www/**", "apps/docs/**"],
        plugins: ["typescript", "react"],
      },
    ],
  },

  fmt: {
    semi: false,
    // The route trees are TanStack's own output, committed because the router
    // reads them at runtime. Their header asks the formatter to leave them
    // alone, and the lint step above already does.
    ignorePatterns: ["apps/*/src/routeTree.gen.ts"],
  },

  staged: {
    "*.{ts,tsx,js,json}": "vp check --fix",
    /*
      `vercel.json` is generated from the sites' own lists, and Vercel reads it
      before it runs the build — so it cannot be a build output and has to be
      committed.

      This refuses the commit rather than fixing it. `vp staged` runs a task
      against a temporary index and discards what the task stages, so a
      `git add` from in here does not survive: the file would be rewritten on
      disk, left unstaged, and the commit would carry the stale one anyway.
      Refusing is the honest half — it says the same thing the suite says, a
      minute earlier.
    */
    "{apps/www/src/lib/pages.ts,apps/docs/src/lib/twins.ts,packages/machine/src/site.ts,packages/machine/src/serve.ts,scripts/vercel-config.ts}":
      "bun scripts/vercel-config.ts --check",
  },
})
