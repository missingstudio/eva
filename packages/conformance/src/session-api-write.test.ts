import { tmpdir } from "node:os"
import { join } from "node:path"
import { apiWire } from "@missingstudio/eva-api"
import { httpTransport } from "@missingstudio/eva-api/client"
import { approval } from "@missingstudio/eva-approval"
import { makeSessionAPI, overSurface, type Api, type Kernel } from "@missingstudio/eva-boot"
import {
  PERMISSION_OPTIONS,
  providerTurn,
  type ModelRef,
  type Provider,
  type SessionAPI,
  type ToolResult,
} from "@missingstudio/eva-core"
import { diff } from "@missingstudio/eva-diff"
import type { Event, Payload } from "@missingstudio/eva-schema"
import { define, type Frontend, type Plugin, type SurfaceInfo } from "@missingstudio/eva-sdk"
import {
  calling,
  CALLING_SESSION,
  committed,
  FAKE_PROVIDER,
  providing,
  scripted,
  virtualFileSystem,
  withKernel,
} from "@missingstudio/eva-testkit"
import { toolEdit } from "@missingstudio/eva-tool-edit"
import { toolPolicy } from "@missingstudio/eva-tool-policy"
import { trace } from "@missingstudio/eva-trace"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { serveWeb } from "@missingstudio/eva-web"
import { Deferred, Effect, Fiber, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"

/**
 * The write half of the Session API, from both doors, against a live kernel.
 *
 * `session-api-contract.test.ts` runs the whole contract over three fillers,
 * so what the wire answers is already held to what the kernel answers. What is
 * proven here is the half a filler cannot state: a Run opened over a socket is
 * the same Run, judged by the same gate, and recorded the same way — because
 * below the Session API nothing knows which surface asked.
 */

const MODEL: ModelRef = { provider: "fake", model: "model" }
const TERMINAL = "test.surface.term"

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

/**
 * Where a write goes in. Both doors are the same contract, so a clause names
 * one and every assertion after it is about Eva rather than about a transport.
 *
 * The socket is opened where a person's Eva opens it — behind `eva.web`'s own
 * server, from the handler the composition root hands over — so what is under
 * test is the composition and not a socket a suite wired for itself.
 */
interface Door {
  readonly name: string
  readonly of: (api: SessionAPI) => Effect.Effect<SessionAPI, never, Scope.Scope>
}

const overSocket = (api: SessionAPI): Effect.Effect<SessionAPI, never, Scope.Scope> =>
  Effect.gen(function* () {
    // The address is read back out of what the surface printed, because a
    // `Frontend` carries none. Nothing here reads the page, so the root names
    // a tree no build ever filled.
    const said: string[] = []
    yield* serveWeb({
      root: join(tmpdir(), "eva-write-half-no-page"),
      bind: { host: "127.0.0.1", port: 0 },
      posture: "local",
      api: apiWire(api),
      write: (line) => void said.push(line),
    })
    const transport = yield* httpTransport({ origin: said.join("").split(" ")[0] ?? "" })
    return transport.api
  })

const inProcess: Door = { name: "in this process", of: (api) => Effect.succeed(api) }
const overWire: Door = { name: "over the socket", of: overSocket }
const doors: readonly Door[] = [inProcess, overWire]

/**
 * The Session is opened beside the door, because `create` is on neither half of
 * the wire: a page that takes no input opens no Session. Everything the clause
 * then writes goes through the door it named.
 */
const writing = <A>(
  door: Door,
  plugins: readonly Plugin[],
  body: (writes: SessionAPI, api: Api, kernel: Kernel) => Effect.Effect<A>,
  config: Record<string, unknown> = {},
): Promise<A> =>
  withKernel(
    plugins,
    (kernel, scope) =>
      Effect.gen(function* () {
        const api = yield* makeSessionAPI(kernel, MODEL, scope)
        const writes = yield* Effect.provideService(door.of(api.session), Scope.Scope, scope)
        return yield* body(writes, api, kernel)
      }),
    { config },
  )

const payloadsOf = (record: readonly Event[]): readonly Payload[] =>
  record.map((event) => event.payload)

/**
 * The rule the whole surface line rests on: below the Session API, the factory
 * never knows which surface asked. Every action lands in the Trace identically
 * and is attributed to an identity — never to a door.
 *
 * There is no field to read for that. The envelope carries a Session, a Run
 * and a position, and no actor; `Identity` is a slot a later stage fills, and
 * this stage adds no record kinds. So the claim is proven the only way it can
 * be: the two doors are driven in turn and the records are compared. A wire
 * that stamped itself anywhere would fail here.
 */
describe("a Prompt, through each door", () => {
  const opened = (door: Door): Promise<readonly Payload[]> =>
    writing(
      door,
      [trace, traceMemory, scripted([{ payloads: [text("an answer")] }]).plugin],
      (writes, api, kernel) =>
        Effect.gen(function* () {
          const session = yield* api.session.create("/here")
          yield* writes.submit(session, { kind: "prompt", text: "ask" })
          return payloadsOf(yield* committed(kernel))
        }),
    )

  it("opens a Run the record holds", async () => {
    const said = await opened(overWire)

    expect(said[0]).toEqual({ kind: "started", intent: "ask" })
    expect(said.some((one) => one.kind === "text")).toBe(true)
    expect(said.at(-1)).toMatchObject({ kind: "finished", claim: { result: "done" } })
  })

  it("leaves the same record whichever door it came through", async () => {
    const direct = await opened(inProcess)
    const over = await opened(overWire)

    expect(over).toEqual(direct)
  })
})

/**
 * A Provider parked mid-turn, so a Run is still open when a cancel arrives.
 * `reached` fires once the turn is parked and nothing more streams, which is
 * what makes the cancel a mid-Run one rather than a race with the close.
 */
const parked = (reached: Deferred.Deferred<void>): Provider => ({
  id: FAKE_PROVIDER,
  available: () => true,
  turn: () =>
    providerTurn(
      Stream.concat(
        Stream.fromIterable([text("part")]),
        Stream.unwrap(
          Effect.andThen(
            Deferred.succeed(reached, undefined),
            Effect.never as Effect.Effect<never>,
          ),
        ),
      ),
      "end_turn",
    ),
})

describe("a cancel, through each door", () => {
  // The partial work is already committed and the Run ends `cancelled`,
  // because a Run that never closed cannot be folded.
  it.each(doors)("stops a Run in flight, and the record says so — $name", async (door) => {
    const reached = Effect.runSync(Deferred.make<void>())
    const said = await writing(
      door,
      [trace, traceMemory, providing(parked(reached))],
      (writes, api, kernel) =>
        Effect.gen(function* () {
          const session = yield* api.session.create("/here")
          const running = yield* Effect.forkChild(
            writes.submit(session, { kind: "prompt", text: "ask" }),
          )
          yield* Deferred.await(reached)
          yield* writes.cancel(session, "user")
          yield* Fiber.await(running)
          return payloadsOf(yield* committed(kernel))
        }),
    )

    expect(said.at(-1)).toMatchObject({
      kind: "finished",
      claim: { result: "failed", summary: "cancelled" },
      stopReason: "cancelled",
    })
  })
})

/**
 * The gate, from both doors. `overSurface` races the surface's own `ask`
 * against `SessionAPI.answer`, because both are answers to one request — so
 * the only difference between a terminal and a page is which door the answer
 * came through, and the decision must not be able to tell.
 *
 * The surface here never answers by itself, so every answer below arrives
 * through the door under test.
 */
const waiting = (id: string): Frontend => ({ id, ask: () => Effect.never, done: Effect.void })

const surfaceRow = (id: string): Plugin =>
  define({
    id,
    effect: Effect.fn(id)(function* (ctx) {
      yield* ctx.surface.transform((draft) => {
        draft.set({ id, interactive: true, streaming: false, images: false } satisfies SurfaceInfo)
      })
    }),
  })

const EDIT = { path: "one.md", hunks: [{ find: "before", replace: "after" }] }

interface Gated {
  readonly result: ToolResult
  readonly held: string | undefined
}

describe("a permission answered through each door", () => {
  const answered = (door: Door, optionId: string): Promise<Gated> => {
    const virtual = virtualFileSystem({ "one.md": "before\n" })

    return withKernel(
      [
        traceMemory,
        trace,
        diff,
        virtual.plugin,
        toolEdit,
        toolPolicy,
        approval,
        surfaceRow(TERMINAL),
      ],
      (kernel, scope) =>
        Effect.gen(function* () {
          // The write tool records what it wrote, so there is a Run for it to
          // record in — the same open `calling` leans on everywhere else.
          const recorder = yield* kernel.slot.recorder.peek
          if (recorder !== undefined) yield* recorder.open(CALLING_SESSION)

          const api = yield* makeSessionAPI(kernel, MODEL, scope)
          const writes = yield* Effect.provideService(door.of(api.session), Scope.Scope, scope)
          const asking = yield* Deferred.make<void>()

          const calls = calling(kernel, {
            approving: overSurface(kernel, {
              frontend: Effect.succeed(waiting(TERMINAL)),
              // The request is open from the call and not from when its fiber
              // runs, so an answer cannot arrive before there is something to
              // answer. This is what says it is open.
              request: (id) => Effect.andThen(Deferred.succeed(asking, undefined), api.request(id)),
            }),
          })

          const running = yield* Effect.forkChild(calls.call("edit", EDIT))
          yield* Deferred.await(asking)
          yield* writes.answer("call_1", { kind: "permission", optionId })
          const result = yield* Fiber.join(running)
          return { result, held: virtual.files()["one.md"] }
        }),
      { config: { approval: { mode: "supervised" } } },
    )
  }

  const allowing = PERMISSION_OPTIONS.filter((one) => one.kind.startsWith("allow"))
  const denying = PERMISSION_OPTIONS.filter((one) => one.kind.startsWith("reject"))

  describe.each(doors)("$name", (door) => {
    it.each(allowing)("lets the call run on $optionId", async (option) => {
      const found = await answered(door, option.optionId)

      expect(found.result.disposition).toBe("ok")
      expect(found.held).toBe("after\n")
    })

    it.each(denying)("denies the call on $optionId", async (option) => {
      const found = await answered(door, option.optionId)

      expect(found.result.disposition).toBe("denied")
      expect(found.held).toBe("before\n")
    })
  })

  // And the same decision, not merely the same shape of one: the two doors are
  // driven in turn over one option and what came back is compared.
  it("is the same decision from either door", async () => {
    const direct = await answered(inProcess, "reject_once")
    const over = await answered(overWire, "reject_once")

    expect(over.result).toEqual(direct.result)
    expect(over.held).toBe(direct.held)
  })
})
