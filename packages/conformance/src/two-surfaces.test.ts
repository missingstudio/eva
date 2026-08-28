import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { makeApi, type Answering } from "@missingstudio/eva-api"
import { httpTransport } from "@missingstudio/eva-api/client"
import { approval, remembering } from "@missingstudio/eva-approval"
import { boot, buildOf, makeSessionAPI, overSurface, type Kernel } from "@missingstudio/eva-boot"
import { localTransport, makeClient } from "@missingstudio/eva-client-runtime"
import type { FrontendAnswer, ModelRef, ProposedCall, SessionAPI } from "@missingstudio/eva-core"
import { diff } from "@missingstudio/eva-diff"
import { harnessLoop, LOOP_HARNESS_ID } from "@missingstudio/eva-harness-loop"
import type { Event, Payload, SessionID } from "@missingstudio/eva-schema"
import {
  define,
  type Frontend,
  type FrontendRequest,
  type Plugin,
  type SurfaceInfo,
} from "@missingstudio/eva-sdk"
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
import { makeWeb, WEB_SURFACE } from "@missingstudio/eva-web"
import { watchAsking } from "@missingstudio/eva-web/client"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { describe, expect, it } from "vitest"

/**
 * W2's exit scene: one process, one Session, two surfaces.
 *
 * A person starts a Session in the terminal, answers its permission request in
 * the browser, and finishes in the terminal. Below the Session API nothing
 * knows which surface asked, so the Trace shows one Session and no record says
 * a second door was ever there.
 *
 * The doors are the real ones. The terminal's is a `Frontend` in this process
 * behind the local transport, which is what `plugins/tui` is handed. The
 * browser's is the whole of what a page holds: `eva.web`'s ask channel to read
 * the question, and `eva.api`'s HTTP transport to answer it, run a line and
 * write. A plugin may not import a plugin, so the two halves of the one port
 * are joined here the way `apps/cli`'s `serving` joins them.
 *
 * `both-doors.test.ts` is the request's own suite — every option, the grant an
 * `allow_always` writes, the stale answer that lands on nothing. What is here
 * is the half that needs two surfaces at once: the race between them, the one
 * Resolution they share, and the Session that shows neither.
 *
 * No model is in the room. The Provider is `scripted`, so what a Run proposes
 * is written down here.
 */

const MODEL: ModelRef = { provider: "fake", model: "model" }
const TERMINAL = "test.surface.terminal"
const CALL = "call_1"

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const EDIT = { path: "one.md", hunks: [{ find: "before", replace: "after" }] }
const AGAIN = { path: "one.md", hunks: [{ find: "after", replace: "again" }] }

// One Run that proposes a write, and the turn that closes it.
const proposing = (id: string, args: unknown): readonly ScriptedTurn[] => [
  {
    payloads: [text("Changing it.")],
    toolCalls: [{ id, name: "edit", args }] satisfies readonly ProposedCall[],
  },
  { payloads: [text("Changed it.")] },
]

/**
 * The row that says the terminal takes input. `overSurface` reads the row and
 * never the `Frontend`, so a door whose row says otherwise is a door it never
 * asks.
 */
const terminalRow: Plugin = define({
  id: TERMINAL,
  effect: Effect.fn(TERMINAL)(function* (ctx) {
    yield* ctx.surface.transform((draft) => {
      draft.set({
        id: TERMINAL,
        interactive: true,
        streaming: true,
        images: false,
      } satisfies SurfaceInfo)
    })
  }),
})

const fakeCatalog: Plugin = define({
  id: "test.catalog.fake",
  effect: Effect.fn("test.catalog.fake")(function* (ctx) {
    yield* ctx.catalog.transform((draft) => {
      draft.model.update(MODEL.provider, MODEL.model, () => {})
      draft.model.default.set(MODEL)
    })
  }),
})

interface BenchOptions {
  readonly script?: readonly ScriptedTurn[]
  readonly mode?: string
}

