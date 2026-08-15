import type { SessionAPI } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { dispatch, helpText } from "./command.js"
import type { CommandContext, CommandInfo } from "./domains.js"

// What a command was given when it ran, so a test can see the argument the
// line carried without a surface to write into.
const given: { argument: string | undefined } = { argument: undefined }

// Nothing here reaches a Session: these rows answer from the line alone.
const context = (parsed: { argument?: string }): CommandContext => ({
  api: {} as SessionAPI,
  session: "test" as SessionID,
  ...parsed,
  write: () => {},
  select: () => {},
})

const rows: readonly CommandInfo[] = [
  {
    id: "model",
    description: "Show or set the session model",
    argumentHint: "provider/model",
    run: (ctx) =>
      Effect.sync(() => {
        given.argument = ctx.argument
      }),
  },
  { id: "clear", description: "Open a new Session", aliases: ["new"], run: () => Effect.void },
  // A row without `run`: the plugin that owns the behaviour did not load.
  { id: "cost", description: "Show what this session has spent" },
]

const ran = (line: string) => Effect.runPromise(dispatch(rows, line, context))

describe("dispatch", () => {
  it.each([["plain text"], ["/"], [""]])("reads %o as a prompt, not a command", async (line) => {
    expect(await ran(line)).toEqual({ kind: "prompt" })
  })

  it("runs the row a name resolves to", async () => {
    expect(await ran("  /clear  ")).toEqual({ kind: "ran", name: "clear" })
  })

  it("runs the row an alias resolves to, under the id it is", async () => {
    expect(await ran("/new")).toEqual({ kind: "ran", name: "clear" })
  })

  // The whole line after the name is one argument, not a parsed list.
  it("hands the rest of the line over as one argument", async () => {
    expect(await ran("/model anthropic/claude-opus-5")).toEqual({ kind: "ran", name: "model" })
    expect(given.argument).toBe("anthropic/claude-opus-5")
  })

  it("says nothing about an argument when the line carries none", async () => {
    given.argument = "stale"
    await ran("/model")
    expect(given.argument).toBeUndefined()
  })

  /**
   * The terminal used to say `no such command` flat, while the command line
   * named the near miss for its own verbs. One module says it, so both do.
   */
  it("names the near miss a name most likely meant", async () => {
    expect(await ran("/moldel")).toEqual({
      kind: "said",
      text: "no such command: /moldel, did you mean /model?",
    })
  })

  it("suggests through an alias, because an alias resolves a line too", async () => {
    expect(await ran("/mew")).toEqual({
      kind: "said",
      text: "no such command: /mew, did you mean /new?",
    })
  })

  it("says only what it knows when no candidate is close", async () => {
    expect(await ran("/telemetry")).toEqual({ kind: "said", text: "no such command: /telemetry" })
  })

  // A row the build knows of but cannot execute. Saying so beats silence,
  // and beats submitting `/cost` to a model as a prompt.
  it("says a known command has nothing to run in this build", async () => {
    expect(await ran("/cost")).toEqual({ kind: "said", text: "/cost does nothing in this build" })
  })
})

describe("helpText", () => {
  it("lists every row with its argument hint", () => {
    expect(helpText(rows)).toContain("/model <provider/model>")
    expect(helpText(rows).split("\n")).toHaveLength(rows.length)
  })
})
