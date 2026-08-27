import { PERMISSION_OPTIONS } from "@missingstudio/eva-core"
import type { ActorKind } from "@missingstudio/eva-schema"
import { hunkText, type Block, type Turn } from "@missingstudio/eva-session-view"
import { Button } from "@missingstudio/ui/components/button"
import {
  CommitFile,
  CommitFileChanges,
  CommitFileIcon,
  CommitFileInfo,
  CommitFilePath,
  CommitFileStatus,
} from "./components/ai-elements/commit.js"
import { Image } from "./components/ai-elements/image.js"
import { Message, MessageContent, MessageResponse } from "./components/ai-elements/message.js"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./components/ai-elements/reasoning.js"
import { Tool, ToolContent, ToolHeader } from "./components/ai-elements/tool.js"

/**
 * What a Block's disclosure is called, on the panel and on the control that
 * opens it. It is the Block's own key, which is stable for the life of the
 * Block and unique across the page — and it is made here rather than left to
 * the component, because a generated id counts from where a component sits in
 * the tree: the same Block would draw one way alone and another way inside a
 * Turn, and the two drawings `packages/conformance` holds against each other
 * would stop being one drawing.
 */
const panelOf = (key: string): string => `panel-${key}`

/**
 * One Block, in page primitives, from the Turn that says who wrote it. What
 * the Run did is settled before this is called — the fold in `session-view`
 * settled it — so all this decides is what a reader sees.
 *
 * Every member is drawn, including the one this page has no primitive for.
 * A Surface may render less than another; it may never know more. So a Block
 * nothing here can draw says what it was and that it could not be drawn,
 * rather than leaving a hole a reader would read as nothing having happened.
 *
 * The author is a fact about the words and not about the Turn's colour, which
 * is why it is carried this far down. An agent writes markdown by convention.
 * Nobody else does, and reading a person's words as markdown rewrites them:
 * a pasted comment line becomes a bullet, the line breaks close up, and the
 * backticks around a template literal are eaten by the chip they draw. So the
 * agent's words go through the markdown renderer and everyone else's are
 * drawn as the characters they were written in.
 */
