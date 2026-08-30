import type { StreamFrame } from "@missingstudio/eva-client-runtime"
import {
  ResumeTooFarBehind,
  type CancelCause,
  type FrontendAnswer,
  type ModelRef,
  type SessionHeader,
  type SubmitInput,
} from "@missingstudio/eva-core"
import {
  decode,
  decodePayloadLine,
  encode,
  sessionID,
  type Cursor,
  type Event,
  type ModelPrice,
  type Payload,
  type SessionID,
} from "@missingstudio/eva-schema"
import type { FrontendRequest, PickRow, Ran } from "@missingstudio/eva-sdk"

export const API_PLUGIN = "eva.api"

/**
 * Where the wire is. The paths are rooted and never absolute, because one
 * port serves the page and the calls: the page asks the host that served it,
 * and no address is built into the artifact.
 */
export const API_ROOT = "/api"
export const SESSIONS = `${API_ROOT}/sessions`

/**
 * `answer` is keyed by a `RequestID` and not by a Session, so it is the one
 * method that sits outside the listing. A request is what a Run asked a
 * person, and a person may answer it from a page that never named a Session.
 */
export const REQUESTS = `${API_ROOT}/requests`

/**
 * What the Catalog knows, and the one path here that names no Session. A
 * model is a fact of the build and not of a Session, so the rows are read
 * once and every Session on this runtime is offered the same ones.
 */
export const MODELS = `${API_ROOT}/models`

/**
 * Where the questions that stand are read.
 *
 * It is here and not beside a surface. `answer` is here already, and a
 * question and its answer are two halves of one exchange — so a terminal at
 * the end of a socket relays a permission request through this wire and
 * imports no page.
 *
 * The path is outside `API_ROOT`, which the wire claims whole and refuses
 * every unknown path under. The surface that binds the port writes the
 * frames, and it spells this path itself: a plugin may not import a plugin,
 * so the copy is forced, exactly as `Answering` is spelled twice.
 */
export const ASKING_PATH = "/asking"

const requestIn = (value: unknown): FrontendRequest | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const { kind, id, question } = value as Record<string, unknown>
  if (typeof id !== "string" || typeof question !== "string") return undefined
  return kind === "permission" || kind === "question" ? { kind, id, question } : undefined
}

/**
 * The questions a frame's data carries, or nothing when it carries no set this
 * side can read. A frame that cannot be read is not an empty set: a reader
 * looking at a question would otherwise watch it vanish because a byte was
 * wrong, so the caller keeps what it had.
 *
 * What travels is `FrontendRequest`, whole. It is the shape `Frontend.ask`
 * takes, so a question crosses this wire unchanged and a door at the far end
 * asks its person with the kind the gate asked it with — a wire that dropped
 * the kind made every relayed question a permission request, whatever it was.
 */
export const askingIn = (text: string): readonly FrontendRequest[] | undefined => {
  let read: unknown
  try {
    read = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof read !== "object" || read === null) return undefined
  const asking = (read as Record<string, unknown>)["asking"]
  if (!Array.isArray(asking)) return undefined

  const out: FrontendRequest[] = []
  for (const one of asking as readonly unknown[]) {
    const request = requestIn(one)
    if (request === undefined) return undefined
    out.push(request)
  }
  return out
}

export const sessionPath = (session: string): string => `${SESSIONS}/${encodeURIComponent(session)}`

export const modelPath = (session: string): string => `${sessionPath(session)}/model`

export const watchPath = (session: string): string => `${sessionPath(session)}/watch`

export const cancelPath = (session: string): string => `${sessionPath(session)}/cancel`

/**
 * A command is not a `SessionAPI` method, and it is under the Session all the
 * same: a line runs against one Session, and the rows it resolves through
 * belong to the process that holds the Domains. A door that ran the line for
 * itself would change its own process and not the one the Run is in.
 */
export const commandPath = (session: string): string => `${sessionPath(session)}/command`

