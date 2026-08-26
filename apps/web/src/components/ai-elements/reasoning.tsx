/**
 * Vendored from `ai-elements@latest add reasoning`, then retyped against Eva.
 *
 * Changed: the streaming state is removed — the page draws a committed fold,
 * so there is no duration to time and no panel that opens and closes by
 * itself, and `useControllableState`, the Shimmer and the auto-close go with
 * it. `id` is required on the content, because the panel's id has to come from
 * the Block's own key: a generated one makes the same Block draw differently
 * in two places, and `packages/conformance` holds one drawing against the
 * other. The palette is Eva's brand tokens.
 *
 * The panel draws its markdown through `MessageResponse`, which is upstream's
 * own arrangement: a thought and an answer are both the agent writing, so one
 * renderer draws both and a fenced block in a thought is not lost on the way
 * to a page that keeps one in an answer.
 */
import { BrainIcon, ChevronDownIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { cn } from "../../lib/utils.js"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible.js"
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
      "flex w-full items-center gap-2 text-muted text-xs uppercase tracking-[0.06em] transition-colors hover:text-ink",
      className,
    )}
    {...props}
  >
    <BrainIcon className="size-4" />
    {children}
    <ChevronDownIcon className="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
  </CollapsibleTrigger>
)

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string
  id: string
}

export const ReasoningContent = ({ className, children, ...props }: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn("mt-1 border-rule border-l-2 pl-3 text-muted text-sm italic", className)}
    {...props}
  >
    <MessageResponse>{children}</MessageResponse>
  </CollapsibleContent>
)
