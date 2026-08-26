/**
 * Vendored from `ai-elements@latest add message`, then retyped against Eva.
 *
 * Changed: `from` is Eva's ActorKind rather than the AI SDK's UIMessage role;
 * the branch, action and toolbar families are removed, because the page takes
 * no input; the Streamdown plugin set is removed, so the markdown is GFM and
 * nothing that loads a second renderer; the palette is Eva's brand tokens.
 *
 * `MessageResponse` is given three settings upstream leaves at their default.
 * `mode="static"` because these words are a committed fold and never a stream
 * — the tail is drawn apart from the Turns and is plain text. `controls`
 * off, because a copy button on a table is input to a page that takes none.
 * And the link modal off: a link already leaves with `rel="noopener"` in a
 * new tab, and a modal is a second thing to answer on a page that asks
 * nothing.
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

export type MessageResponseProps = ComponentProps<typeof Streamdown>

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      controls={false}
      linkSafety={{ enabled: false }}
      mode="static"
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
)

MessageResponse.displayName = "MessageResponse"
