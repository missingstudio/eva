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
import { buildOf, type Build } from "@missingstudio/eva-boot"
import type { Payload } from "@missingstudio/eva-schema"
import { scripted } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { BUILT_IN, main, OPTIONAL } from "./index.js"
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
  given: { build?: Build; stdin?: () => string | undefined } = {},
): Promise<{ code: number; out: string; err: string; outs: readonly string[] }> => {
  const out: string[] = []
  const err: string[] = []
  const world: World = {
    args,
    env: { EVA_CONFIG: join(directory, "user.yaml"), ...env },
    cwd: directory,
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    stdin: given.stdin ?? (() => undefined),
  }
  const code = await Effect.runPromise(main(world, given.build))
  return { code, out: out.join(""), err: err.join(""), outs: out }
}

const answer = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

// This build with its provider scripted: the same table, the same resolved
// ids, and no key. The scripted plugin answers under the anthropic id
// because that id is what the resolved list already carries.
const buildWith = (script: readonly string[]): Build =>
  buildOf([
    ...BUILT_IN.filter((plugin) => plugin.id !== "eva.provider.anthropic"),
    ...OPTIONAL,
    scripted(
      script.map((said) => ({ payloads: [answer(said)] })),
      "eva.provider.anthropic",
    ).plugin,
  ])

// The trace and the auth store under the scratch directory, so a booted run
// writes nothing into the person's own home directory.
const contained = (directory: string): string => `
plugins:
  - id: eva.trace.jsonl
    options:
      path: "${join(directory, "trace.jsonl")}"
  - id: eva.auth
    options:
      authStore: "${join(directory, "auth.json")}"
`

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

describe("eva run", () => {
  const declared = (directory: string): string => `${contained(directory)}
prompts:
  say:
    text: "Answer: {{input}}"
  next:
    text: "Continue from: {{prior}}"
workflows:
  one-step:
    name: One step
    steps:
      - id: only
        template: say
        with:
          input: input
  three-step:
    name: Three steps
    steps:
      - id: first
        template: say
        with:
          input: input
      - id: second
        template: next
        with:
          prior: first.output
      - id: third
        template: next
        with:
          prior: second.output
  no-template:
    name: Broken
    steps:
      - id: only
        template: nowhere
`

  it("runs the named row and the last Run's text reaches the output exactly once", async () => {
    const directory = scratch()
    write(directory, "user.yaml", declared(directory))

    const found = await ran(
      ["run", "one-step"],
      directory,
      {},
      {
        build: buildWith(["one answer"]),
      },
    )

    expect(found.code).toBe(0)
    expect(found.outs).toEqual(["one answer"])
  })

  // The filter assertion: every Step reports its answer as text, and the
  // surface prints the Run that closed last, nowhere the Runs before it.
  it("writes one answer for a three-Step Workflow, not three", async () => {
    const directory = scratch()
    write(directory, "user.yaml", declared(directory))

    const found = await ran(
      ["run", "three-step"],
      directory,
      {},
      {
        build: buildWith(["first said", "second said", "third said"]),
      },
    )

    expect(found.code).toBe(0)
    expect(found.outs).toEqual(["third said"])
  })

  it("prints a near miss over the row ids when nothing answers the name", async () => {
    const directory = scratch()
    write(directory, "user.yaml", declared(directory))

    const found = await ran(["run", "one-stpe"], directory)

    expect(found.code).toBe(1)
    expect(found.err).toContain("no harness answers one-stpe")
    expect(found.err).toContain("did you mean one-step?")
    expect(found.outs).toEqual([])
  })

  // A Gap has no Finding path, so the failed Claim's summary is where an
  // unfillable Workflow reaches a person.
  it("prints the failed Claim's summary on the error stream and exits 1", async () => {
    const directory = scratch()
    write(directory, "user.yaml", declared(directory))

    const found = await ran(
      ["run", "no-template"],
      directory,
      {},
      {
        build: buildWith([]),
      },
    )

    expect(found.code).toBe(1)
    expect(found.err).toContain("no Template is nowhere")
    expect(found.outs).toEqual([])
  })

  // A blocked --version is the failure the lazy stdin read exists to prevent.
  it("answers the version without reading standard input", async () => {
    const found = await ran(
      ["--version"],
      scratch(),
      {},
      {
        stdin: () => {
          throw new Error("standard input was read")
        },
      },
    )

    expect(found).toMatchObject({ code: 0, out: `${VERSION}\n` })
  })
})

