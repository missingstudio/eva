import type { Provider, ProviderRequest } from "@missingstudio/eva-core"
import { makeAnthropicProvider } from "@missingstudio/eva-provider-anthropic"
import { makeCompatibleProvider } from "@missingstudio/eva-provider-compatible"
import { makeOpenAIProvider } from "@missingstudio/eva-provider-openai"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

/**
 * Every Provider, held to the contract they share.
 *
 * The `TraceSink` seam has had a suite like this since stage 0 and the
 * `FileSystem` seam since stage 2; the Provider seam had none. Its rules were
 * verified three times in three sibling suites, once each — so a rule one
 * adapter kept and another quietly dropped read as three passing suites.
 *
 * What is here is only what they share. A dialect — how one wire's events
 * become Eva's payloads — is each plugin's own internal seam, tested beside
 * it, and no longer published: publishing it made a plugin's interface as wide
 * as its implementation.
 */

const REQUEST: ProviderRequest = {
  model: { provider: "acme", model: "one" },
  messages: [],
}

/**
 * Each adapter, built with no credential — the one shape every one of them
 * takes without a wire.
 *
 * `available` is what each says in that shape, and the two answers are both
 * right. A hosted endpoint with no key cannot answer, and says so, so a Run
 * reports `auth_failed` rather than `no_such_model`. A configured endpoint that
 * asked for no key needs none — a local Ollama is the case — and the tri-state
 * `endpointOf` reads is what tells the two apart: `false` is a key the entry
 * asked for and did not get, and absent is an endpoint that wanted none.
 */
const adapters: readonly (readonly [string, () => Provider, boolean])[] = [
  ["anthropic", () => makeAnthropicProvider({}), false],
  ["openai", () => makeOpenAIProvider({}), false],
  [
    "compatible",
    () =>
      makeCompatibleProvider({
        id: "eva.provider.compatible:acme",
        namespace: "acme",
        api: "http://127.0.0.1:1/v1",
      }),
    true,
  ],
]

describe.each(adapters)("the %s Provider honors the contract", (_name, make, available) => {
  /**
   * A Run never starts against a dead Provider. Every adapter resolves anyway
   * — `model.resolve` answers whether or not a credential was found — so what
   * this asks is that each one answers the question, and answers it the same
   * way every time.
   */
  it("says whether it can answer, without a wire", () => {
    expect(make().available()).toBe(available)
    expect(make().available()).toBe(available)
  })

  it("names itself", () => {
    expect(make().id).toMatch(/^eva\.provider\./)
  })

  /**
   * Whether the tools a request offers reach the model, stated rather than
   * inferred. An adapter that carries none answers a Turn proposing no calls,
   * which is exactly what a model that wanted none answers — so a Run that
   * offered tools to one marks itself Degraded instead of reading the silence
   * as the answer.
   */
  it("states whether it carries the tools a request offers", () => {
    expect(typeof make().carriesTools).toBe("boolean")
  })

  /**
   * Before the drain, a Turn has said nothing. Both are read after it, so an
   * early read understates and never misleads — an unreported Stop Reason and
   * no proposed call is what a Turn that has not ended has said so far.
   */
  it("reports no Stop Reason and no proposed call before the drain", async () => {
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const turn = make().turn(REQUEST)
        return {
          reason: yield* turn.stopReason,
          calls: turn.toolCalls === undefined ? undefined : yield* turn.toolCalls,
        }
      }),
    )

    expect(found.reason).toBeUndefined()
    expect(found.calls ?? []).toEqual([])
  })

  // Asking for a Turn is not making a call: the stream is a description, and
  // nothing behind the seam runs until it does. So this reaches no network.
  it("builds a Turn without reaching the wire", () => {
    expect(() => make().turn(REQUEST)).not.toThrow()
  })
})

/**
 * One adapter of the three puts a request's tools on the wire. That is a gap
 * in two dialects and not a rule of the seam — what the seam requires is that
 * each one says which it is, so a Run can mark itself Degraded rather than
 * ending its Prompt on a silence it read as an answer.
 */
describe("the tools a request offers", () => {
  it("is carried by the adapter that puts them on the wire, and stated by the two that do not", () => {
    const stated = adapters.map(([name, make]) => [name, make().carriesTools] as const)

    expect(stated).toEqual([
      ["anthropic", true],
      ["openai", false],
      ["compatible", false],
    ])
  })
})
