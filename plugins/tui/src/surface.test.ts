import type { CancelCause, SubmitInput } from "@missingstudio/eva-core"
import {
  droppableTransport,
  makeClient,
  memorySessionAPI,
  type Client,
  type Method,
} from "@missingstudio/eva-client-runtime"
import { sessionID, type Payload, type SessionID } from "@missingstudio/eva-schema"
import type {
  CommandInfo,
  Frontend,
  IntegrationInfo,
  KeymapInfo,
  PickRow,
  Running,
} from "@missingstudio/eva-sdk"
import type { Frame, KeyPress, Renderer, ThemeColors } from "@missingstudio/eva-tui-core"
import { Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { ARMED, ASKING, DISCONNECTED, SYNCHRONIZING } from "./console.js"
import { makeSurface, TICK, type Where } from "./surface.js"

// What a Run closes with. The surface reads the Claim off it; the record
// keeps it.
const CLOSE: Payload = { kind: "finished", claim: { result: "done", summary: "ok" } }

interface Fake {
  readonly renderer: Renderer
  readonly press: (text: string) => void
  readonly key: (key: Partial<KeyPress> & { readonly key: string }) => void
  readonly paste: (text: string) => void
  readonly end: () => void
  readonly last: () => Frame | undefined
  readonly written: () => string
}

// A Renderer that keeps the frames it was given. `press` types a line and
// hits return; `end` closes the input; `written` is every line the surface
// has shown.
const fakeRenderer = (draws: Partial<Renderer["draws"]> = {}): Fake => {
  const handlers = new Set<(key: KeyPress) => void>()
  const ends = new Set<() => void>()
  const pastes = new Set<(text: string) => void>()
  const drawn: Frame[] = []
  const deliver = (press: KeyPress) => {
    for (const handler of handlers) handler(press)
  }
  const last = () => drawn.at(-1)
  // A press as the normalizer hands it over: one character with no chord
  // modifier carries a glyph, and everything else names a key.
  const pressOf = (given: Partial<KeyPress> & { readonly key: string }): KeyPress => ({
    ctrl: false,
    shift: false,
    meta: false,
    glyph: Array.from(given.key).length === 1 && given.ctrl !== true && given.meta !== true,
    ...given,
  })
  return {
    key: (given) => deliver(pressOf(given)),
    paste: (text) => {
      for (const handler of pastes) handler(text)
    },
    end: () => {
      for (const handler of ends) handler()
    },
    renderer: {
      draw: (frame) => void drawn.push(frame),
      // A screen, unless a test asks for one that draws less.
      draws: { panels: true, colors: true, ...draws },
      onKey: (handler) => {
        handlers.add(handler)
        return () => void handlers.delete(handler)
      },
      onPaste: (handler) => {
        pastes.add(handler)
        return () => void pastes.delete(handler)
      },
      onEnd: (handler) => {
        ends.add(handler)
        return () => void ends.delete(handler)
      },
      stop: () => {},
    },
    press: (text) => {
      for (const character of text) {
        deliver(pressOf({ key: character === " " ? "space" : character }))
      }
      deliver(pressOf({ key: "return" }))
    },
    last,
    // What the surface said of its own. The record's fold is `session`, and
    // nothing the surface writes reaches it.
    written: () => (last()?.notes ?? []).join("\n"),
  }
}

interface Spy {
  // The fake, wrapped once. Every surface under test reads through it,
  // which is what makes an API call the surface does not make unreachable.
  readonly client: Client
  readonly submitted: readonly SubmitInput[]
  readonly cancelled: readonly CancelCause[]
  // The Sessions whose record the surface asked for, in order.
  readonly attached: readonly SessionID[]
  readonly publish: (payload: Payload) => Effect.Effect<void>
  // Keeps the next Run open, so a test can look at the surface mid-stream.
  readonly hold: () => { readonly release: () => void }
  // The pipe under the surface, lost and found again.
  readonly drop: Effect.Effect<void>
  readonly restore: Effect.Effect<void>
  // How many watch streams have really subscribed.
  readonly open: () => number
}

/**
 * The in-memory filler, driven the way this surface needs it. The contract is
 * the filler's — the numbering, the cursor watch, the exactly-once rule — and
 * what is here is only what one Run says and when it closes.
 *
 * `racing` closes the Run in the same turn the surface submitted it, with no
 * hop between. That is the race the surface must survive: its watcher
 * subscribes after it is forked, so a close said this early is a close it
 * never hears.
 */
const fakeApi = Effect.fn("test.api")(function* (racing = false): Effect.fn.Return<Spy> {
  let holding = false
  let close: () => Effect.Effect<void> = () => Effect.void

  const memory = yield* memorySessionAPI((_input, say) =>
    Effect.gen(function* () {
      close = () => say(CLOSE)
      // Answers at once unless held, so the loop is back at the prompt when
      // this returns and a test does not have to guess at timing. The close
      // waits one turn of the event loop, which is what the real Session API
      // does — it forks the turn — and `racing` is the same filler with that
      // turn taken away.
      if (holding) return
      if (!racing) yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
      yield* say(CLOSE)
    }),
  )

  // The droppable filler under every surface under test, so the one test
  // that has to lose the pipe reaches the same seam as the rest.
  const transport = yield* droppableTransport(memory.api)

  const argsOf = <A>(method: Method): readonly A[] =>
    memory.calls.filter((one) => one.method === method).map((one) => one.args[1] as A)

  return {
    client: yield* makeClient(transport),
    get submitted() {
      return argsOf<SubmitInput>("submit")
    },
    get cancelled() {
      return argsOf<CancelCause>("cancel")
    },
    get attached() {
      return memory.calls
        .filter((one) => one.method === "attach")
        .map((one) => one.args[0] as SessionID)
    },
    publish: (payload: Payload) => memory.say(payload),
    drop: transport.drop,
    restore: transport.restore,
    open: memory.open,
    hold: () => {
      holding = true
      return {
        release: () => {
          holding = false
          Effect.runFork(close())
        },
      }
    },
  }
})

// The clock stands still unless a test asks for one that moves, so a frame
// a test looks at holds what it was given rather than how long it took.
interface SurfaceOver {
  readonly keymap?: readonly KeymapInfo[]
  readonly notices?: readonly string[]
  // How each provider would authenticate, as the auth plugin projects it.
  readonly integrations?: readonly IntegrationInfo[]
  // Where the work happens. An attached terminal names a runtime instead.
  readonly where?: Where
  readonly theme?: ThemeColors
  // What the renderer under this surface can draw. A test that takes one
  // away is a pipe, where the same surface offers a command less.
  readonly draws?: Partial<Renderer["draws"]>
  readonly now?: () => number
  // A Session API that closes the Run before the watcher has subscribed,
  // and how long the surface waits for a drain that will never come.
  readonly racing?: boolean
  // How a line runs, when it does not run in this process. It is what an
  // attached terminal is handed.
  readonly run?: Running
  readonly settle?: number
}

const withSurface = <A>(
  commands: readonly CommandInfo[],
  body: (
    fake: Fake,
    spy: Spy,
    frontend: { ask: Frontend["ask"]; done: Effect.Effect<void> },
  ) => Promise<A> | A,
  over: SurfaceOver = {},
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fake = fakeRenderer(over.draws)
        const spy = yield* fakeApi(over.racing ?? false)
        const frontend = yield* makeSurface({
          client: spy.client,
          renderer: fake.renderer,
          commands: Effect.succeed(commands),
          keymap: Effect.succeed(over.keymap ?? KEYMAP),
          where: over.where ?? { kind: "directory", path: "/somewhere" },
          version: "0.0.0",
          ...(over.integrations === undefined
            ? {}
            : { integrations: Effect.succeed(over.integrations) }),
          ...(over.notices === undefined ? {} : { notices: over.notices }),
          ...(over.theme === undefined ? {} : { theme: over.theme }),
          ...(over.settle === undefined ? {} : { settle: over.settle }),
          ...(over.run === undefined ? {} : { run: over.run }),
          now: over.now ?? (() => 0),
        })
        // Let the loop reach its first prompt before anything is typed.
        yield* Effect.yieldNow
        return yield* Effect.promise(async () => body(fake, spy, frontend))
      }),
    ),
  )

