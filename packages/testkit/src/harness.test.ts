import { boot, buildOf } from "@missingstudio/eva-boot"
import type { Harness } from "@missingstudio/eva-core"
import { sessionID, type Payload } from "@missingstudio/eva-schema"
import { define } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { openRow, scriptedHost } from "./harness.js"

const SESSION = sessionID("sess_testkit_harness")
const MODEL = { provider: "fake", model: "model" }

describe("scriptedHost", () => {
  it("answers each Run in order and logs the interleave", async () => {
    const watched = scriptedHost([{ text: "first" }, { text: "second" }])
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const one = yield* watched.host.run({
          session: SESSION,
          spec: { intent: "a" },
          model: MODEL,
          history: [],
        })
        yield* watched.host.report([{ kind: "degraded", missing: ["Validator"] }])
        const two = yield* watched.host.run({
          session: SESSION,
          spec: { intent: "b" },
          model: MODEL,
          history: [],
        })
        return [one.text, two.text]
      }),
    )

    expect(found).toEqual(["first", "second"])
    expect(watched.calls).toEqual(["run", "report:degraded", "run"])
    expect(watched.runs.map((one) => one.spec.intent)).toEqual(["a", "b"])
    expect(watched.reports).toEqual([[{ kind: "degraded", missing: ["Validator"] }]])
  })

  // A silent repeat of the final entry would make a repair test pass for the
  // wrong reason, so a Run past the script fails instead.
  it("fails a Run past the script rather than repeating the final entry", async () => {
    const watched = scriptedHost([{ text: "only" }])
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        yield* watched.host.run({
          session: SESSION,
          spec: { intent: "a" },
          model: MODEL,
          history: [],
        })
        return yield* Effect.exit(
          watched.host.run({ session: SESSION, spec: { intent: "b" }, model: MODEL, history: [] }),
        )
      }),
    )

    expect(Exit.isFailure(outcome)).toBe(true)
    // The Run past the end is still logged, so the test that overran can see
    // what asked one Run too many.
    expect(watched.runs).toHaveLength(2)
  })
})

describe("openRow", () => {
  // A harness whose prompt emits one payload through the host, so the test
  // sees what `said` collected.
  const row = (said: Payload) =>
    define({
      id: "test.harness.row",
      effect: Effect.fn("test.harness.row")(function* (ctx) {
        yield* ctx.harness.transform((draft) => {
          draft.set({
            id: "echo",
            name: "Echo",
            open: (host) =>
              Effect.succeed({
                id: "echo",
                capabilities: {},
                initialize: () => Effect.succeed({}),
                createSession: () => Effect.succeed(SESSION),
                resumeSession: (id) => Effect.succeed({ kind: "resumed", session: id } as const),
                prompt: () => host.report([said]).pipe(Effect.as("end_turn" as const)),
                cancel: () => Effect.void,
                updates: Stream.empty,
              } satisfies Harness),
          })
        })
      }),
    })

  it("opens the named row over boot's host and collects what it said", async () => {
    const answered: Payload = { kind: "degraded", missing: ["Validator"] }
    const plugin = row(answered)
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const kernel = yield* boot({
          scope,
          resolved: [{ id: plugin.id }],
          build: buildOf([plugin]),
        })
        const opened = yield* openRow(kernel, scope, "echo", SESSION)
        const reason = yield* opened.harness.prompt(SESSION, { kind: "prompt", text: "go" })
        yield* Scope.close(scope, Exit.void)
        return { reason, said: opened.said() }
      }),
    )

    expect(found.reason).toBe("end_turn")
    expect(found.said).toEqual([answered])
  })

  it("refuses an id no runnable row answers", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const kernel = yield* boot({ scope, resolved: [], build: buildOf([]) })
        const found = yield* Effect.exit(openRow(kernel, scope, "nowhere", SESSION))
        yield* Scope.close(scope, Exit.void)
        return found
      }),
    )

    expect(Exit.isFailure(outcome)).toBe(true)
  })
})
