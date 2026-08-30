import type {
  ActorKind,
  ContentBlock,
  Disposition,
  ErrorClass,
  Result,
  ToolKind,
  ToolStatus,
  TranscriptBlock,
  TranscriptMessage,
} from "@missingstudio/eva-schema"
import type { Transcript } from "@missingstudio/eva-core"

/**
 * One piece of what a Message says, in the one shape every renderer reads.
 * The set is closed, so a renderer switches over it, draws each member in
 * its own primitives, and decides nothing else — this fold has already
 * decided what the Run did.
 *
 * `key` is stable for the life of a Block, so a renderer that keys its rows
 * by it never redraws a turn it has already drawn.
 */
export type Block =
  // What was said out loud, by whoever the Turn says was speaking.
  | { readonly kind: "words"; readonly key: string; readonly text: string }
  // What was thought on the way to it. Always the agent's.
  | { readonly kind: "reasoning"; readonly key: string; readonly text: string }
  /**
   * A tool call that is still open: where it is in its life, and nothing
   * about how it ended, because it has not.
   */
  | {
      readonly kind: "tool"
      readonly key: string
      readonly call: string
      readonly name: string
      readonly tool: ToolKind
      readonly status: ToolStatus
    }
  /**
   * The same call, once a result has answered it: its Tool Status and its
   * Disposition. A call has both and neither replaces the other, so a
   * renderer that draws an outcome — denied, failed, over budget — draws it
   * from here.
   */
  | {
      readonly kind: "result"
      readonly key: string
      readonly call: string
      readonly name: string
      readonly tool: ToolKind
      readonly status: ToolStatus
      readonly disposition: Disposition
    }
  /**
   * A file the Run changed. The record holds a path and a count of hunks, so
   * that is what this holds; the hunk text arrives when the edit tools ship,
   * and this member does not change shape when it does.
   */
  | { readonly kind: "diff"; readonly key: string; readonly path: string; readonly hunks: number }
  /**
   * The permission mode the Session runs under, from the moment it changed.
   * A mode is a fact on the record, so a reader who scrolls back reads which
   * mode each Run was made under rather than inferring it from what a Run was
   * refused.
   */
  | { readonly kind: "mode"; readonly key: string; readonly mode: string; readonly reason?: string }
  /**
   * How the Run ended: what it claimed, the words it gave for it, and the
   * class of the failure when something classified one. It is the fold's, so
   * every door draws one ending and none of them invents a version of it.
   *
   * The sentence that says what a class means is `errorWords` and not a field
   * here. Eight classes are eight sentences, written once; a Block that
   * carried them would give a renderer a second place to read them from.
   *
   * An absent `errorClass` on a failed Claim is nobody classifying it, which
   * is not `other`.
   */
  | {
      readonly kind: "outcome"
      readonly key: string
      readonly result: Result
      readonly summary?: string
      readonly errorClass?: ErrorClass
    }
  /**
   * A permission request nobody has answered. It is the one Block that is not
   * on the record, and it cannot be: a request a person has answered is the
   * Disposition of the call it gated, and one nobody has answered is a thing
   * that is still happening.
   *
   * **One surface draws it today: the page.** The terminal shows the question
   * as a Note and says `ASKING` on its status line, because a `Frame` carries
   * the record and a standing request is not on the record. The roadmap puts
   * the terminal's permission Overlay at C1, and that is where the two start
   * drawing one question the same way. Until then this is a shape one of the
   * two ignores, which is a cost worth naming rather than a claim worth
   * repeating.
   *
   * `request` is the id an answer names, which is the id of the tool call the
   * question is about — so the card the record drew for that call is the card
   * this stands under. The four options are not here: they are
   * `PERMISSION_OPTIONS`, the same four every time, and a Block that carried
   * them would give a renderer two places to read the labels from.
   */
  | {
      readonly kind: "permission"
      readonly key: string
      readonly request: string
      readonly question: string
    }
  | {
      readonly kind: "image"
      readonly key: string
      readonly mimeType: string
      readonly data: string
      readonly uri?: string
    }
  /**
   * Something the record holds that no other member covers — the same
   * degradation rule the harness seam uses, pointed at renderers. A Surface
   * may render less than another; it may never know more. So nothing is
   * dropped here: `originalKind` is what it was, and `raw` is what it said,
   * and a renderer draws that it could not draw it.
   */
  | {
      readonly kind: "unknown"
      readonly key: string
      readonly originalKind: string
      readonly raw: unknown
    }

/**
 * One Message, folded: who spoke, and the Blocks of what they said. The
 * Blocks of one Message belong together on the screen, so the fold carries
 * that boundary rather than leaving every renderer to find it again.
 */
