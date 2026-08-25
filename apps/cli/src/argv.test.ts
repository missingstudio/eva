import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { COMMANDS, parseArgv } from "./argv.js"
import { VERSION } from "./version.js"
import type { World } from "./world.js"

/**
 * One parse against a World that writes into arrays. Nothing here reaches the
 * process, so every message the command line makes is readable in a test.
 */
const ran = (args: readonly string[], stdin: () => string | undefined = () => undefined) => {
  const out: string[] = []
  const err: string[] = []
  const world: World = {
    args,
    env: {},
    cwd: "/",
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
    stdin,
  }
  return { invocation: parseArgv(world), out: out.join(""), err: err.join("") }
}

describe("parseArgv", () => {
  it("starts the interactive surface when nothing is named", () => {
    expect(ran([]).invocation).toEqual({ kind: "interactive", overlays: {} })
  })

  it("reads a prompt behind --print", () => {
    expect(ran(["--print", "hello"]).invocation).toEqual({
      kind: "print",
      prompt: "hello",
      overlays: {},
    })
  })

  it("reads the --print=value form", () => {
    expect(ran(["--print=hello"]).invocation).toMatchObject({ kind: "print", prompt: "hello" })
  })

  it.each(["trust", "untrust"] as const)("reads the %s command", (verb) => {
    expect(ran([verb]).invocation).toEqual({ kind: verb })
  })

  it("reads config show", () => {
    expect(ran(["config", "show"]).invocation).toEqual({ kind: "showConfig", overlays: {} })
  })

  // A flag is a layer, so a command that resolves config gets the flags
  // whichever side of the verb they were typed on.
  it.each([[["--model", "a/b", "config", "show"]], [["config", "show", "--model", "a/b"]]])(
    "carries a flag across the command in %s",
    (args) => {
      expect(ran(args).invocation).toEqual({ kind: "showConfig", overlays: { model: "a/b" } })
    },
  )

  it("keeps every value of a repeatable flag", () => {
    expect(ran(["--config", "one.yaml", "--config", "two.yaml"]).invocation).toEqual({
      kind: "interactive",
      overlays: { config: ["one.yaml", "two.yaml"] },
    })
  })

  /**
   * The reason the flag is `--without-plugin`. Commander reads a `--no-`
   * prefix as a negation of `--plugin`, so `--no-plugin` wrote into the list
   * of plugins to load and the plugin a person dropped was loaded instead.
   */
  it("keeps the plugin to skip out of the plugins to load", () => {
    expect(ran(["--plugin", "eva.tui", "--without-plugin", "eva.print"]).invocation).toEqual({
      kind: "interactive",
      overlays: { plugin: ["eva.tui"], noPlugin: ["eva.print"] },
    })
  })

  it("answers the version itself, and exits 0", () => {
    const found = ran(["--version"])
    expect(found.invocation).toEqual({ kind: "answered", code: 0 })
    expect(found.out).toBe(`${VERSION}\n`)
  })

  it("answers the help itself, and names every command and the environment", () => {
    const found = ran(["--help"])
    expect(found.invocation).toEqual({ kind: "answered", code: 0 })
    for (const command of COMMANDS) expect(found.out).toContain(command)
    expect(found.out).toContain("EVA_CONFIG_CONTENT")
  })
})

