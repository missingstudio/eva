/**
 * Vendored from `ai-elements@latest add tool`, then retyped.
 *
 * Changed: the header reads a Status and a Disposition rather than the AI
 * SDK's ToolUIPart state, and both are drawn, because neither replaces the
 * other — a status alone reads as a call that worked. `ToolInput` and
 * `ToolOutput` are removed: a record may hold no arguments and no output, and
 * a section drawn from nothing would read as a call that passed none. The
 * panel's id is required, on the trigger and on the content, because it has to
 * come from the caller's own key — a generated one counts from where the
 * component sits in the tree, and the same call would then draw one way alone
 * and another way inside a turn. The palette is the bridge's semantic names,
 * so one markup follows whichever skin an app is wearing.
 */
import { ChevronDownIcon } from "lucide-react"
import type { ComponentProps } from "react"

import { cn } from "../../lib/utils.js"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../collapsible.js"

/**
 * Where a call is in its life, and how it ended. Both are declared here rather
 * than imported from a product's schema: this package is the design system,
 * and a surface that imports it must not thereby import somebody's domain. A
 * caller's own unions arrive structurally, and they are type-only — so a word
 * that drifts fails to compile at the call site.
 */
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"

export type ToolDisposition =
  | "ok"
  | "denied"
  | "failed"
  | "skipped"
  | "cancelled"
  | "unknown_tool"
  | "budget_denied"

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose w-full rounded-md border border-input", className)}
    {...props}
  />
)

/**
 * Where a call stands, as one chip. Upstream draws two badges with an icon in
 * each; the status and the disposition are one fact about one call, and two
 * badges read as two claims about it.
 *
 * The words carry the state and the colour only confirms it, so the chip still
 * reads in grayscale — and the colour is left to the surface: `data-state`
 * says which of the three it is, and the stylesheet that owns the palette
 * paints it. A component in this package names no state colour of its own.
 */
const stateOf = (status: ToolStatus, disposition?: ToolDisposition): string => {
  if (status === "failed" || (disposition !== undefined && disposition !== "ok")) return "failed"
  if (status === "in_progress") return "running"
  return disposition === "ok" ? "ok" : "waiting"
}

export type ToolStateProps = {
  status: ToolStatus
  disposition?: ToolDisposition
}

export const ToolState = ({ status, disposition }: ToolStateProps) => (
  <span
    className="shrink-0 rounded-full border px-2 py-0.5 font-mono text-xs"
    data-slot="tool-state"
    data-state={stateOf(status, disposition)}
  >
    {disposition === undefined ? status : `${status} · ${disposition}`}
  </span>
)

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  "aria-controls": string
  name: string
  tool: string
  status: ToolStatus
  disposition?: ToolDisposition
}

export const ToolHeader = ({
  className,
  name,
  tool,
  status,
  disposition,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn("flex w-full items-center gap-2 p-3 text-left", className)}
    {...props}
  >
    <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-data-closed:-rotate-90" />
    <span className="font-medium text-sm" data-slot="tool-name">
      {name}
    </span>
    <span className="min-w-0 flex-1 truncate">{tool}</span>
    <ToolState {...(disposition === undefined ? {} : { disposition })} status={status} />
  </CollapsibleTrigger>
)

export type ToolContentProps = ComponentProps<typeof CollapsibleContent> & { id: string }

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "space-y-2 border-border border-t px-3 py-2 text-muted-foreground text-xs",
      className,
    )}
    {...props}
  />
)