export interface Turn {
  readonly key: string
  readonly author: ActorKind
  readonly blocks: readonly Block[]
}

// Words, an image, or something this renderer set does not name. A content
// kind no member covers folds to `unknown` rather than falling out.
const contentOf = (key: string, content: ContentBlock, reasoning: boolean): Block => {
  switch (content.type) {
    case "text":
      return reasoning
        ? { kind: "reasoning", key, text: content.text }
        : { kind: "words", key, text: content.text }
    case "image":
      return {
        kind: "image",
        key,
        mimeType: content.mimeType,
        data: content.data,
        ...(content.uri === undefined ? {} : { uri: content.uri }),
      }
    default:
      return { kind: "unknown", key, originalKind: content.type, raw: content }
  }
}

const blockOf = (key: string, block: TranscriptBlock): Block => {
  switch (block.type) {
    case "content":
      return contentOf(key, block.content, false)
    case "thought":
      return contentOf(key, block.content, true)
    // A call and the result that answers it are one thing in the record, so
    // they are one Block here: the call while it is open, and the call with
    // its Disposition once one has landed.
    case "tool":
      return block.disposition === undefined
        ? {
            kind: "tool",
            key,
            call: block.id,
            name: block.name,
            tool: block.tool,
            status: block.status,
          }
        : {
            kind: "result",
            key,
            call: block.id,
            name: block.name,
            tool: block.tool,
            status: block.status,
            disposition: block.disposition,
          }
    case "edit":
      return { kind: "diff", key, path: block.path, hunks: block.hunks }
    case "mode":
      return {
        kind: "mode",
        key,
        mode: block.mode,
        ...(block.reason === undefined ? {} : { reason: block.reason }),
      }
    case "outcome":
      return {
        kind: "outcome",
        key,
        result: block.result,
        ...(block.summary === undefined ? {} : { summary: block.summary }),
        ...(block.errorClass === undefined ? {} : { errorClass: block.errorClass }),
      }
    // A payload kind the schema does not define, and a content type it does
    // not define, are the same fact to a renderer: the record holds one and
    // nothing here can draw it.
    case "unknown":
      return { kind: "unknown", key, originalKind: block.originalKind, raw: block.raw }
  }
}

/**
 * The one fold that decides what a Run did. The terminal calls it with
 * `Frame.session` and the page with `transcript.messages()`, and neither has
 * a fold of its own — two folds would disagree, and a person comparing two
 * screens would find the disagreement.
 */
/**
 * How many hunks changed, in words. One is not "1 hunks", and a reader
 * counting files does not want to read a number twice to find out.
 *
 * It is here because both surfaces say it. A renderer may not import another
 * renderer and neither may import an app, so the two spelled it character for
 * character and the terminal's copy carried a note calling the copy forced.
 * The fold both of them already read is where it stops being forced.
 */
export const hunkText = (hunks: number): string => `${hunks} ${hunks === 1 ? "hunk" : "hunks"}`

export const blockFold = (messages: readonly TranscriptMessage[]): readonly Turn[] =>
  messages.map((message, index) => ({
    key: `${index}`,
    author: message.author,
    blocks: message.blocks.map((block, at) => blockOf(`${index}.${at}`, block)),
  }))

// The same fold, from the record a surface is handed. A Transcript answers
// what it holds through `messages()`, so this is where that call is made
// once rather than in every surface that folds one.
export const blocksOf = (transcript: Transcript): readonly Turn[] =>
  blockFold(transcript.messages())

/**
 * A request nobody has answered: what was asked, the id an answer names, and
 * which of the two kinds of question it is. The id is the tool call's, so the
 * record the surface already holds names the call the question is about.
 *
 * The kind is carried because a line typed at a question is read by it: a
 * permission request offers four options a person may type and every other
 * request takes the line whole. `answerFor` is the one rule, and it needs
 * this to apply it.
 */
export interface Asking {
  readonly kind: "permission" | "question"
  readonly request: string
  readonly question: string
}

/**
 * The questions that stand, as Turns. It is a second source and never the
 * record — a request nobody has answered has no position on the Trace — so it
 * folds separately and a surface draws it after the record, the way it draws
 * the tail of an open Run after the record.
 *
 * It answers Turns rather than Blocks so that a surface has one thing to draw
 * and one switch to write. The author is the agent, because the question is
 * the Run asking.
 */
export const askingOf = (asking: readonly Asking[]): readonly Turn[] =>
  asking.length === 0
    ? []
    : [
        {
          key: "asking",
          author: "agent",
          blocks: asking.map((one, at) => ({
            kind: "permission" as const,
            key: `asking.${at}`,
            request: one.request,
            question: one.question,
          })),
        },
      ]
