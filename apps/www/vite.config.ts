import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"
// A path into the ui package rather than its name. Vite loads this config
// through Node, which resolves a bare specifier without the bundler's
// `.js`-means-`.ts` rule and fails on the package's own internal imports. The
// application still imports `@missingstudio/ui` by name; only the build config
// reaches past it, and only for the one list below.
import { capabilities } from "../../packages/ui/src/agents.js"
import { machinePathsFor, notFoundPath } from "./src/lib/pages.js"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

/**
 * What the build renders to a file, beyond the pages it finds on its own.
 *
 * Prerender discovers a route by looking for a `component`, so it finds every
 * page and none of the machine-readable files: those routes answer with text,
 * and a route with no component is invisible to the crawl. Naming them here is
 * what puts them in the deployed output. Before this list they existed in the
 * route tree, worked in `vite dev`, and 404ed in production.
 *
 * A response whose content type is not HTML is written at its own path, so
 * `/robots.txt` becomes `robots.txt` rather than `robots.txt/index.html`.
 *
 * The 404 body is the exception that needs an explicit output path: static
 * hosting looks for the file named `404.html`, and the default would file a
 * page at `404/index.html`.
 */
const emitted = [
  ...machinePathsFor(capabilities.map((capability) => capability.name)).map((path) => ({ path })),
  { path: "/404", prerender: { outputPath: notFoundPath } },
]

/**
 * `scripts/install.sh` has one copy, in the repository. This serves that copy
 * at /install.sh rather than committing a second one under public/.
 */
const installScript = (): Plugin => ({
  name: "eva-install-script",
  generateBundle() {
    if (this.environment.name !== "client") return

    this.emitFile({
      type: "asset",
      fileName: "install.sh",
      source: readFileSync(`${repoRoot}scripts/install.sh`, "utf8"),
    })
  },
})

export default defineConfig({
  // Favicons, the manifest, and the logos are vendored once in the ui
  // package. Both sites serve that one directory rather than keeping a copy.
  publicDir: fileURLToPath(new URL("../../packages/ui/public", import.meta.url)),
  plugins: [
    tanstackStart({
      // Static HTML at the edge. Most AI crawlers do not run JavaScript, so a
      // page assembled in the browser is a page they cannot read.
      prerender: { enabled: true, crawlLinks: true, failOnError: true },
      pages: emitted,
    }),
    viteReact(),
    tailwindcss(),
    installScript(),
  ],
  server: { port: 3000 },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