const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

// Lets the surface's loop catch up. Several turns of the event loop rather
// than one fixed pause: a single 10ms window lost the race on a loaded test
// host, and a turn count does not care how slow the host is. An assertion
// about a call the surface made waits for that call — `heldWhere` — rather
// than for this.
const settle = async () => {
  for (let turn = 0; turn < 15; turn += 1) await pause(2)
}

// The frame once the screen shows a condition. A fixed pause misses on a
// loaded test host, so this polls, bounded, and the assertion still reads
// whatever was really drawn. The bound is generous because it costs nothing
// on a run that passes: a loaded host missed a one-second one.
const drawnWhere = async (fake: Fake, holds: (frame: Frame | undefined) => boolean) => {
  const deadline = Date.now() + 5_000
  while (!holds(fake.last()) && Date.now() < deadline) await pause(5)
  return fake.last()
}

// The same bounded poll for what a test reads off the spy rather than off
// the screen: an assertion about a call the surface made waits for that
// call, so no wait has to be long enough by guess.
const heldWhere = async <A>(read: () => A, holds: (value: A) => boolean): Promise<A> => {
  const deadline = Date.now() + 5_000
  while (!holds(read()) && Date.now() < deadline) await pause(5)
  return read()
}

// The rows the keymap plugin registers for this surface.
const KEYMAP: readonly KeymapInfo[] = [
  { id: "submit", binding: "enter", command: "session.submit", surface: "eva.tui" },
  { id: "newline", binding: "shift+enter", command: "input.newline", surface: "eva.tui" },
  { id: "steer", binding: "ctrl+s", command: "session.steer", surface: "eva.tui" },
  { id: "cancel", binding: "ctrl+c", command: "session.cancel", surface: "eva.tui" },
  { id: "quit", binding: "ctrl+d", command: "app.quit", surface: "eva.tui" },
  { id: "back", binding: "escape", command: "surface.back", surface: "eva.tui" },
  { id: "palette", binding: "ctrl+k", command: "surface.palette", surface: "eva.tui" },
]

// What a panel is showing, as a test reads it off the Frame.
const rowsOf = (frame: Frame | undefined): readonly string[] =>
  (frame?.overlay?.rows ?? []).map((row) => row.label)

const chosenIn = (frame: Frame | undefined): string | undefined => {
  const overlay = frame?.overlay
  return overlay === undefined ? undefined : overlay.rows[overlay.selected]?.label
}

describe("a typed line", () => {
  it("becomes a prompt when it is not a command", async () => {
    const submitted = await withSurface([], async (fake, spy) => {
      fake.press("what is this")
      await settle()
      return spy.submitted
    })

    expect(submitted).toEqual([{ kind: "prompt", text: "what is this" }])
  })

  // The stream lands in the live area, never in the fold. Anything drawn
  // into the session pane came from the record.
  it("shows streamed text in the live area while the Run is open", async () => {
    const drawn = await withSurface([], async (fake, spy) => {
      const streaming = spy.hold()
      fake.press("go")
      await settle()
      await Effect.runPromise(
        spy.publish({ kind: "text", block: 0, content: { type: "text", text: "an answer" } }),
      )
      await settle()
      const during = fake.last()
      streaming.release()
      await settle()
      return { during, after: fake.last() }
    })

    expect(drawn.during?.live).toContain("an answer")
    expect(drawn.during?.session ?? []).not.toContainEqual(
      expect.objectContaining({ author: "agent" }),
    )
    // The fold replaces the stream once the Run closes.
    expect(drawn.after?.live).toBe("")
  })

  /**
   * The watcher subscribes after it is forked, so a Run that closes in the
   * same turn is a close it never hears. It used to wait on that close
   * forever, which left the spinner turning on a Run that had already
   * finished. `submit` is what says the Run is over, so the surface closes
   * it either way.
   */
  it("closes a Run whose end its watcher never heard", async () => {
    const drawn = await withSurface(
      [],
      async (fake, spy) => {
        fake.press("go")
        await pause(200)
        return { last: fake.last(), submitted: spy.submitted }
      },
      { racing: true, settle: 20 },
    )

    expect(drawn.submitted).toEqual([{ kind: "prompt", text: "go" }])
    expect(drawn.last?.work.running).toBe(false)
    expect(drawn.last?.status.mode).toBe("ready")
  })

  /**
   * A pasted block is one line, however many rows it has. Every newline in
   * it used to arrive as the key bound to submit, so pasting a stack trace
   * opened one Run per row — each on a fragment, each against a provider.
   */
  it("takes a multi-line paste as one prompt", async () => {
    const result = await withSurface([], async (fake, spy) => {
      fake.paste("first line\nsecond line")
      await settle()
      const typed = fake.last()
      fake.key({ key: "return" })
      await settle()
      return { typed, submitted: spy.submitted }
    })

    expect(result.typed?.input).toBe("first line\nsecond line")
    expect(result.submitted).toEqual([{ kind: "prompt", text: "first line\nsecond line" }])
  })

  it("puts a paste where the caret is", async () => {
    const drawn = await withSurface([], async (fake) => {
      for (const character of "ac") fake.key({ key: character })
      fake.key({ key: "left" })
      fake.paste("b")
      await settle()
      return fake.last()
    })

    expect(drawn?.input).toBe("abc")
    expect(drawn?.cursor).toBe(2)
  })

  it("draws the typed line, so a redraw never loses it", async () => {
    const drawn = await withSurface([], async (fake) => {
      for (const character of "half") fake.key({ key: character })
      await settle()
      return fake.last()
    })

    expect(drawn?.input).toBe("half")
  })

  // The caret is the surface's to move and the renderer's to draw, so what
  // is typed lands where the caret is rather than at the end.
  it("types at the caret after it has been moved", async () => {
    const submitted = await withSurface([], async (fake, spy) => {
      for (const character of "helo") fake.key({ key: character })
      fake.key({ key: "left" })
      fake.key({ key: "left" })
      fake.key({ key: "l" })
      fake.key({ key: "return" })
      await settle()
      return spy.submitted
    })

    expect(submitted).toEqual([{ kind: "prompt", text: "hello" }])
  })
})

