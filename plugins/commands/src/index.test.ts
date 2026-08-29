import type { ModelRef, SessionAPI, SessionHeader } from "@missingstudio/eva-core"
import type { SessionID } from "@missingstudio/eva-schema"
import { define, modelRows, type CommandContext, type PickRow } from "@missingstudio/eva-sdk"
import { describe, expect, it } from "vitest"
import { withPlugin } from "@missingstudio/eva-testkit"
import { Effect } from "effect"
import { COMMANDS, commands } from "./index.js"

describe("COMMANDS", () => {
  it("names the five the product ships", () => {
    expect(COMMANDS.map((one) => one.id)).toEqual(["model", "cost", "clear", "sessions", "help"])
  })

  it("resolves an alias to its command", () => {
    expect(COMMANDS.find((one) => (one.aliases ?? []).includes("new"))?.id).toBe("clear")
  })
})

// A Catalog with models in it, written by a plugin that loads first — the
// way a provider's models and their prices really arrive.
const catalog = define({
  id: "test.catalog",
  effect: Effect.fn("test.catalog")(function* (ctx) {
    yield* ctx.catalog.transform((draft) => {
      draft.model.update("openai", "gpt-5.6-terra", (model) => {
        model.contextWindow = 400_000
      })
      // A rate is Ticks per million tokens: $3 in, $15 out.
      draft.model.update("anthropic", "claude-opus-5", (model) => {
        model.price = { inputTicks: 30_000_000_000, outputTicks: 150_000_000_000 }
      })
    })
  }),
})

interface Watched {
  readonly ctx: CommandContext
  readonly written: () => string
  readonly offered: () => readonly PickRow[]
  readonly model: () => ModelRef
  readonly followed: () => SessionID | undefined
}

/**
 * A context a test can watch. `pick` is the capability a surface with panels
 * supplies; a test that leaves it out is the print surface, where the same
 * command has to answer in words.
 */
const watched = (
  takes?: (rows: readonly PickRow[]) => PickRow | undefined,
  held: readonly SessionHeader[] = [],
): Watched => {
  const said: string[] = []
  let offered: readonly PickRow[] = []
  let model: ModelRef = { provider: "fake", model: "model" }
  let followed: SessionID | undefined
  // Only the half `/model` reaches: the rest of the Session API is not what
  // this command is, and a stub of it would only be a second thing to keep
  // in step.
  const api = {
    list: Effect.succeed(held),
    model: {
      get: () => Effect.succeed(model),
      set: (_session: SessionID, next: ModelRef) => Effect.sync(() => void (model = next)),
    },
  } as unknown as SessionAPI

  return {
    ctx: {
      api,
      session: "sess_test" as SessionID,
      write: (text) => void said.push(text),
      select: (session) => void (followed = session),
      ...(takes === undefined
        ? {}
        : {
            pick: (_title: string, rows: readonly PickRow[]) => {
              offered = rows
              return Effect.succeed(takes(rows))
            },
          }),
    },
    written: () => said.join(""),
    offered: () => offered,
    model: () => model,
    followed: () => followed,
  }
}

/**
 * A command as this build really registers it. `/model` reads the Catalog it
 * is registered beside, so its handler is only itself once the kernel has
 * built it — a constant cannot carry one.
 */
const ran = (id: string, ctx: CommandContext, argument?: string) =>
  withPlugin(
    commands,
    (kernel) =>
      Effect.gen(function* () {
        const row = (yield* kernel.domains.command.get).find((one) => one.id === id)
        if (row?.run === undefined) throw new Error(`this build cannot run /${id}`)
        yield* row.run(argument === undefined ? ctx : { ...ctx, argument })
      }),
    { before: [catalog] },
  )

describe("the commands plugin", () => {
  it("writes every command into the command domain", async () => {
    const rows = await withPlugin(commands, (kernel) => kernel.domains.command.get)

    for (const command of COMMANDS) {
      expect(rows.find((row) => row.id === command.id)?.description).toBe(command.description)
    }
  })

  it("gives /help a handler, which the constants cannot carry", async () => {
    const help = await withPlugin(commands, (kernel) =>
      Effect.map(kernel.domains.command.get, (rows) => rows.find((row) => row.id === "help")),
    )

    expect(help?.run).toBeTypeOf("function")
  })
})

