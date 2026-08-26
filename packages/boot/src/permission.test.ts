import {
  PERMISSION_OPTIONS,
  type FrontendAnswer,
  type ModelRef,
  type PermissionOutcome,
  type PermissionRequest,
  type RequestID,
} from "@missingstudio/eva-core"
import { define, type Frontend, type Plugin, type SurfaceInfo } from "@missingstudio/eva-sdk"
import { sessionID } from "@missingstudio/eva-schema"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { boot, buildOf, type Kernel } from "./boot.js"
import { overSurface } from "./permission.js"
import { makeSessionAPI } from "./session.js"

const MODEL: ModelRef = { provider: "anthropic", model: "claude-sonnet-4-5" }
const SESSION = sessionID("sess_ask")
const CALL = "call_1"

const request: PermissionRequest = {
  sessionId: SESSION,
  toolCall: { toolCallId: CALL, title: "run git push?" },
  options: PERMISSION_OPTIONS,
}

// A surface row, the way a surface plugin registers one.
const surfaceRow = (id: string, interactive: boolean): Plugin =>
  define({
    id,
    effect: Effect.fn(id)(function* (ctx) {
      yield* ctx.surface.transform((draft) => {
        draft.set({ id, interactive, streaming: false, images: false } satisfies SurfaceInfo)
      })
    }),
  })

/**
 * A surface that never answers by itself. Every answer in this suite arrives
 * through `SessionAPI.answer`, which is the door a surface at the end of a
 * socket has — so what is proven is the seam and not one surface's queue.
 */
const waiting = (id: string): Frontend => ({
  id,
  ask: () => Effect.never,
  done: Effect.void,
})

// A surface that answers the direct call, the way the terminal does.
const speaking = (id: string, answer: FrontendAnswer): Frontend => ({
  id,
  ask: () => Effect.succeed(answer),
  done: Effect.void,
})

interface Asking {
  readonly outcome: PermissionOutcome
}

/**
 * One ask over a live kernel and a real Session API. The answer goes in
 * through `SessionAPI.answer` and the ask waits on `Api.request`, which is
 * the wait/resolve seam the Session API already had and nothing had used.
 */
const asking = (options: {
  readonly plugins?: readonly Plugin[]
  readonly frontend?: Frontend
  readonly answer?: FrontendAnswer
}): Promise<Asking> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const plugins = options.plugins ?? []
      const scope = yield* Scope.make()
      const kernel: Kernel = yield* boot({
        scope,
        resolved: plugins.map((plugin) => ({ id: plugin.id })),
        build: buildOf(plugins),
      })
      const api = yield* makeSessionAPI(kernel, MODEL, scope)
      const opened = yield* Deferred.make<void>()

      const approving = overSurface(kernel, {
        frontend: Effect.succeed(options.frontend),
        request: (id: RequestID) =>
          Effect.andThen(Deferred.succeed(opened, undefined), api.request(id)),
      })

      const asked = yield* Effect.forkChild(approving(request, { ...CALL_SHAPE }))
      if (options.answer !== undefined) {
        yield* Deferred.await(opened)
        yield* api.session.answer(CALL, options.answer)
      }
      const outcome = yield* Fiber.join(asked)
      yield* Scope.close(scope, Exit.void)
      return { outcome }
    }),
  )

const CALL_SHAPE = { id: CALL, name: "bash", args: { command: ["git", "push"] }, session: SESSION }

describe("a permission request with nobody to answer it", () => {
  it("is a denial when no surface is running", async () => {
    const { outcome } = await asking({})

    expect(outcome).toEqual({
      kind: "reject_once",
      reason: "nobody is there to answer: run git push?",
    })
  })

  /**
   * A surface says what it can do on its own row, and `eva.web` says
   * `interactive: false`. So the page never gets a permission prompt and the
   * gate rejects rather than hanging on an answer that cannot arrive.
   */
  it("is a denial when the surface takes no input", async () => {
    const { outcome } = await asking({
      plugins: [surfaceRow("acme.page", false)],
      frontend: waiting("acme.page"),
    })

    expect(outcome).toEqual({
      kind: "reject_once",
      reason: "acme.page takes no input, so nobody can answer: run git push?",
    })
  })

  // A surface with no row at all has said nothing about taking input, so it
  // is read as one that does not.
  it("is a denial when the surface registered no row", async () => {
    const { outcome } = await asking({ frontend: waiting("acme.ghost") })

    expect(outcome.kind).toBe("reject_once")
  })
})

describe("all four options, over SessionAPI.answer", () => {
  const over = (optionId: string) =>
    asking({
      plugins: [surfaceRow("acme.term", true)],
      frontend: waiting("acme.term"),
      answer: { kind: "permission", optionId },
    })

  it.each(["allow_once", "allow_always"] as const)("round-trips %s", async (kind) => {
    expect((await over(kind)).outcome).toEqual({ kind })
  })

  it.each(["reject_once", "reject_always"] as const)("round-trips %s", async (kind) => {
    expect((await over(kind)).outcome).toEqual({
      kind,
      reason: "a person refused: run git push?",
    })
  })

  // The reject arms carry a required reason, so a gate that denies always
  // words its denial.
  it("names an answer that names no option as a refusal for this call only", async () => {
    const { outcome } = await over("maybe_later")

    expect(outcome).toEqual({ kind: "reject_once", reason: "nobody answered: run git push?" })
  })

  it("reads a cancelled answer as nobody having answered", async () => {
    const { outcome } = await asking({
      plugins: [surfaceRow("acme.term", true)],
      frontend: waiting("acme.term"),
      answer: { kind: "cancelled" },
    })

    expect(outcome).toEqual({ kind: "reject_once", reason: "nobody answered: run git push?" })
  })
})

/**
 * The other door. `Frontend.ask` already carries the request id and the
 * question, so a surface in this process answers by returning — and the two
 * doors race, because both are answers to one request.
 */
describe("an answer the surface returns itself", () => {
  it("is the answer, with nothing arriving over the API", async () => {
    const { outcome } = await asking({
      plugins: [surfaceRow("acme.term", true)],
      frontend: speaking("acme.term", { kind: "permission", optionId: "allow_always" }),
    })

    expect(outcome).toEqual({ kind: "allow_always" })
  })

  // A terminal that offers the four as words answers with the words, which is
  // what a surface answering `{ kind: "text" }` already does.
  it("reads an option a person typed in words", async () => {
    const { outcome } = await asking({
      plugins: [surfaceRow("acme.term", true)],
      frontend: speaking("acme.term", { kind: "text", text: "Allow once" }),
    })

    expect(outcome).toEqual({ kind: "allow_once" })
  })
})
