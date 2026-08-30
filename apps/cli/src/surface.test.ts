import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boot } from "@missingstudio/eva-boot"
import {
  PERMISSION_OPTIONS,
  type FrontendAnswer,
  type PermissionRequest,
  type ToolCall,
} from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import type { Frontend, SurfaceInfo } from "@missingstudio/eva-sdk"
import { Deferred, Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import type { Started } from "./run.js"
import { gateFor, pickSurface, runDoor, type Door } from "./surface.js"

const row = (over: Partial<SurfaceInfo> & { id: string }): SurfaceInfo => ({
  interactive: false,
  streaming: true,
  images: false,
  ...over,
})

const startable = (id: string, ran: string[]): SurfaceInfo =>
  row({
    id,
    interactive: true,
    start: () =>
      Effect.succeed({
        id,
        ask: () => Effect.succeed({ kind: "cancelled" }),
        done: Effect.sync(() => void ran.push(id)),
      } satisfies Frontend),
  })

const withKernel = <A>(
  surfaces: readonly SurfaceInfo[],
  body: (started: Started) => Effect.Effect<A, unknown>,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const kernel = yield* boot({ scope, resolved: [] })
      yield* kernel.domains.surface
        .transform((draft) => {
          for (const one of surfaces) draft.set(one)
        })
        .pipe(Effect.provideService(Scope.Scope, scope))

      const started: Started = {
        kernel,
        // The environment this run was given, as every door hands it on.
        env: {},
        config: { plugins: [], raw: {}, origin: {} },
        model: { provider: "fake", model: "model" },
      }
      const result = yield* body(started)
      yield* Scope.close(scope, Exit.void)
      return result
    }),
  )

describe("pickSurface", () => {
  it("passes over a surface that cannot ask a person", () => {
    const rows = [row({ id: "eva.print" }), startable("eva.tui", [])]
    expect(pickSurface(rows)?.id).toBe("eva.tui")
  })

  // A row without `start` names a surface the build knows of but cannot run.
  it("passes over an interactive row with nothing to start", () => {
    expect(pickSurface([row({ id: "eva.tui", interactive: true })])).toBeUndefined()
  })

  it("takes the first that can run, so registration order decides", () => {
    const ran: string[] = []
    const rows = [startable("first", ran), startable("second", ran)]
    expect(pickSurface(rows)?.id).toBe("first")
  })
})

/**
 * The gate is composed here and nowhere else, because this is the only place
 * an `Api` and a live `Frontend` both exist. Under it, a tool call's `ask`
 * reaches the person at whichever surface this run started.
 */
