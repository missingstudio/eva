import type { ClientState } from "@missingstudio/eva-client-runtime"
import type { SessionHeader } from "@missingstudio/eva-core"
import {
  spendOf,
  toUsd,
  type CostSummary,
  type Cursor,
  type Spend,
} from "@missingstudio/eva-schema"
import type { Turn } from "@missingstudio/eva-session-view"
import { Turns } from "./blocks.js"

/**
 * What the page has of one Session's record: the fold, or not yet. It is a
 * separate answer from the Header, because reading is progressive — a page
 * says which Session it is at once and says what was said in it when the
 * record has arrived.
 */
export type Folded =
  | { readonly kind: "folding" }
  | {
      readonly kind: "folded"
      readonly at: Cursor
      readonly turns: readonly Turn[]
      readonly cost: CostSummary
    }

/**
 * What the page holds of one Session: the committed fold, and the tail of the
 * Run that is open. Two sources, never confused — the same two the terminal's
 * `Frame` keeps apart — and the fold is the one that decides what a Run did.
 *
 * `said` is what the open Run has streamed so far. It grows by append within
 * one Run and it is empty again exactly when the fold has replaced it.
 */
export interface Reading {
  readonly folded: Folded
  readonly said: string
}

/**
 * What the page has of the pipe: where the runtime says it is, and whether it
 * has ever said it was gone. The state is the Client's own — a surface reads
 * it to say so and acts on nothing else about the pipe — and `dropped` is this
 * page's, because "the pipe is back" says nothing to a reader who was never
 * told it had gone.
 */
export interface Pipe {
  readonly at: ClientState
  readonly dropped: boolean
}

/**
 * What the page says about the pipe, and nothing while there is nothing to
 * say. A page frozen on a dead pipe reads as a Session that stopped, so the
 * words are about the pipe and never about the Run: the Session goes on
 * without this page, and the page catches up by Cursor when the pipe is back.
 *
 * `synchronizing` cannot arrive here. It is a Run refolding and this page
 * drives no Run — W1 takes no input of any kind. It is said anyway, because
 * the three are a closed set and an arm left off is a page that says nothing
 * on the day the write half lands.
 */
export const noticeOf = (pipe: Pipe): string | undefined => {
  switch (pipe.at) {
    case "ready":
      return pipe.dropped ? "The pipe is back." : undefined
    case "synchronizing":
      return "Catching up with the record…"
    case "disconnected":
      return "The pipe is down. The Session goes on, and this page catches up when it is back."
  }
}

/**
 * What the pipe is, said where a reader is already looking. It is drawn above
 * the transcript and not beside it: a reader who cannot tell a dead pipe from
 * a Session that stopped reads the wrong thing off a page that is otherwise
 * correct.
 */
export const Wire = ({ pipe }: { readonly pipe: Pipe }) => {
  const said = noticeOf(pipe)
  return said === undefined ? null : (
    <p className="pipe" role="status">
      {said}
    </p>
  )
}

/**
 * An estimate wears `~` and the word, because a figure Eva worked out is
 * never shown as one a Provider gave. The four are a closed set, so this
 * surface formats each of them and decides between none of them.
 *
 * `estimated` cannot arrive on this page: the fold happens on this side of
 * the wire and this side holds no Catalog, so nothing here prices anything.
 * It is drawn anyway, because a page that dropped the arm would be a page
 * that shows an estimate as a reported figure the day a Catalog arrives.
 */
const dollars = (ticks: number): string => {
  const usd = toUsd(ticks)
  return `$${usd >= 1 ? usd.toFixed(2) : usd.toFixed(4)}`
}

const money = (spend: Spend): string => {
  switch (spend.kind) {
    case "none":
      return "nothing spent yet"
    case "reported":
      return dollars(spend.ticks)
    case "estimated":
      return `~${dollars(spend.ticks)} est`
    case "unreported":
      return "cost unreported"
  }
}

const counts = (value: number | null): string => (value === null ? "—" : String(value))

/**
 * What the Session cost, from the Transcript's own cost fold. `ran` is
 * whether it has done anything: a Session that has not spent is not one
 * whose spend nobody reported, and one line for both would tell a reader the
 * Provider is silent when it has simply not been asked.
 */
export const Cost = ({ cost, ran }: { readonly cost: CostSummary; readonly ran: boolean }) => (
  <dl className="cost">
    <dt>spend</dt>
    <dd>{money(spendOf(cost, ran))}</dd>
    <dt>tokens in</dt>
    <dd>{counts(cost.inputTokens)}</dd>
    <dt>tokens out</dt>
    <dd>{counts(cost.outputTokens)}</dd>
  </dl>
)

/**
 * Which Session this is. It is drawn from the id the page was asked for, so
 * it is drawn at once, and the title joins it when the listing answers.
 *
 * It takes no `Folded`, which is how the page keeps its promise that reading
 * is progressive: a long Session cannot be waited on here, because the fold
 * is not reachable from this component at all.
 */
export const Named = ({
  session,
  header,
}: {
  readonly session: string
  readonly header: SessionHeader | undefined
}) => (
  <>
    <h1>{header?.title ?? "no title yet"}</h1>
    <p className="build">
      <code>{session}</code>
      {header?.updatedAt === undefined ? null : (
        <time dateTime={header.updatedAt}> · {header.updatedAt}</time>
      )}
    </p>
    <p className="build">
      <a href="/">every Session</a>
    </p>
  </>
)

/**
 * What the open Run has streamed so far, after the fold and before the cost.
 * It is the stream and never the record, so it is drawn apart from the Turns:
 * a reader can see which words are still being said, and the fold writes over
 * them when the Run closes.
 */
export const Live = ({ said }: { readonly said: string }) =>
  said === "" ? null : (
    <p className="live" aria-live="polite">
      {said}
    </p>
  )

/**
 * One Session, read: which Session it is, what the pipe is, then what was said
 * in it, then what the open Run is saying, then what it cost.
 *
 * Nothing here takes input. No prompt, no permission answer, no model
 * switch: those are W2's, and they wait for the permission gate.
 */
export const Session = ({
  session,
  header,
  reading,
  pipe,
}: {
  readonly session: string
  readonly header: SessionHeader | undefined
  readonly reading: Reading
  readonly pipe: Pipe
}) => (
  <main>
    <Named session={session} header={header} />
    <Wire pipe={pipe} />
    {reading.folded.kind === "folding" ? (
      <p className="note">Reading the transcript…</p>
    ) : (
      <>
        <Turns turns={reading.folded.turns} />
        <Live said={reading.said} />
        <Cost cost={reading.folded.cost} ran={reading.folded.at.seq > 0} />
      </>
    )}
  </main>
)
