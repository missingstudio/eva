/**
 * Vendored from `ai-elements@latest add prompt-input`, then cut to a card that
 * takes one line.
 *
 * Most of upstream is attachments: the provider and its controller, the local
 * file list, the accept and size checks, drag-and-drop, paste-a-file, the
 * hidden file input, the blob-to-data-url conversion, the action menu that adds
 * them and the header that shows them. All of it is removed, because a surface
 * that takes a line and nothing else has no input for any of it, and a hidden
 * `<input type="file">` on such a page is a field nobody can use.
 *
 * Removed with them: the speech button, the tabs, the command palette, the
 * hover card, and the toolbar button nothing calls.
 *
 * The select family stays, on this package's own `select.tsx`. A picker in a
 * toolbar is a listbox the surface draws, not the platform's menu: a native
 * `<select>` opens the operating system's own list, in its own font and its
 * own colours, which is the one control on the page that cannot follow the
 * skin.
 *
 * What is left is the clothes and the submit plumbing. `onSubmit` is handed
 * the line and decides everything: whether it may go, what it means, and what
 * happens next. This component decides none of that — a caller's own rules and
 * this component's must never be two answers to whether a line may be sent.
 */
import type { ComponentProps, FormEvent, FormEventHandler, HTMLAttributes } from "react"

import { cn } from "../../lib/utils.js"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../input-group.js"
import { SelectContent, SelectTrigger } from "../select.js"

export type PromptInputMessage = {
  text: string
}

export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onSubmit"> & {
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void
}

/**
 * The card, and the one gesture it owns: a submit.
 *
 * It is a form because that is what makes Enter, the submit button and a
 * screen reader's own submit gesture one thing rather than three bindings. It
 * names no action and no method, and the default is prevented here, so nothing
 * it does reaches the browser's navigation — the line goes wherever `onSubmit`
 * sends it and nowhere else.
 */
export const PromptInput = ({ className, onSubmit, children, ...props }: PromptInputProps) => {
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()
    const said = new FormData(event.currentTarget).get("message")
    onSubmit({ text: typeof said === "string" ? said : "" }, event)
  }

  return (
    <form className={cn("w-full", className)} onSubmit={handleSubmit} {...props}>
      <InputGroup className="overflow-hidden">{children}</InputGroup>
    </form>
  )
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
)

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>

/**
 * The field. Enter sends and shift+Enter makes a line, which is the binding
 * every door of a transcript keeps.
 *
 * A send is refused here in exactly one case: the submit button is disabled.
 * That is not this component deciding — it is reading the decision the caller
 * already drew on the page, so the key and the button cannot disagree.
 *
 * A composition — an IME candidate window — swallows its own Enter, so the
 * key is ignored while one is open. Otherwise the first character of a
 * Japanese or Chinese word sends the word.
 */
export const PromptInputTextarea = ({
  className,
  onKeyDown,
  ...props
}: PromptInputTextareaProps) => (
  <InputGroupTextarea
    className={cn("field-sizing-content", className)}
    name="message"
    onKeyDown={(event) => {
      onKeyDown?.(event)
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
      event.preventDefault()

      const form = event.currentTarget.form
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]')
      if (submit?.disabled === true) return
      form?.requestSubmit()
    }}
    {...props}
  />
)

export type PromptInputFooterProps = Omit<ComponentProps<typeof InputGroupAddon>, "align">

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
)

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>

export const PromptInputTools = ({ className, ...props }: PromptInputToolsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props} />
)

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton>

/**
 * The send. Upstream swaps its glyph for what a Run is doing — submitted,
 * streaming, errored — and that prop is gone: what a Run is doing is the
 * record's to say, and a button that said it too would be a second source.
 * The caller supplies the glyph and the accessible name.
 */
export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  ...props
}: PromptInputSubmitProps) => (
  <InputGroupButton
    className={cn(className)}
    size={size}
    type="submit"
    variant={variant}
    {...props}
  />
)

/**
 * A picker in the toolbar. It is this package's `Select` — a listbox the
 * surface draws and the skin reaches — and only the two pieces a toolbar has
 * to dress differently are wrapped: the trigger and the list. A caller takes
 * `Select`, `SelectItem` and `SelectValue` as they are, because a wrapper
 * that passes everything through is a second name for the same thing.
 */
export type PromptInputSelectTriggerProps = ComponentProps<typeof SelectTrigger>

export const PromptInputSelectTrigger = ({
  className,
  ...props
}: PromptInputSelectTriggerProps) => (
  <SelectTrigger className={cn("border-none bg-transparent shadow-none", className)} {...props} />
)

export type PromptInputSelectContentProps = ComponentProps<typeof SelectContent>

/**
 * The list sizes to its rows and hangs off the pill, rather than sitting over
 * the page with the chosen row on top of the trigger.
 *
 * `Select` defaults suit a field in a form: the popup takes the trigger's
 * width, and it overlaps the trigger so the selected row lands on the value it
 * replaces. In a toolbar both are wrong. The pill is only as wide as the name
 * it shows, so an anchored width clips every row at the one place a person is
 * choosing by; and a toolbar sits under the content, so a list that overlaps
 * its trigger covers the thing the toolbar acts on.
 */
export const PromptInputSelectContent = ({
  align = "start",
  alignItemWithTrigger = false,
  className,
  ...props
}: PromptInputSelectContentProps) => (
  <SelectContent
    align={align}
    alignItemWithTrigger={alignItemWithTrigger}
    className={cn("w-auto max-w-[min(28rem,calc(100vw-2rem))]", className)}
    {...props}
  />
)
