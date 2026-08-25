import { z } from "zod"
import { contentBlock } from "./content.js"
import { SCHEMA_VERSION, type Event } from "./event.js"
import { eventID, runID, sessionID } from "./id.js"
import type { Kind, Payload } from "./payload.js"

// Every kind that travels on the wire under its own name. `unknown` is the
// one that does not: it wears the kind it arrived as.
type WireKind = Exclude<Kind, "unknown">
type Member<K extends WireKind> = Extract<Payload, { kind: K }>

export class CodecError extends Error {
  override readonly name = "CodecError"
}

const timestamp = z.strictObject({ wall: z.string().min(1) })

const envelope = z.strictObject({
  id: z.string().min(1),
  seq: z.number().int().positive(),
  at: timestamp,
  version: z.number().int(),
  kind: z.string().min(1),
  run: z.string().min(1),
  session: z.string().min(1),
  parent: z.string().min(1).nullable(),
  payload: z.looseObject({}),
})

const toolStatus = z.enum(["pending", "in_progress", "completed", "failed"])
const toolKind = z.enum([
  "read",
  "edit",
  "delete",
  "move",
  "search",
  "execute",
  "think",
  "fetch",
  "switch_mode",
  "other",
])
const disposition = z.enum([
  "ok",
  "denied",
  "failed",
  "skipped",
  "cancelled",
  "unknown_tool",
  "budget_denied",
])
const errorClass = z.enum([
  "rate_limit",
  "overloaded",
  "auth_failed",
  "unreachable",
  "server_error",
  "no_such_model",
  "billing",
  "other",
])
const stopReason = z.enum(["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"])

const claim = z.strictObject({
  result: z.enum(["done", "failed"]),
  summary: z.string().exactOptional(),
  errorClass: errorClass.exactOptional(),
})

const planEntry = z.strictObject({
  content: z.string(),
  priority: z.enum(["high", "medium", "low"]),
  status: z.enum(["pending", "in_progress", "completed"]),
})

const harnessCommand = z.strictObject({
  name: z.string(),
  description: z.string(),
  input: z.strictObject({ hint: z.string() }).exactOptional(),
})

const configOption = z.strictObject({
  id: z.string(),
  name: z.string(),
  value: z.string().nullable().exactOptional(),
})

// A payload that names a Session or an Event brands it exactly as the
// envelope does, so a reader never holds an unbranded id the type calls one.
const cursor = z.strictObject({
  session: z.string().min(1).transform(sessionID),
  seq: z.number().int().positive(),
})

const counter = z.number().int().nonnegative().nullable()

// One body schema per kind, without the `kind` discriminant.
const bodies = {
  started: z.strictObject({ intent: z.string() }),
  text: z.strictObject({ block: z.number().int().nonnegative(), content: contentBlock }),
  thought: z.strictObject({ block: z.number().int().nonnegative(), content: contentBlock }),
  message: z.strictObject({ content: contentBlock, target: z.enum(["next-run", "next-step"]) }),
  tool_call: z.strictObject({
    id: z.string(),
    name: z.string(),
    tool: toolKind,
    args: z.unknown(),
    status: toolStatus,
    redacted: z.boolean(),
  }),
  tool_update: z.strictObject({
    id: z.string(),
    status: toolStatus,
    content: z.array(contentBlock).exactOptional(),
  }),
  tool_result: z.strictObject({
    id: z.string(),
    name: z.string(),
    disposition,
    bytes: z.number().int().nonnegative(),
  }),
  plan: z.strictObject({ entries: z.array(planEntry) }),
  mode: z.strictObject({ mode: z.string(), reason: z.string().exactOptional() }),
  commands: z.strictObject({ commands: z.array(harnessCommand) }),
  config: z.strictObject({ options: z.array(configOption) }),
  info: z.strictObject({
    title: z.string().exactOptional(),
    updatedAt: z.string().exactOptional(),
    costTicks: z.number().int().nonnegative().exactOptional(),
  }),
  usage: z.strictObject({
    model: z.string().exactOptional(),
    inputTokens: counter,
    outputTokens: counter,
    cacheWriteTokens: counter,
    cacheReadTokens: counter,
    reasoningTokens: counter.exactOptional(),
    serverToolTokens: counter.exactOptional(),
    costTicks: z.number().int().nonnegative().exactOptional(),
  }),
  retry: z.strictObject({
    attempt: z.number().int().positive(),
    max: z.number().int().positive(),
    delayMs: z.number().int().nonnegative(),
    errorClass,
  }),
  verdict: z.strictObject({
    step: z.string(),
    verdict: z.enum(["valid", "invalid", "unchecked"]),
    attempt: z.number().int().positive(),
    faults: z.array(z.strictObject({ at: z.string(), wanted: z.string() })),
  }),
  edit: z.strictObject({ path: z.string(), hunks: z.number().int().nonnegative() }),
  needs_human: z.strictObject({ question: z.string(), resume: cursor }),
  resolved: z.strictObject({
    question: z.string().min(1).transform(eventID),
    resolution: z.enum(["answered", "rejected", "expired", "cancelled"]),
    content: contentBlock.exactOptional(),
  }),
  finished: z.strictObject({ claim, stopReason: stopReason.exactOptional() }),
  degraded: z.strictObject({ missing: z.array(z.string()).min(1) }),
} satisfies Record<WireKind, z.ZodType>

