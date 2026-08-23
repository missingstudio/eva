import type { Kernel } from "@missingstudio/eva-boot"
import type { ModelResolution, Provider, ProviderRequest } from "@missingstudio/eva-core"
import type { Payload, StopReason } from "@missingstudio/eva-schema"
import type { Plugin } from "@missingstudio/eva-sdk"
import { Effect, Exit, Stream } from "effect"
import { describe, expect, it } from "vitest"
import { withPlugin } from "./context.js"
import { recorded, scripted, type Cassette } from "./provider.js"

const text = (value: string): Payload => ({
  kind: "text",
  block: 0,
  content: { type: "text", text: value },
})

const request = (note: string): ProviderRequest => ({
  model: { provider: "fake", model: "model" },
  messages: [
    {
      author: "human",
      blocks: [{ type: "content", block: 0, content: { type: "text", text: note } }],
    },
  ],
})

// The same hook a Run resolves the Provider through.
const resolved = Effect.fn("resolved")(function* (kernel: Kernel) {
  let found: ModelResolution | undefined
  yield* kernel.hooks.run("model.resolve", {
    reference: { provider: "fake", model: "model" },
    resolve: (resolution) => {
      found = resolution
    },
  })
  if (found === undefined) throw new Error("nothing answered model.resolve")
  return found.provider
})

const drained = (provider: Provider, note: string) =>
  Effect.orDie(
    Effect.map(Stream.runCollect(provider.turn(request(note)).payloads), (chunk) => [...chunk]),
  )

// Replays a whole cassette and gives back what each turn streamed and said.
const replayed = (
  plugin: Plugin,
  turns: number,
): Promise<{ payloads: readonly Payload[]; stopReason: StopReason | undefined }[]> =>
  withPlugin(plugin, (kernel) =>
    Effect.gen(function* () {
      const provider = yield* resolved(kernel)
      const found: { payloads: readonly Payload[]; stopReason: StopReason | undefined }[] = []
      for (let index = 0; index < turns; index += 1) {
        const turn = provider.turn(request(`turn ${index + 1}`))
        const payloads = [...(yield* Effect.orDie(Stream.runCollect(turn.payloads)))]
        found.push({ payloads, stopReason: yield* turn.stopReason })
      }
      return found
    }),
  )

describe("scripted", () => {
  it("answers each Provider Turn in order and keeps every request", async () => {
    const fake = scripted([{ payloads: [text("one")] }, { payloads: [text("two")] }])
    const answers = await withPlugin(fake.plugin, (kernel) =>
      Effect.gen(function* () {
        const provider = yield* resolved(kernel)
        return [yield* drained(provider, "first"), yield* drained(provider, "second")]
      }),
    )

    expect(answers).toEqual([[text("one")], [text("two")]])
    const carried = fake.seen().map((one) => {
      const block = one.messages[0]?.blocks[0]
      return block?.type === "content" && block.content.type === "text" ? block.content.text : ""
    })
    expect(carried).toEqual(["first", "second"])
  })

  it("fails a turn past the script rather than repeating the final entry", async () => {
    const fake = scripted([{ payloads: [text("only")] }])
    const outcome = await withPlugin(fake.plugin, (kernel) =>
      Effect.gen(function* () {
        const provider = yield* resolved(kernel)
        const first = yield* drained(provider, "first")
        const second = yield* Effect.exit(
          Stream.runCollect(provider.turn(request("second")).payloads),
        )
        return { first, second }
      }),
    )

    expect(outcome.first).toEqual([text("only")])
    expect(Exit.isFailure(outcome.second)).toBe(true)
    // The request past the end is still kept, so the test that overran can
    // see what asked one turn too many.
    expect(fake.seen()).toHaveLength(2)
  })
})

describe("recorded", () => {
  it("replays a cassette chunk for chunk and gives the same payloads twice", async () => {
    const cassette: Cassette = {
      turns: [
        // Two chunks stay two chunks: a replay never merges what the wire
        // carried apart.
        { payloads: [text("a"), text("b")] },
        { payloads: [text("c")], stopReason: "max_tokens" },
      ],
    }
    const once = await replayed(recorded(cassette), 2)
    const twice = await replayed(recorded(cassette), 2)

    expect(once).toEqual([
      { payloads: [text("a"), text("b")], stopReason: "end_turn" },
      { payloads: [text("c")], stopReason: "max_tokens" },
    ])
    expect(twice).toEqual(once)
  })
})
