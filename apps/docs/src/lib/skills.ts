import type { DocSlug } from "@missingstudio/machine"

/**
 * The tasks these pages teach, as Agent Skills.
 *
 * A different list from the marketing origin's. That one publishes what the
 * program can do; this one publishes what the documentation can teach, and
 * each skill *is* a page — so the URL is the page's own markdown twin and the
 * digest is taken over the bytes that twin serves. Nothing is duplicated:
 * there is no second copy of a skill body to keep in step with a page.
 */
export const taught: { slug: DocSlug; name: string; description: string }[] = [
  {
    slug: "install",
    name: "install-eva",
    description:
      "Install Eva from Homebrew, a shell script, npm, or source, and verify the download before running it. Use when setting Eva up on a machine for the first time.",
  },
  {
    slug: "connect-a-model",
    name: "connect-a-model",
    description:
      "Point Eva at Anthropic, OpenAI, or an OpenAI-compatible endpoint, and set the key in the environment it is read from. Use when Eva reports that it has no credential.",
  },
  {
    slug: "first-run",
    name: "first-run",
    description:
      "Get from a finished install to a first answer. Use when Eva is installed and has a model, and the next step is unclear.",
  },
  {
    slug: "use/print-mode",
    name: "run-a-prompt-in-a-script",
    description:
      "Answer one prompt without a terminal session, print to stdout, and branch on the exit code. Use when a script, a git hook, or a CI job has to run a coding prompt.",
  },
  {
    slug: "reference/cli",
    name: "eva-command-surface",
    description:
      "Every Eva command and every global flag, with what each returns. Use when composing an Eva invocation and the exact flag is in doubt.",
  },
  {
    slug: "configure/trust",
    name: "grant-a-repository",
    description:
      "Grant a repository its .eva configuration with a command someone types, and withdraw it again. Use when Eva appears to ignore a project's configuration.",
  },
  {
    slug: "extend/write-a-plugin",
    name: "write-an-eva-plugin",
    description:
      "Add a tool, a provider, a surface, or a trace store to Eva as a plugin rather than a fork. Use when Eva lacks a capability that a plugin could carry.",
  },
]

/** Every slug the skills index names, for the test that checks they exist. */
export const taughtSlugs = taught.map((skill) => skill.slug)
