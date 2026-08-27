import type { ClientState } from "@missingstudio/eva-client-runtime"
import type { SessionHeader } from "@missingstudio/eva-core"
import {
  spendOf,
  toUsd,
  type CostSummary,
  type Cursor,
  type Spend,
} from "@missingstudio/eva-schema"
import { askingOf, type Asking, type Turn } from "@missingstudio/eva-session-view"
import { Turns } from "./blocks.js"
import {
  Context,
  ContextCacheUsage,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
} from "./components/ai-elements/context.js"
import { titleLine } from "./title.js"

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
 * `synchronizing` arrives here whenever the pipe comes back: this page follows
 * a Session through the Client, and the Client refolds after a drop. The arm
 * used to be unreachable, because the page held a refold of its own that said
 * nothing about the pipe.
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
export const Notice = ({ pipe }: { readonly pipe: Pipe }) => {
  const said = noticeOf(pipe)
  return said === undefined ? null : (
    <p className="mt-3 rounded-md border border-warning bg-card px-3 py-2 text-sm" role="status">
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

/**
 * What the Session cost, from the Transcript's own cost fold. `ran` is
 * whether it has done anything: a Session that has not spent is not one
 * whose spend nobody reported, and one line for both would tell a reader the
 * Provider is silent when it has simply not been asked.
 *
 * The spend is worked out here and handed over already said, because pricing
 * is not a drawing's job and this side of the wire holds no Catalog anyway.
 */
export const Cost = ({ cost, ran }: { readonly cost: CostSummary; readonly ran: boolean }) => (
  <Context cost={cost} className="mt-8">
    <ContextContentHeader>{money(spendOf(cost, ran))}</ContextContentHeader>
    <ContextInputUsage />
    <ContextOutputUsage />
    <ContextReasoningUsage />
    <ContextCacheUsage />
  </Context>
)

/**
 * Which Session this is. It is drawn from the id the page was asked for, so
 * it is drawn at once, and the title joins it when the listing answers.
 *
 * It takes no `Folded`, which is how the page keeps its promise that reading
 * is progressive: a long Session cannot be waited on here, because the fold
 * is not reachable from this component at all.
 *
 * The title is a Run's intent until an `info` gives a better one, and an
 * intent is a whole prompt. The record is right to hold all of it and a
 * heading is the wrong place to draw all of it, so the heading is one line
 * and the record's own text is on the element behind it.
 */
export const Named = ({
  session,
  header,
}: {
  readonly session: string
  readonly header: SessionHeader | undefined
}) => (
  <>
    <h1 className="d-3" title={header?.title}>
      {titleLine(header?.title)}
    </h1>
    <p className="text-muted-foreground text-sm">
      <code>{session}</code>
      {header?.updatedAt === undefined ? null : (
        <time dateTime={header.updatedAt}> · {header.updatedAt}</time>
      )}
    </p>
    <p className="text-muted-foreground text-sm">
      <a href="/">every Session</a>
    </p>
  </>
)

/**
 * What the open Run has streamed so far, after the fold and before the cost.
 * It is the stream and never the record, so it is drawn apart from the Turns:
 * a reader can see which words are still being said, and the fold writes over
 * them when the Run closes.
 *
 * It is drawn on the panel, which is the one surface that stays dark in both
 * schemes because the program it stands for is. Nothing else on this page is
 * the program talking while it talks.
 */
export const Live = ({ said }: { readonly said: string }) =>
  said === "" ? null : (
    <p
      className="panel-terminal my-2 whitespace-pre-wrap rounded-md px-3 py-2 text-sm"
      aria-live="polite"
    >
      {said}
    </p>
  )

/**
 * One Session, read: which Session it is, what the pipe is, then what was said
 * in it, then the questions that stand, then what the open Run is saying, then
 * what it cost.
 *
 * The one thing this page writes is an answer to a permission request. A
 * prompt and a model switch are W2's; a question that stands blocks a Run, and
 * a reader watching it blocked is the person the Run is waiting on.
 *
 * The questions are drawn after the record and never inside it. They are the
 * second source — the same separation the tail of an open Run has — and they
 * are Blocks all the same, so the terminal and this page draw one question
 * from one shape.
 */
export const Session = ({
  session,
  header,
  reading,
  pipe,
  asking = [],
  answer,
}: {
  readonly session: string
  readonly header: SessionHeader | undefined
  readonly reading: Reading
  readonly pipe: Pipe
  readonly asking?: readonly Asking[]
  readonly answer?: (request: string, optionId: string) => void
}) => (
  <main className="mx-auto max-w-measure px-6 py-16">
    <Named session={session} header={header} />
    <Notice pipe={pipe} />
    {reading.folded.kind === "folding" ? (
      <p aria-busy="true" className="mt-6 text-muted-foreground" role="status">
        Reading the transcript…
      </p>
    ) : (
      <>
        <Turns
          turns={[...reading.folded.turns, ...askingOf(asking)]}
          {...(answer === undefined ? {} : { answer })}
        />
        <Live said={reading.said} />
        <Cost cost={reading.folded.cost} ran={reading.folded.at.seq > 0} />
      </>
    )}
  </main>
)
