import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { main } from "./index.js"
import { VERSION } from "./version.js"
import type { World } from "./world.js"

// The real spelling, because a grant records the real spelling and the
// system temporary directory is a symlink on more than one platform.
const scratch = () => realpathSync.native(mkdtempSync(join(tmpdir(), "eva-main-")))

const write = (directory: string, name: string, source: string): string => {
  const path = join(directory, name)
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, source)
  return path
}

/**
 * One run of the composition root against a scratch directory. The World is
 * the whole of what it reads from outside itself, so nothing here touches
 * the person's own home directory.
 */
const ran = async (
  args: readonly string[],
  directory: string,
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; out: string; err: string }> => {
  const out: string[] = []
  const err: string[] = []
  const world: World = {
    args,
    env: { EVA_CONFIG: join(directory, "user.yaml"), ...env },
    cwd: directory,
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
  }
  const code = await Effect.runPromise(main(world))
  return { code, out: out.join(""), err: err.join("") }
}

describe("what answers before anything loads", () => {
  it("prints the version and exits 0", async () => {
    const found = await ran(["--version"], scratch())
    expect(found).toMatchObject({ code: 0, out: `${VERSION}\n` })
  })

  it("prints the help and exits 0", async () => {
    const found = await ran(["--help"], scratch())
    expect(found.code).toBe(0)
    expect(found.out).toContain("config")
  })

  // The parse failed, so nothing resolved and nothing booted.
  it("exits 1 on a flag nothing declares", async () => {
    const found = await ran(["--telemetry"], scratch())
    expect(found.code).toBe(1)
    expect(found.err).toContain("--telemetry")
  })
})

describe("the trust grant", () => {
  it("records the directory beside the person's own config", async () => {
    const directory = scratch()
    const found = await ran(["trust"], directory)

    expect(found.code).toBe(0)
    expect(found.out).toContain(`${directory} is trusted`)
    expect(readFileSync(join(directory, "trusted"), "utf8")).toContain(directory)
  })

  it("drops the grant again", async () => {
    const directory = scratch()
    await ran(["trust"], directory)
    const found = await ran(["untrust"], directory)

    expect(found.out).toContain("is no longer trusted")
    expect(readFileSync(join(directory, "trusted"), "utf8").trim()).toBe("")
  })

  it("says nothing was written when there was no grant to drop", async () => {
    const directory = scratch()
    const found = await ran(["untrust"], directory)

    expect(found.out).toContain("is no longer trusted")
    expect(existsSync(join(directory, "trusted"))).toBe(false)
  })
})