describe("the gate every door runs under", () => {
  const GATED = sessionID("sess_gate")
  const ASKED: PermissionRequest = {
    sessionId: GATED,
    toolCall: { toolCallId: "call_1", title: "edit may change something. Run it?" },
    options: PERMISSION_OPTIONS,
  }
  const CALL: ToolCall = {
    id: "call_1",
    name: "edit",
    args: { path: "a.ts" },
    session: GATED,
  }

  // A call the rule language can grant: a grant is written over the words a
  // command would run, and an Edit names none.
  const RAN: ToolCall = {
    id: "call_2",
    name: "bash",
    args: { command: ["git", "status"] },
    session: GATED,
  }

  const answering = (answer: FrontendAnswer, id = "eva.tui"): Frontend => ({
    id,
    ask: () => Effect.succeed(answer),
    done: Effect.void,
  })

  const asking = (
    surfaces: readonly Frontend[],
    env: NodeJS.ProcessEnv = {},
    call: ToolCall = CALL,
    rows: readonly SurfaceInfo[] = [row({ id: "eva.tui", interactive: true })],
  ) =>
    withKernel(rows, (started) =>
      gateFor(started.kernel, () => surfaces, env)(() => Effect.never)(ASKED, call),
    )

  it("carries a person's answer back as the option they named", async () => {
    const outcome = await asking([answering({ kind: "permission", optionId: "allow_once" })])
    expect(outcome).toStrictEqual(Exit.succeed({ kind: "allow_once" }))
  })

  /**
   * A door with nobody behind it — `--print`, `eva run`, or a surface that has
   * not started yet — denies and says nobody is there. Every door composes
   * this gate, so that is the one sentence a call with no person gets.
   */
  it("denies while no surface is running, and says nobody is there", async () => {
    const outcome = await asking([])

    expect(Exit.isSuccess(outcome) && outcome.value.kind).toBe("reject_once")
    expect(Exit.isSuccess(outcome) && "reason" in outcome.value && outcome.value.reason).toContain(
      "nobody is there to answer",
    )
  })

  /**
   * The one write in the whole permission lifecycle, through the gate every
   * door composes. It lands where the World this run was given says, and
   * never where the process does — a suite handed a scratch directory for
   * exactly this reason must not write into the person's own home.
   */
  it("writes an allow_always into the config the World names", async () => {
    const directory = mkdtempSync(join(tmpdir(), "eva-gate-"))
    const path = join(directory, "config.yaml")

    const outcome = await asking(
      [answering({ kind: "permission", optionId: "allow_always" })],
      { EVA_CONFIG: path },
      RAN,
    )

    expect(outcome).toStrictEqual(Exit.succeed({ kind: "allow_always" }))
    // The rule language is the policy plugin's and its shape is proven where
    // the two plugins meet. What this door owes is the path: the file is the
    // one the World named, and it holds a rule over the words the gate judged.
    const held = readFileSync(path, "utf8")
    expect(held).toContain("policy:")
    expect(held).toContain("git")
    expect(held).toContain("status")
  })

  /**
   * `eva --web` holds the terminal and the page at once, so one request has
   * two doors in this process and the gate races both. Whichever answers
   * first is the answer, and the prompt at the other door is retired by the
   * interrupt the race sends it — there is nothing else to retire it with.
   */
  describe("two surfaces, one request", () => {
    const BOTH: readonly SurfaceInfo[] = [
      row({ id: "eva.tui", interactive: true }),
      row({ id: "eva.web", interactive: true }),
    ]

    // A door that is asked and never answers. It says when it was asked, so
    // the door beside it can wait for that, and it says when its prompt was
    // retired.
    const silent = (
      id: string,
      reached: Deferred.Deferred<void>,
      retired: Deferred.Deferred<string>,
    ): Frontend => ({
      id,
      ask: () =>
        Effect.onInterrupt(Effect.andThen(Deferred.succeed(reached, undefined), Effect.never), () =>
          Effect.asVoid(Deferred.succeed(retired, id)),
        ),
      done: Effect.void,
    })

    /**
     * A door that answers once the door beside it has been asked, so both are
     * really in the race rather than one settling before the other opened.
     * The answer comes a tick later because that is what a person answering
     * is: a prompt that is still being drawn is not yet a prompt to retire.
     */
    const after = (id: string, reached: Deferred.Deferred<void>): Frontend => ({
      id,
      ask: () =>
        Effect.andThen(
          Deferred.await(reached),
          Effect.andThen(
            Effect.yieldNow,
            Effect.succeed({ kind: "permission", optionId: "allow_once" } as const),
          ),
        ),
      done: Effect.void,
    })

    it.each([
      { answers: "eva.web", waits: "eva.tui" },
      { answers: "eva.tui", waits: "eva.web" },
    ])("reads the answer from $answers, and retires the prompt at $waits", async (door) => {
      const reached = Deferred.makeUnsafe<void>()
      const retired = Deferred.makeUnsafe<string>()
      // Built in row order, so which door answers is the only thing that
      // changes: a gate that preferred a position would pass one and fail the
      // other.
      const surfaces = BOTH.map((one) =>
        one.id === door.answers ? after(one.id, reached) : silent(one.id, reached, retired),
      )

      const outcome = await asking(surfaces, {}, CALL, BOTH)

      expect(outcome).toStrictEqual(Exit.succeed({ kind: "allow_once" }))
      expect(await Effect.runPromise(Deferred.await(retired))).toBe(door.waits)
    })

    /**
     * A row that takes no input takes one door out of the race and never the
     * whole call. `eva.print` says it holds nobody, and the terminal beside it
     * still holds a person.
     */
    it("asks the surfaces whose rows take input, and passes over the rest", async () => {
      const rows = [row({ id: "eva.print" }), row({ id: "eva.tui", interactive: true })]
      const pipe: Frontend = {
        id: "eva.print",
        ask: () => Effect.die(new Error("eva.print was asked")),
        done: Effect.void,
      }

      const outcome = await asking(
        [pipe, answering({ kind: "permission", optionId: "allow_once" })],
        {},
        CALL,
        rows,
      )

      expect(outcome).toStrictEqual(Exit.succeed({ kind: "allow_once" }))
    })
  })
})

