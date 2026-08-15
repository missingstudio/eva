import {
  costFold,
  headerFold,
  transcriptFold,
  type CostSummary,
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
  return {
    session,
    messages: () => clone(messages),
    cost: () => clone(cost),
  }
}

export const headerOf = (session: SessionID, events: readonly Event[]): SessionHeader => ({
  id: session,
  ...headerFold(events.filter((event) => event.session === session)),
})
