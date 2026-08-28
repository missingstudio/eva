import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeApi, type Answering } from "@missingstudio/eva-api"
import { httpTransport } from "@missingstudio/eva-api/client"
import { approval, remembering } from "@missingstudio/eva-approval"
import { boot, buildOf, makeSessionAPI, overSurface, type Kernel } from "@missingstudio/eva-boot"
import { localTransport, makeClient } from "@missingstudio/eva-client-runtime"
import { commands } from "@missingstudio/eva-commands"
import type { ModelRef, ProposedCall, SessionAPI } from "@missingstudio/eva-core"
import { diff } from "@missingstudio/eva-diff"
import { harnessLoop, LOOP_HARNESS_ID } from "@missingstudio/eva-harness-loop"
import { BINDINGS } from "@missingstudio/eva-keymap"
import type { Event, Payload } from "@missingstudio/eva-schema"
import { define, type Frontend, type FrontendRequest, type Plugin } from "@missingstudio/eva-sdk"
import { sched } from "@missingstudio/eva-sched"
import {
  committed,
  scripted,
  virtualFileSystem,
  type ScriptedTurn,
} from "@missingstudio/eva-testkit"
import { toolEdit } from "@missingstudio/eva-tool-edit"
import { toolPolicy } from "@missingstudio/eva-tool-policy"
import { toolRead } from "@missingstudio/eva-tool-read"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { ASKING, makeSurface, TUI_SURFACE, type SurfaceDeps } from "@missingstudio/eva-tui-surface"
import { makeWeb, WEB_SURFACE } from "@missingstudio/eva-web"
import { watchAsking } from "@missingstudio/eva-web/client"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { attached } from "./attach.js"
import { attaching, BUILT_IN, tui } from "./plugins.js"
import type { Started } from "./run.js"
import { runSurface, type Startable } from "./surface.js"

/**
 * `eva attach <url>`: the terminal, run against a runtime another process
 * serves.
 *
 * Both halves are real. The runtime is a booted kernel with the two halves of
 * one port on it, joined the way `serving` joins them, on an ephemeral
 * loopback address. The terminal is the real `eva.tui` surface over
 * `eva.api`'s HTTP transport, started through `runSurface` by the real
 * `attached` opening — so the Client, the ordering and the ask relay are the
 * ones `eva attach` uses. Two things stand in: the renderer, because a suite
 * has no terminal, and the row lookup, because `attaching` names the real
 * renderer and this cannot load it.
 *
 * The attaching process boots a kernel of its own, with its own approval
 * plugin and its own tools. That is what makes the command clause mean
 * something: a `/mode` dispatched here would have a Domain of its own to
 * change, and the clause is that it changes the other one.
 *
 * No model is in the room. The Provider is `scripted`, so what a Run proposes
 * is written down here.
 */

const MODEL: ModelRef = { provider: "fake", model: "model" }
const OTHER: ModelRef = { provider: "fake", model: "other" }
const CALL = "call_1"

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const EDIT = { path: "one.md", hunks: [{ find: "before", replace: "after" }] }

// One Run that proposes a write, and the turn that closes it.
const proposing = (id: string, args: unknown): readonly ScriptedTurn[] => [
  {
    payloads: [text("Changing it.")],
    toolCalls: [{ id, name: "edit", args }] satisfies readonly ProposedCall[],
  },
  { payloads: [text("Changed it.")] },
]

const fakeCatalog: Plugin = define({
  id: "test.catalog.fake",
  effect: Effect.fn("test.catalog.fake")(function* (ctx) {
    yield* ctx.catalog.transform((draft) => {
      for (const one of [MODEL, OTHER]) draft.model.update(one.provider, one.model, () => {})
      draft.model.default.set(MODEL)
    })
  }),
})

type Rendering = SurfaceDeps["renderer"]
type Frame = Parameters<Rendering["draw"]>[0]
type KeyPress = Parameters<Parameters<Rendering["onKey"]>[0]>[0]

interface Fake {
  readonly renderer: Rendering
  readonly press: (line: string) => void
  readonly key: (key: Partial<KeyPress> & { readonly key: string }) => void
  readonly end: () => void
  readonly last: () => Frame | undefined
}

