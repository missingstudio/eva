import type {
  ModelRef,
  ModelResolution,
  ProviderError,
  ProviderRequest,
  Retry,
  RunDeps,
} from "@missingstudio/eva-core"
import type { Payload } from "@missingstudio/eva-schema"
import { Effect } from "effect"
import type { Kernel } from "./boot.js"

/**
 * What a Hook may change while it runs. Two of the four events declare
 * `{ get, update }` and the other two only set, so one cell serves both and
 * an adapter stops declaring a `let` and its closures for each.
 */
const cell = <A>(initial: A) => {
  let held = initial
  return {
    read: () => held,
    set: (value: A) => void (held = value),
    port: {
      get: () => held,
      update: (next: (one: A) => A) => void (held = next(held)),
    },
  }
}

/**
 * The dependencies `submit` reads, built from the kernel. Every hook the SDK
 * declares is run here. A hook no plugin registered is a no-op, not a
 * missing feature.
 *
 * A Hook edits what it is given in place and `submit` wants an
 * answer back, so each of these holds the answer while the Hooks run and
 * returns what the last one left.
 */
export const runDeps = (
  kernel: Kernel,
  emit: (payload: Payload) => Effect.Effect<void>,
): RunDeps => {
  const resolve = Effect.fn("boot.resolve")(function* (reference: ModelRef) {
    const held = cell<ModelResolution | undefined>(undefined)
    yield* kernel.hooks.run("model.resolve", { reference, resolve: held.set })
    return held.read()
  })

  const beforeRequest = Effect.fn("boot.beforeRequest")(function* (request: ProviderRequest) {
    const held = cell(request)
    yield* kernel.hooks.run("provider.request.before", { request: held.port })
    return held.read()
  })

  const afterResponse = Effect.fn("boot.afterResponse")(function* (group: readonly Payload[]) {
    const held = cell(group)
    yield* kernel.hooks.run("provider.response.after", { payloads: held.port })
    return held.read()
  })

  const retry = Effect.fn("boot.retry")(function* (error: ProviderError, attempt: number) {
    const held = cell<Retry>({ retry: false, max: attempt, delayMs: 0 })
    yield* kernel.hooks.run("provider.retry", { error, attempt, decide: held.set })
    return held.read()
  })

  return {
    recorder: kernel.slot.recorder.peek,
    resolve,
    beforeRequest,
    afterResponse,
    retry,
    budget: kernel.slot.budget.peek,
    sleep: (milliseconds) => Effect.sleep(milliseconds),
    emit,
  }
}
