import { readFileSync } from "node:fs"
import { defineConfig } from "vite-plus"

// The manifest sits one directory above both src/ and dist/, and a page
// served as static assets has no manifest to read — so the build injects the
// version, the way the release build injects it into the binary.
const version = (): string => {
  const source = readFileSync(new URL("package.json", import.meta.url), "utf8")
  const parsed: unknown = JSON.parse(source)
  const found = (parsed as Record<string, unknown>)["version"]
  return typeof found === "string" ? found : "0.0.0"
}

export default defineConfig({
  define: {
    EVA_WEB_VERSION: JSON.stringify(version()),
    /**
     * Every private package in this repository sits at `0.0.0`, so the
     * version alone cannot tell two builds of this page apart. The stamp is
     * what answers "is this the page I just built", which is the question
     * `eva.web` serving an artifact it did not build makes worth asking.
     */
    EVA_WEB_BUILT_AT: JSON.stringify(new Date().toISOString().slice(0, 19)),
  },
})