describe("the esc stack", () => {
  // One key, one meaning: step back. The whole stack in one test, because
  // what each press does depends on what the one before it left open.
  it("clears the line, then arms, then interrupts", async () => {
    const seen = await withSurface([], async (fake, spy) => {
      spy.hold()
      fake.press("go")
      await settle()
      for (const character of "half typed") fake.key({ key: character })
      await settle()

      // One: the line goes, and the Run is untouched.
      fake.key({ key: "escape" })
      await settle()
      const cleared = fake.last()

      // Two: the Run is armed, and the status line says so.
      fake.key({ key: "escape" })
      await settle()
      const armed = fake.last()

      // Three: the Run stops.
      fake.key({ key: "escape" })
      await settle()
      return { cleared, armed, after: fake.last(), cancelled: spy.cancelled }
    })

    expect(seen.cleared?.input).toBe("")
    expect(seen.cleared?.work.running).toBe(true)
    expect(seen.armed?.work.hint).toBe(ARMED)
    expect(seen.cancelled).toEqual(["user"])
    expect(seen.after?.work.running).toBe(false)
    expect(seen.after?.work.hint).toBe("")
  })

  // An interrupt is never something a person arrives at by forgetting they
  // armed it a minute ago.
  it("forgets an armed interrupt when another key is pressed", async () => {
    const result = await withSurface([], async (fake, spy) => {
      spy.hold()
      fake.press("go")
      await settle()
      fake.key({ key: "escape" })
      await settle()
      fake.key({ key: "x" })
      fake.key({ key: "escape" })
      await settle()
      return { cancelled: spy.cancelled, frame: fake.last() }
    })

    // The second escape only cleared the `x`; nothing was interrupted.
    expect(result.cancelled).toEqual([])
    expect(result.frame?.work.running).toBe(true)
  })
})

describe("the prompt history", () => {
  it("recalls the last line on up, and submits it again", async () => {
    const submitted = await withSurface([], async (fake, spy) => {
      fake.press("ask once")
      await heldWhere(
        () => spy.submitted,
        (all) => all.length === 1,
      )
      fake.key({ key: "up" })
      const recalled = (await drawnWhere(fake, (frame) => frame?.input === "ask once"))?.input
      fake.key({ key: "return" })
      return {
        recalled,
        submitted: await heldWhere(
          () => spy.submitted,
          (all) => all.length === 2,
        ),
      }
    })

    expect(submitted.recalled).toBe("ask once")
    expect(submitted.submitted).toEqual([
      { kind: "prompt", text: "ask once" },
      { kind: "prompt", text: "ask once" },
    ])
  })

  // A line being written is the person's. Up moves the caret through it and
  // never replaces it with something they typed an hour ago.
  it("leaves a half-written line alone", async () => {
    const drawn = await withSurface([], async (fake) => {
      fake.press("an old prompt")
      await settle()
      for (const character of "new") fake.key({ key: character })
      fake.key({ key: "up" })
      await settle()
      return fake.last()
    })

    expect(drawn?.input).toBe("new")
  })
})

describe("a slash command", () => {
  // The whole point: the four commands used to parse and never run.
  it("runs the row the command domain holds", async () => {
    const seen: string[] = []
    const rows: readonly CommandInfo[] = [
      {
        id: "model",
        description: "Show or set the session model",
        run: (ctx) =>
          Effect.gen(function* () {
            const current = yield* ctx.api.model.get(ctx.session)
            seen.push(ctx.argument ?? `${current.provider}/${current.model}`)
            ctx.write("ran\n")
          }),
      },
    ]

    const result = await withSurface(rows, async (fake, spy) => {
      fake.press("/model")
      await settle()
      return { written: fake.written(), submitted: spy.submitted }
    })

    expect(seen).toEqual(["fake/model"])
    expect(result.written).toContain("ran")
    // A command is not a prompt.
    expect(result.submitted).toEqual([])
  })

  /**
   * A command may write to the record: `/mode` records the mode it named, and
   * the status line reads the mode off the record. So a command that ran is
   * followed by a fold, and the screen carries the new fact before the next
   * Run rather than after it.
   */
  it("reads the record again after a command ran, so what it recorded shows", async () => {
    let record: ((payload: Payload) => Effect.Effect<void>) | undefined
    const rows: readonly CommandInfo[] = [
      {
        id: "mode",
        description: "names the permission mode this Session runs under",
        run: (ctx) =>
          Effect.gen(function* () {
            if (record !== undefined) yield* record({ kind: "mode", mode: "read-only" })
            ctx.write("mode: read-only\n")
          }),
      },
    ]

    const shown = await withSurface(rows, async (fake, spy) => {
      record = spy.publish
      fake.press("/mode read-only")
      await settle()
      return fake.last()?.session ?? []
    })

    expect(shown.flatMap((message) => message.blocks)).toContainEqual(
      expect.objectContaining({ type: "mode", mode: "read-only" }),
    )
  })

  it("hands the rest of the line over as one argument", async () => {
    const seen: (string | undefined)[] = []
    const rows: readonly CommandInfo[] = [
      {
        id: "model",
        description: "x",
        run: (ctx) => Effect.sync(() => void seen.push(ctx.argument)),
      },
    ]

    await withSurface(rows, async (fake) => {
      fake.press("/model anthropic/claude-opus-5")
      await settle()
    })

    expect(seen).toEqual(["anthropic/claude-opus-5"])
  })

  it("resolves an alias to the same row", async () => {
    let ran = 0
    const rows: readonly CommandInfo[] = [
      {
        id: "clear",
        description: "x",
        aliases: ["new"],
        run: () => Effect.sync(() => void (ran += 1)),
      },
    ]

    await withSurface(rows, async (fake) => {
      fake.press("/new")
      await settle()
    })

    expect(ran).toBe(1)
  })

  // What clearing looks like: the screen shows the fold of the Session now
  // open, and a new Session folds to nothing.
  it("shows the Session a command selected", async () => {
    const other = sessionID("sess_other")
    const rows: readonly CommandInfo[] = [
      {
        id: "clear",
        description: "x",
        run: (ctx) => Effect.sync(() => ctx.select(other)),
      },
    ]

    const drawn = await withSurface(rows, async (fake) => {
      fake.press("a question")
      await drawnWhere(fake, (frame) => (frame?.session.length ?? 0) > 0)
      fake.press("/clear")
      return drawnWhere(fake, (frame) => frame?.session.length === 0)
    })

    expect(drawn?.session).toEqual([])
  })

  it("follows the command when it selects a different Session", async () => {
    const other = sessionID("sess_other")
    const seen: SessionID[] = []
    const rows: readonly CommandInfo[] = [
      {
        id: "clear",
        description: "x",
        run: (ctx) => Effect.sync(() => ctx.select(other)),
      },
      {
        id: "where",
        description: "x",
        run: (ctx) => Effect.sync(() => void seen.push(ctx.session)),
      },
    ]

    await withSurface(rows, async (fake) => {
      fake.press("/clear")
      await settle()
      fake.press("/where")
      await settle()
    })

    expect(seen).toEqual([other])
  })

  it("says so rather than prompting when the name is unknown", async () => {
    const result = await withSurface([], async (fake, spy) => {
      fake.press("/nope")
      await settle()
      return { written: fake.written(), submitted: spy.submitted }
    })

    expect(result.written).toContain("no such command: /nope")
    expect(result.submitted).toEqual([])
  })

  it("says so when the row names a command this build cannot run", async () => {
    const rows: readonly CommandInfo[] = [{ id: "cost", description: "x" }]
    const written = await withSurface(rows, async (fake) => {
      fake.press("/cost")
      await settle()
      return fake.written()
    })

    expect(written).toContain("/cost does nothing in this build")
  })
})

