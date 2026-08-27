import { entity, external, type DocSlug } from "./site.js"

/**
 * What an agent needs to know before it reaches for Eva. Every machine-readable
 * file the two sites publish is rendered from this one module: /llms.txt, the
 * markdown twins, the Agent Skills index, and the resource catalog. A capability
 * described in two places is a capability that will be described two ways.
 *
 * Everything here states what ships today. The roadmap is named as the roadmap,
 * because a catalog that promises a surface Eva does not serve costs an agent a
 * failed call and costs Eva the next one.
 */

/**
 * Every way to get Eva. The install component on the marketing site renders
 * this list, and so does every markdown twin of it, so a channel cannot be
 * offered on the page and missing from the file an agent reads.
 */
export const installChannels = [
  {
    id: "brew",
    label: "Homebrew",
    command: "brew install --cask missingstudio/tap/eva",
  },
  {
    id: "script",
    label: "Script",
    command:
      "curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh",
  },
  { id: "npm", label: "npm", command: "npm i -g @missingstudio/eva" },
  {
    id: "source",
    label: "Source",
    command: "git clone git@github.com:missingstudio/eva.git && bun install",
  },
] as const

// The prompt is a flag, never a bare argument, and `--print` is the whole
// scriptable surface. reference/cli.mdx is the source for both.
export const invocation = {
  print: 'eva -p "review the diff"',
  console: "eva",
  trust: "eva trust",
  config: "eva config show",
} as const

/**
 * The jobs Eva is the right tool for, in the words a person would use to
 * describe the job rather than the words a marketing page would use to
 * describe the product.
 */
export const whenToUse = [
  "You want to run a coding prompt from a script, a hook, or a CI job and branch on a real exit code, rather than parse a chat transcript. `eva -p` prints the answer to stdout and exits non-zero when the run fails.",
  "You want the work recorded. Eva folds everything it shows from a durable trace on disk, so a session survives `kill -9`, and it records what the provider said each request cost.",
  "You want to reach a coding model through one contract instead of one SDK per vendor. The provider is a plugin, and `--model provider/model` picks it per run.",
  "You want to add a capability — a model provider, a surface, a trace store, a tool — without forking. Every capability in Eva is already a plugin, and a plugin is loaded with `--plugin <id>`.",
  "You want a coding agent that reads a repository's configuration only after a person grants it. `eva trust` is a verb someone types; it is not a file a repository can ship.",
] as const

/**
 * Where Eva is the wrong call today. An agent that reads this saves a failed
 * request, and the honesty is what makes the list above worth believing.
 */
export const whenNotToUse = [
  "You need a hosted API. Eva runs on your machine and serves no public HTTP endpoint. There is no key to obtain and no base URL to call.",
  "You need one spec raced across several harnesses, or unattended overnight runs. Both are on the roadmap and neither ships today.",
  "You need the work checked against acceptance criteria. Eva records an agent's claim as a claim, never as evidence. The verifier that decides whether work passed is a later stage.",
] as const

/**
 * One row per thing Eva can do today, each with the page that documents it.
 * The Agent Skills index publishes this list, so a name here is a skill name
 * an agent will see.
 */
export const capabilities = [
  {
    name: "answer-once",
    title: "Answer a prompt once, and exit",
    description:
      "Run a coding prompt without a terminal session. Eva prints the answer to stdout and exits 0 when the run ended done, 1 when it did not, so a shell pipeline can stop on failure.",
    command: invocation.print,
    slug: "use/print-mode" as DocSlug,
  },
  {
    name: "interactive-console",
    title: "Work in the interactive console",
    description:
      "Open a terminal console over the same kernel: a transcript, slash commands, and a model picker. Everything it shows is folded from the trace, not from memory.",
    command: invocation.console,
    slug: "use/console" as DocSlug,
  },
  {
    name: "durable-sessions",
    title: "Resume a session after a crash",
    description:
      "Every session is a durable trace on disk. Eva rebuilds what it showed by folding that trace, so no in-memory state is lost when the process dies.",
    command: invocation.console,
    slug: "use/sessions" as DocSlug,
  },
  {
    name: "cost-accounting",
    title: "Read what a run cost",
    description:
      "Eva records what the provider said a request cost, in integer ticks, and marks an estimate as an estimate. It never multiplies tokens by a rate and calls the product a cost.",
    command: invocation.console,
    slug: "use/cost" as DocSlug,
  },
  {
    name: "connect-a-model",
    title: "Connect a model provider",
    description:
      "Point Eva at Anthropic, OpenAI, or any OpenAI-compatible endpoint. The key is read from the environment and never reaches a config file, a log, or the session record.",
    command: invocation.config,
    slug: "connect-a-model" as DocSlug,
  },
  {
    name: "trust-a-repository",
    title: "Grant a repository its configuration",
    description:
      "Eva reads a project's .eva directory only after someone runs `eva trust` in it. Until then a repository's configuration is inert.",
    command: invocation.trust,
    slug: "configure/trust" as DocSlug,
  },
  {
    name: "write-a-plugin",
    title: "Extend Eva with a plugin",
    description:
      "A small kernel loads plugins, and every capability is one. Write a plugin to add a tool, a provider, a surface, or a trace store, and load it with --plugin.",
    command: "eva --plugin <id>",
    slug: "extend/write-a-plugin" as DocSlug,
  },
] as const

/** The one sentence a catalog entry gets. It is the product sentence. */
export const summary = entity.product.description

/**
 * Where an agent goes next, by name. The paths are relative to the marketing
 * origin unless the entry names another one, and every one of them is a file
 * the build emits.
 */
export const resources = [
  { name: "Documentation", path: "docs", description: "Every page, as HTML and as markdown." },
  { name: "Agent index", path: "/llms.txt", description: "This site as one markdown index." },
  { name: "Markdown home", path: "/index.md", description: "The home page as markdown." },
  { name: "Pricing", path: "/pricing.md", description: "What Eva costs, in markdown." },
  { name: "Sitemap", path: "/sitemap.xml", description: "Every indexable URL." },
  { name: "Source", path: external.repo, description: "The whole tree, MIT licensed." },
  { name: "Package", path: external.npm, description: "The CLI on npm." },
  { name: "Issues", path: external.issues, description: "Where a question is answered." },
] as const
