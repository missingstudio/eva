import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { connect, createServer, type AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildOf, type Build } from "@missingstudio/eva-boot"
import type { Payload } from "@missingstudio/eva-schema"
import { errorWords } from "@missingstudio/eva-session-view"
import { define } from "@missingstudio/eva-sdk"
import { scripted } from "@missingstudio/eva-testkit"
import { Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { BUILT_IN, main, OPTIONAL, PREFIX } from "./index.js"
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

/**
 * A port nothing holds, taken from the kernel and given straight back, and
 * whether anything came to hold it. A refused bind opens nothing, and a raw
 * connect is how that is proven rather than assumed.
 */
const freePort = (): Promise<number> =>
  new Promise((settle) => {
    const probe = createServer()
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => settle(port))
    })
  })

/**
 * What a run has said once it says it, or nothing after a second of asking.
 * A door that holds the process is read while it runs, not after it.
 */
const until = async (read: () => string | undefined): Promise<string | undefined> => {
  for (let tries = 0; tries < 100; tries += 1) {
    const found = read()
    if (found !== undefined) return found
    await new Promise((wake) => setTimeout(wake, 10))
  }
  return undefined
}

const listening = (port: number): Promise<boolean> =>
  new Promise((settle) => {
    const socket = connect({ host: "127.0.0.1", port })
    socket.once("connect", () => {
      socket.destroy()
      settle(true)
    })
    socket.once("error", () => settle(false))
  })

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
  - id: eva.trace.sqlite
    options:
      path: "${join(directory, "trace.sqlite")}"
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

  /**
   * The table is for a person and cuts a value at the column; `--json` is for
   * a machine and cuts nothing, because this is the answer that goes whole
   * into a bug report.
   */
  describe("--json", () => {
    const sentence = "a prompt that is far longer than the table's column, and stays whole here"

    it("answers with the config, the origins, the plugins, and the location", async () => {
      const directory = scratch()
      const path = write(directory, "user.yaml", `model: anthropic/one\ntheme: dusk\n`)

      const found = await ran(["config", "show", "--json"], directory)
      expect(found.code).toBe(0)

      const answer = JSON.parse(found.out)
      expect(Object.keys(answer)).toEqual(["config", "origins", "plugins", "location"])
      expect(answer.config.model).toBe("anthropic/one")
      expect(answer.origins.model).toBe(path)
      expect(answer.plugins.map((plugin: { id: string }) => plugin.id)).toContain("eva.tui")
      expect(answer.location).toMatchObject({ directory, trusted: false, ignored: [] })
    })

    it("keeps a value the table would cut at the column", async () => {
      const directory = scratch()
      write(directory, "user.yaml", `prompts:\n  say:\n    text: "${sentence}"\n`)

      const table = await ran(["config", "show"], directory)
      expect(table.out).toContain("…")
      expect(table.out).not.toContain(sentence)

      const found = await ran(["config", "show", "--json"], directory)
      expect(JSON.parse(found.out).config.prompts.say.text).toBe(sentence)
    })

    it("names the command line as the origin of a flag, as the table does", async () => {
      const directory = scratch()
      write(directory, "user.yaml", "model: anthropic/one\n")

      const found = await ran(["config", "show", "--json", "--model", "anthropic/two"], directory)
      const answer = JSON.parse(found.out)
      expect(answer.config.model).toBe("anthropic/two")
      expect(answer.origins.model).toBe("the command line")
    })
  })
})

/**
 * The exit code and the message, and nothing about the rule language: what a
 * malformed rule set is belongs to `eva.tool.policy`, which is what makes CI
 * and the gate agree about it.
 */
