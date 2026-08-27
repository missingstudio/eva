/**
 * Every contract the two sites owe a machine, checked against a running
 * deployment.
 *
 * The unit tests check what the build produces. This checks what a host
 * actually serves — the status, the content type, the `Vary`, the `Link`, and
 * the shape of the body — because the defect this whole effort started from
 * was invisible to every test that read the repository: the routes existed,
 * the tests passed, and production answered 404.
 *
 * Usage:
 *   bun scripts/agent-ready.ts                     # the deployed sites
 *   bun scripts/agent-ready.ts http://localhost:3000 http://localhost:3001
 */

import { createHash } from "node:crypto"
import process from "node:process"
// The three lists a page belongs to, read from the modules that own them
// rather than restated here. A prober whose idea of "every page" is its own
// stops probing the page that was added last.
import { agentSkillFields, agentSkillsSchema } from "../packages/machine/src/skills.js"
import type { DocSlug } from "../packages/machine/src/site.js"
import { pagePaths, twinOf } from "../apps/www/src/lib/pages.js"
import { sections } from "../apps/docs/src/lib/twins.js"

const [web = "https://evafactory.co", docs = "https://docs.evafactory.co"] = process.argv.slice(2)

/**
 * The origins the bodies name, which are not always the origins being asked.
 *
 * A canonical link, a sitemap `loc`, and a `Sitemap:` line are absolute URLs
 * decided at build time, so a build served from a preview still says
 * evafactory.co — correctly. Checking the body against the address being
 * probed would fail every preview and pass only production, which is the wrong
 * way round for a check meant to run before a deploy.
 */
const canonical = { web: "https://evafactory.co", docs: "https://docs.evafactory.co" }

type Check = {
  /** What is being asked for, in the words the report will use. */
  what: string
  url: string
  accept?: string
  /** Every condition the answer has to meet. */
  expect: {
    status?: number
    type?: string | RegExp
    /** A header name mapped to what its value must contain. */
    headers?: Record<string, string | RegExp>
    body?: (RegExp | string)[]
    /** The body must not match any of these. */
    absent?: (RegExp | string)[]
    minLength?: number
    json?: (value: any) => string | undefined
  }
}

const checks: Check[] = []

const check = (entry: Check) => checks.push(entry)

// The pages the sites serve, and the twins that mirror them.
const webPages = pagePaths
// A spot check rather than the whole list: probing twenty-seven pages over
// HTTP buys nothing the first five do not. Typed, so a renamed page fails to
// compile here rather than 404ing in the report.
const docPages: DocSlug[] = ["", "install", "first-run", "use/print-mode", "reference/cli"]
const docPath = (slug: DocSlug) => (slug === "" ? "" : `/${slug}`)
const twin = twinOf

/*
  The home page. An agent arriving cold from a search result reads this one,
  and it has to carry a heading, real text, and the entity graph in the markup
  itself — a page assembled in the browser is a page a crawler cannot read.
*/
check({
  what: "the home page is server-rendered, with a heading and an entity graph",
  url: web,
  expect: {
    status: 200,
    type: /text\/html/,
    body: [/<h1[^>]*>/, /"@type":\s*"Organization"/, /"contactPoint"/, /"address"/],
    minLength: 4000,
  },
})

check({
  what: "the home page advertises its markdown twin, the sitemap, and the catalog",
  url: web,
  expect: {
    status: 200,
    headers: { vary: /Accept/i, link: /rel="sitemap"/ },
    body: [/rel="alternate"\s+type="text\/markdown"/, /rel="ard"/],
  },
})

