/**
 * A glossary entry in this tree is a paragraph that opens with a bold term and
 * an em dash. The pattern is deliberately narrow — one to three capitalised
 * words, then the dash — so that a bold sentence used for emphasis mid-page is
 * not read as a definition. Nothing declares a page to be a glossary; a page
 * that writes definitions this way has them, and a page that does not, does
 * not.
 */
// A definition runs to a blank line, a heading, or the end of the file — never
// to the end of a line. `m` is needed so `^` finds a term at the start of a
// paragraph, and it is also what makes a bare `$` match every line ending, so
// end-of-file is spelled out as "a line end with nothing after it" instead.
const entry =
  /^\*\*([A-Z][A-Za-z]*(?:[ -][A-Za-z]+){0,2})\*\* [—–] ([\s\S]*?)(?=\n\n|\n#|$(?![\s\S]))/gm

/**
 * Markdown a definition may carry that a schema description may not. A
 * definition often bolds the sentence that carries its rule, and the emphasis
 * belongs to the rendered page rather than to the description an answer engine
 * lifts.
 *
 * `_` is left alone on purpose: it is a character in the identifiers these
 * definitions name, such as `end_turn`, and not emphasis.
 */
const plain = (text: string) =>
  text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()

export type Term = { term: string; definition: string }

export const glossaryTerms = (markdown: string): Term[] =>
  [...markdown.matchAll(entry)].map(([, term, definition]) => ({
    term: term!,
    definition: plain(definition!),
  }))
