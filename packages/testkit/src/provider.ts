import {
  ProviderError,
  providerTurn,
  type ProposedCall,
  type Provider,
  type ProviderRequest,
} from "@missingstudio/eva-core"
import type { Payload, StopReason } from "@missingstudio/eva-schema"
import { define, type Plugin } from "@missingstudio/eva-sdk"
import { Effect, Stream } from "effect"

export const FAKE_PROVIDER = "test.provider.fake"

/**
 * A plugin that answers `model.resolve` with one Provider, the way a provider
 * plugin does.
 *
 * A test that reaches for the hook registry instead needs a cast to call
 * `resolve` — and the cast defeats the map `ProviderHookSpec` exists to
 * check, so a renamed field on the event compiles and the test still passes.
 * It also has to hand the registration a Scope, which inside a plugin the
 * runtime supplies.
 *
 * The reference is answered as it arrives, so the Run resolves whatever model
 * it asked for rather than a model this fake decided on.
 */
export const providing = (provider: Provider, id: string = FAKE_PROVIDER): Plugin =>
  define({
    id,
    effect: Effect.fn(id)(function* (ctx) {
      yield* ctx.provider["model.resolve"]((event) => {
        event.resolve({ model: event.reference, provider })
      })
    }),
  })

/**
 * One Provider Turn as written down: the payloads the stream yields, in
 * order, why the exchange ended, and the calls it proposed. No `stopReason`
 * means a normal end of turn, and no `toolCalls` means a response of words
 * alone.
 */
export interface ScriptedTurn {
  readonly payloads: readonly Payload[]
  readonly stopReason?: StopReason
  readonly toolCalls?: readonly ProposedCall[]
}

// A vendored recording of provider streams, one entry per Provider Turn.
export interface Cassette {
  readonly turns: readonly ScriptedTurn[]
}

const answering = (
  id: string,
  turns: readonly ScriptedTurn[],
  keep?: (request: ProviderRequest) => void,
): Provider => {
  let served = 0
  return {
    id,
    available: () => true,
    turn: (request) => {
      keep?.(request)
      const entry = turns[served]
      served += 1
      if (entry === undefined) {
        // A silent repeat of the final entry would make a repair test pass
        // for the wrong reason, so a turn past the script fails instead.
        return providerTurn(
          Stream.fail(
            new ProviderError({
              provider: id,
              errorClass: "other",
              message: `the script holds ${turns.length} turns and this request is turn ${served}`,
            }),
          ),
        )
      }
      return providerTurn(
        Stream.fromIterable(entry.payloads),
        entry.stopReason ?? "end_turn",
        entry.toolCalls ?? [],
      )
    },
  }
}

export interface Scripted {
  readonly plugin: Plugin
  // Every request the Provider was handed, in order.
  readonly seen: () => readonly ProviderRequest[]
}

/**
 * A Provider that answers a written script, one entry per Provider Turn.
 * Every request it was handed is kept, so a test can assert what a Repair
 * carried.
 *
 * `id` is for a test whose resolved list already names a real provider — the
 * scripted one then answers under that id, and the build stays the shipped
 * table.
 */
export const scripted = (script: readonly ScriptedTurn[], id: string = FAKE_PROVIDER): Scripted => {
  const seen: ProviderRequest[] = []
  return {
    plugin: providing(
      answering(id, script, (request) => void seen.push(request)),
      id,
    ),
    seen: () => seen,
  }
}

export const RECORDED_PROVIDER = "test.provider.recorded"

/**
 * A Provider that replays one vendored cassette, chunk for chunk. This is
 * what lets a deterministic test replay a real provider stream without
 * calling a model.
 */
export const recorded = (cassette: Cassette): Plugin =>
  providing(answering(RECORDED_PROVIDER, cassette.turns), RECORDED_PROVIDER)