export const BlockView = ({
  block,
  author,
  answer,
}: {
  readonly block: Block
  readonly author: ActorKind
  /**
   * Where an answer to a permission request goes. A page that holds a Client
   * hands one over; a page drawn without one draws the four options and takes
   * none of them, because a control that looks live and reaches nothing is
   * worse than one that says it is not.
   */
  readonly answer?: (request: string, optionId: string) => void
}) => {
  switch (block.kind) {
    /**
     * Markdown when an agent said it: a Run writes tables and links, and a
     * page that drew the source would be showing a reader the pipe rather
     * than the answer. Verbatim from anyone else — a person pasted it and
     * `system` is Eva's own text handed to a model, and neither was written
     * to be rendered.
     */
    case "words":
      return author === "agent" ? (
        <MessageResponse>{block.text}</MessageResponse>
      ) : (
        <p className="whitespace-pre-wrap">{block.text}</p>
      )
    /**
     * What was thought on the way, behind a disclosure a reader can close. It
     * is open to start with, because the record stands whole on this page: a
     * reader folds it away, and never has to open it to find out it is there.
     */
    case "reasoning":
      return (
        <Reasoning defaultOpen>
          <ReasoningTrigger aria-controls={panelOf(block.key)}>thinking</ReasoningTrigger>
          <ReasoningContent id={panelOf(block.key)}>{block.text}</ReasoningContent>
        </Reasoning>
      )
    // A call that is open says where it is in its life, and nothing about how
    // it ended, because it has not.
    case "tool":
      return (
        <Tool>
          <ToolHeader
            aria-controls={panelOf(block.key)}
            name={block.name}
            tool={block.tool}
            status={block.status}
          />
          <ToolContent id={panelOf(block.key)}>call {block.call}</ToolContent>
        </Tool>
      )
    /**
     * The same call, answered. A Tool Status and a Disposition are both
     * drawn, because neither replaces the other: the Status says where the
     * call is in its life and the Disposition says how it ended, and a
     * status alone reads as a call that worked.
     */
    case "result":
      return (
        <Tool>
          <ToolHeader
            aria-controls={panelOf(block.key)}
            name={block.name}
            tool={block.tool}
            status={block.status}
            disposition={block.disposition}
          />
          <ToolContent id={panelOf(block.key)}>call {block.call}</ToolContent>
        </Tool>
      )
    // The path and the count of hunks, which is the whole of what the record
    // holds. Nothing here is a rendering the far side sent.
    case "diff":
      return (
        <CommitFile>
          <CommitFileInfo>
            <CommitFileStatus status="modified" />
            <CommitFileIcon />
            <CommitFilePath>{block.path}</CommitFilePath>
          </CommitFileInfo>
          <CommitFileChanges>{hunkText(block.hunks)}</CommitFileChanges>
        </CommitFile>
      )
    /**
     * Which mode the Session runs under, from the moment it changed. It is
     * drawn as a plain line and not as a badge on the Turn: a mode is a fact
     * with a position on the record, and a badge would say it was always so.
     */
    case "mode":
      return (
        <p className="rounded-md border border-graphite px-3 py-2 text-sm">
          mode <strong>{block.mode}</strong>
          {block.reason === undefined ? null : (
            <span className="text-muted-foreground"> · {block.reason}</span>
          )}
        </p>
      )
    /**
     * A question that stands, and the four options it may be answered with.
     * The options are `PERMISSION_OPTIONS` and not a field on the Block: Eva
     * offers all four every time, so a Block that carried them would carry
     * the same four words forever.
     *
     * The request id is drawn beside the question, because it is the id of the
     * tool call the question is about — so a reader ties the question to the
     * card the record drew for that call.
     */
    case "permission":
      return (
        <div
          aria-label="permission request"
          className="rounded-md border border-ember bg-card px-3 py-2"
          role="group"
        >
          <p className="text-muted-foreground text-xs uppercase tracking-[0.06em]">
            permission · call <code>{block.request}</code>
          </p>
          <p className="mt-1 whitespace-pre-wrap">{block.question}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PERMISSION_OPTIONS.map((option) => (
              <Button
                disabled={answer === undefined}
                key={option.optionId}
                onClick={() => answer?.(block.request, option.optionId)}
                size="sm"
                variant="outline"
              >
                {option.name}
              </Button>
            ))}
          </div>
        </div>
      )
    /**
     * An image travels as bytes, so the page draws the bytes. A `uri` on the
     * record names a file on the machine that made it, which a browser cannot
     * open — it is said beside the image as evidence, not used as a source.
     */
    case "image":
      return (
        <figure className="my-1">
          <Image
            base64={block.data}
            mediaType={block.mimeType}
            alt={`an image, ${block.mimeType}`}
          />
          <figcaption className="mt-1 text-muted-foreground text-xs">
            {block.uri === undefined ? block.mimeType : `${block.mimeType} · ${block.uri}`}
          </figcaption>
        </figure>
      )
    case "unknown":
      return (
        <p className="rounded-md border border-graphite border-dashed px-3 py-2 text-muted-foreground text-sm">
          this page cannot draw <code>{block.originalKind}</code>, and the record holds one
        </p>
      )
  }
}

/**
 * One Session, as the fold gives it: a Turn per Message, and the Blocks of
 * what was said in it. The Turns are handed over rather than read, so what
 * the page draws is provable without a socket.
 *
 * A Turn is a Message, so it is drawn as one. Who spoke is said in words as
 * well as in the styling a `Message` carries: a reader who cannot tell the
 * two apart by colour still has to be able to tell them apart.
 */
export const Turns = ({
  turns,
  answer,
}: {
  readonly turns: readonly Turn[]
  readonly answer?: (request: string, optionId: string) => void
}) =>
  turns.length === 0 ? (
    // A Session that folds to nothing and one whose fold has not arrived are
    // two different things, and a page that drew them alike would be lying
    // about one of them.
    <p className="text-muted-foreground">This Session has said nothing yet.</p>
  ) : (
    <ol className="mt-6 flex list-none flex-col gap-6 p-0">
      {turns.map((turn) => (
        <li key={turn.key}>
          <Message from={turn.author}>
            <p className="text-muted-foreground text-xs uppercase tracking-[0.06em]">
              {turn.author}
            </p>
            <MessageContent>
              {turn.blocks.map((block) => (
                <BlockView
                  key={block.key}
                  author={turn.author}
                  block={block}
                  {...(answer === undefined ? {} : { answer })}
                />
              ))}
            </MessageContent>
          </Message>
        </li>
      ))}
    </ol>
  )