/**
 * The type-level tie between the table above and the union it decodes to.
 * A body that drops a field the union declares, gives one the wrong type,
 * or carries one the union does not have fails here, rather than at a
 * reader that trusted the type. This is what makes the one cast in
 * `decode` sound.
 *
 * The two questions catch different faults. The second asks about keys
 * rather than types, because a body yields `T[]` where the union says
 * `readonly T[]` — a variance difference, and not a drift.
 */
type Decoded<K extends WireKind> = { readonly kind: K } & z.infer<(typeof bodies)[K]>

// A kind whose body disagrees with its union member names itself here, so
// the compiler says which one drifted rather than that one did.
type Mismatched = {
  [K in WireKind]: Decoded<K> extends Member<K>
    ? keyof Decoded<K> extends keyof Member<K>
      ? never
      : K
    : K
}[WireKind]

type BodiesMatch = [Mismatched] extends [never]
  ? true
  : `body drifted from the union: ${Mismatched}`
const bodiesMatch: BodiesMatch = true
void bodiesMatch

const isKnownKind = (kind: string): kind is WireKind => kind in bodies

/**
 * One kind and its body, read as the union member they are. A kind no member
 * covers is not a failure: it is what arrived, held whole, so a reader that
 * knows less than the writer says so rather than dropping it.
 */
const bodyIn = (kind: string, body: unknown): Payload => {
  if (!isKnownKind(kind)) return { kind: "unknown", originalKind: kind, raw: body }
  const parsed = bodies[kind].safeParse(body)
  if (!parsed.success) {
    throw new CodecError(`invalid ${kind} payload: ${parsed.error.message}`)
  }
  // The kind and its body are one union member, which no index signature
  // correlates. `BodiesMatch` above is what proves the two agree.
  return { kind, ...parsed.data } as Payload
}

// The kind a payload travels under, and the body beneath it. `unknown` wears
// the kind it arrived as, because that is the one fact it holds.
const bodyOut = (payload: Payload): { readonly kind: string; readonly body: unknown } => {
  const { kind, ...body } = payload
  return kind === "unknown"
    ? {
        kind: (payload as { originalKind: string }).originalKind,
        body: (payload as { raw: unknown }).raw,
      }
    : { kind, body }
}

export const decode = (value: unknown): Event => {
  const wire = envelope.safeParse(value)
  if (!wire.success) throw new CodecError(`invalid envelope: ${wire.error.message}`)
  const record = wire.data

  // Nothing has shipped, so there is one version and no migration path.
  // The reader gains one when a stored record outlives a schema change.
  if (record.version !== SCHEMA_VERSION) {
    throw new CodecError(`unsupported schema version ${record.version}`)
  }

  return {
    id: eventID(record.id),
    seq: record.seq,
    at: record.at,
    run: runID(record.run),
    session: sessionID(record.session),
    parent: record.parent === null ? null : eventID(record.parent),
    payload: bodyIn(record.kind, record.payload),
  }
}

export const decodeLine = (line: string): Event => {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new CodecError(`invalid JSON: ${(cause as Error).message}`)
  }
  return decode(value)
}

export const encode = (event: Event): Record<string, unknown> => {
  const { kind, body } = bodyOut(event.payload)
  return {
    id: event.id,
    seq: event.seq,
    at: { wall: event.at.wall },
    version: SCHEMA_VERSION,
    kind,
    run: event.run,
    session: event.session,
    parent: event.parent,
    payload: body,
  }
}

export const encodeLine = (event: Event): string => JSON.stringify(encode(event))

/**
 * A Payload with no Event over it. `watch` hands payloads back and drops the
 * position — a live delta the sink has not numbered has none to drop — so a
 * wire that carries a stream carries this shape and not the envelope.
 *
 * It is the inner half of `encode`/`decode` rather than a second codec: the
 * same body table answers both, so a kind added for one is added for the
 * other, and an unknown kind survives both the same way.
 */
const flat = z.strictObject({
  version: z.number().int(),
  kind: z.string().min(1),
  payload: z.looseObject({}),
})

export const encodePayload = (payload: Payload): Record<string, unknown> => {
  const { kind, body } = bodyOut(payload)
  return { version: SCHEMA_VERSION, kind, payload: body }
}

export const decodePayload = (value: unknown): Payload => {
  const wire = flat.safeParse(value)
  if (!wire.success) throw new CodecError(`invalid payload frame: ${wire.error.message}`)
  // The same gate `decode` keeps. A body's shape is the schema's, whether or
  // not an envelope is carrying it.
  if (wire.data.version !== SCHEMA_VERSION) {
    throw new CodecError(`unsupported schema version ${wire.data.version}`)
  }
  return bodyIn(wire.data.kind, wire.data.payload)
}

export const encodePayloadLine = (payload: Payload): string =>
  JSON.stringify(encodePayload(payload))

export const decodePayloadLine = (line: string): Payload => {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (cause) {
    throw new CodecError(`invalid JSON: ${(cause as Error).message}`)
  }
  return decodePayload(value)
}