export const answerPath = (request: string): string => `${REQUESTS}/${encodeURIComponent(request)}`

/**
 * The Cursor's name on the wire. `watch` is one way, so it is SSE — and SSE
 * already has a name for "the last position I saw", which is the Cursor with
 * a standard name. The Session is in the path, so the header carries the
 * position and nothing else.
 */
export const CURSOR = "last-event-id"

/**
 * Which write a request is, so the same write asked for twice is answered
 * twice and done once. It rides a header for the reason the Cursor does: the
 * body is the contract's own shape, and a key inside it would be exactly the
 * envelope this wire refuses to add.
 *
 * A write has no error channel, so a call that cannot reach the far side
 * waits and asks again — and a `submit` whose answer was lost would otherwise
 * open a second Run. The key is what makes asking again safe.
 */
export const IDEMPOTENCY = "idempotency-key"

/**
 * The framing this stream speaks is the client runtime's: the surface that
 * writes the ask channel's frames frames the same way, and a plugin may not
 * import a plugin, so the one spelling lives below both. It is said again
 * here so a caller of this wire reads one file for the whole agreement.
 */
export {
  cursorIn,
  EVENT_STREAM,
  framesIn,
  frameOut,
  type StreamFrame,
} from "@missingstudio/eva-client-runtime"

/**
 * What travels: the contract's own shapes, with nothing wrapped around them.
 * `SessionHeader` and `ModelRef` are JSON already, so the wire adds no
 * envelope and no rendering — and the half that reads a shape is the half
 * that says whether what arrived is one.
 *
 * Each shape is one pair here: the writer that spells it onto the wire and
 * the reader that judges what arrived. Both live beside the paths rather
 * than at the call sites, because both halves of one wire have to agree
 * about a shape and a copy of an agreement is one that keeps passing after
 * the agreement moves. Neither `routes.ts` nor `client/transport.ts` names a
 * field: the server writes through the writers, the client reads through the
 * readers, and the agreement moves in this file or not at all.
 *
 * A writer spells its shape field by field and asserts the rest empty, so a
 * field the contract grows is a compile error in this file rather than a
 * silent drop on the far side of the wire.
 */
const objectIn = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const stringAt = (row: Record<string, unknown>, name: string): string | undefined => {
  const found = row[name]
  return typeof found === "string" ? found : undefined
}

const booleanAt = (row: Record<string, unknown>, name: string): boolean | undefined => {
  const found = row[name]
  return typeof found === "boolean" ? found : undefined
}

export const headerOut = (header: SessionHeader): Record<string, unknown> => {
  const { id, title, updatedAt, retired, ...rest } = header
  void (rest satisfies Record<string, never>)
  return {
    id,
    ...(title === undefined ? {} : { title }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(retired === undefined ? {} : { retired }),
  }
}

export const headersOut = (rows: readonly SessionHeader[]): readonly Record<string, unknown>[] =>
  rows.map(headerOut)

export const headerIn = (value: unknown): SessionHeader | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const id = stringAt(row, "id")
  if (id === undefined) return undefined

  const title = stringAt(row, "title")
  const updatedAt = stringAt(row, "updatedAt")
  const retired = booleanAt(row, "retired")
  return {
    id: sessionID(id),
    ...(title === undefined ? {} : { title }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(retired === undefined ? {} : { retired }),
  }
}

export const headersIn = (value: unknown): readonly SessionHeader[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const listed: readonly unknown[] = value

  const rows: SessionHeader[] = []
  for (const one of listed) {
    const row = headerIn(one)
    // One row this cannot read makes the whole listing unreadable. A Session
    // dropped in silence is worse than a call that waits and asks again.
    if (row === undefined) return undefined
    rows.push(row)
  }
  return rows
}

export const modelOut = (model: ModelRef): Record<string, unknown> => {
  const { provider, model: name, ...rest } = model
  void (rest satisfies Record<string, never>)
  return { provider, model: name }
}

export const modelIn = (value: unknown): ModelRef | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const provider = stringAt(row, "provider")
  const model = stringAt(row, "model")
  return provider === undefined || model === undefined ? undefined : { provider, model }
}

