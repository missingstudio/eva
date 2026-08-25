import type {
  ActorKind,
  ContentBlock,
  Disposition,
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
  }
}

/**
 * The one fold that decides what a Run did. The terminal calls it with
 * `Frame.session` and the page with `transcript.messages()`, and neither has
 * a fold of its own — two folds would disagree, and a person comparing two
 * screens would find the disagreement.
 */
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
