import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { boot, buildOf } from "@missingstudio/eva-boot"
import { commands } from "@missingstudio/eva-commands"
import { print } from "@missingstudio/eva-print"
import { traceJsonl } from "@missingstudio/eva-trace-jsonl"
import { traceMemory } from "@missingstudio/eva-trace-memory"
import { define } from "@missingstudio/eva-sdk"
import { Effect, Exit, Scope } from "effect"
import { describe, expect, it } from "vitest"
import { watchKernel } from "./run.js"

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
          observe: watchKernel(scope, (text) => void said.push(text)),
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
          observe: watchKernel(scope, (text) => void said.push(text)),
        })
        yield* Effect.yieldNow
        yield* Scope.close(scope, Exit.void)
      }),
    )

    expect(said).toEqual([])
  })
})

/**
 * Two configured trace sinks both load and one silently wins whichever
 * loaded last. The eviction rides `slot.filled`, and the terminal says it.
 */
describe("a slot eviction is named", () => {
  it("says which sink filled it first", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "eva-run-")), "trace.jsonl")
    const said: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        yield* boot({
          scope,
          resolved: [{ id: "eva.trace.jsonl", options: { path } }, { id: "eva.trace.memory" }],
          build: buildOf([traceJsonl, traceMemory]),
          observe: watchKernel(scope, (text) => void said.push(text)),
        })
        yield* Effect.yieldNow
        yield* Scope.close(scope, Exit.void)
      }),
    )

    expect(said).toEqual([
      "eva: TraceSink now answers from eva.trace.memory; eva.trace.jsonl filled it first\n",
    ])
  })
})

/**
 * A plugin whose effect throws is rolled back, and the run goes on with one
 * plugin fewer. It used to go on in silence: the failure rode a broadcast
 * that only tests subscribed.
 */
describe("a plugin that did not load is said", () => {
  const broken = define({
    id: "eva.broken",
    effect: () => Effect.die(new Error("the store would not open")),
  })

  it("names the plugin and what it said, and the run goes on", async () => {
    const said: string[] = []
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const kernel = yield* boot({
          scope,
          resolved: [{ id: broken.id }, { id: "eva.commands" }],
          build: buildOf([broken, commands]),
          observe: watchKernel(scope, (text) => void said.push(text)),
        })
        yield* Effect.yieldNow
        const loaded = yield* kernel.runtime.list
        yield* Scope.close(scope, Exit.void)
        return loaded
      }),
    )

    expect(said).toEqual([
      "eva: eva.broken did not load, and this run goes on without it\n     the store would not open\n",
    ])
    // The run is degraded and not stopped: the plugin beside it loaded, and
    // the one that failed is not in the list it was rolled back out of.
    expect(rows).toEqual(["eva.commands"])
  })
})
