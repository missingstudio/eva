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
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import type { Started } from "./run.js"
import { gateFor, pickSurface } from "./surface.js"

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

  const answering = (answer: FrontendAnswer): Frontend => ({
    id: "eva.tui",
    ask: () => Effect.succeed(answer),
    done: Effect.void,
  })

  const asking = (
    surface: Frontend | undefined,
    env: NodeJS.ProcessEnv = {},
    call: ToolCall = CALL,
  ) =>
    withKernel([row({ id: "eva.tui", interactive: true })], (started) =>
      gateFor(started.kernel, () => surface, env)(() => Effect.never)(ASKED, call),
    )

  it("carries a person's answer back as the option they named", async () => {
    const outcome = await asking(answering({ kind: "permission", optionId: "allow_once" }))
    expect(outcome).toStrictEqual(Exit.succeed({ kind: "allow_once" }))
  })

  /**
   * A door with nobody behind it — `--print`, `eva run`, or a surface that has
   * not started yet — denies and says nobody is there. Every door composes
   * this gate, so that is the one sentence a call with no person gets.
   */
  it("denies while no surface is running, and says nobody is there", async () => {
    const outcome = await asking(undefined)

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
      answering({ kind: "permission", optionId: "allow_always" }),
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
})
