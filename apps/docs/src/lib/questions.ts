/**
 * A page whose sections are problems is a page of questions.
 *
 * `about/troubleshooting.mdx` is written as one `##` heading per symptom, and
 * the prose under each is the answer. That is a FAQ in everything but the
 * markup, so the markup is produced from the page rather than a second copy of
 * the same words being kept beside it.
 *
 * Nothing declares a page to be a FAQ. A page written this way has questions,
 * and the caller decides whether to publish them.
 */

/** Markdown an answer may carry that a schema description may not. */
const plain = (text: string) =>
  text
    .replace(/^```[\s\S]*?```$/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()

export type Question = { question: string; answer: string }

/**
 * Every `##` section of a page, as a question and its answer. A section whose
 * answer is only a link — "Still stuck", and its like — carries nothing an
 * answer engine can lift, so it is dropped rather than published empty.
 */
export const questionsIn = (markdown: string): Question[] => {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
  const sections = body.split(/^## /m).slice(1)

  return sections.flatMap((section) => {
    const newline = section.indexOf("\n")
    if (newline === -1) return []

    const question = section.slice(0, newline).trim()
    // A nested heading starts new material that is not this answer.
    const answer = plain(section.slice(newline).split(/^#{3,} /m)[0]!)

    if (question.length === 0 || answer.length < 40) return []

    return [{ question, answer }]
  })
}

/**
 * Which page publishes its sections as questions.
 *
 * `questionsIn` is mechanical: any page with `##` sections yields something.
 * What makes a page a FAQ is that it is written as symptoms, and one page is.
 * The rule is named here so the loader states it once and a test can ask it
 * about every page rather than read it out of the loader's source.
 */
export const asksQuestions = (url: string) => url === "/about/troubleshooting"
