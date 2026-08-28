/**
 * Vendored from `ai-elements@latest add conversation`, then cut to the scroll
 * region and its button.
 *
 * `ConversationEmptyState` is removed. It writes its own words — "No messages
 * yet" — and a surface that draws a record has its own sentence for a record
 * that is empty, in its own voice. A component that supplies the words would
 * be a second voice on the page.
 *
 * What is left is the whole reason to adopt this rather than an overflow div:
 * the region sticks to the bottom while the record grows, and it stops sticking
 * the moment a reader scrolls up, which a hand-rolled container gets wrong at
 * exactly the edges a long transcript spends its time on.
 */
import { ArrowDownIcon } from "lucide-react"
import type { ComponentProps } from "react"
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom"

import { cn } from "../../lib/utils.js"
import { Button } from "../button.js"

export type ConversationProps = ComponentProps<typeof StickToBottom>

/**
 * How the region travels when the record grows. Smoothly, unless the reader
 * asked for less motion — a page that slides under someone who is sensitive to
 * it is worse than one that jumps, and this region moves on its own every time
 * a Run says another word.
 *
 * Read at render, and optional-chained: a DOM with no `matchMedia` gets the
 * default, which is the same answer a reader with no preference gets.
 */
const travel = (): "smooth" | "instant" =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    ? "instant"
    : "smooth"

export const Conversation = ({ className, ...props }: ConversationProps) => {
  const how = travel()

  return (
    <StickToBottom
      className={cn("relative flex-1 overflow-y-auto", className)}
      initial={how}
      resize={how}
      role="log"
      {...props}
    />
  )
}

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

export const ConversationContent = ({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content className={cn("flex flex-col", className)} {...props} />
)

export type ConversationScrollButtonProps = ComponentProps<typeof Button>

/**
 * The way back down, and nothing while a reader is already there. It is drawn
 * only when it does something, which is the rule every other control on a
 * transcript keeps.
 */
export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  return isAtBottom ? null : (
    <Button
      aria-label="the newest of the record"
      className={cn(
        "-translate-x-1/2 absolute bottom-4 left-1/2 rounded-full shadow-none",
        className,
      )}
      onClick={() => void scrollToBottom()}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  )
}