/**
 * The roadmap's Stage 1 demo block, line by line, against a scratch fixture
 * and a scripted Provider. This is the one test that fails when the verb,
 * the routing, the filter or the Workflow is wrong — which no unit test
 * above covers together.
 */
describe("the Stage 1 demo block", () => {
  // git diff --staged | eva run commit-msg
  it("answers a piped diff with one commit message", async () => {
    const directory = scratch()
    write(
      directory,
      "user.yaml",
      `${contained(directory)}
prompts:
  commit:
    text: "Write one conventional commit message for this diff: {{input}}"
workflows:
  commit-msg:
    name: Commit message
    steps:
      - id: message
        template: commit
        with:
          input: input
`,
    )

    const found = await ran(
      ["run", "commit-msg"],
      directory,
      {},
      {
        build: buildWith(["feat(auth): add the login gate"]),
        stdin: () => "diff --git a/login.ts b/login.ts\n+export const login = () => {}\n",
      },
    )

    expect(found.code).toBe(0)
    expect(found.outs).toEqual(["feat(auth): add the login gate"])
  })

  // eva run review src/auth/login.ts
  it("reads the positional file and answers structured findings", async () => {
    const directory = scratch()
    const finding = { file: "src/auth/login.ts", line: 1, severity: "info", claim: "looks fine" }
    write(directory, join("src", "auth", "login.ts"), "export const login = () => {}\n")
    write(
      directory,
      "user.yaml",
      `${contained(directory)}
prompts:
  review:
    text: "Review this file and answer findings as JSON: {{input}}"
workflows:
  review:
    name: Review
    steps:
      - id: findings
        template: review
        with:
          input: input
        schema:
          type: array
          items:
            type: object
            required: [file, line, severity, claim]
            properties:
              file: { type: string }
              line: { type: number }
              severity: { type: string }
              claim: { type: string }
`,
    )

    const found = await ran(
      ["run", "review", join("src", "auth", "login.ts")],
      directory,
      {},
      {
        build: buildWith([JSON.stringify([finding])]),
      },
    )

    expect(found.code).toBe(0)
    expect(JSON.parse(found.out)).toEqual([finding])
  })

  // eva run release-notes.yaml --input CHANGELOG.md
  it("runs the .eva workflow by its file name, over the --input file", async () => {
    const directory = scratch()
    write(
      directory,
      "user.yaml",
      `${contained(directory)}
prompts:
  summarize:
    text: "Summarize this changelog: {{input}}"
  notes:
    text: "Write release notes from: {{draft}}"
`,
    )
    write(
      directory,
      join(".eva", "workflows", "release-notes.yaml"),
      `name: Release notes
steps:
  - id: summarize
    template: summarize
    with:
      input: input
  - id: notes
    template: notes
    with:
      draft: summarize.output
`,
    )
    write(directory, "CHANGELOG.md", "## Unreleased\n- the login gate\n")
    await ran(["trust"], directory)

    const found = await ran(
      ["run", "release-notes.yaml", "--input", "CHANGELOG.md"],
      directory,
      {},
      {
        build: buildWith(["- the login gate landed", "## v1.0\n- the login gate landed"]),
      },
    )

    expect(found.code).toBe(0)
    expect(found.outs).toEqual(["## v1.0\n- the login gate landed"])
  })
})
