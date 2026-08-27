/**
 * Vendored from `ai-elements@latest add tool`, then retyped against Eva.
 *
 * Changed: the header reads Eva's Tool Status and Disposition rather than the
 * AI SDK's ToolUIPart state, so the two facts a call carries are two badges
 * and neither stands in for the other. `ToolInput` and `ToolOutput` are
 * removed: a Block holds no arguments and no output at W1, and a section
 * drawn from nothing would read as a call that passed none. The panel's id is
 * required, on the trigger and on the content, because it has to come from the
 * Block's own key — Radix generates one from where the component sits in the
 * tree, and the same Block would then draw one way alone and another way in a
 * Turn. The palette is Eva's brand tokens.
 */
import type { Disposition, ToolStatus } from "@missingstudio/eva-schema"
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react"
import type { ComponentProps, ReactNode } from "react"

import { cn } from "@missingstudio/ui/lib/utils"
import { Badge } from "@missingstudio/ui/components/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@missingstudio/ui/components/collapsible"

export type ToolProps = ComponentProps<typeof Collapsible>

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose w-full rounded-md border border-input", className)}
    {...props}
  />
)

// The colour confirms the state; the glyph and the word carry it, so the row
// still reads in grayscale.
const statusIcons: Record<ToolStatus, ReactNode> = {
  pending: <CircleIcon className="size-4" />,
  in_progress: <ClockIcon className="status-running size-4 animate-pulse" />,
  completed: <CheckCircleIcon className="status-ok size-4" />,
  failed: <XCircleIcon className="status-fail size-4" />,
}

// `ok` is the one Disposition that says nothing went wrong. The other six are
// each a thing a reader may not skim past, so they are marked.
const dispositionIcons: Record<Disposition, ReactNode> = {
  ok: <CheckCircleIcon className="status-ok size-4" />,
  denied: <XCircleIcon className="status-fail size-4" />,
  failed: <XCircleIcon className="status-fail size-4" />,
  skipped: <CircleIcon className="size-4" />,
  cancelled: <CircleIcon className="size-4" />,
  unknown_tool: <XCircleIcon className="status-fail size-4" />,
  budget_denied: <XCircleIcon className="status-fail size-4" />,
}

export const getStatusBadge = (status: ToolStatus) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {status}
  </Badge>
)

export const getDispositionBadge = (disposition: Disposition) => (
  <Badge
    className="gap-1.5 rounded-full text-xs"
    variant={disposition === "ok" ? "outline" : "warning"}
  >
    {dispositionIcons[disposition]}
    {disposition}
  </Badge>
)

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  "aria-controls": string
  name: string
  tool: string
  status: ToolStatus
  disposition?: Disposition
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
    className={cn("flex w-full items-center justify-between gap-4 p-3", className)}
    {...props}
  >
    <div className="flex flex-wrap items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">{name}</span>
      <Badge variant="outline">{tool}</Badge>
      {getStatusBadge(status)}
      {disposition === undefined ? null : getDispositionBadge(disposition)}
    </div>
    <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-open:rotate-180" />
  </CollapsibleTrigger>
)

export type ToolContentProps = ComponentProps<typeof CollapsibleContent> & { id: string }

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "space-y-2 border-graphite border-t px-3 py-2 text-muted-foreground text-xs",
      className,
    )}
    {...props}
  />
)