// A Renderer that keeps the frames it was given. `press` types a line and
// hits return; `end` closes the input, which is how a person quits.
const fakeRenderer = (): Fake => {
  const keys = new Set<(press: KeyPress) => void>()
  const ends = new Set<() => void>()
  const drawn: Frame[] = []
  const pressOf = (given: Partial<KeyPress> & { readonly key: string }): KeyPress => ({
    ctrl: false,
    shift: false,
    meta: false,
    glyph: Array.from(given.key).length === 1 && given.ctrl !== true && given.meta !== true,
    ...given,
  })
  const deliver = (press: KeyPress) => {
    for (const handler of keys) handler(press)
  }
  return {
    renderer: {
      draw: (frame) => void drawn.push(frame),
      draws: { panels: true, colors: true },
      onKey: (handler) => {
        keys.add(handler)
        return () => void keys.delete(handler)
      },
      onPaste: () => () => {},
      onEnd: (handler) => {
        ends.add(handler)
        return () => void ends.delete(handler)
      },
      stop: () => {},
    },
    press: (line) => {
      for (const character of line) {
        deliver(pressOf({ key: character === " " ? "space" : character }))
      }
      deliver(pressOf({ key: "return" }))
    },
    key: (given) => deliver(pressOf(given)),
    end: () => {
      for (const handler of ends) handler()
    },
    last: () => drawn.at(-1),
  }
}

const pause = (milliseconds: number) => new Promise((wake) => setTimeout(wake, milliseconds))

// The frame once the screen shows a condition, or the last one there was. A
// bounded poll costs nothing on a run that passes and does not care how
// loaded the host is.
const drawnWhere = async (fake: Fake, holds: (frame: Frame | undefined) => boolean) => {
  const deadline = Date.now() + 4_000
  while (!holds(fake.last()) && Date.now() < deadline) await pause(5)
  return fake.last()
}

// The same bounded poll for what a test reads off the runtime rather than
// off the screen. Every such read crosses a socket, so it is awaited.
const heldWhere = async <A>(read: () => Promise<A>, holds: (value: A) => boolean): Promise<A> => {
  const deadline = Date.now() + 4_000
  for (;;) {
    const value = await read()
    if (holds(value) || Date.now() > deadline) return value
    await pause(5)
  }
}

interface BenchOptions {
  readonly script?: readonly ScriptedTurn[]
  readonly mode?: string
  /**
   * A page, prompting, with a question already standing before the terminal
   * attaches. It is what a person attaches for: a runtime that stopped to
   * ask something.
   */
  readonly standing?: boolean
}