/**
 * One model, as a picker draws it. `PickRow` is the command vocabulary's own
 * shape, and it is said again here so the page names it off this wire: the
 * rows a page shows are the rows `/model` picks from, and a second shape for
 * them would be a second answer to what this build can run.
 */
export type { PickRow }

const numberAt = (row: Record<string, unknown>, name: string): number | undefined => {
  const found = row[name]
  return typeof found === "number" && Number.isFinite(found) ? found : undefined
}

/**
 * A model's published rate, as this wire carries it. The two counters every
 * vendor bills are required and the other three are not: a rate that named no
 * input and no output would price nothing, and a rate missing a cache figure
 * prices what it can and leaves the rest at nothing.
 *
 * A price this cannot read is no price. It is dropped rather than half-read,
 * because half a rate produces an estimate that is wrong rather than absent.
 */
const priceIn = (value: unknown): ModelPrice | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined

  const inputTicks = numberAt(row, "inputTicks")
  const outputTicks = numberAt(row, "outputTicks")
  if (inputTicks === undefined || outputTicks === undefined) return undefined

  const cacheReadTicks = numberAt(row, "cacheReadTicks")
  const cacheWriteTicks = numberAt(row, "cacheWriteTicks")
  const reasoningTicks = numberAt(row, "reasoningTicks")
  return {
    inputTicks,
    outputTicks,
    ...(cacheReadTicks === undefined ? {} : { cacheReadTicks }),
    ...(cacheWriteTicks === undefined ? {} : { cacheWriteTicks }),
    ...(reasoningTicks === undefined ? {} : { reasoningTicks }),
  }
}

const priceOut = (price: ModelPrice): Record<string, unknown> => {
  const { inputTicks, outputTicks, cacheReadTicks, cacheWriteTicks, reasoningTicks, ...rest } =
    price
  void (rest satisfies Record<string, never>)
  return {
    inputTicks,
    outputTicks,
    ...(cacheReadTicks === undefined ? {} : { cacheReadTicks }),
    ...(cacheWriteTicks === undefined ? {} : { cacheWriteTicks }),
    ...(reasoningTicks === undefined ? {} : { reasoningTicks }),
  }
}

/**
 * The colors a row would paint, when it names a theme. A value that is not
 * a name-to-color table is no colors: it is dropped rather than half-read,
 * the way a half rate is, because a screen painted from half a theme is
 * wrong rather than plain.
 */
const colorsIn = (value: unknown): Record<string, string> | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const colors: Record<string, string> = {}
  for (const [name, color] of Object.entries(row)) {
    if (typeof color !== "string") return undefined
    colors[name] = color
  }
  return colors
}

export const modelRowOut = (row: PickRow): Record<string, unknown> => {
  const { id, label, detail, price, colors, ...rest } = row
  void (rest satisfies Record<string, never>)
  return {
    id,
    label,
    ...(detail === undefined ? {} : { detail }),
    ...(price === undefined ? {} : { price: priceOut(price) }),
    ...(colors === undefined ? {} : { colors }),
  }
}

export const modelRowsOut = (rows: readonly PickRow[]): readonly Record<string, unknown>[] =>
  rows.map(modelRowOut)

export const modelRowIn = (value: unknown): PickRow | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const id = stringAt(row, "id")
  const label = stringAt(row, "label")
  if (id === undefined || label === undefined) return undefined

  const detail = stringAt(row, "detail")
  const price = priceIn(row["price"])
  const colors = colorsIn(row["colors"])
  return {
    id,
    label,
    ...(detail === undefined ? {} : { detail }),
    ...(price === undefined ? {} : { price }),
    ...(colors === undefined ? {} : { colors }),
  }
}

