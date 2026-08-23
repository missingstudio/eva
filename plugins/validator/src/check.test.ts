import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { accepts, check } from "./check.js"

// One Step's Output schema, the shape a Workflow author writes.
const SCHEMA = {
  type: "object",
  required: ["name", "status", "entries"],
  properties: {
    name: { type: "string" },
    status: { enum: ["open", "closed", "held"] },
    entries: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
  },
}

const OUTPUT = { name: "eva", status: "open", entries: [{ id: "one" }] }

const judged = (schema: unknown, candidate: string) => Effect.runPromise(check(schema, candidate))

const faultsOf = async (schema: unknown, candidate: string) => {
  const found = await judged(schema, candidate)
  if (found.verdict !== "invalid") throw new Error(`expected invalid, got ${found.verdict}`)
  return found.faults
}

describe("the extraction rule", () => {
  it("takes the body of one fenced block", async () => {
    const candidate = `Here is the answer:\n\`\`\`json\n${JSON.stringify(OUTPUT)}\n\`\`\`\nDone.`

    expect(await judged(SCHEMA, candidate)).toEqual({ verdict: "valid", value: OUTPUT })
  })

  it("takes a bare object as it is", async () => {
    expect(await judged(SCHEMA, JSON.stringify(OUTPUT))).toEqual({
      verdict: "valid",
      value: OUTPUT,
    })
  })

  it("takes the longest balanced run out of wrapping prose", async () => {
    const candidate = `The output {below} is ${JSON.stringify(OUTPUT)} as requested.`

    expect(await judged(SCHEMA, candidate)).toEqual({ verdict: "valid", value: OUTPUT })
  })

  // Two fences are not "one fenced block", so the balanced run decides.
  it("falls past two fenced blocks to the longest balanced run", async () => {
    const candidate = `\`\`\`\nnot it\n\`\`\`\n\`\`\`json\n${JSON.stringify(OUTPUT)}\n\`\`\``

    expect(await judged(SCHEMA, candidate)).toEqual({ verdict: "valid", value: OUTPUT })
  })

  it("judges text that is not JSON at all with one Fault at the root", async () => {
    expect(await faultsOf(SCHEMA, "no JSON here at all")).toEqual([
      { at: "", wanted: "one JSON value" },
    ])
  })
})

describe("a judged Candidate", () => {
  it("answers valid with the parsed Output", async () => {
    const found = await judged(SCHEMA, JSON.stringify(OUTPUT))

    expect(found.verdict).toBe("valid")
    expect(found).toHaveProperty("value", OUTPUT)
  })

  it("names a missing required property", async () => {
    const faults = await faultsOf(SCHEMA, JSON.stringify({ name: "eva", status: "open" }))

    expect(faults).toEqual([{ at: "", wanted: "a property named entries" }])
  })

  it("names a wrong type", async () => {
    const faults = await faultsOf(SCHEMA, JSON.stringify({ ...OUTPUT, name: 5 }))

    expect(faults).toEqual([{ at: "/name", wanted: "a string" }])
  })

  it("names the members on an enum miss", async () => {
    const faults = await faultsOf(SCHEMA, JSON.stringify({ ...OUTPUT, status: "lost" }))

    expect(faults).toEqual([{ at: "/status", wanted: "one of open, closed, held" }])
  })

  it("points into depth with a JSON Pointer", async () => {
    const faults = await faultsOf(SCHEMA, JSON.stringify({ ...OUTPUT, entries: [{ id: 5 }] }))

    expect(faults).toEqual([{ at: "/entries/0/id", wanted: "a string" }])
  })

  it("reports every Fault rather than only the first", async () => {
    const candidate = JSON.stringify({ name: 5, status: "lost", entries: [{ id: "one" }] })

    expect((await faultsOf(SCHEMA, candidate)).map((fault) => fault.at)).toEqual([
      "/name",
      "/status",
    ])
  })

  /**
   * The contract assertion, not a preference: two keyword misses at one
   * location are one Fault, so two Validator plugins count the same Runs
   * the same way.
   */
  it("reduces to one Fault per instance location", async () => {
    const schema = { type: "string", minLength: 5, pattern: "^[a-z]+$" }
    const faults = await faultsOf(schema, JSON.stringify("A1"))

    expect(faults).toHaveLength(1)
    expect(faults[0]?.at).toBe("")
  })

  it("reduces two missing properties to one Fault naming both", async () => {
    const schema = { type: "object", required: ["one", "two"] }
    const faults = await faultsOf(schema, "{}")

    expect(faults).toEqual([{ at: "", wanted: "a property named one and a property named two" }])
  })
})

describe("a JSON Schema that cannot be read", () => {
  const flipped = (effect: Effect.Effect<unknown, { _tag: string }>) =>
    Effect.runPromise(Effect.flip(effect))

  it("fails accepts with ValidatorError", async () => {
    expect((await flipped(accepts({ type: "strang" })))._tag).toBe("ValidatorError")
    expect((await flipped(accepts(5)))._tag).toBe("ValidatorError")
  })

  it("fails check with ValidatorError", async () => {
    expect((await flipped(check({ type: "strang" }, "{}")))._tag).toBe("ValidatorError")
    expect((await flipped(check(5, "{}")))._tag).toBe("ValidatorError")
  })

  // Stage 1 speaks one dialect; a second dialect is a second plugin.
  it("refuses a schema that declares another dialect", async () => {
    const foreign = { $schema: "http://json-schema.org/draft-07/schema#", type: "object" }

    expect((await flipped(accepts(foreign)))._tag).toBe("ValidatorError")
  })

  // The meta-schema cannot see a dangling $ref; the judgement still can.
  it("fails check when a $ref resolves to nothing", async () => {
    const dangling = { $ref: "#/$defs/nowhere" }

    expect((await flipped(check(dangling, "{}")))._tag).toBe("ValidatorError")
  })

  it("accepts a boolean schema and the Output schemas above", async () => {
    await Effect.runPromise(accepts(true))
    await Effect.runPromise(accepts(SCHEMA))
  })
})
