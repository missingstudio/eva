import {
  entity,
  external,
  installChannels,
  invocation,
  origin,
  whenNotToUse,
  whenToUse,
} from "@missingstudio/ui"
import { pageMarkdown } from "./markdown.js"
import { source } from "./source.js"
import { sections, type Section } from "./twins.js"

/**
 * The markdown indexes this site serves.
 *
 * Not SEO artifacts. No major answer engine reads them. They are here because
 * coding assistants fetch documentation into context, and that is exactly who
 * reads Eva's docs.
 *
 * The root index lists every page. A section index lists one area, so an agent
 * working on configuration can take the configuration pages and not the other
 * twenty — which is the whole point of a scoped index.
 */

const pathOf = (url: string) => (url === "/" ? "" : url)

// The page shape comes from the collection rather than being restated here. A
// hand-written copy of it disagrees with the loader on the first upgrade.
type DocPage = ReturnType<typeof source.getPages>[number]

const entry = (page: DocPage) =>
  `- [${page.data.title}](${origin.docs}${pathOf(page.url)}): ${page.data.description ?? ""}`

const pagesIn = (section?: Section) =>
  source
    .getPages()
    .filter((page) => (section ? page.url.startsWith(`/${section}/`) : true))
    .sort((a, b) => a.url.localeCompare(b.url))

const lines = (parts: string[]) => `${parts.join("\n")}\n`

/**
 * Every page, as one index.
 *
 * The guidance is carried here rather than linked. This origin is scanned, and
 * read, on its own: an agent that lands on a documentation page and fetches
 * this file must not be told to go and ask another host what Eva is for.
 */
export const llmsTxt = () =>
  lines([
    `# ${entity.product.name} documentation`,
    "",
    `> ${entity.product.description}`,
    "",
    "Eva is free and MIT licensed, and it runs on the machine that calls it: there is no hosted API, no account, and no key to request from this site.",
    "",
    "Every page below is also served as markdown at the same path with `.md` appended.",
    "",
    "## When to use Eva",
    "",
    ...whenToUse.map((reason) => `- ${reason}`),
    "",
    "## When not to use Eva",
    "",
    ...whenNotToUse.map((reason) => `- ${reason}`),
    "",
    "## Start here",
    "",
    "```sh",
    installChannels[2].command,
    invocation.print,
    "```",
    "",
    `- [Install](${origin.docs}/install.md): every channel, and how to verify a download.`,
    `- [First run](${origin.docs}/first-run.md): the shortest path from install to an answer.`,
    `- [CLI reference](${origin.docs}/reference/cli.md): every command and every global flag.`,
    `- [Exit codes](${origin.docs}/reference/exit-codes.md): what each code means in a pipeline.`,
    "",
    "## Documentation",
    "",
    ...pagesIn().map(entry),
    "",
    "## Scoped indexes",
    "",
    `- [Every page, in full](${origin.docs}/llms-full.txt): every page's markdown, concatenated.`,
    ...sections.map(
      (section) =>
        `- [${section.title}](${origin.docs}/${section.slug}/llms.txt): the ${section.slug} pages only.`,
    ),
    "",
    "## Machine-readable",
    "",
    `- [Pricing](${origin.docs}/pricing.md): zero, and what you do pay for.`,
    `- [Authentication](${origin.docs}/auth.md): why there is no credential to obtain.`,
    `- [Resource catalog](${origin.docs}/.well-known/ard.json): what this origin offers.`,
    `- [Agent skills](${origin.docs}/.well-known/agent-skills/index.json): the tasks these pages teach.`,
    `- [Search index](${origin.docs}/api/search): the full-text index, as one file.`,
    `- [Sitemap](${origin.docs}/sitemap.xml): every indexable URL, with dates.`,
    "",
    "## Elsewhere",
    "",
    `- [${entity.product.name}](${origin.web}): what Eva is, and how to install it.`,
    `- [Agent index](${origin.web}/llms.txt): the same guidance, on the marketing origin.`,
    `- [Repository](${external.repo}): the whole tree, MIT licensed.`,
  ])

/**
 * Every page's markdown, in one file.
 *
 * A reader that wants the whole manual in context fetches this instead of
 * twenty-five URLs. It is the same bodies the twins serve, in the order the
 * index lists them.
 */
export const llmsFullTxt = async () => {
  const parts = [
    `# ${entity.product.name} documentation, in full`,
    "",
    `> ${entity.product.description}`,
    "",
    `Every documentation page, concatenated. The index is at ${origin.docs}/llms.txt, and each page is served on its own at the same path with \`.md\` appended.`,
    "",
  ]

  for (const page of pagesIn()) {
    parts.push(
      "---",
      "",
      pageMarkdown({
        title: page.data.title,
        description: page.data.description,
        url: page.url,
        raw: await page.data.getText("raw"),
      }),
    )
  }

  return `${parts.join("\n")}\n`
}

/** One area, for an agent that needs that area and not the manual. */
export const sectionLlmsTxt = (section: Section) => {
  const named = sections.find((entry) => entry.slug === section)
  if (!named) return undefined

  const pages = pagesIn(section)
  if (pages.length === 0) return undefined

  return lines([
    `# ${named.title} — ${entity.product.name} documentation`,
    "",
    `> The ${section} pages of Eva's documentation. The whole index is at ${origin.docs}/llms.txt.`,
    "",
    "Every page below is also served as markdown at the same path with `.md` appended.",
    "",
    `## ${named.title}`,
    "",
    ...pages.map(entry),
  ])
}
