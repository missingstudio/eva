import type { ClientState } from "@missingstudio/eva-client-runtime"
import type { SessionHeader } from "@missingstudio/eva-core"
import { spendOf, spendText, type CostSummary, type Cursor } from "@missingstudio/eva-schema"
import { askingOf, type Asking, type Turn } from "@missingstudio/eva-session-view"
import { Turns } from "./blocks.js"
import { Composer, type Composing } from "./composer.js"
import {
  Context,
  ContextCacheUsage,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
} from "@missingstudio/ui/components/ai-elements/context"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@missingstudio/ui/components/ai-elements/conversation"
import { MessageResponse } from "@missingstudio/ui/components/ai-elements/message"
import { ModelPicker, type Choosing } from "./models.js"
import { priced } from "./pricing.js"
import { Main, stampText, TopBar } from "./shell.js"
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
 *
 * `running` is whether a Run is open, whichever door opened it. The fold says
 * nothing about a Run that has not closed, so it is read off the payloads that
 * bracket one — which is also why it holds through a fold: a fold arrives at
 * the close of a Run, after the payload that closed it, and after a drop it
 * arrives with the Run still going.
 */
export interface Reading {
  readonly folded: Folded
  readonly said: string
  readonly running: boolean
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
const noticeOf = (pipe: Pipe): string | undefined => {
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
const Notice = ({ pipe }: { readonly pipe: Pipe }) => {
  const said = noticeOf(pipe)
  return said === undefined ? null : (
    <p className="notice" role="status">
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

/**
 * What the Session cost, from the Transcript's own cost fold. `ran` is
 * whether it has done anything: a Session that has not spent is not one
 * whose spend nobody reported, and one line for both would tell a reader the
 * Provider is silent when it has simply not been asked.
 *
 * The spend is worked out here and handed over already said, because pricing
 * is not a drawing's job and this side of the wire holds no Catalog anyway.
 */
const Cost = ({ cost, ran }: { readonly cost: CostSummary; readonly ran: boolean }) => (
  <Context cost={cost} className="mt-8">
    <ContextContentHeader>{spendText(spendOf(cost, ran))}</ContextContentHeader>
    <ContextInputUsage />
    <ContextOutputUsage />
    <ContextReasoningUsage />
    <ContextCacheUsage />
  </Context>
)

/**
 * Which mode the Session runs under, read off the record and nowhere else.
 *
 * The last mode Block on the record is the one in force, because a mode is a
 * fact with a position and every change writes another one. A record that
 * holds none leaves this undefined, and the pill beside the field is then not
 * drawn at all: the page never guesses a posture it cannot read, and a Session
 * whose mode has never been said is not a Session in the default mode as far
 * as this page can prove.
 */
const modeOf = (reading: Reading): string | undefined => {
  if (reading.folded.kind === "folding") return undefined
  return reading.folded.turns
    .flatMap((turn) => turn.blocks)
    .findLast((block) => block.kind === "mode")?.mode
}

// The same answer as a prop or as no prop at all, because an absent mode and
// a mode of `undefined` are the same fact and the composer takes one of them.
const modeSaid = (reading: Reading): { mode?: string } => {
  const mode = modeOf(reading)
  return mode === undefined ? {} : { mode }
}

/**
 * What the pipe is, in one word, and nothing while it is plainly up. It is the
 * meta row's half of the notice above the record: a reader who has read the
 * sentence once does not need it again beside the field, and a reader who has
 * not still gets told the record is not moving.
 */
const pipeWord = (pipe: Pipe): string | undefined => {
  switch (pipe.at) {
    case "ready":
      return undefined
    case "synchronizing":
      return "catching up…"
    case "disconnected":
      return "down"
  }
}

/**
 * Which Session this is, under the field where a reader is about to write.
 * The id is drawn from what the page was asked for, so it is there at once;
 * `updatedAt` joins it when the listing answers, and neither is invented.
 *
 * It takes no `Folded`, which is how the page keeps its promise that reading
 * is progressive: a long Session cannot be waited on here, because the fold
 * is not reachable from this component at all.
 */
const Named = ({
  session,
  header,
  pipe,
}: {
  readonly session: string
  readonly header: SessionHeader | undefined
  readonly pipe: Pipe
}) => {
  const said = pipeWord(pipe)

  return (
    <p className="meta-row">
      <code>{session}</code>
      {header?.updatedAt === undefined ? null : (
        <time dateTime={header.updatedAt}>{stampText(header.updatedAt)}</time>
      )}
      {said === undefined ? null : <span>{said}</span>}
    </p>
  )
}

/**
 * What the open Run has streamed so far, after the fold and before the cost.
 * It is the stream and never the record, so it is drawn apart from the Turns:
 * a reader can see which words are still being said, and the fold writes over
 * them when the Run closes.
 *
 * It is drawn as the agent's own prose, through the same renderer the
 * committed fold goes through, in `streaming` mode. A Run writes markdown
 * while it writes — a heading, a list, a half-finished fence — so a tail drawn
 * as plain characters shows a reader the source of the answer rather than the
 * answer, and then rewrites it as prose the moment the Run closes. Streaming
 * mode is what reads a half-written document without waiting for it to close,
 * so the words arrive already formed and the fold replaces them with the same
 * drawing rather than a different one.
 *
 * The caret is the stylesheet's, on the last line of what has arrived. It says
 * the words are still coming, carries no text, and is gone under reduced
 * motion — the live region says the same thing to a reader who is being read
 * the page rather than shown it.
 */
const Live = ({ said }: { readonly said: string }) =>
  said === "" ? null : (
    <div aria-live="polite" className="prose live">
      <MessageResponse mode="streaming">{said}</MessageResponse>
    </div>
  )

/**
 * One Session, read: which Session it is, what the pipe is, then what was said
 * in it, then the questions that stand, then what the open Run is saying, then
 * what it cost — and under all of it, what to say next.
 *
 * The page writes three things: a line — a Prompt, or the command it names —
 * an answer to a permission request that stands, and the model this Session is
 * kept at. A question that stands blocks a Run, and a reader watching it
 * blocked is the person the Run is waiting on.
 *
 * The composer is drawn outside the fold, because saying something needs no
 * record: a page still reading a long Session can already prompt it.
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
  composer,
  choosing,
}: {
  readonly session: string
  readonly header: SessionHeader | undefined
  readonly reading: Reading
  readonly pipe: Pipe
  readonly asking?: readonly Asking[]
  readonly answer?: (request: string, optionId: string) => void
  readonly composer?: Composing
  /**
   * The models this build can run and the one this Session is kept at. It is
   * the picker's, and it is the cost line's too: the Catalog is where a rate
   * comes from, so the rows that offer a model are the rows that price it.
   */
  readonly choosing?: Choosing
}) => (
  <Main>
    <TopBar
      title={titleLine(header?.title)}
      {...(reading.folded.kind === "folding"
        ? {}
        : {
            spend: spendText(
              spendOf(
                priced(reading.folded.cost, choosing?.rows ?? [], choosing?.chosen),
                reading.folded.at.seq > 0,
              ),
            ),
          })}
    />
    {/*
       The one scroll container on the page. It sticks to the bottom while the
       record grows and stops the moment a reader scrolls up, so the composer
       and the rail hold still while the record moves.
    */}
    <Conversation className="scroll">
      <ConversationContent className="col">
        <Notice pipe={pipe} />
        {reading.folded.kind === "folding" ? (
          <p aria-busy="true" className="text-muted-foreground" role="status">
            Reading the transcript…
          </p>
        ) : (
          <>
            <Turns
              turns={[...reading.folded.turns, ...askingOf(asking)]}
              {...(answer === undefined ? {} : { answer })}
            />
            <Live said={reading.said} />
            <Cost
              cost={priced(reading.folded.cost, choosing?.rows ?? [], choosing?.chosen)}
              ran={reading.folded.at.seq > 0}
            />
          </>
        )}
      </ConversationContent>
      <ConversationScrollButton className="to-newest" />
    </Conversation>
    <div className="dock">
      <div className="dock-col">
        <Composer
          model={
            <ModelPicker
              chosen={choosing?.chosen}
              rows={choosing?.rows ?? []}
              {...(choosing === undefined ? {} : { choose: choosing.choose })}
            />
          }
          pipe={pipe}
          running={reading.running}
          {...(composer === undefined ? {} : { composer })}
          {...modeSaid(reading)}
        />
        <Named header={header} pipe={pipe} session={session} />
      </div>
    </div>
  </Main>
)