describe("eva run", () => {
  const written = (text: string): string => {
    const path = join(mkdtempSync(join(tmpdir(), "eva-argv-")), "input.txt")
    writeFileSync(path, text)
    return path
  }

  it("names the harness, with the empty input, when standard input is a terminal", () => {
    expect(ran(["run", "commit-msg"]).invocation).toEqual({
      kind: "run",
      harness: "commit-msg",
      input: "",
      overlays: {},
    })
  })

  // `.eva/workflows/release-notes.yaml` is keyed by its base name, and the
  // roadmap's own demo types the file name.
  it.each(["release-notes.yaml", "release-notes.yml"])("strips the extension off %s", (name) => {
    expect(ran(["run", name]).invocation).toMatchObject({
      kind: "run",
      harness: "release-notes",
    })
  })

  it("reads a positional file into the input", () => {
    const path = written("the file's text")
    expect(ran(["run", "review", path]).invocation).toMatchObject({
      kind: "run",
      harness: "review",
      input: "the file's text",
    })
  })

  it("reads the --input file into the input", () => {
    const path = written("changelog text")
    expect(ran(["run", "release-notes", "--input", path]).invocation).toMatchObject({
      kind: "run",
      input: "changelog text",
    })
  })

  it("carries the global flags as overlays", () => {
    expect(ran(["run", "commit-msg", "--model", "a/b"]).invocation).toMatchObject({
      kind: "run",
      overlays: { model: "a/b" },
    })
  })

  it("reads piped standard input into the input", () => {
    expect(ran(["run", "commit-msg"], () => "the piped diff").invocation).toMatchObject({
      kind: "run",
      input: "the piped diff",
    })
  })

  it("refuses a positional file and --input together, naming both", () => {
    const found = ran(["run", "x", "one.txt", "--input", "two.txt"])
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain("one.txt")
    expect(found.err).toContain("two.txt")
  })

  // A pipe is a route like the other two.
  it("refuses piped standard input and --input together, naming both", () => {
    const path = written("from the flag")
    const found = ran(["run", "x", "--input", path], () => "from the pipe")
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain(path)
    expect(found.err).toContain("standard input")
  })

  it("refuses a file it cannot read, naming the path", () => {
    const found = ran(["run", "x", "--input", "/nowhere/missing.txt"])
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain("/nowhere/missing.txt")
  })

  it("names run for the word that likely meant it", () => {
    expect(ran(["rnu", "commit-msg"]).err).toContain("did you mean run?")
  })

  // The app has not booted, so it cannot know the row ids.
  it("refuses run with no name, and says nothing about Workflows", () => {
    const found = ran(["run"])
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain("name")
    expect(found.err).not.toMatch(/workflow/i)
  })
})

describe("eva serve", () => {
  it("names the web posture, and leaves the bind to the surface", () => {
    expect(ran(["serve", "--web"]).invocation).toEqual({ kind: "serve", overlays: {} })
  })

  it("carries the host and the port the command line named", () => {
    expect(ran(["serve", "--web", "--host", "127.0.0.1", "--port", "8080"]).invocation).toEqual({
      kind: "serve",
      overlays: {},
      host: "127.0.0.1",
      port: 8080,
    })
  })

  // Port 0 is a real ask: bind anywhere free, and say where it landed.
  it("reads port 0 as a port and not as nothing", () => {
    expect(ran(["serve", "--web", "--port", "0"]).invocation).toMatchObject({ port: 0 })
  })

  it("carries the global flags as overlays", () => {
    expect(ran(["serve", "--web", "--without-plugin", "eva.tui"]).invocation).toMatchObject({
      kind: "serve",
      overlays: { noPlugin: ["eva.tui"] },
    })
  })

  /**
   * `--acp` is the next answer to "serve what", so a posture is named rather
   * than defaulted: a default would start a surface nobody chose.
   */
  it("refuses a serve with no posture, and names the one there is", () => {
    const found = ran(["serve"])
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain("--web")
  })

  // It used to be Number("eight"), and a NaN port binds a random one.
  it.each(["eight", "-1", "70000", "80.5"])("refuses %s as a port, naming it", (port) => {
    const found = ran(["serve", "--web", "--port", port])
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain(port)
  })

  it("names serve for the word that likely meant it", () => {
    expect(ran(["serv"]).err).toContain("did you mean serve?")
  })
})

describe("what the command line says it did not read", () => {
  it("says nothing when every argument was read", () => {
    expect(ran(["config", "show"]).err).toBe("")
  })

  it("names a flag that reached nothing, with the one it likely meant", () => {
    const found = ran(["--modle", "a/b"])
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain("--model")
  })

  it("suggests nothing for a flag that resembles none of them", () => {
    const found = ran(["--telemetry"])
    expect(found.err).toContain("--telemetry")
    expect(found.err).not.toContain("Did you mean")
  })

  it("names a command that reached nothing, with the one it likely meant", () => {
    expect(ran(["trsut"]).err).toContain("did you mean trust?")
  })

  // A prompt is the argument a reader most often puts in the wrong place.
  it("tells a bare word where a prompt goes", () => {
    expect(ran(["hello"]).err).toContain("a prompt goes after --print")
  })

  // It used to become an empty prompt, and run a turn against it.
  it("refuses --print with no prompt", () => {
    const found = ran(["--print"])
    expect(found.invocation).toEqual({ kind: "answered", code: 1 })
    expect(found.err).toContain("argument missing")
  })
})