describe("eva policy check", () => {
  it("exits nonzero on a malformed rule set, and names the fault", async () => {
    const directory = scratch()
    const path = write(directory, "rules.yaml", "policy:\n  rules:\n    - allow: [[]]\n")

    const found = await ran(["policy", "check", path], directory)
    expect(found.code).toBe(1)
    expect(found.err).toContain(path)
    expect(found.err).toContain("policy.rules.0.allow.0")
    // Nothing on standard output: a shell reads an artifact there.
    expect(found.out).toBe("")
  })

  it("names every fault, so a person fixes the file once", async () => {
    const directory = scratch()
    const path = write(
      directory,
      "rules.yaml",
      "policy:\n  rules:\n    - deny: []\n    - allow: [[]]\n",
    )

    const found = await ran(["policy", "check", path], directory)
    expect(found.code).toBe(1)
    expect(found.err.trimEnd().split("\n")).toHaveLength(2)
  })

  it("counts the rules of a rule set it reads whole, and exits 0", async () => {
    const directory = scratch()
    const path = write(
      directory,
      "rules.yaml",
      "policy:\n  rules:\n    - allow: [git, [status, diff]]\n    - deny: [git, push]\n",
    )

    const found = await ran(["policy", "check", path], directory)
    expect(found.code).toBe(0)
    expect(found.out).toContain("2 policy rules, and every one is well formed")
    expect(found.err).toBe("")
  })

  /**
   * A rule that can never fire is a fault of the file. A run reads the same
   * file and goes on, because a rule that reaches nothing stops nothing — so
   * this is the one place that finds it.
   */
  it("exits nonzero on a rule no call can reach", async () => {
    const directory = scratch()
    const path = write(
      directory,
      "rules.yaml",
      "policy:\n  rules:\n    - allow: [[bash], [-c], [git status]]\n",
    )

    const found = await ran(["policy", "check", path], directory)
    expect(found.code).toBe(1)
    expect(found.err).toContain("policy.rules.0")
    expect(found.err).toContain("no call reaches this rule")
    expect(found.out).toBe("")
  })

  it("says a config file sets no rules rather than passing in silence", async () => {
    const directory = scratch()
    const path = write(directory, "rules.yaml", "model: anthropic/one\n")

    const found = await ran(["policy", "check", path], directory)
    expect(found.code).toBe(0)
    expect(found.out).toContain("sets no policy rules")
  })

  // It answers before anything loads, the way `config show` does.
  it("answers with every plugin gone", async () => {
    const directory = scratch()
    const path = write(directory, "rules.yaml", "policy:\n  rules:\n    - deny: [rm, -rf]\n")

    const found = await ran(["policy", "check", path], directory, {}, { build: buildOf([]) })
    expect(found.code).toBe(0)
    expect(found.out).toContain("1 policy rule, and every one is well formed")
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

  /**
   * The scope closes however the door's body ends. Four arms used to close it
   * by hand and none of them closed it on a body that failed, so a plugin's
   * finalizer was skipped on exactly the paths where it mattered most.
   */
  it("lets the plugins go when the body fails", async () => {
    const directory = scratch()
    // The plugin has to be one the config resolves to, or the kernel never
    // loads it and there is no finalizer to skip. `contained` ends inside the
    // plugins list, so this is a third entry of it.
    write(directory, "user.yaml", `${contained(directory)}  - id: acme.watching\n`)
    const gone: string[] = []

    const watching = define({
      id: "acme.watching",
      effect: Effect.fn("acme.watching")(function* () {
        yield* Effect.addFinalizer(() => Effect.sync(() => void gone.push("let go")))
      }),
    })

    // A harness no build answers: the Session API refuses it, the Run closes
    // failed, and this door exits 1.
    const found = await ran(
      ["run", "nothing-answers-this"],
      directory,
      {},
      { build: buildOf([...BUILT_IN, ...OPTIONAL, watching]) },
    )

    expect(found.code).toBe(1)
    expect(gone).toEqual(["let go"])
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
 * A Surface is a plugin, and a build without one is a build missing a door
 * rather than a build that fails. This is a stage 0 property, and the web
 * surface is the stage that most easily breaks it: it is the first Surface
 * that binds a socket, and the first that the composition root rebuilds.
 */
describe("a build without eva.web", () => {
  const answered = (directory: string, args: readonly string[]) =>
    ran(["--print", "say hello", ...args], directory, {}, { build: buildWith(["the answer"]) })

  it("runs a Session in the terminal, and says exactly what the whole build says", async () => {
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))
    const whole = await answered(directory, [])

    const dropped = scratch()
    write(dropped, "user.yaml", contained(dropped))
    const without = await answered(dropped, ["--without-plugin", "eva.web"])

    expect(whole.code).toBe(0)
    expect(without.code).toBe(0)
    // Named, so the comparison below cannot pass on two empty runs.
    expect(without.out).toContain("the answer")
    expect(without.out).toBe(whole.out)
    expect(without.err).toBe(whole.err)
  })

  // `posture` is `eva.web`'s key. Which keys reach something is decided by
  // the plugins that would load, so dropping the reader makes it reach none.
  it("says nothing about posture while the plugin is there", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "posture: hosted\n")
    expect((await ran(["config", "show"], directory)).err).toBe("")
  })

  it("names that same key once eva.web is dropped", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "posture: hosted\n")

    const found = await ran(["config", "show", "--without-plugin", "eva.web"], directory)
    expect(found.err).toContain(`nothing reads "posture"`)
  })

  // The door is missing, so the verb says which doors there are. It does not
  // bind, and it does not exit as though it had served.
  it("refuses eva serve --web, and names the surfaces it does have", async () => {
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))

    const found = await ran(["serve", "--web", "--without-plugin", "eva.web"], directory)
    expect(found.code).toBe(1)
    expect(found.err).toContain("eva.web")
    expect(found.err).toContain("eva.tui")
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

/**
 * A local page binds to loopback. A non-local bind has no way to authenticate
 * a visitor, so it is refused rather than served unauthenticated — and a
 * refusal is a supported outcome that says why.
 */
describe("a bind that needs authentication", () => {
  // The whole criterion in one run: the reason and the next step are said, the
  // exit code is non-zero, nothing was printed as though it had served, and
  // the port it named is still free. A server on 0.0.0.0 answers on loopback,
  // so a loopback connect would have reached one had anything bound.
  it("refuses a non-local --host, opens no port, and exits non-zero", async () => {
    const port = await freePort()
    const found = await ran(
      ["serve", "--web", "--host", "0.0.0.0", "--port", String(port)],
      scratch(),
    )

    expect(found.code).toBe(1)
    expect(found.err).toContain("is not authenticated")
    expect(found.err).toContain("bind 127.0.0.1 instead")
    expect(found.out).toBe("")
    expect(await listening(port)).toBe(false)
  })

  // The posture is a tenancy and not a credential, so `hosted` opens no door
  // either.
  it("refuses it under the hosted posture too", async () => {
    const directory = scratch()
    write(directory, "user.yaml", "posture: hosted\n")

    const found = await ran(["serve", "--web", "--host", "192.168.1.10"], directory)
    expect(found.code).toBe(1)
    expect(found.err).toContain("is not authenticated")
    expect(found.out).toBe("")
  })

  // A loopback bind is not refused, so the refusal above is about the host and
  // not about the verb. This build has no `eva.web` row, so it stops at the
  // missing door instead of binding and holding the test open.
  it("refuses no loopback bind", async () => {
    const found = await ran(
      ["serve", "--web", "--host", "127.0.0.2", "--without-plugin", "eva.web"],
      scratch(),
    )

    expect(found.err).not.toContain("is not authenticated")
    expect(found.err).toContain("no eva.web surface is registered")
  })
})

/**
 * One process, both rows. `eva --web` holds the terminal and the page at once,
 * which is what lets a request asked in the terminal be answered in the
 * browser — the two are not two processes with a Session each.
 */
/**
 * The verb, from the command line to the door it opens. What an attached run
 * does after that needs a runtime at the other end and a terminal to draw in,
 * which is `attach.test.ts`; what is here is that the branch exists and gets
 * that far — the address is read, a kernel boots, and the terminal's own door
 * chooses the row.
 */
describe("eva attach", () => {
  /**
   * The build carries no surface that takes input, so the terminal's own door
   * refuses in the words it always refuses in — and no socket is dialled,
   * because the row is chosen before the Client is opened.
   */
  it("refuses on a build with no surface to run, and says so", async () => {
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))

    const found = await ran(
      [
        "attach",
        "http://127.0.0.1:7777",
        "--without-plugin",
        "eva.tui",
        "--without-plugin",
        "eva.web",
      ],
      directory,
    )

    expect(found.code).toBe(1)
    expect(found.err).toContain("no registered surface can run interactively")
  })

  // The address is read before anything boots, so a word nothing can dial
  // costs no kernel.
  it("refuses an address it cannot dial, and boots nothing", async () => {
    const found = await ran(["attach", "localhost:7777"], scratch())

    expect(found.code).toBe(1)
    expect(found.err).toContain("`eva attach` takes the address a runtime serves")
    expect(found.out).toBe("")
  })
})

