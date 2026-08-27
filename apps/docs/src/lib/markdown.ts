import { origin } from "@missingstudio/ui"

/**
 * A documentation page as markdown.
 *
 * The file on disk opens with a frontmatter block and no heading, because the
 * layout draws the title from the frontmatter. A reader fetching the markdown
 * has no layout, so a body handed over unchanged opens with three dashes and a
 * key-value list — and a document whose first line is `---` is a document
 * whose title an agent has to parse out of metadata.
 *
 * The title becomes the heading it already was, and the frontmatter's other
 * two fields become the sentence and the link below it. Nothing is invented
 * and nothing is dropped.
 */
export const pageMarkdown = (page: {
  title: string
  description?: string | undefined
  url: string
  raw: string
}) => {
  const body = page.raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trimStart()
  const canonical = `${origin.docs}${page.url === "/" ? "" : page.url}`

  return [
    `# ${page.title}`,
    "",
    ...(page.description ? [page.description, ""] : []),
    body,
    "",
    `---`,
    "",
    `This page as HTML: ${canonical}`,
    `Every page as one markdown index: ${origin.docs}/llms.txt`,
    "",
  ].join("\n")
}
