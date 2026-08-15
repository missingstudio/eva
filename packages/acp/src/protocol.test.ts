import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  DRAFT_SESSION_UPDATE_KINDS,
  FramingError,
  PROTOCOL_VERSION,
  SDK_VERSION,
  SESSION_UPDATE_KINDS,
  decodeMessage,
  encodeMessage,
  sessionUpdates,
  stopReason,
  toolCallStatus,
  toolKind,
  type SessionUpdateKind,
} from "./protocol.js"

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"))
const alphabetical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const sorted = (names: readonly string[]) => [...names].sort(alphabetical)
const schemaPath = createRequire(import.meta.url).resolve(
  "@agentclientprotocol/sdk/schema/schema.json",
)

// The SDK does not export ./package.json, so reach it from the schema path.
const manifest = read(join(dirname(dirname(schemaPath)), "package.json"))
const schema = read(schemaPath)
const definitions = schema.$defs ?? schema.definitions

// The tag of each variant: a bare const, or the sessionUpdate discriminant.
const tagsOf = (name: string): string[] =>
  (definitions[name].oneOf ?? []).map(
    (variant: { const?: string; properties?: { sessionUpdate?: { const: string } } }) =>
      variant.const ?? variant.properties?.sessionUpdate?.const ?? "",
  )

/**
 * What the SDK says one session update carries. Each variant is the
 * discriminant plus an `allOf` reference to the body definition, so the
 * fields are one hop away from the tag.
 */
const sdkBody = (kind: string): { properties: string[]; required: string[] } => {
  const variant = (definitions.SessionUpdate.oneOf ?? []).find(
    (one: { properties?: { sessionUpdate?: { const: string } } }) =>
      one.properties?.sessionUpdate?.const === kind,
  )
  const reference: string | undefined = (variant?.allOf ?? [])[0]?.$ref
  const body = reference === undefined ? variant : definitions[reference.split("/").pop() as string]
  const named = (names: string[]) => names.filter((name) => name !== "sessionUpdate")
  return {
    properties: named(Object.keys(body?.properties ?? {})),
    required: named(body?.required ?? []),
  }
}

type Field = { safeParse: (value: unknown) => { success: boolean } }

// What this package says it carries. A field that accepts absence is optional.
const evaBody = (kind: SessionUpdateKind): { properties: string[]; required: string[] } => {
  const shape = (sessionUpdates[kind] as unknown as { shape: Record<string, Field> }).shape
  const properties = Object.keys(shape)
  return {
    properties,
    required: properties.filter((name) => !(shape[name] as Field).safeParse(undefined).success),
  }
}

// The pin. These fail loudly when the SDK moves, which is the point.
describe(`the protocol pin, @agentclientprotocol/sdk ${SDK_VERSION}`, () => {
  it("runs against the version this package names", () => {
    expect(manifest.version).toBe(SDK_VERSION)
  })

  it("negotiates the protocol version the SDK ships", () => {
    expect(schema.properties?.version?.const ?? PROTOCOL_VERSION).toBe(PROTOCOL_VERSION)
  })

  it("accounts for every session update the SDK defines", () => {
    const accounted = [...SESSION_UPDATE_KINDS, ...DRAFT_SESSION_UPDATE_KINDS]
    expect(sorted(tagsOf("SessionUpdate"))).toEqual(sorted(accounted))
  })

  it("matches the SDK's stop reasons", () => {
    expect(sorted(tagsOf("StopReason"))).toEqual(sorted(stopReason.options))
  })

  it("matches the SDK's tool kinds", () => {
    expect(sorted(tagsOf("ToolKind"))).toEqual(sorted(toolKind.options))
  })

  it("matches the SDK's tool statuses", () => {
    expect(tagsOf("ToolCallStatus")).toEqual([...toolCallStatus.options])
  })
})

/**
 * A tag set that still matches says nothing about the fields inside a kind.
 * A renamed field parses as a failure and lands in `unknown`, which the
 * union calls a bug — so the pin reaches the fields too.
 */
describe("the shape of each session update", () => {
  it.each(SESSION_UPDATE_KINDS)("reads only fields the SDK defines on %s", (kind) => {
    const sdk = sdkBody(kind)
    const unknownFields = evaBody(kind).properties.filter((name) => !sdk.properties.includes(name))
    expect(unknownFields).toEqual([])
  })

  it.each(SESSION_UPDATE_KINDS)("requires nothing the SDK leaves optional on %s", (kind) => {
    const optional = evaBody(kind).required.filter((name) => !sdkBody(kind).required.includes(name))
    expect(optional).toEqual([])
  })

  it("reads the fields it maps rather than none of them", () => {
    for (const kind of SESSION_UPDATE_KINDS) {
      expect(evaBody(kind).properties.length).toBeGreaterThan(0)
    }
  })
})

describe("stdio framing", () => {
  it.each([
    ["a request", { jsonrpc: "2.0", id: 1, method: "session/prompt", params: { sessionId: "s" } }],
    ["a notification", { jsonrpc: "2.0", method: "session/update", params: {} }],
    ["a result", { jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn" } }],
    ["an error", { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "no such method" } }],
  ] as const)("round-trips %s on one line", (_name, message) => {
    const line = encodeMessage(message)
    expect(line).not.toContain("\n")
    expect(decodeMessage(line)).toEqual(message)
  })

  it.each([
    ["a torn line", '{"jsonrpc":"2.0","id":1,"meth'],
    ["a foreign object", '{"hello":"world"}'],
  ])("refuses %s", (_name, line) => {
    expect(() => decodeMessage(line)).toThrow(FramingError)
  })
})
