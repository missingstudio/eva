import type { HookBoundaries, HookFailure } from "@missingstudio/eva-core"
import { Effect, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makeHooks, type HookRegistry } from "./hook.js"

/**
 * Two boundaries this test owns. Stage 2's first deciding boundary arrives
 * with the tool execution, and the rule lands before it, so the fixture holds
 * one of each kind: `call.before` decides whether the call runs, `call.after`
 * only watches it.
 */
interface Spec {
  "call.before": { readonly name: string }
  "call.after": { readonly name: string }
}

const BOUNDARY: HookBoundaries<Spec> = {
  "call.before": "deciding",
  "call.after": "observing",
}

const registry = (failures: HookFailure[]) =>
  makeHooks<Spec>(BOUNDARY, {
    failed: (failure) => Effect.sync(() => void failures.push(failure)),
  })

const broken = (message: string) => () => {
  throw new Error(message)
}

const register = <Name extends keyof Spec>(
  hooks: HookRegistry<Spec>,
  scope: Scope.Scope,
  name: Name,
  callback: (event: Spec[Name]) => Effect.Effect<void> | void,
  owner: string,
) => hooks.on(name, callback, owner).pipe(Effect.provideService(Scope.Scope, scope))

/**
 * The caller of a deciding boundary: it runs the call only when the boundary
 * handed back no denial. That is the whole of the rule from the caller's
 * side, and it is where "the call never executes" is decided.
 */
const guarded = (hooks: HookRegistry<Spec>, ran: string[]) =>
  Effect.gen(function* () {
    const denial = yield* hooks.run("call.before", { name: "write" })
    if (denial === undefined) ran.push("write")
    return denial
  })

describe("a deciding boundary", () => {
  it("denies the call a hook threw at, and the call never runs", async () => {
    const failures: HookFailure[] = []
    const ran: string[] = []
    const denial = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const hooks = yield* registry(failures)
        yield* register(hooks, scope, "call.before", broken("the gate broke"), "acme.gate")
        return yield* guarded(hooks, ran)
      }),
    )

    expect(denial).toMatchObject({ hook: "call.before", owner: "acme.gate" })
    expect(String((denial as HookFailure).cause)).toContain("the gate broke")
    expect(ran).toEqual([])
    // The caller was told, so nothing is reported behind its back.
    expect(failures).toEqual([])
  })

  it("lets the call run when every hook returns", async () => {
    const failures: HookFailure[] = []
    const ran: string[] = []
    const denial = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const hooks = yield* registry(failures)
        yield* register(hooks, scope, "call.before", () => Effect.void, "acme.gate")
        return yield* guarded(hooks, ran)
      }),
    )

    expect(denial).toBeUndefined()
    expect(ran).toEqual(["write"])
  })

  it("runs no later hook once one has thrown", async () => {
    const failures: HookFailure[] = []
    const seen: string[] = []
    const denial = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const hooks = yield* registry(failures)
        yield* register(hooks, scope, "call.before", broken("first"), "acme.first")
        yield* register(
          hooks,
          scope,
          "call.before",
          () => Effect.sync(() => void seen.push("second")),
          "acme.second",
        )
        return yield* hooks.run("call.before", { name: "write" })
      }),
    )

    expect(denial).toMatchObject({ owner: "acme.first" })
    expect(seen).toEqual([])
  })
})

describe("an observing boundary", () => {
  it("reports the hook that threw and runs the next one", async () => {
    const failures: HookFailure[] = []
    const seen: string[] = []
    const denial = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const hooks = yield* registry(failures)
        yield* register(hooks, scope, "call.after", broken("the observer broke"), "acme.usage")
        yield* register(
          hooks,
          scope,
          "call.after",
          (event) => Effect.sync(() => void seen.push(event.name)),
          "acme.trace",
        )
        return yield* hooks.run("call.after", { name: "write" })
      }),
    )

    // Nothing is denied: an observer has no call to deny.
    expect(denial).toBeUndefined()
    expect(seen).toEqual(["write"])
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ hook: "call.after", owner: "acme.usage" })
    expect(String(failures[0]?.cause)).toContain("the observer broke")
  })

  it("reports a hook whose Effect died, not only one that threw where it stands", async () => {
    const failures: HookFailure[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const hooks = yield* registry(failures)
        yield* register(
          hooks,
          scope,
          "call.after",
          () => Effect.die(new Error("the sink refused")),
          "acme.sink",
        )
        return yield* hooks.run("call.after", { name: "write" })
      }),
    )

    expect(failures).toHaveLength(1)
    expect(String(failures[0]?.cause)).toContain("the sink refused")
  })
})

/**
 * The reason the kind belongs to the boundary: a plugin registering an
 * observer at a deciding boundary must not weaken it.
 */
describe("the boundary declares the kind, never the hook", () => {
  it("gives one hook opposite outcomes at the two boundaries", async () => {
    const failures: HookFailure[] = []
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const hooks = yield* registry(failures)
        const throws = broken("the same hook")
        yield* register(hooks, scope, "call.before", throws, "acme.one")
        yield* register(hooks, scope, "call.after", throws, "acme.one")
        return {
          deciding: yield* hooks.run("call.before", { name: "write" }),
          observing: yield* hooks.run("call.after", { name: "write" }),
        }
      }),
    )

    expect(outcome.deciding).toMatchObject({ hook: "call.before" })
    expect(outcome.observing).toBeUndefined()
    expect(failures.map((failure) => failure.hook)).toEqual(["call.after"])
  })
})

describe("a disposed registration", () => {
  it("no longer runs, and cannot deny", async () => {
    const failures: HookFailure[] = []
    const ran: string[] = []
    const denial = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const hooks = yield* registry(failures)
        const held = yield* register(
          hooks,
          scope,
          "call.before",
          broken("the gate broke"),
          "acme.gate",
        )
        yield* held.dispose
        return yield* guarded(hooks, ran)
      }),
    )

    expect(denial).toBeUndefined()
    expect(ran).toEqual(["write"])
  })
})
