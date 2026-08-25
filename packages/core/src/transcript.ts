import {
  costFold,
  headerFold,
  transcriptFold,
  type CostSummary,
  type Cursor,
  type Event,
  type Header,
  type PriceLookup,
  type SessionID,
  type TranscriptMessage,
} from "@missingstudio/eva-schema"

// The Header of a named Session. The fold answers what the Trace says; the
// identity is the Session API's to add.
export interface SessionHeader extends Header {
  readonly id: SessionID
}

export interface Session {
  readonly id: SessionID
  readonly header: SessionHeader
}

/**
 * The record, folded from the Trace. Nothing writes a Message; a fold gives
 * it back. Reads are deep copies, so a consumer cannot edit the record.
 */
export interface Transcript {
  readonly session: SessionID
  /**
   * Where this fold ends. A surface that folds and then watches gives this to
   * `watch`, so nothing that commits between the two calls is missed and
   * nothing already folded arrives twice.
   *
   * A fold that holds no event is `seq: 0`. The sink numbers a session from 1,
   * so a watch from 0 replays all of it, which is what an empty record means.
   */
  readonly at: Cursor
  readonly messages: () => readonly TranscriptMessage[]
  readonly cost: () => CostSummary
}

const clone = <A>(value: A): A => structuredClone(value)

/**
 * `priceOf` is what turns the counters into an estimate. It is an argument
 * rather than a field on the record, because a rate is not a fact about the
 * Session: the same Trace folds to a different estimate when a vendor
 * reprices, and to none at all when nothing prices the model.
 */
export const foldTranscript = (
  session: SessionID,
  events: readonly Event[],
  priceOf?: PriceLookup,
): Transcript => {
  const own = events.filter((event) => event.session === session)
  const messages = transcriptFold(own)
  const cost = costFold(own, priceOf)
  // A reduce rather than a spread into Math.max: a long trace overflows the
  // stack, and a long trace is the case that matters. The events are not
  // assumed to be ordered, so the last one is not the highest.
  const seq = own.reduce((high, event) => (event.seq > high ? event.seq : high), 0)
  return {
    session,
    at: { session, seq },
    messages: () => clone(messages),
    cost: () => clone(cost),
  }
}

export const headerOf = (session: SessionID, events: readonly Event[]): SessionHeader => ({
  id: session,
  ...headerFold(events.filter((event) => event.session === session)),
})