describe("config show", () => {
  it("prints the model and the file each key came from", async () => {
    const directory = scratch()
    const path = write(directory, "user.yaml", "model: anthropic/one\ntheme: dusk\n")

    const found = await ran(["config", "show"], directory)
    expect(found.code).toBe(0)
    expect(found.out).toContain("model      anthropic/one")
    expect(found.out).toContain(`theme`)
    expect(found.out).toContain(path)
  })

  // The reason a flag is a layer: the file it overrode used to be the name
  // printed against the key.
  it("names the command line, not the file, when a flag set the model", async () => {
    const directory = scratch()
    const path = write(directory, "user.yaml", "model: anthropic/one\n")

    const found = await ran(["config", "show", "--model", "anthropic/two"], directory)
    expect(found.out).toContain("model      anthropic/two")
    expect(found.out).toContain("the command line")
    expect(found.out).not.toContain(path)
  })

  it("answers even when the config names a plugin nobody has", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "plugins:\n  - acme.nobody\n")

    const found = await ran(["config", "show"], directory)
    expect(found.code).toBe(0)
    expect(found.out).toContain("acme.nobody")
  })

  /**
   * It resolves, so it is listed — and it cannot load, so it is reported. A
   * plugin that never loaded is otherwise indistinguishable from one that
   * loaded and did nothing.
   */
  it("says a plugin it resolved is not in this build, and names the file", async () => {
    const directory = scratch()
    const path = write(directory, "user.yaml", "plugins:\n  - acme.nobody\n")

    const found = await ran(["config", "show"], directory)
    expect(found.err).toContain('no plugin named "acme.nobody" is in this build')
    expect(found.err).toContain(path)
  })

  it("says nothing about the plugins it does carry", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "plugins:\n  - eva.tui\n")

    const found = await ran(["config", "show"], directory)
    expect(found.err).not.toContain("is in this build")
  })

  it("says which project file it did not read, and how to allow it", async () => {
    const directory = scratch()
    const path = write(directory, ".eva/config.yaml", "model: anthropic/project\n")

    const found = await ran(["config", "show"], directory)
    expect(found.err).toContain(`not reading ${path}`)
    expect(found.err).toContain("eva trust")
    expect(found.out).toContain("not trusted")
  })

  it("reads the project file once the grant is there", async () => {
    const directory = scratch()
    write(directory, ".eva/config.yaml", "model: anthropic/project\n")
    await ran(["trust"], directory)

    const found = await ran(["config", "show"], directory)
    expect(found.err).toBe("")
    expect(found.out).toContain("model      anthropic/project")
  })

  it("names a key nothing reads against the file that set it", async () => {
    const directory = scratch()
    const path = write(directory, "user.yaml", "telemetry: true\n")

    const found = await ran(["config", "show"], directory)
    expect(found.err).toContain(`nothing reads "telemetry"`)
    expect(found.err).toContain(path)
  })

  // `theme` is the TUI surface's key, not this plugin's. Which keys reach
  // something is decided by the plugins that would load, so dropping the
  // one that reads a key makes that key reach nothing.
  it("says nothing about a key the loaded plugins declare", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "theme: dusk\n")

    expect((await ran(["config", "show"], directory)).err).toBe("")
  })

  it("names that same key once the plugin that reads it is dropped", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "theme: dusk\n")

    const found = await ran(["config", "show", "--without-plugin", "eva.tui"], directory)
    expect(found.err).toContain(`nothing reads "theme"`)
  })

  it("names a key written in a shape nothing reads, with the key it meant", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "themes: dusk\n")

    const found = await ran(["config", "show"], directory)
    expect(found.err).toContain(`"themes" wants a mapping`)
    expect(found.err).toContain(`did you mean "theme"`)
  })

  /**
   * A plugin's own options used to escape the sweep entirely: only the top
   * level was ever swept, so `maxTokns:` under a plugin entry fell back to
   * the default in silence while the same mistake one level up was named.
   */
  it("names an option a plugin's entry carries that the plugin does not take", async () => {
    const directory = scratch()
    const path = write(
      directory,
      "user.yaml",
      "plugins:\n  - id: eva.provider.anthropic\n    options:\n      maxTokns: 100\n",
    )

    const found = await ran(["config", "show"], directory)
    expect(found.err).toContain(`nothing reads "maxTokns" in eva.provider.anthropic's options`)
    expect(found.err).toContain(`did you mean "maxTokens"`)
    expect(found.err).toContain(path)
  })

  it("names a plugin option written in a shape the plugin cannot read", async () => {
    const directory = scratch()
    write(
      directory,
      "user.yaml",
      "plugins:\n  - id: eva.provider.anthropic\n    options:\n      maxTokens: many\n",
    )

    const found = await ran(["config", "show"], directory)
    expect(found.err).toContain(`"maxTokens" in eva.provider.anthropic's options wants a number`)
  })

  it("says nothing about an option the plugin declares it takes", async () => {
    const directory = scratch()
    write(
      directory,
      "user.yaml",
      "plugins:\n  - id: eva.provider.anthropic\n    options:\n      maxTokens: 100\n",
    )

    expect((await ran(["config", "show"], directory)).err).toBe("")
  })

  it("reads the config the environment carries", async () => {
    const directory = scratch()
    const found = await ran(["config", "show"], directory, {
      EVA_CONFIG_CONTENT: "model: anthropic/inline\n",
    })

    expect(found.out).toContain("model      anthropic/inline")
    expect(found.out).toContain("EVA_CONFIG_CONTENT")
  })
})
