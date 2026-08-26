/**
 * Vendored from `ai-elements@latest add image`, then retyped against Eva.
 *
 * Changed: the props are the two fields Eva's image Block holds rather than
 * the AI SDK's Experimental_GeneratedImage, so the page carries no second
 * data model. What it draws is the same: the bytes, as a data URL.
 */
import { cn } from "../../lib/utils.js"

export type ImageProps = {
  base64: string
  mediaType: string
  className?: string
  alt?: string
}

export const Image = ({ base64, mediaType, ...props }: ImageProps) => (
  <img
    {...props}
    alt={props.alt}
    className={cn("h-auto max-w-full overflow-hidden rounded-md", props.className)}
    src={`data:${mediaType};base64,${base64}`}
  />
)