/**
 * What a door starts: the row it chose, and the rows a flag named beside it.
 * `eva --web` is one door of each kind in one process.
 */
describe("the rows a door starts", () => {
  // A row that says when it was started. Its `done` completes at once, so a
  // door that waits on it returns rather than holding the suite open.
  const noting = (id: string, started: string[]): SurfaceInfo =>
    row({
      id,
      interactive: true,
      start: () =>
        Effect.sync(() => {
          started.push(id)
          return {
            id,
            ask: () => Effect.succeed({ kind: "cancelled" }),
            done: Effect.void,
          } satisfies Frontend
        }),
    })

  const TERMINAL: Door = {
    choose: pickSurface,
    refuse: (known) => new Error(`no interactive surface: ${known.join(", ")}`),
  }

  const PAGE: Door = {
    choose: (rows) => rows.find((one) => one.id === "eva.web"),
    refuse: (known) => new Error(`no eva.web surface: ${known.join(", ")}`),
  }

  it("starts the row the flag named before the one it chose", async () => {
    const started: string[] = []
    const outcome = await withKernel(
      [noting("eva.tui", started), noting("eva.web", started)],
      (given) => runDoor(given, TERMINAL, [PAGE]),
    )

    // The interactive row is what the door returns, because it is the row
    // whose end is the run's end. It starts last, because the row beside it
    // has something to tell the person sitting at it.
    expect(outcome).toStrictEqual(Exit.succeed("eva.tui"))
    expect(started).toEqual(["eva.web", "eva.tui"])
  })

  /**
   * What that order buys, which is ticket 008: the page binds and says where,
   * and the terminal reads it as it starts. The other way round the line is
   * said to a screen a full-screen renderer is about to take.
   */
  it("lets the row it chose read what the row beside it said", async () => {
    const said: string[] = []
    const shown: string[] = []
    const frontend = (id: string): Frontend => ({
      id,
      ask: () => Effect.succeed({ kind: "cancelled" }),
      done: Effect.void,
    })

    const outcome = await withKernel(
      [
        row({
          id: "eva.tui",
          interactive: true,
          start: () =>
            Effect.sync(() => {
              shown.push(...said)
              return frontend("eva.tui")
            }),
        }),
        row({
          id: "eva.web",
          interactive: true,
          start: () =>
            Effect.sync(() => {
              said.push("http://127.0.0.1:7777")
              return frontend("eva.web")
            }),
        }),
      ],
      (given) => runDoor(given, TERMINAL, [PAGE]),
    )

    expect(outcome).toStrictEqual(Exit.succeed("eva.tui"))
    expect(shown).toEqual(["http://127.0.0.1:7777"])
  })

  // With no terminal in the build the page is the first interactive row, and
  // the flag that named it has nothing left to add.
  it("starts a row that two doors named one time", async () => {
    const started: string[] = []
    const outcome = await withKernel([noting("eva.web", started)], (given) =>
      runDoor(given, TERMINAL, [PAGE]),
    )

    expect(outcome).toStrictEqual(Exit.succeed("eva.web"))
    expect(started).toEqual(["eva.web"])
  })

  // A flag that names a surface this build has not is refused in that door's
  // own words, and the row that was there is never started.
  it("refuses when a flag names a row this build has not, and starts nothing", async () => {
    const started: string[] = []
    const outcome = await withKernel([noting("eva.tui", started)], (given) =>
      runDoor(given, TERMINAL, [PAGE]),
    )

    expect(Exit.isFailure(outcome)).toBe(true)
    expect(started).toEqual([])
  })
})