/**
 * The other spelling. Nothing holds a terminal here, so nothing draws over
 * standard output and the address belongs on it: a person reads it there, and
 * so does a script that started the page.
 */
describe("eva serve --web", () => {
  it("prints the address it bound on standard output, and lets the port go", async () => {
    const port = await freePort()
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))
    const out: string[] = []
    const world: World = {
      args: ["serve", "--web", "--port", String(port)],
      env: { EVA_CONFIG: join(directory, "user.yaml") },
      cwd: directory,
      out: (text) => void out.push(text),
      err: () => {},
      stdin: () => undefined,
    }

    // A headless page ends when the process is stopped, so this reads what it
    // said while it ran and then stops it the way a signal does.
    const running = Effect.runFork(main(world))
    const said = await until(() => {
      const written = out.join("")
      return written.includes(`http://127.0.0.1:${port}`) ? written : undefined
    })
    await Effect.runPromise(Fiber.interrupt(running))

    // In the one voice, because this door's words land beside whatever else
    // the shell is printing and a reader tells Eva from a crash by the prefix.
    expect(said).toContain(`${PREFIX}http://127.0.0.1:${port}`)
    expect(await listening(port)).toBe(false)
  })
})

describe("eva --web", () => {
  /**
   * The terminal's id, answered by a row that looks and then ends. The
   * interactive row is what the run waits on, so this is where the page can be
   * caught while the terminal still holds the process.
   */
  const terminalThatLooks = (look: () => Promise<void>) =>
    define({
      id: "eva.tui",
      effect: Effect.fn("eva.tui")(function* (ctx) {
        yield* ctx.surface.transform((draft) => {
          draft.set({
            id: "eva.tui",
            interactive: true,
            streaming: true,
            images: false,
            start: () =>
              Effect.succeed({
                id: "eva.tui",
                ask: () => Effect.succeed({ kind: "cancelled" as const }),
                done: Effect.promise(look),
              }),
          })
        })
      }),
    })

  it("binds the page beside the terminal, keeps its line off the screen, and lets it go", async () => {
    const port = await freePort()
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))
    const held: boolean[] = []

    const found = await ran(
      ["--web", "--port", String(port)],
      directory,
      {},
      {
        build: buildOf([
          ...BUILT_IN.filter((plugin) => plugin.id !== "eva.tui"),
          ...OPTIONAL,
          terminalThatLooks(async () => void held.push(await listening(port))),
        ]),
      },
    )

    expect(found.code).toBe(0)
    /**
     * Nothing about the bind reaches either stream: this door draws over
     * them, so the page's line goes to the terminal's notice area instead.
     * `apps/cli/src/surface.test.ts` › "lets the row it chose read what the
     * row beside it said" holds the order that makes it readable, and
     * `plugins/tui/src/surface.test.ts` › "shows a notice it was handed"
     * holds what the surface does with it.
     */
    expect(found.out).not.toContain(`http://127.0.0.1:${port}`)
    expect(found.err).not.toContain(`http://127.0.0.1:${port}`)
    // Bound while the terminal row still held the process, and gone with it.
    expect(held).toEqual([true])
    expect(await listening(port)).toBe(false)
  })

  // The flag names a surface this build has not, and is told what the verb
  // that names it is told. Nothing is started: the terminal is refused too.
  it("refuses on a build with no page, and names the surfaces it does have", async () => {
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))

    const found = await ran(["--web", "--without-plugin", "eva.web"], directory)

    expect(found.code).toBe(1)
    expect(found.err).toContain("no eva.web surface is registered")
    expect(found.err).toContain("eva.tui")
  })

  // The same refusal `eva serve --web` gets, from the same rule, before
  // anything boots — so the flag cannot open the door the verb cannot.
  it("refuses a non-local bind, and opens no port", async () => {
    const port = await freePort()

    const found = await ran(["--web", "--host", "0.0.0.0", "--port", String(port)], scratch())

    expect(found.code).toBe(1)
    expect(found.err).toContain("is not authenticated")
    expect(found.out).toBe("")
    expect(await listening(port)).toBe(false)
  })
})

