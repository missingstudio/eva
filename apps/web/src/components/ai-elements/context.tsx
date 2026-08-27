/**
 * Vendored from `ai-elements@latest add context`, then retyped against Eva.
 *
 * Changed, and the changes are the whole of what this component is for here.
 *
 * `tokenlens` is gone. Upstream prices the usage it is given; this side of the
 * wire holds no Catalog, so what a reader sees is the figure a Provider
 * reported and the page prices nothing. The spend arrives already formatted.
 *
 * The used-of-maximum ring, the percentage and the Progress bar are gone with
 * it. They need a context window, and Eva's record holds none — a ring drawn
 * against a maximum nobody reported would be a number this page invented.
 *
 * The HoverCard is gone. A read-only transcript has nowhere else for the
 * record to live, so the cost stands on the page rather than behind a hover a
 * touch reader cannot reach.
 *
 * A counter nobody reported is drawn as `—` rather than left out: silence is
 * not zero, and a row that vanished would read as one.
 */
import type { CostSummary } from "@missingstudio/eva-schema"
import type { ComponentProps, ReactNode } from "react"
import { createContext, useContext, useMemo } from "react"

import { cn } from "@missingstudio/ui/lib/utils"

interface ContextSchema {
  cost: CostSummary
}

const ContextContext = createContext<ContextSchema | null>(null)

const useContextValue = () => {
  const context = useContext(ContextContext)

  if (!context) {
    throw new Error("Context components must be used within Context")
  }

  return context
}

export type ContextProps = ComponentProps<"dl"> & ContextSchema

export const Context = ({ cost, className, ...props }: ContextProps) => {
  const contextValue = useMemo(() => ({ cost }), [cost])

  return (
    <ContextContext.Provider value={contextValue}>
      <dl
        className={cn(
          "grid grid-cols-[auto_auto] justify-start gap-x-3 border-graphite border-t pt-3 text-xs",
          className,
        )}
        {...props}
      />
    </ContextContext.Provider>
  )
}

const Usage = ({ label, tokens }: { label: string; tokens: number | null }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="tnum font-mono">
      {tokens === null ? "—" : new Intl.NumberFormat("en-US").format(tokens)}
    </dd>
  </>
)

export type ContextContentHeaderProps = { children: ReactNode }

export const ContextContentHeader = ({ children }: ContextContentHeaderProps) => (
  <>
    <dt className="text-muted-foreground">spend</dt>
    <dd className="tnum font-mono">{children}</dd>
  </>
)

export const ContextInputUsage = () => {
  const { cost } = useContextValue()
  return <Usage label="tokens in" tokens={cost.inputTokens} />
}

export const ContextOutputUsage = () => {
  const { cost } = useContextValue()
  return <Usage label="tokens out" tokens={cost.outputTokens} />
}

// The two below are drawn only when a Provider reported them. They are not
// counters every Provider keeps, and an unbroken column of `—` says less than
// the two above it do.
export const ContextReasoningUsage = () => {
  const { cost } = useContextValue()
  return cost.reasoningTokens === null ? null : (
    <Usage label="reasoning tokens" tokens={cost.reasoningTokens} />
  )
}

export const ContextCacheUsage = () => {
  const { cost } = useContextValue()
  return cost.cacheReadTokens === null ? null : (
    <Usage label="cache tokens read" tokens={cost.cacheReadTokens} />
  )
}