/**
 * The build, bound on an ephemeral loopback port, with both doors open on it.
 *
 * The surfaces are read through a cell rather than captured, because they
 * start after the API they answer through is built — the `runSurface` rule.
 * The gate is `remembering(overSurface(...))`, which is the gate every door in
 * `apps/cli` composes: `overSurface` alone is a gate no door has, and a suite
 * that proved things about it would keep passing while the half that writes a
 * grant went wrong.
 */
const bench = async (options: BenchOptions = {}) => {
  const said: string[] = []
  const files = virtualFileSystem({ "one.md": "before\n" })
  const scope = await Effect.runPromise(Scope.make())

  // The two halves of one port, joined as the composition root joins them.
  let wire: ((api: SessionAPI) => Answering) | undefined
  const web = makeWeb({
    assets: () => mkdtempSync(join(tmpdir(), "eva-two-surfaces-")),
    host: "127.0.0.1",
    port: 0,
    write: (line) => void said.push(line),
    api: (client) => wire?.(client.api),
  })

  const plugins: readonly Plugin[] = [
    trace,
    traceMemory,
    files.plugin,
    diff,
    toolRead,
    toolEdit,
    sched,
    toolPolicy,
    approval,
    fakeCatalog,
    scripted(options.script ?? proposing(CALL, EDIT)).plugin,
    harnessLoop,
    terminalRow,
    makeApi({ serve: (one) => void (wire = one) }),
    web,
  ]

  /**
   * The person at the terminal. They answer nothing until a clause releases
   * them, and they answer a tick later — a prompt still being drawn is not yet
   * a prompt to retire, and a winner that completes inside the loser's own
   * step never interrupts the loser at all.
   */
  const release = Deferred.makeUnsafe<void>()
  const retired = Deferred.makeUnsafe<string>()
  let answer: FrontendAnswer | undefined
  const waiting = Effect.never as Effect.Effect<FrontendAnswer>
  const terminal: Frontend = {
    id: TERMINAL,
    ask: () =>
      Effect.onInterrupt(
        Effect.andThen(
          Deferred.await(release),
          Effect.andThen(
            Effect.yieldNow,
            Effect.suspend(() => (answer === undefined ? waiting : Effect.succeed(answer))),
          ),
        ),
        () => Effect.asVoid(Deferred.succeed(retired, TERMINAL)),
      ),
    done: Effect.void,
  }

  const live: Frontend[] = [terminal]
  // Where an `allow_always` writes its rule. It is this bench's own, so the
  // one write in the permission lifecycle never reaches a person's home.
  const env = {
    EVA_CONFIG: join(mkdtempSync(join(tmpdir(), "eva-two-surfaces-grant-")), "config.yaml"),
  }

  const started = await Effect.runPromise(
    Effect.gen(function* () {
      const kernel: Kernel = yield* boot({
        scope,
        resolved: plugins.map((one) => ({ id: one.id })),
        build: buildOf(plugins),
        config: { approval: { mode: options.mode ?? "supervised" } },
      })
      const api = yield* makeSessionAPI(kernel, MODEL, scope, {
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

  // The page's own two halves: the ask channel it reads, and the wire it
  // answers, commands and writes through.
  const heard: (readonly FrontendRequest[])[] = []
  const stopReading = watchAsking((asking) => void heard.push(asking), { origin })
  const page = await Effect.runPromise(httpTransport({ origin }))

  const until = async (holds: (asking: readonly FrontendRequest[]) => boolean) => {
    for (let tries = 0; tries < 600; tries += 1) {
      const last = heard.at(-1)
      if (last !== undefined && holds(last)) return last
      await new Promise((wake) => setTimeout(wake, 5))
    }
    return heard.at(-1)
  }

  // The page is reading before anything is asked, because the stream is the
  // presence signal as well as the channel.
  await until(() => true)

  return {
    page,
    // The terminal's own handle, over the local transport.
    terminal: started.client,
    // The question the page has heard of, once it stands.
    asked: () => until((asking) => asking.length > 0),
    // Nothing standing, once the page has heard the question withdrawn.
    nothing: () => until((asking) => asking.length === 0),
    // The person at the terminal answers, once a clause says what they said.
    answers: (given: FrontendAnswer) => {
      answer = given
      Effect.runSync(Deferred.succeed(release, undefined))
    },
    // Which door's prompt the race retired.
    retired: () => Effect.runPromise(Deferred.await(retired)),
    held: () => files.files()["one.md"],
    record: () => Effect.runPromise(committed(started.kernel)),
    sessions: () =>
      Effect.runPromise(Effect.flatMap(started.kernel.slot.traceSink.get, (sink) => sink.sessions)),
    close: async () => {
      stopReading()
      await Effect.runPromise(Scope.close(scope, Exit.void))
    },
  }
}

type Desk = Awaited<ReturnType<typeof bench>>

const payloadsOf = (record: readonly Event[]): readonly Payload[] =>
  record.map((event) => event.payload)

const dispositionsIn = (record: readonly Event[]): readonly string[] =>
  payloadsOf(record).flatMap((one) => (one.kind === "tool_result" ? [one.disposition] : []))

// A Prompt the terminal sent, on a fiber, so a clause can answer it from the
// other door while it is still open.
const prompting = (desk: Desk, session: SessionID) =>
  Effect.runFork(
    desk.terminal.api.submit(session, {
      kind: "prompt",
      text: "change it",
      harness: LOOP_HARNESS_ID,
    }),
  )

const opened = (desk: Desk) => Effect.runPromise(desk.terminal.api.create("/here"))

describe("a Session the terminal starts and the browser answers", () => {
  /**
   * The exit scene, whole. The Session is opened and prompted from the
   * terminal, the permission request is answered in the browser, and the
   * terminal finishes it — one Run gated by the page, one after it that needs
   * nobody, and the fold the terminal reads at the end holds both.
   */
  it("starts in the terminal, is answered in the browser, and finishes in the terminal", async () => {
    const desk = await bench({
      script: [...proposing(CALL, EDIT), { payloads: [text("Nothing is left.")] }],
    })
    const session = await opened(desk)
    const running = prompting(desk, session)

    expect(await desk.asked()).toEqual([
      { kind: "permission", id: CALL, question: expect.stringContaining("edit changes one.md") },
    ])
    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "allow_once" }),
    )
    await Effect.runPromise(Fiber.join(running))

    // The browser's answer is what let the write land.
    expect(desk.held()).toBe("after\n")

    // Finished where it started, and the fold the terminal reads holds it all.
    await Effect.runPromise(
      desk.terminal.api.submit(session, { kind: "prompt", text: "anything left?" }),
    )
    const folded = await Effect.runPromise(Effect.scoped(desk.terminal.api.attach(session)))

    expect(folded.session).toBe(session)
    expect(folded.answer().claim?.result).toBe("done")
    expect(dispositionsIn(folded.events())).toEqual(["ok"])
    await desk.close()
  })

  /**
   * The seam that must not exist. The record carries a Session, a Run and a
   * position and no actor, so a wire or a surface that stamped itself
   * anywhere would be readable here — and the whole scene above is one
   * Session and not a handover between two.
   */
  it("leaves one Session on the Trace, and no record that names a surface", async () => {
    const desk = await bench()
    const session = await opened(desk)
    const running = prompting(desk, session)
    await desk.asked()
    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "allow_once" }),
    )
    await Effect.runPromise(Fiber.join(running))

    expect(await desk.sessions()).toEqual([session])

    const record = await desk.record()
    // The record is really there, so the seam check below cannot pass on an
    // empty one.
    expect(dispositionsIn(record)).toEqual(["ok"])

    const written = JSON.stringify(record)
    expect(written).not.toContain(WEB_SURFACE)
    expect(written).not.toContain(TERMINAL)
    await desk.close()
  })
})