const bench = async (options: BenchOptions = {}) => {
  const said: string[] = []
  const files = virtualFileSystem({ "one.md": "before\n" })
  const scope = await Effect.runPromise(Scope.make())

  // The two halves of one port, joined as the composition root joins them.
  let wire: ((api: SessionAPI) => Answering) | undefined
  const serving: readonly Plugin[] = [
    trace,
    traceMemory,
    files.plugin,
    diff,
    toolRead,
    toolEdit,
    sched,
    toolPolicy,
    approval,
    commands,
    fakeCatalog,
    scripted(options.script ?? proposing(CALL, EDIT)).plugin,
    harnessLoop,
    makeApi({ serve: (one) => void (wire = one) }),
    makeWeb({
      assets: () => mkdtempSync(join(tmpdir(), "eva-attach-")),
      host: "127.0.0.1",
      port: 0,
      write: (line) => void said.push(line),
      api: (client) => wire?.(client.api),
    }),
  ]

  // Where an `allow_always` writes its rule. It is this bench's own, so the
  // one write in the permission lifecycle never reaches a person's home.
  const env = {
    EVA_CONFIG: join(mkdtempSync(join(tmpdir(), "eva-attach-grant-")), "config.yaml"),
  }

  const runtime = await Effect.runPromise(
    Effect.gen(function* () {
      const kernel: Kernel = yield* boot({
        scope,
        resolved: serving.map((one) => ({ id: one.id })),
        build: buildOf(serving),
        config: { approval: { mode: options.mode ?? "supervised" } },
      })
      // The page is the only surface this process holds, and the gate reaches
      // it the way every door in `apps/cli` reaches one.
      const live: Frontend[] = []
      const api = yield* makeSessionAPI(kernel, MODEL, scope, {
        // The default a Prompt that names none is answered by, which is what
        // the config of a real serving process says.
        harness: LOOP_HARNESS_ID,
        gate: (request) =>
          remembering(overSurface(kernel, { frontends: Effect.sync(() => live), request }), env),
      })
      const client = yield* makeClient(yield* localTransport(api.session))
      const rows = yield* kernel.domains.surface.get
      const row = rows.find((one) => one.id === WEB_SURFACE)
      if (row?.start === undefined) throw new Error("no eva.web row")
      live.push(yield* Effect.provideService(row.start(client), Scope.Scope, scope))
      return { kernel, client }
    }),
  )

  const origin = said.join("").split(" ")[0] ?? ""

  // The page beside it: `eva.api`'s wire to write and answer through, and
  // `eva.web`'s ask channel to read the questions that stand.
  const heard: (readonly FrontendRequest[])[] = []
  let stopReading: (() => void) | undefined
  const reading = () => {
    stopReading ??= watchAsking((asking) => void heard.push(asking), { origin })
    return Effect.runPromise(httpTransport({ origin }))
  }
  const until = async (holds: (asking: readonly FrontendRequest[]) => boolean) => {
    const deadline = Date.now() + 4_000
    for (;;) {
      const last = heard.at(-1)
      if ((last !== undefined && holds(last)) || Date.now() > deadline) return last
      await pause(5)
    }
  }

  // A Run the page opened, stopped at a question, before this terminal is
  // anywhere. The channel is the presence signal, so the page reading is what
  // makes the runtime ask at all.
  if (options.standing === true) {
    const ahead = await reading()
    const session = await Effect.runPromise(ahead.api.create("/elsewhere"))
    Effect.runFork(ahead.api.submit(session, { kind: "prompt", text: "change it" }))
    await until((asking) => asking.length > 0)
  }

  /**
   * The attaching process. Its kernel holds an approval plugin and tools of
   * its own, so a line that ran here would have something here to change.
   */
  const near: readonly Plugin[] = [toolRead, toolEdit, sched, toolPolicy, approval, commands]
  const fake = fakeRenderer()

  const attachScope = await Effect.runPromise(Scope.make())
  const terminal = await Effect.runPromise(
    Effect.gen(function* () {
      const kernel: Kernel = yield* boot({
        scope: attachScope,
        resolved: near.map((one) => ({ id: one.id })),
        build: buildOf(near),
        config: { approval: { mode: options.mode ?? "supervised" } },
      })
      const transport = yield* httpTransport({ origin })
      const started: Started = {
        kernel,
        env,
        config: { plugins: [], raw: {}, origin: {} },
        model: MODEL,
      }
      /**
       * The row `attaching` rebuilds, with the renderer stood in for. What is
       * real is everything the ticket is about: the wire as the Client, the
       * runtime as the place the banner names, and `run` as the route a line
       * takes.
       */
      const row: Startable = {
        id: TUI_SURFACE,
        interactive: true,
        streaming: true,
        images: false,
        start: (client) =>
          makeSurface({
            client,
            renderer: fake.renderer,
            commands: kernel.domains.command.get,
            keymap: Effect.succeed(BINDINGS),
            where: { kind: "runtime", origin },
            run: transport.command,
            version: "0.0.0",
            now: () => 0,
          }),
      }
      const running = Effect.runFork(
        Effect.scoped(runSurface(started, row, [], attached(transport, origin))),
      )
      return { kernel, running }
    }),
  )

  const page = { open: reading, until }

  // The first frame, which the terminal draws once the Session it opened
  // answers. Nothing is typed before there is a Session to type into.
  await drawnWhere(fake, (frame) => frame !== undefined)

  return {
    fake,
    page,
    // What the serving process holds, read the way any door reads it.
    sessions: () => Effect.runPromise(runtime.client.api.list),
    modelOf: (session: string) => Effect.runPromise(runtime.client.api.model.get(session as never)),
    record: () => Effect.runPromise(committed(runtime.kernel)),
    toolsThere: () =>
      Effect.runPromise(
        Effect.map(runtime.kernel.domains.tool.get, (rows) => rows.map((r) => r.id)),
      ),
    toolsHere: () =>
      Effect.runPromise(
        Effect.map(terminal.kernel.domains.tool.get, (rows) => rows.map((r) => r.id)),
      ),
    held: () => files.files()["one.md"],
    close: async () => {
      stopReading?.()
      fake.end()
      await Effect.runPromise(Scope.close(attachScope, Exit.void))
      await Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
}

type Desk = Awaited<ReturnType<typeof bench>>

const payloadsOf = (record: readonly Event[]): readonly Payload[] =>
  record.map((event) => event.payload)

const dispositionsIn = (record: readonly Event[]): readonly string[] =>
  payloadsOf(record).flatMap((one) => (one.kind === "tool_result" ? [one.disposition] : []))

// A Run that closed, as the record says it closed. A cancel is a Claim that
// failed and says so in one word, which is the word this reads.
const claimsIn = (record: readonly Event[]): readonly (string | undefined)[] =>
  payloadsOf(record).flatMap((one) => (one.kind === "finished" ? [one.claim.summary] : []))

// The one Session this run opened, which the attached terminal opened over
// the wire before it drew a frame.
const theSession = async (desk: Desk): Promise<string> => {
  const rows = await heldWhere(
    () => desk.sessions(),
    (asked) => asked.length > 0,
  )
  const found = rows[0]
  if (found === undefined) throw new Error("no Session was opened")
  return found.id
}

describe("a terminal attached to a runtime another process serves", () => {
  /**
   * The Session is opened over the wire before the first frame is drawn, and
   * it belongs to the serving process's directory: this terminal names none,
   * because the directory it is running in is not where the work happens.
   */
  it("opens its Session on the runtime, and names the runtime on the banner", async () => {
    const desk = await bench({ mode: "autonomous" })
    const rows = await desk.sessions()

    expect(rows).toHaveLength(1)
    const banner = desk.fake.last()?.banner
    expect(banner?.directory).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    // A branch read here would be this machine's, and the repository is on
    // the other one.
    expect(banner?.branch).toBe("")
    await desk.close()
  })

  // A line that names no command is a Prompt, and the Run it opens is a Run
  // in the serving process: the file it writes is that process's file.
  it("prompts the runtime, and the Run happens there", async () => {
    const desk = await bench({ mode: "autonomous" })
    desk.fake.press("change it")

    expect(
      await heldWhere(
        async () => desk.held(),
        (one) => one === "after\n",
      ),
    ).toBe("after\n")
    expect(dispositionsIn(await desk.record())).toEqual(["ok"])
    await desk.close()
  })

  /**
   * The question is asked in the serving process and answered at this
   * terminal. `eva.web` streams the questions that stand and the answer goes
   * back through `SessionAPI.answer`, which is the door a surface at the end
   * of a socket has.
   */
  it("answers a permission request the runtime asked", async () => {
    const desk = await bench()
    desk.fake.press("change it")

    await drawnWhere(desk.fake, (frame) => frame?.status.mode === ASKING)
    desk.fake.press("allow_once")

    expect(
      await heldWhere(
        async () => desk.held(),
        (one) => one === "after\n",
      ),
    ).toBe("after\n")
    expect(dispositionsIn(await desk.record())).toEqual(["ok"])
    await desk.close()
  })

  /**
   * The reason a person attaches: the runtime stopped to ask something, and
   * nobody at that machine can answer it. The question is on the channel
   * before this terminal exists, so it is on the first frame the channel
   * hands it — and it reaches a surface, which had to be live before
   * anything was offered to it.
   */
  it("shows a question that already stood when it attached", async () => {
    const desk = await bench({ standing: true })

    expect(await drawnWhere(desk.fake, (frame) => frame?.status.mode === ASKING)).toBeDefined()
    desk.fake.press("allow_once")

    expect(
      await heldWhere(
        async () => desk.held(),
        (one) => one === "after\n",
      ),
    ).toBe("after\n")
    await desk.close()
  })

  // The cancel crosses the wire as a Session API call, so the Run the serving
  // process is holding is the one that stops.
  it("cancels the Run the runtime is holding", async () => {
    const desk = await bench()
    desk.fake.press("change it")

    await drawnWhere(desk.fake, (frame) => frame?.status.mode === ASKING)
    desk.fake.key({ key: "c", ctrl: true })

    const closed = await heldWhere(
      () => desk.record(),
      (asked) => claimsIn(asked).includes("cancelled"),
    )
    expect(claimsIn(closed)).toContain("cancelled")
    // The write never landed, because the call it gated never ran.
    expect(desk.held()).toBe("before\n")
    await desk.close()
  })

  // `/model` is a command, so it runs where the Domains are — and the model
  // it sets is a fact of the Session the serving process holds.
  it("switches the model of the Session the runtime holds", async () => {
    const desk = await bench({ mode: "autonomous" })
    const session = await theSession(desk)
    expect(await desk.modelOf(session)).toEqual(MODEL)

    desk.fake.press("/model fake/other")

    expect(
      await heldWhere(
        () => desk.modelOf(session),
        (asked) => asked.model === OTHER.model,
      ),
    ).toEqual(OTHER)
    await desk.close()
  })
})

/**
 * The clause the ticket is named for. A command reaches Domains rather than a
 * Session, and it changes state where it runs — so a terminal that dispatched
 * its own lines would move the approval state of the process nobody is
 * talking to and leave the runtime under the mode it already had.
 *
 * Both processes carry the approval plugin and both carry `edit`, so the
 * mistake is reachable and the two answers are told apart.
 */
describe("a command an attached terminal ran", () => {
  it("changes the serving process's approval state, and not this one's", async () => {
    const desk = await bench({ mode: "autonomous" })
    expect(await desk.toolsThere()).toContain("edit")
    expect(await desk.toolsHere()).toContain("edit")

    desk.fake.press("/mode read-only")

    expect(
      await heldWhere(
        () => desk.toolsThere(),
        (asked) => !asked.includes("edit"),
      ),
    ).not.toContain("edit")
    // The mode moved where the Run is. Here nothing moved.
    expect(await desk.toolsHere()).toContain("edit")
    await desk.close()
  })
})

/**
 * The third clause: a terminal and a page over one runtime. They see one
 * Session because there is one, and they race one gate because the gate is
 * the serving process's — the first answer settles the request and the second
 * lands on nothing.
 */
describe("an attached terminal and a page over one runtime", () => {
  it("see one Session, and race one gate", async () => {
    const desk = await bench()
    const page = await desk.page.open()
    const session = await theSession(desk)

    // The page lists what the runtime holds, and it is the Session the
    // terminal opened.
    expect((await Effect.runPromise(page.api.list)).map((one) => one.id)).toEqual([session])

    desk.fake.press("change it")
    await drawnWhere(desk.fake, (frame) => frame?.status.mode === ASKING)
    // The page is reading the same question off the same channel.
    expect(await desk.page.until((asking) => asking.length > 0)).toEqual([
      { kind: "permission", id: CALL, question: expect.stringContaining("edit changes one.md") },
    ])

    await Effect.runPromise(page.api.answer(CALL, { kind: "permission", optionId: "allow_once" }))

    // The page's answer is what let the write land, and the terminal's prompt
    // is retired by the ask being interrupted.
    expect(
      await heldWhere(
        async () => desk.held(),
        (one) => one === "after\n",
      ),
    ).toBe("after\n")
    expect(await drawnWhere(desk.fake, (frame) => frame?.status.mode !== ASKING)).toBeDefined()
    expect(desk.fake.last()?.status.mode).not.toBe(ASKING)

    // One Question, one Resolution, one write.
    const record = await desk.record()
    expect(dispositionsIn(record)).toEqual(["ok"])
    expect(payloadsOf(record).filter((one) => one.kind === "edit")).toHaveLength(1)
    await desk.close()
  })
})

/**
 * The table `eva attach` boots. The terminal is rebuilt around the wire and
 * nothing else changes: a build that dropped a row here would be an attached
 * run with no theme, no keymap and no config projection.
 *
 * The order is the clause that matters most. Both surface rows are
 * interactive and the first one wins the door, so a rebuild that moved the
 * terminal behind the page would attach a browser to the runtime and leave
 * the person looking at a prompt nothing is behind.
 */
describe("the build an attached run boots", () => {
  it("replaces the terminal row where it stands, and keeps every other one", () => {
    const build = buildOf([...BUILT_IN])
    const rebuilt = attaching(build, "http://127.0.0.1:7777", () => Effect.succeed({ wrote: "" }))

    expect(rebuilt.all.map((one) => one.id)).toEqual(build.all.map((one) => one.id))
    expect(rebuilt.all.find((one) => one.id === TUI_SURFACE)).not.toBe(tui)
  })

  // The row is really before the page's, which is what the door reads.
  it("leaves the terminal ahead of the page", () => {
    const ids = attaching(buildOf([...BUILT_IN]), "http://127.0.0.1:7777", () =>
      Effect.succeed({ wrote: "" }),
    ).all.map((one) => one.id)

    expect(ids.indexOf(TUI_SURFACE)).toBeLessThan(ids.indexOf(WEB_SURFACE))
  })
})
