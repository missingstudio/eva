import { entity, type DocSlug } from "@missingstudio/machine"

/*
  The home page's words, held where both the page and its markdown twin can
  read them. The tagline is not here: it lives in the machine package, because the
  README and the documentation say it too.
*/
export const lede =
  "A local-first control center for coding agents. They run in parallel, and they ship without losing context."

export const today: readonly { title: string; body: string; slug: DocSlug }[] = [
  {
    title: "Every capability is a plugin",
    body: "A small kernel loads plugins. The model, the surface, the trace, the themes — each one is a plugin, and any of them can be replaced or switched off.",
    slug: "extend/how-plugins-work",
  },
  {
    title: "A session survives kill -9",
    body: "Everything Eva shows is folded from a durable trace on disk. There is no in-memory state a crash could lose, because there is none that matters.",
    slug: "use/sessions",
  },
  {
    title: "You can see what a run cost",
    body: "Eva records what the provider said a request cost, in integer ticks. It marks an estimate as an estimate, and never multiplies tokens by a rate and calls it a cost.",
    slug: "use/cost",
  },
  {
    title: "A repository earns its trust",
    body: "Eva reads a project's .eva directory only after you run eva trust there. The grant is a verb you type, not a file a repository can ship.",
    slug: "configure/trust",
  },
]

// What the open-source band says, in the order it says it. The company is
// named from the machine package, never spelled out here: the page said the name
// twice once, and the two spellings drifted apart.
export const openSource = {
  heading: "Your key never reaches a settings file, a log, or the session record.",
  body: [
    "Eva reads a repository’s configuration only after you grant it. Everything runs on your machine.",
    `Eva is MIT licensed and the whole tree is public. ${entity.company.name} is the company behind it, and its first product is Eva as a managed service — the same tree, operated for you. Self-hosting is not a downgrade path.`,
  ],
} as const
