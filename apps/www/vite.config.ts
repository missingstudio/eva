import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig, type Plugin } from "vite"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))

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
