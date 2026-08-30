import type { ErrorClass, Event } from "@missingstudio/eva-schema"
import type { Transcript } from "@missingstudio/eva-core"

/**
 * What a Session wants from a person. It is derived and never held: a Run is
 * waiting on a person, or blocked with a reason, or moving, or finished, and
 * every one of those is on the Trace.
 *
 * It is a fold and not a field on a listing, because the fleet view asks the
 * same question of twenty Sessions that a rail asks of one. Written here, the
 * fleet view is a renderer over a fold that already exists; written in a rail,
 * the fleet brings a second fold and the two disagree.
 */
export type Attention =
  /**
   * A Run stopped and asked, and nobody has answered. This is the one state
   * where work is not happening and a person is the reason it can start
   * again, so it sorts over everything else.
   */
  | { readonly kind: "asking"; readonly question: string }
  /**
   * A Run ended in a failure. It carries what the record carries and nothing
   * more — the words the Run gave, and the class when something classified
   * one — so a renderer words it with `errorWords` and no surface writes a
   * second sentence for one failure.
   */
  | { readonly kind: "blocked"; readonly summary?: string; readonly errorClass?: ErrorClass }
  /**
   * A Run is open. Whether its worker is still there is not on the Trace —
   * waiting and stranded are different, and the record cannot tell them apart
   * — so that answer belongs to whoever holds the runtime and never here.
   */
  | { readonly kind: "moving" }
  // A Run ended and it claimed it was done. It wants nothing.
  | { readonly kind: "done" }
  // The record holds no Run at all. It has nothing to read and nothing to do.
  | { readonly kind: "idle" }

/**
 * What a Session wants, from its own Trace.
 *
 * A question that stands outranks an open Run: a Run that is asking is not
 * working, whatever else the record says about it. Only a `needs_human` with
 * no `resolved` naming it is a question that stands — a permission request
 * nobody has answered is not on the Trace at all, and `askingOf` is where a
 * surface takes that second source.
 */
export const attentionFold = (events: readonly Event[]): Attention => {
  const answered = new Set<string>()
  for (const { payload } of events) {
    if (payload.kind === "resolved") answered.add(payload.question)
  }

  let standing: string | undefined
  let open = false
  let ran = false
  let claim: Extract<Event["payload"], { kind: "finished" }>["claim"] | undefined

  for (const event of events) {
    const payload = event.payload
    if (payload.kind === "needs_human" && !answered.has(event.id)) {
      // The oldest question that stands, because that is the one that has
      // waited longest for the person this is asking to come back.
      standing ??= payload.question
    }
    if (payload.kind === "started") {
      open = true
      ran = true
    }
    if (payload.kind === "finished") {
      open = false
      ran = true
      claim = payload.claim
    }
  }

  if (standing !== undefined) return { kind: "asking", question: standing }
  if (open) return { kind: "moving" }
  if (claim?.result === "failed")
    return {
      kind: "blocked",
      ...(claim.summary === undefined ? {} : { summary: claim.summary }),
      ...(claim.errorClass === undefined ? {} : { errorClass: claim.errorClass }),
    }
  return ran ? { kind: "done" } : { kind: "idle" }
}

// The same fold, from the record a surface is handed. It sits beside
// `blocksOf` because it is the same kind of thing: one call, made once,
// rather than in every surface that folds a Trace.
export const attentionOf = (transcript: Transcript): Attention => attentionFold(transcript.events())

// Whether a Session is one a person has to come to. Both of these stop until
// somebody acts; the other three do not.
export const needsAPerson = (attention: Attention | undefined): boolean =>
  attention !== undefined && (attention.kind === "asking" || attention.kind === "blocked")

/**
 * The ladder a listing orders by: what needs a person, then what is working,
 * then what wants nothing. The numbers are read by `byAttention` and by
 * nothing else.
 *
 * A Session nothing has read is `undefined`, and it sits under everything
 * known to want a person and over everything known to want nothing: an unread
 * Session may want something, and a guess never outranks a fact.
 */
export const attentionRank = (attention: Attention | undefined): number => {
  if (attention === undefined) return 3
  switch (attention.kind) {
    case "asking":
      return 0
    case "blocked":
      return 1
    case "moving":
      return 2
    case "done":
      return 4
    case "idle":
      return 5
  }
}

/**
 * Rows ordered by what they want from a person, with the caller's own rule
 * for the ties. Recency is the listing's rule and never this one's, so it is
 * handed in — and a fleet view that orders by something else hands in that.
 */
export const byAttention =
  <A>(of: (one: A) => Attention | undefined, then: (one: A, other: A) => number) =>
  (one: A, other: A): number => {
    const order = attentionRank(of(one)) - attentionRank(of(other))
    return order === 0 ? then(one, other) : order
  }
