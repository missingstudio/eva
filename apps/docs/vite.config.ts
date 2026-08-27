import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"
// A path into the ui package rather than its name. Vite loads this config
// through Node, which resolves a bare specifier without the bundler's
// `.js`-means-`.ts` rule and fails on the package's own internal imports.
import { docSlugs } from "../../packages/machine/src/site.js"
// `twins.ts` imports nothing, which is what lets the build read it: Vite loads
// this config through Node, and a bare package specifier anywhere in the
// import graph fails on the package's own internal imports.
import { emittedFor, rawPath } from "./src/lib/twins.js"

const emitted = emittedFor(docSlugs)

/**
 * `/install.md` in development.
 *
 * Production serves the twins as files the build wrote. There is no route at
 * `.md`, so without this the same URL that works on the deployed site 404s on
 * a developer's machine — and a divergence between the two is how a broken
 * link ships.
 */
const markdownTwins = (): Plugin => ({
  name: "eva-markdown-twins",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, _response, next) => {
      const url = request.url ?? ""
      if (!url.endsWith(".md")) return next()

      const slug = url === "/index.md" ? "" : url.slice(1, -".md".length)
      request.url = rawPath(slug)
      next()
    })
  },
})

export default defineConfig({
  // Favicons, the manifest, and the logos are vendored once in the ui
  // package. Both sites serve that one directory rather than keeping a copy.
  publicDir: fileURLToPath(new URL("../../packages/ui/public", import.meta.url)),
  plugins: [
    fumadocsMdx(),
    tanstackStart({
      // Static HTML at the edge. Most AI crawlers do not run JavaScript, so a
      // page assembled in the browser is a page they cannot read.
      prerender: { enabled: true, crawlLinks: true, failOnError: true },
      pages: emitted,
    }),
    viteReact(),
    tailwindcss(),
    markdownTwins(),
  ],
  server: { port: 3001 },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