/**
 * A line that runs where the Domains are: what an attached terminal is
 * handed, because a command changes state where it runs.
 *
 * Whether the line is a command at all is decided here, so a Prompt never
 * crosses the wire to be told it is a Prompt — and the rows this process
 * holds are never resolved against, because they are the wrong process's.
 */
describe("a line that runs somewhere else", () => {
  const HERE: readonly CommandInfo[] = [
    { id: "mode", description: "x", run: () => Effect.die("dispatched in the wrong process") },
  ]

  it("sends a command line over, and shows what it wrote", async () => {
    const sent: string[] = []
    const written = await withSurface(
      HERE,
      async (fake) => {
        fake.press("/mode read-only")
        await settle()
        return fake.written()
      },
      {
        run: (_session, line) =>
          Effect.sync(() => {
            sent.push(line)
            return { wrote: "mode → read-only\n" }
          }),
      },
    )

    expect(sent).toEqual(["/mode read-only"])
    expect(written).toContain("mode → read-only")
  })

  // A line that names no command is a Prompt, and a Prompt is not a write to
  // send and take back.
  it("submits a plain line as a Prompt, and sends nothing over", async () => {
    const sent: string[] = []
    const submitted = await withSurface(
      HERE,
      async (fake, spy) => {
        fake.press("what is this")
        await settle()
        return spy.submitted
      },
      {
        run: (_session, line) =>
          Effect.sync(() => void sent.push(line)).pipe(Effect.as({ wrote: "" })),
      },
    )

    expect(submitted).toEqual([{ kind: "prompt", text: "what is this" }])
    expect(sent).toEqual([])
  })

  // A command that opened a Session says so, and the screen follows it —
  // which is what `/clear` looks like from the far side.
  it("follows the Session a command over there opened", async () => {
    const next = sessionID("sess_next")
    const attached = await withSurface(
      HERE,
      async (fake, spy) => {
        fake.press("/clear")
        await heldWhere(
          () => spy.attached,
          (rows) => rows.includes(next),
        )
        return spy.attached
      },
      { run: () => Effect.succeed({ wrote: "", selected: next }) },
    )

    expect(attached.at(-1)).toBe(next)
  })
})

// The rows a panel is filled from, in the order the Domain holds them.
const PANEL_ROWS: readonly CommandInfo[] = [
  { id: "model", description: "Show or set the session model", argumentHint: "provider/model" },
  { id: "trace show", description: "Replay this Run", run: () => Effect.void },
  { id: "clear", description: "Open a new Session", run: () => Effect.void },
]

describe("the command palette", () => {
  it("lists every command row on ctrl+k", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      fake.key({ key: "k", ctrl: true })
      await settle()
      return fake.last()
    })

    expect(rowsOf(drawn)).toEqual(["/model", "/trace show", "/clear"])
    expect(drawn?.overlay?.source).toBe("query")
  })

  // The panel's own query: typing narrows it and never reaches the line.
  it("narrows on its own query, best answer first", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      fake.key({ key: "k", ctrl: true })
      await settle()
      for (const character of "tra") fake.key({ key: character })
      await settle()
      return fake.last()
    })

    expect(rowsOf(drawn)).toEqual(["/trace show"])
    expect(drawn?.input).toBe("")
  })

  it("moves the selection with up and down", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      fake.key({ key: "k", ctrl: true })
      await settle()
      fake.key({ key: "down" })
      await settle()
      return fake.last()
    })

    expect(chosenIn(drawn)).toBe("/trace show")
  })

  it("runs the selected row on enter", async () => {
    let ran = 0
    const rows: readonly CommandInfo[] = [
      { id: "clear", description: "x", run: () => Effect.sync(() => void (ran += 1)) },
    ]

    const drawn = await withSurface(rows, async (fake) => {
      fake.key({ key: "k", ctrl: true })
      await settle()
      fake.key({ key: "return" })
      await settle()
      return fake.last()
    })

    expect(ran).toBe(1)
    expect(drawn?.overlay).toBeUndefined()
  })

  /**
   * Enter runs it, whether or not it names an argument. `argumentHint` says
   * what an argument would look like and never that one is needed — the two
   * commands that name one, `/theme` and `/model`, both answer a bare line
   * with a choice of their own, and the palette used to type them out
   * instead of opening either.
   */
  it("runs a command that names an argument, rather than typing it out", async () => {
    let ran = 0
    const rows: readonly CommandInfo[] = [
      {
        id: "theme",
        description: "Choose the screen's colors",
        argumentHint: "theme",
        run: () => Effect.sync(() => void (ran += 1)),
      },
    ]

    const drawn = await withSurface(rows, async (fake) => {
      fake.key({ key: "k", ctrl: true })
      await settle()
      fake.key({ key: "return" })
      await settle()
      return fake.last()
    })

    expect(ran).toBe(1)
    expect(drawn?.input).toBe("")
    expect(drawn?.overlay).toBeUndefined()
  })

  // Tab is the key that leaves it ready for one, with the space it needs.
  it("leaves a command that names an argument on the line for tab", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      fake.key({ key: "k", ctrl: true })
      await settle()
      fake.key({ key: "tab" })
      await settle()
      return fake.last()
    })

    expect(drawn?.input).toBe("/model ")
    expect(drawn?.cursor).toBe("/model ".length)
    expect(drawn?.overlay).toBeUndefined()
  })

  it("closes on esc and leaves the line as it was", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      for (const character of "half") fake.key({ key: character })
      fake.key({ key: "k", ctrl: true })
      await settle()
      fake.key({ key: "escape" })
      await settle()
      return fake.last()
    })

    expect(drawn?.overlay).toBeUndefined()
    expect(drawn?.input).toBe("half")
  })
})

