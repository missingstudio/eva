/**
 * A page that is mostly words, held as data rather than as markup.
 *
 * Two surfaces render each of these documents: the HTML page a person reads,
 * and the markdown twin an agent fetches. Holding the words once is what keeps
 * the two from drifting — a twin written by hand beside a page is a twin that
 * is wrong by the second edit.
 */

export type Block =
  | { p: string }
  | { list: readonly string[] }
  | { code: string }
  | { link: { label: string; href: string } }

export type Section = {
  heading: string
  blocks: readonly Block[]
}

export type Prose = {
  /** The `h1`, and the page title before the template wraps it. */
  title: string
  /** The meta description. One sentence, and never the lede restated. */
  description: string
  /** The opening line, set larger than the body. */
  lede: string
  sections: readonly Section[]
}
