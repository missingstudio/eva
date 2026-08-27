import {
  capabilities,
  entity,
  external,
  installChannels,
  invocation,
  origin,
  pricingMarkdown,
  whenNotToUse,
  whenToUse,
} from "@missingstudio/ui"
import { about } from "../content/about.js"
import { changelog } from "../content/changelog.js"
import { contact } from "../content/contact.js"
import { lede, openSource, today } from "../content/home.js"
import { privacy } from "../content/privacy.js"
import type { Prose } from "../content/prose.js"
import { faq } from "../marketing/faq.js"
import { siteData } from "./site.js"

/**
 * Every markdown file this site serves. Each one is rendered from the same
 * data its HTML page renders from, so a twin cannot fall behind the page it
 * is a twin of.
 *
 * Every body starts with a level-one heading and carries no HTML. An agent
 * that asked for markdown and received a document beginning with `<!doctype`
 * has been told a lie about the content type.
 */

const doc = (slug: string) => (slug === "" ? origin.docs : `${origin.docs}/${slug}`)

const lines = (...parts: (string | false | undefined)[]) =>
  `${parts.filter((part) => typeof part === "string").join("\n")}\n`

/** A prose document, in the order the page sets it. */
export const proseMarkdown = (prose: Prose): string =>
  lines(
    `# ${prose.title}`,
    "",
    `> ${prose.lede}`,
    ...prose.sections.flatMap((section) => [
      "",
      `## ${section.heading}`,
      ...section.blocks.flatMap((block) => {
        if ("list" in block) return ["", ...block.list.map((item) => `- ${item}`)]
        if ("code" in block) return ["", "```sh", block.code, "```"]
        if ("link" in block) return ["", `[${block.link.label}](${block.link.href})`]
        return ["", block.p]
      }),
    ]),
    "",
    `Read this page as HTML: ${origin.web}/${prose.title.toLowerCase()}`,
  )

/**
 * The home page. It answers the three questions an agent arriving cold from a
 * search result asks: what is this, how do I call it, and do I need a key.
 */
export const homeMarkdown = (): string =>
  lines(
    // The tagline is a sentence and ends in a full stop. A heading does not.
    `# ${entity.product.name} — ${entity.product.tagline.replace(/\.$/, "")}`,
    "",
    `> ${entity.product.description}`,
    "",
    lede,
    "",
    "## Install",
    "",
    ...installChannels.flatMap((channel) => [
      `${channel.label}:`,
      "",
      "```sh",
      channel.command,
      "```",
      "",
    ]),
    `Current version: ${siteData.version}. Every channel, and how to verify a download: ${doc("install")}`,
    "",
    "## Interfaces and authentication",
    "",
    "Eva is a command-line program that runs on your machine. There is no hosted HTTP API, no public base URL, and no account, so an agent does not obtain a credential from this site.",
    "",
    '- Call it as a program. `eva -p "<prompt>"` answers once, prints to stdout, and exits 0 when the run ended done and 1 when it did not.',
    `- Model credentials are your own, read from the environment, and never written to a config file, a log, or the session record. See ${doc("connect-a-model")}.`,
    `- The full command surface and every exit code: ${doc("reference/cli")} and ${doc("reference/exit-codes")}.`,
    "",
    "## What Eva does today",
    "",
    ...today.map((row) => `- **${row.title}.** ${row.body} (${doc(row.slug)})`),
    "",
    "## When to use Eva",
    "",
    ...whenToUse.map((reason) => `- ${reason}`),
    "",
    "## When not to use Eva",
    "",
    ...whenNotToUse.map((reason) => `- ${reason}`),
    "",
    "## Local-first, and open",
    "",
    openSource.heading,
    "",
    ...openSource.body.flatMap((paragraph) => [paragraph, ""]),
    "## Questions",
    "",
    ...faq.flatMap((entry) => [`**${entry.question}**`, "", entry.answer, ""]),
    "## More",
    "",
    `- Agent index: ${origin.web}/llms.txt`,
    `- Documentation: ${origin.docs} (markdown index at ${origin.docs}/llms.txt)`,
    `- Pricing: ${origin.web}/pricing.md`,
    `- Source, MIT licensed: ${external.repo}`,
    `- Package: ${external.npm}`,
  )