describe("slash completion", () => {
  // The panel follows the line: its query is the buffer, so typing keeps
  // editing the line and the panel keeps up with it.
  it("opens as the line names a command, and narrows with it", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      for (const character of "/tra") fake.key({ key: character })
      await settle()
      return fake.last()
    })

    expect(drawn?.overlay?.source).toBe("buffer")
    expect(rowsOf(drawn)).toEqual(["/trace show"])
    expect(drawn?.input).toBe("/tra")
  })

  // The argument after the space belongs to the person, not to a list.
  it("closes when a space starts the argument", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      for (const character of "/model") fake.key({ key: character })
      fake.key({ key: "space" })
      await settle()
      return fake.last()
    })

    expect(drawn?.overlay).toBeUndefined()
    expect(drawn?.input).toBe("/model ")
  })

  it("completes the line on tab, with the space a command that takes one needs", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      for (const character of "/mod") fake.key({ key: character })
      await settle()
      fake.key({ key: "tab" })
      await settle()
      return fake.last()
    })

    expect(drawn?.input).toBe("/model ")
    expect(drawn?.overlay).toBeUndefined()
  })

  // Dismissing is about this line: the next edit asks for the panel again.
  it("stays dismissed until the line moves on", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake) => {
      for (const character of "/mo") fake.key({ key: character })
      await settle()
      fake.key({ key: "escape" })
      await settle()
      const hushed = fake.last()
      fake.key({ key: "d" })
      await settle()
      return { hushed, after: fake.last() }
    })

    expect(drawn.hushed?.overlay).toBeUndefined()
    expect(drawn.hushed?.input).toBe("/mo")
    expect(drawn.after?.overlay?.source).toBe("buffer")
  })

  // A line that has stopped naming a command is a line with no panel over
  // it, whatever it goes on to be.
  it("closes when the line stops naming a command", async () => {
    const drawn = await withSurface(PANEL_ROWS, async (fake, spy) => {
      spy.hold()
      for (const character of "/mo") fake.key({ key: character })
      await settle()
      const showing = fake.last()
      for (const _ of "/mo") fake.key({ key: "backspace" })
      for (const character of "a prompt") fake.key({ key: character })
      await settle()
      return { showing, after: fake.last() }
    })

    expect(drawn.showing?.overlay?.source).toBe("buffer")
    expect(drawn.after?.overlay).toBeUndefined()
    expect(drawn.after?.input).toBe("a prompt")
  })

  it("submits the line as typed when no row answers it", async () => {
    const result = await withSurface(PANEL_ROWS, async (fake, spy) => {
      fake.press("/nope")
      await settle()
      return { written: fake.written(), submitted: spy.submitted }
    })

    expect(result.written).toContain("no such command: /nope")
    expect(result.submitted).toEqual([])
  })
})

describe("a picker a command opened", () => {
  // The rows a command offers, and what it did with the one it got back.
  const picker = (
    took: (row: PickRow | undefined) => void,
    rows: readonly PickRow[] = [
      { id: "one", label: "the first" },
      { id: "two", label: "the second", detail: "with a detail" },
    ],
  ): readonly CommandInfo[] => [
    {
      id: "choose",
      description: "x",
      run: (ctx) =>
        Effect.gen(function* () {
          if (ctx.pick === undefined) {
            ctx.write("no panel here\n")
            return
          }
          took(yield* ctx.pick("a choice", rows))
        }),
    },
  ]

  /**
   * The whole of `/theme` from the palette: the command panel closes, the
   * command runs, and the choice it opens takes its place. It used to type
   * `/theme ` onto the line and stop there, so the picker was two enters
   * away and the first one looked like nothing had happened.
   */
  it("opens the choice of a command taken from the palette", async () => {
    let took: PickRow | undefined
    const rows = picker((row) => void (took = row)).map((one) => ({
      ...one,
      argumentHint: "which",
    }))

    const drawn = await withSurface(rows, async (fake) => {
      fake.key({ key: "k", ctrl: true })
      await settle()
      // Enter on the command row, which runs it and opens its choice.
      fake.key({ key: "return" })
      await settle()
      const choosing = fake.last()
      fake.key({ key: "down" })
      fake.key({ key: "return" })
      await settle()
      return { choosing, after: fake.last() }
    })

    expect(drawn.choosing?.overlay?.title).toBe("a choice")
    expect(drawn.choosing?.input).toBe("")
    expect(took?.id).toBe("two")
    expect(drawn.after?.overlay).toBeUndefined()
  })

  it("hands the row back on enter, and closes", async () => {
    const taken: (PickRow | undefined)[] = []
    const drawn = await withSurface(
      picker((row) => void taken.push(row)),
      async (fake) => {
        fake.press("/choose")
        await settle()
        const open = fake.last()
        fake.key({ key: "down" })
        fake.key({ key: "return" })
        await settle()
        return { open, after: fake.last() }
      },
    )

    expect(rowsOf(drawn.open)).toEqual(["the first", "the second"])
    expect(taken).toEqual([{ id: "two", label: "the second", detail: "with a detail" }])
    expect(drawn.after?.overlay).toBeUndefined()
  })

  // Esc is "keep what you had", and a command hears that nobody chose —
  // never that a panel closed.
  it("hands nothing back on esc", async () => {
    const taken: (PickRow | undefined)[] = []
    const drawn = await withSurface(
      picker((row) => void taken.push(row)),
      async (fake) => {
        fake.press("/choose")
        await settle()
        fake.key({ key: "escape" })
        await settle()
        return fake.last()
      },
    )

    expect(taken).toEqual([undefined])
    expect(drawn?.overlay).toBeUndefined()
  })

  // A surface that cannot draw panels does not supply one, and the command
  // writes instead. This one can, so it does — the print surface is the
  // other half of the same test, in that plugin.
  it("supplies the panel this surface can draw", async () => {
    const written = await withSurface(
      picker(() => {}),
      async (fake) => {
        fake.press("/choose")
        await settle()
        fake.key({ key: "escape" })
        await settle()
        return fake.written()
      },
    )

    expect(written).not.toContain("no panel here")
  })

  /**
   * A pipe cannot go back, so it draws no panel — and a choice opened there
   * would wait on an answer that can never arrive. The command says its
   * answer in words instead, which is what a pipe wanted.
   */
  it("offers no choice where the renderer draws no panel", async () => {
    const taken: (PickRow | undefined)[] = []
    const drawn = await withSurface(
      picker((row) => void taken.push(row)),
      async (fake) => {
        fake.press("/choose")
        await settle()
        return fake.last()
      },
      { draws: { panels: false } },
    )

    expect(drawn?.overlay).toBeUndefined()
    expect(taken).toEqual([])
    expect((drawn?.notes ?? []).join("\n")).toContain("no panel here")
  })

  // Stopping outranks a question: the loop is waiting on the panel, so the
  // panel is answered with nothing before the quit can reach it.
  it("answers an open choice with nothing when the input ends", async () => {
    const taken: (PickRow | undefined)[] = []
    const stopped = await withSurface(
      picker((row) => void taken.push(row)),
      async (fake, _spy, frontend) => {
        fake.press("/choose")
        await settle()
        fake.end()
        await Effect.runPromise(frontend.done)
        return true
      },
    )

    expect(stopped).toBe(true)
    expect(taken).toEqual([undefined])
  })
})