describe("one request, two doors", () => {
  /**
   * The browser wins, and the terminal's prompt goes with it. There is nothing
   * else to retire it: the race interrupts the door that lost, and that
   * interrupt is the whole of a terminal's obligation.
   */
  it("takes the answer the browser gave, and retires the prompt in the terminal", async () => {
    const desk = await bench()
    const session = await opened(desk)
    const running = prompting(desk, session)
    await desk.asked()

    await Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "reject_once" }),
    )
    await Effect.runPromise(Fiber.join(running))

    expect(dispositionsIn(await desk.record())).toEqual(["denied"])
    expect(desk.held()).toBe("before\n")
    expect(await desk.retired()).toBe(TERMINAL)
    await desk.close()
  })

  /**
   * The other way round, and the other door's obligation. A page cannot be
   * interrupted from here, so what retires its card is the question leaving
   * the set it is reading.
   */
  it("takes the answer the terminal gave, and withdraws the question from the page", async () => {
    const desk = await bench()
    const session = await opened(desk)
    const running = prompting(desk, session)
    await desk.asked()

    desk.answers({ kind: "permission", optionId: "allow_once" })
    await Effect.runPromise(Fiber.join(running))

    expect(dispositionsIn(await desk.record())).toEqual(["ok"])
    expect(desk.held()).toBe("after\n")
    expect(await desk.nothing()).toEqual([])
    await desk.close()
  })

  /**
   * Both at once, which is the clause the roadmap states. One Question has one
   * Resolution however many doors answer it: the first settles the request and
   * the second lands on nothing, so the Trace holds one decision and the file
   * holds one write.
   */
  it("records one decision for a request both doors answered", async () => {
    const desk = await bench()
    const session = await opened(desk)
    const running = prompting(desk, session)
    await desk.asked()

    // Sent before the terminal is released, and awaited after, so both answers
    // are in flight at the same time.
    const posted = Effect.runPromise(
      desk.page.api.answer(CALL, { kind: "permission", optionId: "allow_once" }),
    )
    desk.answers({ kind: "permission", optionId: "allow_once" })
    await posted
    await Effect.runPromise(Fiber.join(running))

    const record = await desk.record()
    expect(dispositionsIn(record)).toEqual(["ok"])
    expect(payloadsOf(record).filter((one) => one.kind === "edit")).toHaveLength(1)
    expect(desk.held()).toBe("after\n")
    expect(await desk.nothing()).toEqual([])
    await desk.close()
  })
})