export const changelogMarkdown = (): string =>
  lines(
    `# ${changelog.title}`,
    "",
    `> ${changelog.lede}`,
    "",
    `${changelog.link.label}: ${changelog.link.href}`,
  )

/**
 * The navigation index, in the shape llmstxt.org asks for: a level-one
 * heading, a blockquote summary, then sections of markdown links. It is an
 * index and not a manual, so every entry is a link with one line of context.
 */
export const llmsTxt = (): string =>
  lines(
    `# ${entity.product.name}`,
    "",
    `> ${entity.product.description}`,
    "",
    `Eva is free and MIT licensed. It runs on your machine as a command-line program: there is no hosted API, no account, and no key to request from this site. Current version ${siteData.version}.`,
    "",
    "## When to use Eva",
    "",
    ...whenToUse.map((reason) => `- ${reason}`),
    "",
    "## When not to use Eva",
    "",
    ...whenNotToUse.map((reason) => `- ${reason}`),
    "",
    "## How to call Eva",
    "",
    "```sh",
    installChannels[2].command,
    invocation.print,
    "```",
    "",
    `\`--print\` is the whole scriptable surface: it answers once, writes to stdout, and returns 0 or 1. The flags are at ${doc("reference/cli")} and the codes at ${doc("reference/exit-codes")}.`,
    "",
    "## Capabilities",
    "",
    ...capabilities.map(
      (capability) => `- [${capability.title}](${doc(capability.slug)}): ${capability.description}`,
    ),
    "",
    "## Documentation",
    "",
    `- [Documentation index](${origin.docs}): every page, with search.`,
    `- [Documentation as markdown](${origin.docs}/llms.txt): the same pages as one markdown index.`,
    `- [Install](${doc("install")}): every channel, and how to verify a download.`,
    `- [Connect a model](${doc("connect-a-model")}): providers, keys, and where a key is read from.`,
    `- [First run](${doc("first-run")}): the shortest path from install to an answer.`,
    `- [Concepts](${doc("concepts")}): the vocabulary the rest of the documentation uses.`,
    `- [Print mode](${doc("use/print-mode")}): answering once, for scripts and pipelines.`,
    `- [CLI reference](${doc("reference/cli")}): every command and every global flag.`,
    `- [Exit codes](${doc("reference/exit-codes")}): what each code means in a pipeline.`,
    `- [Write a plugin](${doc("extend/write-a-plugin")}): adding a capability without a fork.`,
    `- [Roadmap](${doc("about/roadmap")}): what is built, and in what order.`,
    "",
    "## This site",
    "",
    `- [Home, as markdown](${origin.web}/index.md): what Eva is, how to install it, what works today.`,
    `- [Pricing](${origin.web}/pricing.md): zero, and what you do pay for.`,
    `- [About](${origin.web}/about.md): who publishes Eva, and what does not work yet.`,
    `- [Contact](${origin.web}/contact.md): which channel answers what.`,
    `- [Privacy](${origin.web}/privacy.md): what this site stores, which is nothing.`,
    `- [Changelog](${origin.web}/changelog.md): every release, with checksums.`,
    `- [Sitemap](${origin.web}/sitemap.xml): every indexable URL.`,
    "",
    "## Source",
    "",
    `- [Repository](${external.repo}): the whole tree, MIT licensed.`,
    `- [Releases](${external.releases}): notes, checksums, and a provenance attestation.`,
    `- [Issues](${external.issues}): where a question is answered, in public.`,
    `- [Package](${external.npm}): the CLI on npm.`,
  )

/** Every markdown body this site serves, by the path that serves it. */
export const markdownPages = {
  "/index.md": homeMarkdown,
  "/about.md": () => proseMarkdown(about),
  "/contact.md": () => proseMarkdown(contact),
  "/pricing.md": pricingMarkdown,
  "/privacy.md": () => proseMarkdown(privacy),
  "/changelog.md": changelogMarkdown,
} as const