describe("a picker that paints", () => {
  const DUSK = { foreground: "#eee", muted: "#888", accent: "#8888ff", warning: "#ffcc00" }
  const NOON = { foreground: "#111", muted: "#555", accent: "#0000ff", warning: "#ff0000" }

  const themePicker: readonly CommandInfo[] = [
    {
      id: "theme",
      description: "x",
      run: (ctx) =>
        Effect.gen(function* () {
          const chosen = yield* (
            ctx.pick?.("theme", [
              { id: "dusk", label: "Dusk", colors: DUSK },
              { id: "noon", label: "Noon", colors: NOON },
            ]) ?? Effect.succeed(undefined)
          )
          if (chosen?.colors !== undefined) ctx.paint?.(chosen.colors)
        }),
    },
  ]

  // The highlighted theme paints the screen as the selection moves: a theme
  // is looked at before it is chosen.
  it("paints the row under the selection", async () => {
    const drawn = await withSurface(themePicker, async (fake) => {
      fake.press("/theme")
      await settle()
      fake.key({ key: "down" })
      await settle()
      return fake.last()
    })

    expect(drawn?.theme).toEqual(NOON)
  })

  it("restores what you had when nothing is chosen", async () => {
    const drawn = await withSurface(
      themePicker,
      async (fake) => {
        fake.press("/theme")
        await settle()
        fake.key({ key: "down" })
        await settle()
        fake.key({ key: "escape" })
        await settle()
        return fake.last()
      },
      { theme: DUSK },
    )

    expect(drawn?.theme).toEqual(DUSK)
  })

  // What a look painted is not what a choice applied: the command is what
  // makes the colors stay.
  it("keeps the colors the command applied", async () => {
    const drawn = await withSurface(
      themePicker,
      async (fake) => {
        fake.press("/theme")
        await settle()
        fake.key({ key: "down" })
        fake.key({ key: "return" })
        await settle()
        return fake.last()
      },
      { theme: DUSK },
    )

    expect(drawn?.theme).toEqual(NOON)
  })

  // The theme configuration chose is on the first frame, so nothing is ever
  // drawn in colors nobody asked for.
  it("carries the theme it started with into every frame", async () => {
    const drawn = await withSurface(
      [],
      async (fake) => {
        await settle()
        return fake.last()
      },
      { theme: DUSK },
    )

    expect(drawn?.theme).toEqual(DUSK)
  })
})

describe("the surface", () => {
  it("cancels the Session on ctrl+c and stays at the prompt", async () => {
    const result = await withSurface([], async (fake, spy) => {
      fake.key({ key: "c", ctrl: true })
      await settle()
      fake.press("still here")
      await settle()
      return { cancelled: spy.cancelled, submitted: spy.submitted }
    })

    expect(result.cancelled).toEqual(["user"])
    expect(result.submitted).toEqual([{ kind: "prompt", text: "still here" }])
  })

  it("stops on ctrl+d, and `done` completes", async () => {
    const stopped = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = fakeRenderer()
          const spy = yield* fakeApi()
          const frontend = yield* makeSurface({
            client: spy.client,
            renderer: fake.renderer,
            commands: Effect.succeed([]),
            keymap: Effect.succeed(KEYMAP),
            where: { kind: "directory", path: "/somewhere" },
            version: "0.0.0",
            now: () => 0,
          })
          yield* Effect.yieldNow
          fake.key({ key: "d", ctrl: true })
          yield* frontend.done
          return true
        }),
      ),
    )

    expect(stopped).toBe(true)
  })

  // The end of the input is not a key, so no rebinding can strand a pipe:
  // app.quit lives on another chord here, and the surface still stops.
  it("stops when the input ends, whatever app.quit is bound to", async () => {
    const stopped = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = fakeRenderer()
          const spy = yield* fakeApi()
          const frontend = yield* makeSurface({
            client: spy.client,
            renderer: fake.renderer,
            commands: Effect.succeed([]),
            keymap: Effect.succeed([
              { id: "quit", binding: "ctrl+q", command: "app.quit", surface: "eva.tui" },
            ]),
            where: { kind: "directory", path: "/somewhere" },
            version: "0.0.0",
            now: () => 0,
          })
          yield* Effect.yieldNow
          fake.end()
          yield* frontend.done
          return true
        }),
      ),
    )

    expect(stopped).toBe(true)
  })

  it("drops the half-typed line when it is cancelled", async () => {
    const submitted = await withSurface([], async (fake, spy) => {
      for (const character of "abandon") fake.key({ key: character })
      fake.key({ key: "c", ctrl: true })
      await settle()
      fake.press("fresh")
      await settle()
      return spy.submitted
    })

    expect(submitted).toEqual([{ kind: "prompt", text: "fresh" }])
  })
})

describe("a closed Run", () => {
  // The record is the source of truth, but a fold that comes back empty has
  // lost the record rather than the conversation. Blanking the screen on it
  // would throw away the turn the reader just had.
  it("keeps what it showed when the record folds to nothing", async () => {
    const drawn = await withSurface([], async (fake) => {
      fake.press("a question")
      await settle()
      return fake.last()
    })

    expect(drawn?.session).toContainEqual(expect.objectContaining({ author: "human" }))
  })
})

/**
 * The key a Run needs, asked for before a prompt is spent. `MEMORY_MODEL`
 * names the `fake` provider, so a row for `fake` is the row this Session
 * would run against.
 */
describe("the credential preflight", () => {
  const row = (over: Partial<IntegrationInfo> = {}): IntegrationInfo => ({
    id: "fake.api_key",
    provider: "fake",
    mode: "api_key",
    connected: false,
    variable: "FAKE_API_KEY",
    ...over,
  })

  const started = (over: SurfaceOver): Promise<string> =>
    withSurface(
      [],
      async (fake) => {
        await settle()
        return fake.written()
      },
      over,
    )

  it("names the variable to export, and the way out that needs none", async () => {
    const written = await started({ integrations: [row()] })

    expect(written).toContain("no key for fake")
    expect(written).toContain("export FAKE_API_KEY")
    expect(written).toContain("Ollama")
  })

  it("says nothing when the provider is connected", async () => {
    const written = await started({ integrations: [row({ connected: true })] })
    expect(written).not.toContain("no key for")
  })

  // A compatible endpoint needs no key, so it projects no row and there is
  // nothing to warn about. A warning here would be noise on every run.
  it("says nothing about a provider that projects no row", async () => {
    const written = await started({ integrations: [row({ provider: "anthropic" })] })
    expect(written).not.toContain("no key for")
  })

  // The credentials that decide a Run are the serving process's, and this
  // process's say nothing about them.
  it("says nothing at an attached terminal", async () => {
    const written = await started({
      integrations: [row()],
      where: { kind: "runtime", origin: "http://127.0.0.1:7777" },
    })

    expect(written).not.toContain("no key for")
  })
})

describe("what went wrong on the way here", () => {
  // A degraded outcome is said where the person is looking. The fold
  // replaces it later, which is fine: a notice is for the person who just
  // started the surface.
  it("shows a notice it was handed", async () => {
    const written = await withSurface(
      [],
      async (fake) => {
        await settle()
        return fake.written()
      },
      { notices: ["theme dusk is not a theme here; the default is drawn instead"] },
    )

    expect(written).toContain("theme dusk is not a theme here")
  })

  it("names a binding that names no key this surface knows", async () => {
    const written = await withSurface(
      [],
      async (fake) => {
        await settle()
        return fake.written()
      },
      {
        keymap: [
          ...KEYMAP,
          { id: "palette", binding: "cmd+k", command: "command.palette", surface: "eva.tui" },
        ],
      },
    )

    expect(written).toContain("key binding palette names no key this surface knows: cmd+k")
  })

  // The rows collapse into a Map here, so here is where a silent overwrite
  // would happen — and it is not silent.
  it("names a key bound twice, in any spelling", async () => {
    const written = await withSurface(
      [],
      async (fake) => {
        await settle()
        return fake.written()
      },
      {
        keymap: [
          ...KEYMAP,
          { id: "also-quit", binding: "Ctrl+D", command: "app.quit", surface: "eva.tui" },
        ],
      },
    )

    expect(written).toContain("ctrl+d is bound twice (quit, also-quit); the last one wins")
  })
})

