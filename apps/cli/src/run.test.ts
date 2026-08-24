import { boot, buildOf } from "@missingstudio/eva-boot"
import { commands } from "@missingstudio/eva-commands"
import { print } from "@missingstudio/eva-print"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { watchMisses } from "./run.js"

/**
 * The walkthrough's own example, as the exit test: `eva.print` supplies the
 * `run` for the `/cost` that `eva.commands` describes, and a flipped load
 * order used to lose it in silence. Now the boot says whose edit reached
 * nothing — and says it once, because a persistent miss recurs on every
 * rebuild by design.
 */
describe("a miss is said once", () => {
  it("names eva.print against the cost command when the load order flips", async () => {
    const said: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const kernel = yield* boot({
          scope,
          resolved: [{ id: "eva.print" }, { id: "eva.commands" }],
          build: buildOf([print, commands]),
          observe: watchMisses(scope, (text) => void said.push(text)),
        })
        // A rebuild replays everything and publishes the same miss again;
        // the dedup keeps it to one line.
        yield* kernel.domains.command.reload
        yield* Effect.yieldNow
        yield* Scope.close(scope, Exit.void)
      }),
    )

    expect(said).toEqual(['eva: eva.print edited command "cost", and nothing had registered it\n'])
  })

  it("says nothing when the order is right", async () => {
    const said: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        yield* boot({
          scope,
          resolved: [{ id: "eva.commands" }, { id: "eva.print" }],
          build: buildOf([print, commands]),
          observe: watchMisses(scope, (text) => void said.push(text)),
        })
        yield* Effect.yieldNow
        yield* Scope.close(scope, Exit.void)
      }),
    )

    expect(said).toEqual([])
  })
})
