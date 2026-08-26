/**
 * Vendored from `ai-elements@latest add commit`, then cut to the file row.
 *
 * Eva's record holds no commit: an `edit` says which file changed and how many
 * hunks changed in it, and nothing about a hash, an author or a time. So the
 * hash, author, timestamp, copy button and the collapsible around them are
 * removed, and what is left is the row this component draws a changed file
 * with. `CommitFileStatus` keeps its four letters; the page draws `M`, because
 * an edit is a modification and the record names no other kind. The palette is
 * Eva's brand tokens.
 */
import { FileIcon } from "lucide-react"
import type { ComponentProps, HTMLAttributes } from "react"

import { cn } from "../../lib/utils.js"

export type CommitFileProps = HTMLAttributes<HTMLDivElement>

export const CommitFile = ({ className, children, ...props }: CommitFileProps) => (
  <div
    className={cn(
      "flex items-center justify-between gap-2 rounded border border-rule px-2 py-1 text-sm",
      className,
    )}
    {...props}
  >
    {children}
  </div>
)

export type CommitFileInfoProps = HTMLAttributes<HTMLDivElement>

export const CommitFileInfo = ({ className, children, ...props }: CommitFileInfoProps) => (
  <div className={cn("flex min-w-0 items-center gap-2", className)} {...props}>
    {children}
  </div>
)

// Upstream colours the four letters green, red, yellow and blue. Eva's
// palette carries one accent and one warning, and a letter is the label
// already, so the colour is dropped rather than invented.
const fileStatusLabels = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
}

export type CommitFileStatusProps = HTMLAttributes<HTMLSpanElement> & {
  status: "added" | "modified" | "deleted" | "renamed"
}

export const CommitFileStatus = ({
  status,
  className,
  children,
  ...props
}: CommitFileStatusProps) => (
  <span className={cn("font-medium font-mono text-xs", className)} {...props}>
    {children ?? fileStatusLabels[status]}
  </span>
)

export type CommitFileIconProps = ComponentProps<typeof FileIcon>

export const CommitFileIcon = ({ className, ...props }: CommitFileIconProps) => (
  <FileIcon className={cn("size-3.5 shrink-0 text-muted", className)} {...props} />
)

export type CommitFilePathProps = HTMLAttributes<HTMLSpanElement>

export const CommitFilePath = ({ className, children, ...props }: CommitFilePathProps) => (
  <span className={cn("truncate font-mono text-xs", className)} {...props}>
    {children}
  </span>
)

export type CommitFileChangesProps = HTMLAttributes<HTMLDivElement>

export const CommitFileChanges = ({ className, children, ...props }: CommitFileChangesProps) => (
  <div
    className={cn("flex shrink-0 items-center gap-1 font-mono text-muted text-xs", className)}
    {...props}
  >
    {children}
  </div>
)