describe("a question from Eva", () => {
  // The Frontend half: the one path Eva uses when it needs a person. The
  // next line typed answers the question rather than opening a Run.
  it("shows the question and answers it with the next line", async () => {
    const result = await withSurface([], async (fake, spy, frontend) => {
      const answered = Effect.runPromise(
        frontend.ask({ kind: "question", id: "q1", question: "deploy to production?" }),
      )
      await settle()
      const asked = fake.written()
      fake.press("yes")
      await settle()
      return { asked, answer: await answered, submitted: spy.submitted }
    })

    expect(result.asked).toContain("deploy to production?")
    expect(result.answer).toEqual({ kind: "text", text: "yes" })
    // An answer is not a prompt: nothing was submitted to the Session.
    expect(result.submitted).toEqual([])
  })

  // A permission request is answered by naming an option, so the option a
  // person typed is what the gate reads rather than a line of prose.
  it("answers a permission request with the option a person named", async () => {
    const answer = await withSurface([], async (fake, _spy, frontend) => {
      const answered = Effect.runPromise(
        frontend.ask({ kind: "permission", id: "call_1", question: "run git push?" }),
      )
      await settle()
      fake.press("Allow once")
      await settle()
      return await answered
    })

    expect(answer).toEqual({ kind: "permission", optionId: "allow_once" })
  })

  /**
   * The other door answered. The gate races the two, so the door that lost is
   * interrupted — and that interrupt is the whole signal: a question nobody has
   * answered is not on the record, so there is nothing to watch for.
   *
   * What retires is the status line. A person who was being asked to answer is
   * no longer being asked, and a terminal that kept asking would be waiting on
   * an answer Eva has already had.
   */
  it("retires the prompt when the other door answers", async () => {
    const result = await withSurface([], async (fake, _spy, frontend) => {
      const asking = Effect.runFork(
        frontend.ask({ kind: "permission", id: "call_1", question: "run git push?" }),
      )
      await settle()
      const during = fake.last()?.status.mode

      await Effect.runPromise(Fiber.interrupt(asking))
      await settle()
      return { during, after: fake.last()?.status.mode }
    })

    expect(result.during).toBe(ASKING)
    expect(result.after).toBe("ready")
  })

  /**
   * Two questions at once. One tool group can hold two calls that both need a
   * person, and each ask is answered on its own — so the first line settles
   * the first question and the second question is then the one on the screen.
   *
   * One slot and one shared queue used to hold this: the second ask overwrote
   * the first, both waited on one answer, and which of them it settled was
   * whichever the runtime happened to wake.
   */
  it("answers each of two standing questions on its own, in the order they arrived", async () => {
    const result = await withSurface([], async (fake, _spy, frontend) => {
      const first = Effect.runPromise(
        frontend.ask({ kind: "permission", id: "call_1", question: "run git push?" }),
      )
      const second = Effect.runPromise(
        frontend.ask({ kind: "permission", id: "call_2", question: "run rm -rf build?" }),
      )
      await settle()
      // The first question is the one a person is looking at; the second waits
      // behind it rather than replacing it on the screen.
      const shown = fake.written()

      fake.press("Allow once")
      await settle()
      const afterFirst = fake.written()

      fake.press("Reject once")
      await settle()
      return {
        shown,
        afterFirst,
        first: await first,
        second: await second,
        mode: fake.last()?.status.mode,
      }
    })

    expect(result.shown).toContain("run git push?")
    // Answering the first shows the next rather than nothing.
    expect(result.afterFirst).toContain("run rm -rf build?")
    // Each answer settled the question it was given for.
    expect(result.first).toEqual({ kind: "permission", optionId: "allow_once" })
    expect(result.second).toEqual({ kind: "permission", optionId: "reject_once" })
    // Nothing stands, so the terminal is back to taking prompts.
    expect(result.mode).toBe("ready")
  })
})

