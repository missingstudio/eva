import type { Command, Process } from "@missingstudio/eva-core"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { Effect, Stream } from "effect"

export const SPYING_SANDBOX = "test.sandbox.spy"

/**
 * A process that runs nothing: no output, an exit of zero, and a kill that
 * has nothing to kill. It is what a Sandbox double answers, so a suite about
 * a gate never waits on a real program.
 */
export const IDLE_PROCESS: Process = {
  output: Stream.empty,
  exit: Effect.succeed({ code: 0, signal: null }),
  kill: Effect.void,
}

export interface SpyingSandbox {
  readonly plugin: Plugin
  // Every command the Sandbox was asked to run, in order.
  readonly asked: readonly Command[]
}

/**
 * A Sandbox that remembers what it was asked to run and runs none of it.
 *
 * It is what a suite about a gate needs: a gate that let a command through
 * when it should have refused is caught by a command in this list, and a gate
 * that regressed the other way is caught by an empty one — rather than by a
 * machine that lost a directory. Nothing spawns.
 */
export const spyingSandbox = (): SpyingSandbox => {
  const asked: Command[] = []
  const plugin = define({
    id: SPYING_SANDBOX,
    effect: Effect.fn(SPYING_SANDBOX)(function* (ctx) {
      yield* ctx.slot.sandbox.provide(SPYING_SANDBOX, {
        run: (command) =>
          Effect.sync(() => {
            asked.push(command)
            return IDLE_PROCESS
          }),
        capabilities: Effect.succeed({ enforces: [] }),
      })
    }),
  })
  return { plugin, asked }
}
