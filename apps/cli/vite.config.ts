import { defineConfig } from "vite-plus"

export default defineConfig({
  pack: {
    // The binary is self-contained: the workspace packages are bundled in
    // rather than left as bare imports Node cannot resolve from source.
    noExternal: [/^@missingstudio\//],
  },
})