export const modelRowsIn = (value: unknown): readonly PickRow[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const listed: readonly unknown[] = value

  const rows: PickRow[] = []
  for (const one of listed) {
    const row = modelRowIn(one)
    // One row this cannot read makes the whole listing unreadable, as a
    // listing of Sessions does. A model dropped in silence is a model a
    // person cannot choose and is never told about.
    if (row === undefined) return undefined
    rows.push(row)
  }
  return rows
}

/**
 * Where a new Session is, as the caller named it. A browser holds no honest
 * path, so the field is optional and an absent one means the directory the
 * serving process is in.
 *
 * An absent body reads the same way, and it has to: a body that is not JSON
 * arrives here as nothing, exactly as no body at all does. So this refuses
 * only a `location` that is there and is not a string — the one disagreement
 * about a shape that this side can really see.
 */
export const locationOut = (location: string | undefined): Record<string, unknown> =>
  location === undefined ? {} : { location }

export const locationIn = (value: unknown): { readonly location?: string } | undefined => {
  if (value === undefined) return {}
  const row = objectIn(value)
  if (row === undefined) return undefined
  if (row["location"] === undefined) return {}
  const location = stringAt(row, "location")
  return location === undefined ? undefined : { location }
}

// The Session a `create` opened. It travels as the string it is, because a
// `SessionID` is a branded string and an envelope around one would say no more.
export const sessionOut = (session: SessionID): string => session

export const sessionIn = (value: unknown): SessionID | undefined =>
  typeof value === "string" ? sessionID(value) : undefined

/**
 * The line a person typed, whole. The name and the argument are not split
 * here: `dispatch` owns what a line means, and a wire that parsed one would
 * be a second parser to keep in step with the first.
 */
export const lineOut = (line: string): Record<string, unknown> => ({ line })

export const lineIn = (value: unknown): string | undefined => {
  const row = objectIn(value)
  return row === undefined ? undefined : stringAt(row, "line")
}

// What running a line came to. The shape is the sdk's, so the wire and the
// door that draws the answer read one agreement.
export const ranOut = (ran: Ran): Record<string, unknown> => {
  const { wrote, selected, ...rest } = ran
  void (rest satisfies Record<string, never>)
  return { wrote, ...(selected === undefined ? {} : { selected }) }
}

export const ranIn = (value: unknown): Ran | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const wrote = stringAt(row, "wrote")
  if (wrote === undefined) return undefined

  if (row["selected"] === undefined) return { wrote }
  const selected = stringAt(row, "selected")
  return selected === undefined ? undefined : { wrote, selected: sessionID(selected) }
}

/**
 * What a write carries, read the way an answer is. The shapes are the
 * contract's own — a `SubmitInput` body *is* the Prompt and a `CancelCause`
 * body *is* the cause — so there is nothing to unwrap and nothing to name a
 * field twice.
 *
 * A body one of these cannot read is a refusal, never a partially applied
 * write. It is the rule `headersIn` keeps pointed the other way: a shape half
 * understood is worse than a call that says it was not understood.
 */
export const submitInputOut = (input: SubmitInput): Record<string, unknown> => {
  if (input.kind === "prompt") {
    const { kind, text, harness, ...rest } = input
    void (rest satisfies Record<string, never>)
    return { kind, text, ...(harness === undefined ? {} : { harness }) }
  }
  const { kind, text, target, ...rest } = input
  void (rest satisfies Record<string, never>)
  return { kind, text, target }
}

export const submitInputIn = (value: unknown): SubmitInput | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const text = stringAt(row, "text")
  if (text === undefined) return undefined

  if (stringAt(row, "kind") === "prompt") {
    const harness = stringAt(row, "harness")
    // An absent Harness is the behaviour a Prompt has always had, so it is
    // read as absent and never as an empty name.
    if (harness === undefined && row["harness"] !== undefined) return undefined
    return { kind: "prompt", text, ...(harness === undefined ? {} : { harness }) }
  }

  if (stringAt(row, "kind") === "steer") {
    const target = stringAt(row, "target")
    if (target !== "next-run" && target !== "next-step") return undefined
    return { kind: "steer", text, target }
  }

  return undefined
}