/*
  Content negotiation. An agent that asks for markdown is given markdown, and
  the answer says it varies by Accept — without which a cache hands one
  representation to a reader who asked for the other.
*/
check({
  what: "a request for markdown is answered with markdown",
  url: web,
  accept: "text/markdown",
  expect: {
    status: 200,
    type: /text\/markdown/,
    headers: { vary: /Accept/i },
    body: [/^# /],
    absent: [/<!doctype html/i],
  },
})

check({
  what: "a refusal of markdown is answered with markup",
  url: web,
  accept: "text/markdown;q=0, text/html",
  expect: { status: 200, type: /text\/html/ },
})

check({
  what: "?mode=agent answers with the machine-readable view",
  url: `${web}/?mode=agent`,
  expect: {
    status: 200,
    type: /text\/markdown/,
    body: [/^# /, /## When to use Eva/, /eva -p/],
  },
})

// The indexes.
check({
  what: "robots.txt states a policy for AI crawlers and names both sitemaps",
  url: `${web}/robots.txt`,
  expect: {
    status: 200,
    type: /text\/plain/,
    body: [
      /Content-Signal:\s*search=yes/i,
      /User-agent:\s*GPTBot/i,
      /User-agent:\s*ClaudeBot/i,
      /User-agent:\s*PerplexityBot/i,
      new RegExp(`Sitemap:\\s*${canonical.web}/sitemap\\.xml`),
      /Sitemap:.*docs\..*sitemap\.xml/,
    ],
  },
})

check({
  what: "the sitemap lists every page",
  url: `${web}/sitemap.xml`,
  expect: {
    status: 200,
    type: /xml/,
    body: [/<urlset/, ...webPages.map((path) => new RegExp(`<loc>${canonical.web}${path}</loc>`))],
  },
})

check({
  what: "llms.txt is an index, and says when to reach for Eva",
  url: `${web}/llms.txt`,
  expect: {
    status: 200,
    type: /text\/plain/,
    body: [
      /^# Eva/,
      /^> /m,
      /## When to use Eva/,
      /## When not to use Eva/,
      /eva -p/,
      /\[.+\]\(https:\/\/.+\)/,
    ],
    minLength: 1000,
  },
})

check({
  what: "the documentation's sitemap dates every page from git",
  url: `${docs}/sitemap.xml`,
  expect: {
    status: 200,
    type: /xml/,
    body: [/<urlset/, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/],
  },
})

check({
  what: "the documentation's own index lists its pages and its scoped indexes",
  url: `${docs}/llms.txt`,
  expect: {
    status: 200,
    type: /text\/plain/,
    body: [/^# Eva documentation/, /## Documentation/, /## Scoped indexes/, /llms\.txt/],
  },
})

for (const { slug: section } of sections) {
  check({
    what: `the ${section} pages have a scoped index`,
    url: `${docs}/${section}/llms.txt`,
    expect: { status: 200, type: /text\/plain/, body: [/^# /, new RegExp(`/${section}/`)] },
  })
}

// Every twin, on both sites.
for (const path of webPages) {
  check({
    what: `${path || "/"} has a markdown twin`,
    url: `${web}${twin(path)}`,
    expect: {
      status: 200,
      type: /text\/markdown/,
      body: [/^# /],
      absent: [/<!doctype html/i],
      minLength: 150,
    },
  })
}

for (const slug of docPages) {
  const path = docPath(slug)

  check({
    what: `the documentation's ${path || "/"} has a markdown twin`,
    url: `${docs}${twin(path)}`,
    expect: {
      status: 200,
      type: /text\/markdown/,
      body: [/^# /],
      absent: [/<!doctype html/i, /^---\r?\n/],
      minLength: 150,
    },
  })
}

check({
  what: "the raw endpoint still answers, on the twin's body",
  url: `${docs}/raw/install`,
  expect: { status: 200, type: /text\/markdown/, body: [/^# Install/] },
})

// The pages an agent reads to decide whether a publisher is real.
for (const path of ["/about", "/contact", "/privacy"]) {
  check({
    what: `${path} is a real page`,
    url: `${web}${path}`,
    expect: { status: 200, type: /text\/html/, body: [/<h1[^>]*>/], minLength: 3000 },
  })
}

/**
 * The files an agent looks for by name, on whichever origin it landed on. An
 * origin is read on its own: a reader that arrives at the documentation must
 * not be sent to another host to ask what Eva costs or how to authenticate.
 */
for (const [name, origin] of [
  ["the site", web],
  ["the documentation", docs],
] as const) {
  check({
    what: `${name} publishes pricing as markdown`,
    url: `${origin}/pricing.md`,
    expect: {
      status: 200,
      type: /text\/markdown/,
      body: [/^# Pricing/, /MIT/, /0 USD/],
      minLength: 500,
    },
  })

  check({
    what: `${name} answers how an agent gets a credential`,
    url: `${origin}/auth.md`,
    expect: {
      status: 200,
      type: /text\/markdown/,
      body: [
        /^# Authentication/,
        /## Discover/,
        /## Pick a method/,
        /## Register/,
        /## Claim/,
        /## Use the credential/,
        /## Errors/,
        /## Revocation/,
      ],
      minLength: 500,
    },
  })
}

check({
  what: "the documentation's guidance is on the documentation, not a link to it",
  url: `${docs}/llms.txt`,
  expect: { status: 200, body: [/## When to use Eva/, /## When not to use Eva/, /eva -p/] },
})

check({
  what: "the whole manual is fetchable as one file",
  url: `${docs}/llms-full.txt`,
  expect: {
    status: 200,
    type: /text\/plain/,
    body: [/^# Eva documentation, in full/, /# Install/, /# CLI reference/],
    minLength: 20_000,
  },
})

check({
  what: "the documentation publishes the tasks its pages teach",
  url: `${docs}/.well-known/agent-skills/index.json`,
  expect: {
    status: 200,
    type: /application\/json/,
    json: (value) => {
      if (value?.$schema !== agentSkillsSchema) return "the $schema is not the one clients match on"
      if (!Array.isArray(value?.skills) || value.skills.length === 0) return "no skills"

      for (const entry of value.skills) {
        for (const field of agentSkillFields) {
          if (!entry[field]) return `a skill has no ${field}`
        }
        if (!entry.url.endsWith(".md")) return `${entry.name} does not point at a markdown twin`
      }

      return undefined
    },
  },
})

for (const path of ["/about/contact", "/about/privacy"]) {
  check({
    what: `the documentation's ${path} is a real page`,
    url: `${docs}${path}`,
    expect: { status: 200, type: /text\/html/, minLength: 3000 },
  })
}

check({
  what: "the troubleshooting page publishes its symptoms as questions",
  url: `${docs}/about/troubleshooting`,
  expect: { status: 200, body: [/"@type":\s*"FAQPage"/, /"acceptedAnswer"/] },
})

check({
  what: "the documentation names its developer surface where a crawler reads it",
  url: docs,
  expect: { status: 200, body: [/\/reference\/cli/, /\/llms\.txt/, /\/auth\.md/] },
})

// Discovery documents.
/**
 * The catalog every origin has to publish for itself. A search result lands an
 * agent on a page, not on a site root, and an agent that has to guess which
 * host holds the catalog guesses wrong.
 */
const catalogChecks = (origin: string, name: string, expected: string[]) => {
  const entriesAreValid = (value: any) => {
    if (!Array.isArray(value?.entries) || value.entries.length === 0) return "no entries"

    const seen = new Set<string>()

    for (const entry of value.entries) {
      if (!/^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/.test(entry.identifier ?? ""))
        return `${entry.identifier} is not a urn:air identifier`
      if (seen.has(entry.identifier)) return `${entry.identifier} is listed twice`
      seen.add(entry.identifier)

      if (!entry.displayName) return `${entry.identifier} has no displayName`
      if (!entry.type) return `${entry.identifier} has no type`
      if (!entry.url === !entry.data) return `${entry.identifier} needs exactly one of url, data`
    }

    for (const url of expected) {
      if (!value.entries.some((entry: { url: string }) => entry.url === url))
        return `nothing in the catalog points at ${url}`
    }

    return undefined
  }

  check({
    what: `${name} publishes a resource catalog at the path the spec names`,
    url: `${origin}/.well-known/ard.json`,
    expect: { status: 200, type: /application\/json/, json: entriesAreValid },
  })

  check({
    what: `${name} also serves the catalog at the predecessor path`,
    url: `${origin}/.well-known/ai-catalog.json`,
    expect: {
      status: 200,
      type: /application\/json/,
      json: (value) => {
        if (value?.specVersion !== "1.0") return 'specVersion must be "1.0"'
        if (!value?.host?.displayName) return "host.displayName is required"

        for (const entry of value.entries ?? []) {
          const queries = entry.representativeQueries
          if (!Array.isArray(queries) || queries.length < 2 || queries.length > 5)
            return `${entry.identifier} needs two to five representativeQueries`
        }

        return entriesAreValid(value)
      },
    },
  })

  check({
    what: `${name} advertises the catalog from its pages`,
    url: origin,
    expect: { status: 200, body: [/rel="ard"/] },
  })
}

catalogChecks(web, "the site", [
  `${canonical.web}/llms.txt`,
  `${canonical.web}/pricing.md`,
  `${canonical.web}/.well-known/agent-skills/index.json`,
  `${canonical.docs}/llms.txt`,
])

catalogChecks(docs, "the documentation", [
  `${canonical.docs}/llms.txt`,
  `${canonical.docs}/api/search`,
  `${canonical.docs}/use/llms.txt`,
  `${canonical.web}/.well-known/agent-skills/index.json`,
])

check({
  what: "a documentation page carries the publisher it references",
  url: `${docs}/install`,
  expect: {
    status: 200,
    body: [
      /"@type":\s*"Organization"/,
      /"contactPoint"/,
      /"address"/,
      /"@type":\s*"TechArticle"/,
      /"@type":\s*"BreadcrumbList"/,
    ],
  },
})

check({
  what: "the skills index names every skill, with a digest",
  url: `${web}/.well-known/agent-skills/index.json`,
  expect: {
    status: 200,
    type: /application\/json/,
    json: (value) => {
      if (value?.$schema !== agentSkillsSchema) return "the $schema is not the one clients match on"
      if (!Array.isArray(value?.skills) || value.skills.length === 0) return "no skills"
      for (const entry of value.skills) {
        for (const field of agentSkillFields) {
          if (!entry[field]) return `a skill has no ${field}`
        }
        if (!/^sha256:[0-9a-f]{64}$/.test(entry.digest))
          return `${entry.name} has a malformed digest`
        if (!["skill-md", "archive"].includes(entry.type))
          return `${entry.name} has type ${entry.type}`
      }
      return undefined
    },
  },
})

// A wrong URL, on both sites.
for (const [name, origin] of [
  ["the site", web],
  ["the documentation", docs],
] as const) {
  check({
    what: `a wrong URL on ${name} answers 404, and says where to look`,
    url: `${origin}/a-path-that-does-not-exist-8f2c`,
    expect: {
      status: 404,
      body: [/llms\.txt/, /sitemap\.xml/],
    },
  })
}

check({
  what: "the documentation's search index is a file the browser can read",
  url: `${docs}/api/search`,
  expect: {
    status: 200,
    json: (value) => (value && typeof value === "object" ? undefined : "not a JSON document"),
    minLength: 1000,
  },
})

check({
  what: "the install script is served from the site it is advertised on",
  url: `${web}/install.sh`,
  expect: { status: 200, body: [/^#!/] },
})

/** Every skill the index names has to answer, with the bytes it was hashed as. */
const checkSkillDigests = async (): Promise<string[]> => {
  const failures: string[] = []
  const response = await fetch(`${web}/.well-known/agent-skills/index.json`)

  if (!response.ok) return [`the skills index answered ${response.status}`]

  const index = (await response.json()) as {
    skills: { name: string; url: string; digest: string; description: string }[]
  }

  for (const entry of index.skills) {
    const url = new URL(entry.url, web).toString()
    const skill = await fetch(url)

    if (!skill.ok) {
      failures.push(`${entry.name}: ${url} answered ${skill.status}`)
      continue
    }

    const type = skill.headers.get("content-type") ?? ""
    if (!/text\/(markdown|plain)/.test(type)) {
      failures.push(`${entry.name}: served as ${type}`)
    }

    const body = await skill.text()
    const digest = createHash("sha256").update(body, "utf8").digest("hex")

    if (`sha256:${digest}` !== entry.digest) {
      failures.push(`${entry.name}: the digest does not match the bytes served`)
    }

    if (!body.includes(`name: ${entry.name}`)) {
      failures.push(`${entry.name}: the frontmatter name does not match the directory`)
    }

    if (!body.includes(entry.description)) {
      failures.push(`${entry.name}: the description does not match the index`)
    }
  }

  return failures
}

const run = async (entry: Check): Promise<string[]> => {
  const failures: string[] = []
  const { expect: wanted } = entry

  let response: Response
  try {
    response = await fetch(entry.url, {
      headers: entry.accept ? { accept: entry.accept } : {},
      redirect: "manual",
    })
  } catch (error) {
    return [`the request failed: ${(error as Error).message}`]
  }

  // A redirect is a failure here, not a step. A scanner that meets a redirect
  // at the apex reads the empty body it was handed, which is the defect that
  // made a rendered page look like an empty one.
  if (response.status >= 300 && response.status < 400) {
    return [`answered ${response.status} to ${response.headers.get("location")}`]
  }

  if (wanted.status && response.status !== wanted.status) {
    failures.push(`answered ${response.status}, wanted ${wanted.status}`)
  }

  const type = response.headers.get("content-type") ?? ""
  if (wanted.type) {
    const matches =
      typeof wanted.type === "string" ? type.includes(wanted.type) : wanted.type.test(type)
    if (!matches) failures.push(`served as "${type}"`)
  }

  for (const [header, value] of Object.entries(wanted.headers ?? {})) {
    const actual = response.headers.get(header) ?? ""
    const matches = typeof value === "string" ? actual.includes(value) : value.test(actual)
    if (!matches) failures.push(`${header} is "${actual || "absent"}"`)
  }

  const body = await response.text()

  if (wanted.minLength && body.length < wanted.minLength) {
    failures.push(`${body.length} characters, wanted ${wanted.minLength}`)
  }

  for (const pattern of wanted.body ?? []) {
    const matches = typeof pattern === "string" ? body.includes(pattern) : pattern.test(body)
    if (!matches) failures.push(`the body does not match ${pattern}`)
  }

  for (const pattern of wanted.absent ?? []) {
    const matches = typeof pattern === "string" ? body.includes(pattern) : pattern.test(body)
    if (matches) failures.push(`the body matches ${pattern} and should not`)
  }

  if (wanted.json) {
    try {
      const problem = wanted.json(JSON.parse(body))
      if (problem) failures.push(problem)
    } catch {
      failures.push("the body is not JSON")
    }
  }

  return failures
}

console.log(`Checking ${web} and ${docs}\n`)

let failed = 0

for (const entry of checks) {
  const failures = await run(entry)
  const path = entry.url.replace(web, "").replace(docs, "docs:") || "/"

  if (failures.length === 0) {
    console.log(`  ok    ${entry.what}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${entry.what}`)
    console.log(`        ${path}${entry.accept ? ` (Accept: ${entry.accept})` : ""}`)
    for (const failure of failures) console.log(`        ${failure}`)
  }
}

const digestFailures = await checkSkillDigests()
if (digestFailures.length === 0) {
  console.log("  ok    every skill answers with the bytes its digest was taken from")
} else {
  failed += 1
  console.log("  FAIL  every skill answers with the bytes its digest was taken from")
  for (const failure of digestFailures) console.log(`        ${failure}`)
}

const total = checks.length + 1
console.log(`\n${total - failed} of ${total} checks passed.`)

if (failed > 0) process.exit(1)
