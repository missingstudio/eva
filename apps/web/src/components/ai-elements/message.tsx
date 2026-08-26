/**
 * Vendored from `ai-elements@latest add message`, then retyped against Eva.
 *
 * Changed: `from` is Eva's ActorKind rather than the AI SDK's UIMessage role;
 * the branch, action and toolbar families are removed, because the page takes
 * no input; the Streamdown plugin set is removed, so the markdown is GFM and
 * nothing that loads a second renderer; the palette is Eva's brand tokens.
 *
 * `MessageResponse` is given four settings upstream leaves at their default.
 * `mode="static"` because these words are a committed fold and never a stream
 * — the tail is drawn apart from the Turns and is plain text. `controls`
 * off, because a copy button on a table is input to a page that takes none.
 * The link modal off: a link already leaves with `rel="noopener"` in a new
 * tab, and a modal is a second thing to answer on a page that asks nothing.
 * And `components`, which is where the code that follows is handed over.
 */
import type { ActorKind } from "@missingstudio/eva-schema"
import type { ComponentProps, HTMLAttributes } from "react"
import { memo } from "react"
import { Streamdown } from "streamdown"

import { cn } from "../../lib/utils.js"

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: ActorKind
}

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "human" ? "is-user" : "is-assistant",
      className,
    )}
    {...props}
  />
)

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden text-ink text-sm",
      "group-[.is-user]:rounded-lg group-[.is-user]:bg-card group-[.is-user]:px-4 group-[.is-user]:py-3",
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

// The fence's info string, which is where the language is written.
const LANGUAGE = /language-([^\s]+)/

// `node` is the hast element Streamdown hands every component. It is not an
// attribute, so it is taken off here rather than reaching an element.
type MarkdownCodeProps = ComponentProps<"code"> & { readonly node?: unknown }

/**
 * Code, fenced and inline. A fenced block is a `pre` and a `code` and nothing
 * else: the whitespace is the element's own, every line is there at once, and
 * the language is said above the block because the record holds it.
 *
 * It is drawn here because Streamdown's own draws it through a highlighter
 * loaded on demand, and this page carries no highlighter plugin. What arrives
 * then is a container under `content-visibility: auto` with an empty body: a
 * reader gets a blank box where the answer was, and the answer is not in the
 * page's text at all. Losing a Run's answer is the one thing this page may
 * not do, so the renderer that draws it holds nothing back and waits for
 * nothing. Colour on the tokens is what a second renderer buys, and it is
 * what a reader can do without.
 *
 * The inline arm is upstream's, down to the `data-streamdown` name the
 * stylesheet paints its ground by.
 */
const MarkdownCode = ({ children, className, node: _node, ...props }: MarkdownCodeProps) => {
  const language = LANGUAGE.exec(className ?? "")?.[1]
  return "data-block" in props ? (
    <div className="my-4 overflow-hidden rounded-lg border border-rule bg-card">
      {language === undefined ? null : (
        <p className="border-rule border-b px-3 py-1 font-mono text-muted text-xs">{language}</p>
      )}
      <pre className="overflow-x-auto px-3 py-2 text-code">
        {/* A fence closes with a newline, and drawn in a `pre` it is a blank last line. */}
        <code className={className}>
          {typeof children === "string" ? children.trimEnd() : children}
        </code>
      </pre>
    </div>
  ) : (
    <code
      className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)}
      data-streamdown="inline-code"
      {...props}
    >
      {children}
    </code>
  )
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      components={{ code: MarkdownCode }}
      controls={false}
      linkSafety={{ enabled: false }}
      mode="static"
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
)

MessageResponse.displayName = "MessageResponse"