/**
 * A line the page ran, and the Run in this process that it changed.
 *
 * A command is not a `SessionAPI` method and it crosses the wire all the same:
 * the rows a line resolves through belong to the process that holds the
 * Domains, and the Run is in that process. A door that ran `/mode` for itself
 * would change its own approval state and leave the Run under the mode it
 * already had — which is a thing only two doors over one kernel can show.
 */
describe("a command the browser ran", () => {
  it("changes the mode the terminal's next write is judged by", async () => {
    const desk = await bench({
      mode: "autonomous",
      script: [...proposing(CALL, EDIT), ...proposing("call_2", AGAIN)],
    })
    const session = await opened(desk)

    // Autonomous, so the first write needs nobody.
    await Effect.runPromise(Fiber.join(prompting(desk, session)))
    expect(desk.held()).toBe("after\n")

    const ran = await Effect.runPromise(desk.page.command(session, "/mode read-only"))
    expect(ran.wrote).toContain("read-only")

    await Effect.runPromise(Fiber.join(prompting(desk, session)))

    // The row left the domain, so the execution refuses the name: a mode is
    // capability selection and not a filter at call time.
    expect(dispositionsIn(await desk.record())).toEqual(["ok", "unknown_tool"])
    expect(desk.held()).toBe("after\n")
    await desk.close()
  })

  // The other line that does work rather than reporting it. The write it
  // reverses is one the terminal's Run made.
  it("reverses a write the terminal's Run made", async () => {
    const desk = await bench({ mode: "autonomous" })
    const session = await opened(desk)

    await Effect.runPromise(Fiber.join(prompting(desk, session)))
    expect(desk.held()).toBe("after\n")

    const ran = await Effect.runPromise(desk.page.command(session, "/undo"))

    expect(ran.wrote).toContain("one.md is as it was")
    expect(desk.held()).toBe("before\n")
    await desk.close()
  })
})
