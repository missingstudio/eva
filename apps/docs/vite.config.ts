import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import tailwindcss from "@tailwindcss/vite"
import viteReact from "@vitejs/plugin-react"
import { fumadocsMdx } from "fumadocs-mdx/vite"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

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
    }),
    viteReact(),
    tailwindcss(),
  ],
  server: { port: 3001 },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
})