describe("an open Run", () => {
  // The loop stays at the queue while a Run is open, so a cancel acts on
  // the Run it was pressed against — not on the prompt after it.
  it("cancels the Run it was pressed against", async () => {
    const result = await withSurface([], async (fake, spy) => {
      spy.hold()
      fake.press("go")
      await settle()
      fake.key({ key: "c", ctrl: true })
      await settle()
      return { cancelled: spy.cancelled, frame: fake.last() }
    })

    expect(result.cancelled).toEqual(["user"])
    expect(result.frame?.work.running).toBe(false)
    expect(result.frame?.status.mode).toBe("ready")
    expect(result.frame?.live).toBe("")
  })

  it("quits while a Run is open", async () => {
    const stopped = await withSurface([], async (fake, spy, frontend) => {
      spy.hold()
      fake.press("go")
      await settle()
      fake.key({ key: "d", ctrl: true })
      await Effect.runPromise(frontend.done)
      return true
    })

    expect(stopped).toBe(true)
  })

  /**
   * A row taken from the panel is a line like any other, so it goes through
   * the same fold. It did not, once: taking a row while a Run was open
   * forked a second Run over the first and lost the fiber holding it, so
   * nothing could interrupt it and its close named a Run the loop was no
   * longer holding.
   */
  it("holds a row taken from the palette until the open Run closes", async () => {
    const ran: string[] = []
    const rows: readonly CommandInfo[] = [
      { id: "deploy", description: "x", run: () => Effect.sync(() => void ran.push("deploy")) },
    ]

    const found = await withSurface(rows, async (fake, spy) => {
      const running = spy.hold()
      fake.press("first")
      await settle()

      fake.key({ key: "k", ctrl: true })
      await settle()
      fake.key({ key: "return" })
      await settle()

      const during = [...ran]
      running.release()
      await settle()
      return { during, after: [...ran], submitted: spy.submitted }
    })

    // The row waited behind the open Run rather than running over it.
    expect(found.during).toEqual([])
    expect(found.after).toEqual(["deploy"])
    // And no second Run was opened on top of the first.
    expect(found.submitted).toEqual([{ kind: "prompt", text: "first" }])
  })

  // A line typed during a Run waits its turn rather than racing it.
  it("runs a line typed during a Run after the Run closes", async () => {
    const submitted = await withSurface([], async (fake, spy) => {
      const running = spy.hold()
      fake.press("first")
      await settle()
      fake.press("second")
      await settle()
      const during = spy.submitted.length
      running.release()
      await settle()
      return { during, after: spy.submitted }
    })

    expect(submitted.during).toBe(1)
    expect(submitted.after).toEqual([
      { kind: "prompt", text: "first" },
      { kind: "prompt", text: "second" },
    ])
  })

  // And it waits where a person can see it waiting: a queue a reader cannot
  // see is a line they type a second time. The words are the composer fold's,
  // so this door and the page say a queue the same way.
  it("says how many lines wait behind the open Run", async () => {
    const hints = await withSurface([], async (fake, spy) => {
      const running = spy.hold()
      fake.press("first")
      await settle()
      fake.press("second")
      await settle()
      const during = fake.last()?.work.hint
      running.release()
      await settle()
      return { during, after: fake.last()?.work.hint }
    })

    expect(hints.during).toBe("1 waiting")
    expect(hints.after).toBe("")
  })

  /**
   * The gesture, at the terminal. A plain line queues behind the open Run —
   * the test above — and this one rides it. What the steer then does to a
   * tool group is the harness's rule and is proven where the harness runs;
   * what is proven here is that the key reaches it, spelled `next-step`.
   */
  it("steers the open Run rather than queueing behind it", async () => {
    const found = await withSurface([], async (fake, spy) => {
      const running = spy.hold()
      fake.press("first")
      await settle()
      for (const character of "go left") fake.key({ key: character === " " ? "space" : character })
      fake.key({ key: "s", ctrl: true })
      const submitted = await heldWhere(
        () => spy.submitted,
        (calls) => calls.length > 1,
      )
      running.release()
      await settle()
      return submitted
    })

    expect(found).toEqual([
      { kind: "prompt", text: "first" },
      { kind: "steer", text: "go left", target: "next-step" },
    ])
  })

  // And it opens no Run of its own. A steer answers at once, so a surface
  // that treated it as a prompt would hold a Run number nothing closes.
  it("opens no Run on a steer", async () => {
    const found = await withSurface([], async (fake, spy) => {
      for (const character of "go left") fake.key({ key: character === " " ? "space" : character })
      fake.key({ key: "s", ctrl: true })
      await settle()
      return spy.submitted
    })

    expect(found).toEqual([{ kind: "steer", text: "go left", target: "next-step" }])
  })

  // The one path Eva uses when it needs a person opens during a Run. The
  // loop must be at the queue to carry the answer back.
  it("answers a question asked while a Run is open", async () => {
    const result = await withSurface([], async (fake, spy, frontend) => {
      const running = spy.hold()
      fake.press("deploy")
      await settle()
      const answered = Effect.runPromise(
        frontend.ask({ kind: "question", id: "q1", question: "are you sure?" }),
      )
      await settle()
      fake.press("yes")
      await settle()
      const answer = await answered
      running.release()
      await settle()
      return { answer, submitted: spy.submitted }
    })

    expect(result.answer).toEqual({ kind: "text", text: "yes" })
    // An answer is not a prompt: only the first line opened a Run.
    expect(result.submitted).toEqual([{ kind: "prompt", text: "deploy" }])
  })

  // A Run that says nothing for a while is still a Run that is working, so
  // the spinner turns on a clock of its own rather than on what arrives.
  it("turns the spinner while nothing is streamed", async () => {
    let clock = 0
    const drawn = await withSurface(
      [],
      async (fake, spy) => {
        const running = spy.hold()
        fake.press("go")
        await pause(TICK * 3)
        const during = fake.last()
        running.release()
        await settle()
        return { during, after: fake.last() }
      },
      { now: () => (clock += 250) },
    )

    expect(drawn.during?.work.running).toBe(true)
    expect(drawn.during?.work.tick).toBeGreaterThan(0)
    expect(drawn.during?.work.elapsed).not.toBe("")
    // The spinner stops with the Run, and what it took stays on the turn.
    expect(drawn.after?.work).toEqual({ running: false, elapsed: "", tick: 0, hint: "" })
    expect(drawn.after?.took).toMatch(/^took \d+\.\ds$/)
  })
})

/**
 * W0's exit test: kill the connection mid-Run and the surface reconnects by
 * trace position, with no line lost and none doubled. The runtime does the
 * reconnecting; what the surface pays is one repaint.
 */
describe("a dropped connection", () => {
  const said = (value: string): Payload => ({
    kind: "text",
    block: 0,
    content: { type: "text", text: value },
  })

  // The words the session pane is showing, as a reader sees them.
  const shown = (frame: Frame | undefined): string =>
    (frame?.session ?? [])
      .filter((message) => message.author === "agent")
      .flatMap((message) => message.blocks)
      .map((block) =>
        block.type === "content" && block.content.type === "text" ? block.content.text : "",
      )
      .join("")

  it("costs one repaint, and the record shows every line once", async () => {
    const drawn = await withSurface([], async (fake, spy) => {
      const running = spy.hold()
      fake.press("go")
      await settle()
      await Effect.runPromise(spy.publish(said("first")))
      const streaming = await drawnWhere(fake, (frame) => (frame?.live ?? "").includes("first"))

      // The pipe goes with the Run still open, and the Trace moves without
      // it: what commits now is what a live watch would have missed.
      await Effect.runPromise(spy.drop)
      await heldWhere(spy.open, (open) => open === 0)
      await Effect.runPromise(spy.publish(said(" and second")))
      await Effect.runPromise(spy.restore)

      // The record replaced the stream: the words are in the session pane
      // and the live area is empty again.
      const repainted = await drawnWhere(fake, (frame) => shown(frame).includes(" and second"))
      running.release()
      await settle()
      return { streaming, repainted, closed: fake.last() }
    })

    // Before the drop the words were live, and nothing was folded at anyone.
    expect(drawn.streaming?.live).toContain("first")
    expect(shown(drawn.streaming)).toBe("")

    // After it, both are in the record, each exactly once, in position order.
    expect(shown(drawn.repainted)).toBe("first and second")
    expect(drawn.repainted?.live).toBe("")
    // The repaint is not an ending: the Run says when it is over. The status
    // may still say the runtime is catching up, which is not "ready" either.
    expect(drawn.repainted?.work.running).toBe(true)
    expect([SYNCHRONIZING, "running"]).toContain(drawn.repainted?.status.mode)

    // And the close is still the close.
    expect(shown(drawn.closed)).toBe("first and second")
    expect(drawn.closed?.work.running).toBe(false)
    expect(drawn.closed?.status.mode).toBe("ready")
  })

  /**
   * The runtime recovers on its own. The one thing it cannot do is say why
   * the words stopped moving, and this surface reads `state` to say it.
   */
  it("says the pipe is gone, and stops saying so when it is back", async () => {
    const drawn = await withSurface([], async (fake, spy) => {
      const running = spy.hold()
      fake.press("go")
      await settle()

      await Effect.runPromise(spy.drop)
      const gone = await drawnWhere(fake, (frame) => frame?.status.mode === DISCONNECTED)

      await Effect.runPromise(spy.restore)
      const back = await drawnWhere(fake, (frame) => frame?.status.mode !== DISCONNECTED)
      running.release()
      await settle()
      return { gone, back, closed: fake.last() }
    })

    expect(drawn.gone?.status.mode).toBe(DISCONNECTED)
    // A Run is still open behind the drop, and the screen still says so.
    expect(drawn.gone?.work.running).toBe(true)
    expect(drawn.back?.status.mode).not.toBe(DISCONNECTED)
    expect(drawn.closed?.status.mode).toBe("ready")
  })
})
