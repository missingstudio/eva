import { describe, expect, it } from "vitest"
import {
  CodecError,
  decode,
  decodeLine,
  decodePayload,
  decodePayloadLine,
  encode,
  encodeLine,
  encodePayload,
  encodePayloadLine,
} from "./codec.js"
import { SCHEMA_VERSION, type Event } from "./event.js"
import { eventID, runID, sessionID } from "./id.js"
import type { Payload } from "./payload.js"
import { samples } from "./samples.js"

const wrap = (payload: Payload, overrides: Partial<Event> = {}): Event => ({
  id: eventID("evt_test"),
  seq: 1,
  at: { wall: "2026-08-15T09:00:00Z" },
  run: runID("run_test"),
  session: sessionID("sess_test"),
  parent: null,
  payload,
  ...overrides,
})

const line = (kind: string, payload: unknown, version = SCHEMA_VERSION) =>
  JSON.stringify({
    id: "evt_wire",
    seq: 3,
    at: { wall: "2026-08-15T09:00:00.000Z" },
    version,
    kind,
    run: "run_wire",
    session: "sess_wire",
    parent: null,
    payload,
  })

describe("decode", () => {
  it("preserves an unrecognized kind as unknown", () => {
    const event = decodeLine(line("acp/party_mode", { confetti: true }))
    expect(event.payload).toEqual({
      kind: "unknown",
      originalKind: "acp/party_mode",
      raw: { confetti: true },
    })
    expect(encode(event)).toMatchObject({ kind: "acp/party_mode", payload: { confetti: true } })
  })

  it("refuses a known kind with a malformed payload", () => {
    expect(() => decodeLine(line("text", { nonsense: true }))).toThrow(CodecError)
  })

  it("refuses an envelope without a payload", () => {
    const record = JSON.parse(
      line("text", { block: 0, content: { type: "text", text: "x" } }),
    ) as Record<string, unknown>
    delete record["payload"]
    expect(() => decode(record)).toThrow(CodecError)
  })

  // Nothing has shipped, so there is one version and no migration path.
  it("refuses any version but its own", () => {
    expect(() => decodeLine(line("text", { block: 0, chunk: "x" }, 2))).toThrow(
      /unsupported schema version 2/,
    )
  })

  it("refuses an envelope carrying a field the schema dropped", () => {
    const record = JSON.parse(
      line("text", { block: 0, content: { type: "text", text: "x" } }),
    ) as Record<string, unknown>
    record["wire_seq"] = 0
    expect(() => decode(record)).toThrow(CodecError)
  })

  it("keeps null counters explicit", () => {
    const event = wrap(samples().usage)
    const decoded = decode(encode(event))
    expect(decoded.payload).toMatchObject({ cacheWriteTokens: null, serverToolTokens: null })
  })

  it("keeps tool_call args raw and opaque", () => {
    const args = { nested: { deep: [1, 2, { ok: true }] }, weird: "值" }
    const event = wrap({ ...samples().tool_call, args } as Payload)
    expect(decode(encode(event)).payload).toMatchObject({ args })
  })

  // The type-level tie in the codec says the bodies and the union agree.
  // This says the same thing about the values, for every kind at once.
  it("returns each sample payload field for field", () => {
    for (const payload of Object.values(samples())) {
      expect(decodeLine(encodeLine(wrap(payload))).payload).toEqual(payload)
    }
  })

  // An absent field is absent. `undefined` is a value the union cannot
  // hold and JSON cannot carry, so the reader refuses it rather than
  // handing back a key nothing put there.
  it("refuses an absent field spelled as undefined", () => {
    const record = JSON.parse(line("info", { title: "one" })) as Record<string, unknown>
    expect(() => decode(record)).not.toThrow()
    expect(() => decode({ ...record, payload: { title: undefined } })).toThrow(CodecError)
  })
})

describe("the verdict body", () => {
  const body = {
    step: "draft",
    verdict: "invalid",
    attempt: 1,
    faults: [{ at: "/title", wanted: "a string" }],
  }

  it("round-trips", () => {
    const event = wrap(samples().verdict)
    expect(decodeLine(encodeLine(event)).payload).toEqual(samples().verdict)
  })

  it.each([0, -1])("refuses attempt %d", (attempt) => {
    expect(() => decodeLine(line("verdict", { ...body, attempt }))).toThrow(CodecError)
  })

  it("refuses a verdict word outside the three", () => {
    expect(() => decodeLine(line("verdict", { ...body, verdict: "passed" }))).toThrow(CodecError)
  })

  it.each(["valid", "unchecked"])("accepts empty faults on %s", (verdict) => {
    expect(() => decodeLine(line("verdict", { ...body, verdict, faults: [] }))).not.toThrow()
  })

  // An empty Step id is a caller's problem, not the codec's: refusing it
  // would put a Workflow rule in the wire table.
  it("accepts an empty step", () => {
    expect(() => decodeLine(line("verdict", { ...body, step: "" }))).not.toThrow()
  })
})

describe("encode", () => {
  // A record in memory carries no version, so the writer is the one place
  // a version is decided and there is nothing to disagree with it.
  it("stamps the current schema version", () => {
    expect(encode(wrap(samples().text))).toMatchObject({ version: SCHEMA_VERSION })
  })

  it("re-encodes stably", () => {
    for (const payload of Object.values(samples())) {
      const line = encodeLine(wrap(payload))
      expect(encodeLine(decodeLine(line))).toBe(line)
    }
  })
})

/**
 * The same codec, one layer in. `watch` hands back payloads and no envelope,
 * so a stream travels as this shape — and it is the same body table, so a
 * kind either half can read is a kind both halves can read.
 */
describe("a payload with no envelope over it", () => {
  it("round-trips every sample field for field", () => {
    for (const payload of Object.values(samples())) {
      expect(decodePayloadLine(encodePayloadLine(payload))).toEqual(payload)
    }
  })

  // The same degradation the envelope carries: a reader that knows less than
  // the writer says so, and holds what arrived rather than dropping it.
  it("preserves an unrecognized kind as unknown, and sends it back as it came", () => {
    const wire = { version: SCHEMA_VERSION, kind: "acp/party_mode", payload: { confetti: true } }
    const payload = decodePayload(wire)

    expect(payload).toEqual({
      kind: "unknown",
      originalKind: "acp/party_mode",
      raw: { confetti: true },
    })
    expect(encodePayload(payload)).toEqual(wire)
  })

  it("refuses a known kind with a malformed body", () => {
    expect(() =>
      decodePayload({ version: SCHEMA_VERSION, kind: "text", payload: { nonsense: true } }),
    ).toThrow(CodecError)
  })

  // A body's shape is the schema's, whether or not an envelope is carrying it.
  it("refuses any version but its own", () => {
    expect(() => decodePayload({ version: 2, kind: "text", payload: {} })).toThrow(
      /unsupported schema version 2/,
    )
  })

  it("refuses a frame that is not one", () => {
    expect(() => decodePayloadLine("not json")).toThrow(CodecError)
    expect(() => decodePayload({ kind: "text" })).toThrow(CodecError)
  })

  // One codec, at two granularities. A payload read through the envelope and
  // the same payload read on its own are the same value.
  it("agrees with the envelope about every sample", () => {
    for (const payload of Object.values(samples())) {
      expect(decodePayload(encodePayload(payload))).toEqual(decode(encode(wrap(payload))).payload)
    }
  })
})
