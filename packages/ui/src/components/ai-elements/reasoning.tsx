/**
 * Vendored from `ai-elements@latest add reasoning`, then retyped.
 *
 * Changed: the streaming state is removed — the page draws a committed fold,
 * so there is no duration to time and no panel that opens and closes by
 * itself, and `useControllableState`, the Shimmer and the auto-close go with
 * it. `id` is required on the content, because the panel's id has to come from
 * the Block's own key: a generated one makes the same Block draw differently
 * in two places, and `packages/conformance` holds one drawing against the
 * other. The palette is the bridge's semantic names, so one markup follows
 * whichever skin an app is wearing.
 *
 * The trigger is the same row a tool call's is: the arrow that turns comes
 * first, then the words. Upstream leads with a brain glyph and ends with the
 * arrow, which puts two icons on a row that needs one and makes a thought and
 * a call read as two unrelated kinds of disclosure. They are one kind.
 *
 * The panel draws its markdown through `MessageResponse`, which is upstream's
 * own arrangement: a thought and an answer are both the agent writing, so one
 * renderer draws both and a fenced block in a thought is not lost on the way
 * to a page that keeps one in an answer.
 */
import { ChevronDownIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { cn } from "../../lib/utils.js"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../collapsible.js"
import { MessageResponse } from "./message.js"

export type ReasoningProps = ComponentProps<typeof Collapsible>

export const Reasoning = ({ className, ...props }: ReasoningProps) => (
  <Collapsible className={cn("group not-prose", className)} {...props} />
)

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  "aria-controls": string
}

export const ReasoningTrigger = ({ className, children, ...props }: ReasoningTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center gap-2 text-left text-muted-foreground text-sm transition-colors hover:text-foreground",
      className,
    )}
    {...props}
  >
    <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-data-closed:-rotate-90" />
    {children}
  </CollapsibleTrigger>
)

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string
  id: string
}

export const ReasoningContent = ({ className, children, ...props }: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn("border-border border-t px-3 py-2 text-muted-foreground text-sm", className)}
    {...props}
  >
    <MessageResponse>{children}</MessageResponse>
  </CollapsibleContent>
)