describe("the models as rows", () => {
  // A row is named the way a person types one, so what a panel takes is the
  // argument the line would have carried.
  it("names every model the way the line names one", async () => {
    const rows = await withPlugin(
      commands,
      (kernel) => Effect.map(kernel.domains.catalog.get, modelRows),
      {
        before: [catalog],
      },
    )

    expect(rows.map((row) => row.id)).toEqual(["openai/gpt-5.6-terra", "anthropic/claude-opus-5"])
  })

  // What the Catalog knows helps somebody choose; what it does not know is
  // left unsaid rather than guessed at.
  it("says what the Catalog holds, and nothing it does not", async () => {
    const rows = await withPlugin(
      commands,
      (kernel) => Effect.map(kernel.domains.catalog.get, modelRows),
      {
        before: [catalog],
      },
    )

    expect(rows[0]?.detail).toBe("400k context")
    expect(rows[1]?.detail).toBe("$3.00/Mtok in")
  })
})

describe("/model", () => {
  it("sets the model an argument names, and says so", async () => {
    const seen = watched()
    await ran("model", seen.ctx, "openai/gpt-5.6-terra")

    expect(seen.model()).toEqual({ provider: "openai", model: "gpt-5.6-terra" })
    expect(seen.written()).toContain("model → openai/gpt-5.6-terra")
  })

  it("says so when the argument is not a model reference", async () => {
    const seen = watched()
    await ran("model", seen.ctx, "nonsense")

    expect(seen.model()).toEqual({ provider: "fake", model: "model" })
    expect(seen.written()).toContain("not a model reference: nonsense")
  })

  // The picker is what no argument means where there is a panel to draw it.
  it("offers every model, and sets the one that is taken", async () => {
    const seen = watched((rows) => rows[1])
    await ran("model", seen.ctx)

    expect(seen.offered().map((row) => row.id)).toEqual([
      "openai/gpt-5.6-terra",
      "anthropic/claude-opus-5",
    ])
    expect(seen.model()).toEqual({ provider: "anthropic", model: "claude-opus-5" })
    // The outcome is said in words, so the pipe transcript is never poorer
    // than the screen.
    expect(seen.written()).toContain("model → anthropic/claude-opus-5")
  })

  // Nothing chosen is what keeping what you had is called.
  it("changes nothing when nobody chooses", async () => {
    const seen = watched(() => undefined)
    await ran("model", seen.ctx)

    expect(seen.model()).toEqual({ provider: "fake", model: "model" })
    expect(seen.written()).toBe("")
  })

  // The same command under a surface that draws no panels: it writes the
  // rows instead, and the answer is the same answer.
  it("writes the model and the models where nothing can pick", async () => {
    const seen = watched()
    await ran("model", seen.ctx)

    expect(seen.written()).toContain("fake/model")
    expect(seen.written()).toContain("anthropic/claude-opus-5")
  })
})

describe("/sessions", () => {
  // Two Sessions, the way a listing hands them over: most recently updated
  // first, and one of them with nothing said in it yet.
  const HELD: readonly SessionHeader[] = [
    {
      id: "sess_two" as SessionID,
      title: "read the trace back",
      updatedAt: "2026-08-29T10:00:00Z",
    },
    { id: "sess_one" as SessionID },
  ]

  // The picker is what this command is where there is a panel to draw it.
  it("offers every Session Eva holds, and follows the one that is taken", async () => {
    const seen = watched((rows) => rows[0], HELD)
    await ran("sessions", seen.ctx)

    expect(seen.offered().map((row) => row.label)).toEqual(["read the trace back", "no title yet"])
    expect(seen.followed()).toBe("sess_two")
  })

  // A Session that has heard nothing is named, rather than left out of the
  // listing it is in.
  it("names a Session with no title yet, and tells it apart by when it moved", async () => {
    const seen = watched((rows) => rows[1], HELD)
    await ran("sessions", seen.ctx)

    expect(seen.offered()[0]?.detail).toBe("2026-08-29T10:00:00Z")
    expect(seen.followed()).toBe("sess_one")
  })

  // Nothing chosen is what staying where you are is called.
  it("follows nothing when nobody chooses", async () => {
    const seen = watched(() => undefined, HELD)
    await ran("sessions", seen.ctx)

    expect(seen.followed()).toBeUndefined()
  })

  // The same command under a surface that draws no panels: it writes the rows
  // instead, and the answer is the same answer.
  it("writes the Sessions where nothing can pick", async () => {
    const seen = watched(undefined, HELD)
    await ran("sessions", seen.ctx)

    expect(seen.written()).toContain("read the trace back")
    expect(seen.written()).toContain("no title yet")
    expect(seen.followed()).toBeUndefined()
  })

  // A panel over no rows takes no press. A listing of nothing is said in
  // words, so no door answers this command with silence.
  it("says Eva holds no Session rather than drawing an empty panel", async () => {
    const seen = watched((rows) => rows[0])
    await ran("sessions", seen.ctx)

    expect(seen.written()).toBe("no Sessions yet\n")
    expect(seen.offered()).toEqual([])
    expect(seen.followed()).toBeUndefined()
  })
})
