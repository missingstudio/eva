import type { HarnessHost, RunResult } from "@missingstudio/eva-core"
import { sessionID } from "@missingstudio/eva-schema"
import type { Payload, SessionID, StopReason } from "@missingstudio/eva-schema"
import { Deferred, Effect, Fiber } from "effect"
import { describe, expect, it } from "vitest"
import { nativeHarness, type Prompting, type Steer } from "./harness.js"

/**
 * The body every native Harness shares. Each clause here was spelled twice —
 * once per plugin — and the interrupt rule was proven in one of the two, so
 * the identical code in the other answered for nothing.
 *
 * The host is a double rather than a kernel: what is under test is the
 * bookkeeping around a Run, not the Run.
 */

const SESSION = sessionID("sess_native")

const RAN: RunResult = {
  claim: { result: "done" },
  text: "said",
  calls: [],
  degraded: [],
  attempts: 1,
}

// A host that answers every Run the same way and keeps what was reported.
const recording = (): { readonly host: HarnessHost; readonly seen: Payload[] } => {
  const seen: Payload[] = []
  return {
    seen,
    host: {
      run: () => Effect.succeed(RAN),
      report: (payloads) =>
        Effect.sync(() => {
          seen.push(...payloads)
        }),
    },
  }
}

// One Harness over a host, with an answer body a clause states.
const over = (
  host: HarnessHost,
  answer: (prompting: Prompting) => Effect.Effect<StopReason>,
  steer?: (session: SessionID, arrived: Steer) => void,
) =>
  nativeHarness(host, {
    id: "acme.harness",
    answer: (prompting) => answer(prompting),
    ...(steer === undefined ? {} : { steer }),
  })

const prompting = (harness: ReturnType<typeof over>, text = "go") =>
  Effect.runPromise(harness.prompt(SESSION, { kind: "prompt", text }))

describe("the session a native Harness mints", () => {
  it("resumes one it opened and rejects one it did not", async () => {
    const harness = over(recording().host, () => Effect.succeed("end_turn"))

    const opened = await Effect.runPromise(Effect.scoped(harness.createSession("/work")))
    expect(await Effect.runPromise(harness.resumeSession(opened))).toEqual({
      kind: "resumed",
      session: opened,
    })

    // Never `undetectable`: a native Harness always knows what it holds.
    expect(await Effect.runPromise(harness.resumeSession(SESSION))).toEqual({
      kind: "rejected",
      reason: `acme.harness did not open ${SESSION}`,
    })
  })

  it("negotiates nothing and has no wire", async () => {
    const harness = over(recording().host, () => Effect.succeed("end_turn"))

    expect(harness.capabilities).toEqual({})
    expect(await Effect.runPromise(harness.initialize({} as never))).toEqual({})
  })
})

/**
 * A refusal is on the Trace. Before the first Run there is no Run for it to
 * land in, so the group opens one; after a Run the Runs already carry the
 * story up to the refusal.
 */
describe("a Prompt that refuses", () => {
  it("opens a Run of its own when nothing ran", async () => {
    const { host, seen } = recording()
    const harness = over(host, (one) => one.refuse("nothing to do"))

    expect(await prompting(harness)).toBe("end_turn")
    expect(seen).toEqual([
      { kind: "started", intent: "go" },
      { kind: "finished", claim: { result: "failed", summary: "nothing to do" } },
    ])
  })

  it("adds no second story when a Run already closed", async () => {
    const { host, seen } = recording()
    const harness = over(
      host,
      Effect.fn(function* (one) {
        yield* one.run({} as never)
        return yield* one.refuse("gave up after one")
      }),
    )

    expect(await prompting(harness)).toBe("end_turn")
    expect(seen).toEqual([
      { kind: "finished", claim: { result: "failed", summary: "gave up after one" } },
    ])
  })

  /**
   * A caller that names a Stop Reason records it and answers it. One that
   * names none records no reason, because a Harness whose Steps are declared
   * has none to report beyond the failure.
   */
  it("records the Stop Reason a caller named, and none when it named none", async () => {
    const { host, seen } = recording()
    const harness = over(host, (one) => one.refuse("the fuse blew", "max_turn_requests"))

    expect(await prompting(harness)).toBe("max_turn_requests")
    expect(seen[1]).toEqual({
      kind: "finished",
      claim: { result: "failed", summary: "the fuse blew" },
      stopReason: "max_turn_requests",
    })

    const bare = recording()
    await prompting(over(bare.host, (one) => one.refuse("no reason to give")))
    expect(bare.seen[1]).not.toHaveProperty("stopReason")
  })
})

describe("a cancelled Prompt", () => {
  // A Harness answers a Stop Reason, so an interrupt is classified rather
  // than thrown. This rule was proven in one of the two plugins and lived
  // untested in the other.
  it("answers cancelled rather than failing", async () => {
    const opened = Deferred.makeUnsafe<void>()
    const host: HarnessHost = {
      run: () => Effect.andThen(Deferred.succeed(opened, undefined), Effect.never),
      report: () => Effect.void,
    }
    const harness = over(host, (one) => Effect.as(one.run({} as never), "end_turn" as const))

    const reason = await Effect.runPromise(
      Effect.gen(function* () {
        const running = yield* Effect.forkChild(
          harness.prompt(SESSION, { kind: "prompt", text: "go" }),
        )
        yield* Deferred.await(opened)
        yield* harness.cancel(SESSION)
        return yield* Fiber.join(running)
      }),
    )

    expect(reason).toBe("cancelled")
  })

  // Nothing is running, so there is nothing to interrupt and no failure.
  it("cancels a Session that holds no Prompt", async () => {
    const harness = over(recording().host, () => Effect.succeed("end_turn"))
    await Effect.runPromise(harness.cancel(SESSION))
  })
})

/**
 * A steer answers with the current Stop Reason, because the Prompt it lands in
 * is not that call's to wait for. Where the line lands is the Harness's own.
 */
describe("a steer", () => {
  const line: Steer = { kind: "steer", text: "and be brief", target: "next-step" }

  it("reaches the Harness that states one, and answers the last reason", async () => {
    const held: Steer[] = []
    const harness = over(
      recording().host,
      () => Effect.succeed("max_turn_requests"),
      (_session, arrived) => void held.push(arrived),
    )

    // Nothing has run, so there is no last reason to give.
    expect(await Effect.runPromise(harness.prompt(SESSION, line))).toBe("end_turn")
    expect(held).toEqual([line])

    await prompting(harness)
    expect(await Effect.runPromise(harness.prompt(SESSION, line))).toBe("max_turn_requests")
    expect(held).toHaveLength(2)
  })

  // A Harness that states no `steer` refuses one: the line is not recorded and
  // not ignored, because a delivery record would assert something false.
  it("is refused by a Harness that states none, and records nothing", async () => {
    const { host, seen } = recording()
    const harness = over(host, () => Effect.succeed("end_turn"))

    expect(await Effect.runPromise(harness.prompt(SESSION, line))).toBe("end_turn")
    expect(seen).toEqual([])
  })
})

// What the answer body answered is what the Prompt answers.
describe("a Prompt that ran", () => {
  it("answers what its body answered", async () => {
    const harness = over(recording().host, () => Effect.succeed("refusal"))
    expect(await prompting(harness)).toBe("refusal")
  })
})
