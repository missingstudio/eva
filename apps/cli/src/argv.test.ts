import { describe, expect, it } from "vitest"
import { COMMANDS, parseArgv } from "./argv.js"
import { VERSION } from "./version.js"
import type { World } from "./world.js"

/**
 * One parse against a World that writes into arrays. Nothing here reaches the
 * process, so every message the command line makes is readable in a test.
 */
const ran = (args: readonly string[]) => {
  const out: string[] = []
  const err: string[] = []
  const world: World = {
    args,
    env: {},
    cwd: "/",
    out: (text) => void out.push(text),
    err: (text) => void err.push(text),
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