/**
 * The pipe is a surface with one user and that user is a script, so every
 * verb that answers writes exactly its answer to standard output and every
 * word about the answer — a cost line, a finding, a fault — leaves on the
 * error stream. It is asserted here per verb rather than trusted, because
 * the rule holds only where somebody checked.
 */
describe("what a verb that answers writes to standard output", () => {
  it("is the answer alone for eva --print, and the cost goes to the error stream", async () => {
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))

    const found = await ran(
      ["--print", "say hello"],
      directory,
      {},
      { build: buildWith(["the answer"]) },
    )

    expect(found.code).toBe(0)
    expect(found.out).toBe("the answer")
    expect(found.err).toContain("cost unreported")
  })

  /**
   * And a Run that stopped says why here in the same words every other door
   * says it in. `errorWords` is the one table, so a person who reads a
   * failure at the pipe and a person who reads it on the page read one
   * sentence — and the answer stream stays the answer's, which is empty when
   * there was none.
   */
  it("words a failed Run on the error stream, and writes nothing to the answer", async () => {
    const directory = scratch()
    write(directory, "user.yaml", contained(directory))

    const found = await ran(["--print", "say hello"], directory, {}, { build: buildWith([]) })
    const words = errorWords("other")

    expect(found.code).toBe(1)
    expect(found.out).toBe("")
    expect(found.err).toContain("(other)")
    expect(found.err).toContain(words.means)
    expect(found.err).toContain(words.next)
  })

  it("is the last Run's text alone for eva run", async () => {
    const directory = scratch()
    write(
      directory,
      "user.yaml",
      `${contained(directory)}
prompts:
  say:
    text: "Answer: {{input}}"
workflows:
  one-step:
    name: One step
    steps:
      - id: only
        template: say
        with:
          input: input
`,
    )

    const found = await ran(
      ["run", "one-step"],
      directory,
      {},
      { build: buildWith(["the only answer"]) },
    )

    expect(found.code).toBe(0)
    expect(found.out).toBe("the only answer")
  })

  it("is one JSON object alone for eva config show --json, findings and all", async () => {
    const directory = scratch()
    // A key nothing reads, so the run has something to say while it answers.
    write(directory, "user.yaml", "telemetry: true\n")

    const found = await ran(["config", "show", "--json"], directory)

    expect(found.code).toBe(0)
    expect(found.err).toContain(`nothing reads "telemetry"`)
    expect(found.out).toBe(`${JSON.stringify(JSON.parse(found.out), undefined, 2)}\n`)
  })

  it("is the verdict alone for eva policy check, and a fault goes to the error stream", async () => {
    const directory = scratch()
    const clean = write(directory, "clean.yaml", "policy:\n  rules:\n    - allow: [read]\n")
    const broken = write(directory, "broken.yaml", "policy:\n  rules:\n    - allow: [[]]\n")

    const passed = await ran(["policy", "check", clean], directory)
    expect(passed.code).toBe(0)
    expect(passed.err).toBe("")

    const failed = await ran(["policy", "check", broken], directory)
    expect(failed.code).toBe(1)
    expect(failed.out).toBe("")
    expect(failed.err).toContain("policy.rules.0.allow.0")
  })
})