// A cause travels as the word it is.
export const cancelCauseOut = (cause: CancelCause): string => cause

export const cancelCauseIn = (value: unknown): CancelCause | undefined =>
  value === "user" || value === "budget" || value === "shutdown" ? value : undefined

export const answerOut = (answer: FrontendAnswer): Record<string, unknown> => {
  switch (answer.kind) {
    case "permission": {
      const { kind, optionId, ...rest } = answer
      void (rest satisfies Record<string, never>)
      return { kind, optionId }
    }
    case "text": {
      const { kind, text, ...rest } = answer
      void (rest satisfies Record<string, never>)
      return { kind, text }
    }
    case "cancelled": {
      const { kind, ...rest } = answer
      void (rest satisfies Record<string, never>)
      return { kind }
    }
  }
}

export const answerIn = (value: unknown): FrontendAnswer | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined

  switch (stringAt(row, "kind")) {
    case "permission": {
      const optionId = stringAt(row, "optionId")
      return optionId === undefined ? undefined : { kind: "permission", optionId }
    }
    case "text": {
      const text = stringAt(row, "text")
      return text === undefined ? undefined : { kind: "text", text }
    }
    case "cancelled":
      return { kind: "cancelled" }
    default:
      return undefined
  }
}

/**
 * What travels is the record the Transcript folded, not the Transcript: the
 * far side folds it again. A projection sent instead would be the only answer
 * a page had, and a wrong one would read as the truth. `packages/schema`
 * carries the codec both ways, so there is no second one here.
 */
export const eventsOut = (events: readonly Event[]): readonly Record<string, unknown>[] =>
  events.map(encode)

export const eventsIn = (value: unknown): readonly Event[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const listed: readonly unknown[] = value

  const record: Event[] = []
  for (const one of listed) {
    try {
      record.push(decode(one))
    } catch {
      // One record this cannot read makes the whole fold unreadable. A
      // transcript with a hole in it is worse than a call that asks again.
      return undefined
    }
  }
  return record
}

// What a refused Cursor answers with. Both halves read it, so both halves
// hold one spelling.
export const CURSOR_REFUSED = 409

/**
 * The payload a frame's data carries. `seq` is absent for a watch that
 * carries no Cursor, and that absence is the point: a frame with a made-up
 * position is a position a page would resume from, and it would resume past
 * what it never saw — see `watchFor` for where the counting happens and why
 * only one form of it can count.
 */
export const payloadIn = (frame: StreamFrame): Payload | undefined => {
  try {
    return decodePayloadLine(frame.data)
  } catch {
    // One frame this cannot read is a stream this cannot read. A payload
    // dropped in silence is a hole in what a Run said, and nothing later
    // would say there was one.
    return undefined
  }
}

/**
 * The refusal a cursor watch can answer with. It happens before the first
 * frame — the position is checked against the head and nothing has been said
 * — so it is a status on the response and never a frame inside a stream that
 * has already said it was fine.
 *
 * The Cursor asked for is sent back beside the head, so a reader can say what
 * it asked and what it was told in one line.
 */
export const refusalOut = (refused: ResumeTooFarBehind): Record<string, unknown> => ({
  from: { session: refused.from.session, seq: refused.from.seq },
  head: refused.head,
})

/**
 * The refusal, as the tagged error it was. What travels is a status and a
 * head; the Cursor is the one this side asked with, because the far side was
 * answering that ask.
 */
export const refusalIn = (from: Cursor, value: unknown): ResumeTooFarBehind | undefined => {
  const row = objectIn(value)
  if (row === undefined) return undefined
  const head = row["head"]
  return typeof head === "number" ? new ResumeTooFarBehind({ from, head }) : undefined
}
