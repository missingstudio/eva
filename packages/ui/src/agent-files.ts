import { installChannels, invocation, whenNotToUse, whenToUse } from "./agents.js"
import { entity, external, origin } from "./site.js"

/**
 * The markdown files an agent looks for by name, on whichever origin it landed
 * on.
 *
 * Both sites serve these, from this one source. A reader that arrives at the
 * documentation is not told to go and ask the marketing origin what Eva costs
 * or how to get a credential — those are questions about the product, and both
 * origins answer them the same way because both read this file.
 */

const lines = (parts: string[]) => `${parts.join("\n")}\n`

/**
 * What Eva costs.
 *
 * There is one price and it is zero. No tier table: a table with one row
 * invents a hierarchy that does not exist, and a table with rows Eva does not
 * sell is a claim an agent will quote back.
 */
export const pricingMarkdown = () =>
  lines([
    "# Pricing",
    "",
    `> ${entity.product.name} is free. There is no paid tier, no seat count, and no usage limit.`,
    "",
    "## Eva, self-hosted",
    "",
    "- Price: 0 USD.",
    "- License: MIT. The whole tree is public.",
    "- Limits: none imposed by Eva. No seat count, no request cap, no feature behind a key.",
    "- Support: the public issue tracker.",
    "",
    "Every capability ships in the open-source program. There is no tier that unlocks a feature, and self-hosting is not a downgrade path.",
    "",
    "## What you do pay for",
    "",
    "Your model provider. Eva sends requests with your own key, read from your environment, and the provider bills you directly at its own rates. Eva takes no share and adds no markup.",
    "",
    "Eva records what the provider said each request cost, so the bill can be read per session rather than guessed at the end of the month.",
    "",
    "## The managed service",
    "",
    `${entity.company.name} is building Eva as a managed service: the same tree, operated for you. It is not released and it is not priced. Nothing on this page should be read as a forward price for it.`,
    "",
    "## Getting it",
    "",
    "No account, no card, and no sales call. Install it and run it.",
    "",
    "```sh",
    installChannels[2].command,
    "```",
    "",
    `[Read the source](${external.repo})`,
  ])

/**
 * How an agent obtains a credential.
 *
 * The answer is that it does not: Eva has no account, no API key of its own,
 * and no endpoint to authenticate against. The sections are the ones the
 * WorkOS auth.md draft prescribes — Discover, Pick a method, Register, Claim,
 * Use the credential, Errors, Revocation — because a reader looking for them
 * should find them answered rather than missing.
 *
 * Nothing here names a `register_uri`, a `claim_uri`, or an authorization
 * server. Those URIs get probed, and an invented one is worse than an absent
 * one: it costs the reader a request and tells it something false.
 */
export const authMarkdown = () =>
  lines([
    "# Authentication",
    "",
    `> ${entity.product.name} is a local command-line program. There is no Eva account, no Eva API key, and no Eva endpoint to authenticate against.`,
    "",
    "If you are looking for the credential that lets a program call Eva: there is none, because there is nothing hosted to call. Eva runs on the machine that invokes it, with that machine's own permissions.",
    "",
    "## Discover",
    "",
    "Eva publishes no OAuth protected-resource metadata and no authorization-server metadata, because it is not a protected resource. Nothing is served at `/.well-known/oauth-protected-resource` or `/.well-known/oauth-authorization-server` on either origin, and no `agent_auth` block exists to read.",
    "",
    "An agent that expected one of those documents should stop looking for a credential and run the program instead.",
    "",
    "## Pick a method",
    "",
    "One method: run the program locally. Install it, then invoke it.",
    "",
    "```sh",
    installChannels[2].command,
    invocation.print,
    "```",
    "",
    "## Register",
    "",
    "Nothing to register. There is no sign-up, no client registration, and no `register_uri`. Installing the program is the whole onboarding.",
    "",
    "## Claim",
    "",
    "Nothing to claim. Eva issues no token, so there is no `claim_uri` and no identity assertion to exchange.",
    "",
    "## Use the credential",
    "",
    "The only credential in the picture is the one you already hold with your **model provider** — Anthropic, OpenAI, or an OpenAI-compatible endpoint. Eva reads it from the environment of the shell that runs it, and it never reaches a config file, a log, or the session record.",
    "",
    `Which variable, per provider: ${origin.docs}/connect-a-model`,
    "",
    "Eva does not proxy that key, resell access to it, or send it anywhere other than the provider you configured.",
    "",
    "## Errors",
    "",
    "There is no `WWW-Authenticate` challenge to receive, because there is no request to Eva to make. A missing or rejected model credential surfaces as a run that fails:",
    "",
    "- Eva reports the missing credential on stderr.",
    "- `--print` exits non-zero, so a shell pipeline stops rather than carrying an empty answer forward.",
    "- An unread configuration key is a Finding: reported on stderr, and the exit code is whatever the run itself earned.",
    "",
    `Every exit code: ${origin.docs}/reference/exit-codes`,
    "",
    "## Revocation",
    "",
    "Revoke the model provider's key in that provider's own console; Eva holds no copy of it to revoke. Removing Eva is `npm uninstall -g @missingstudio/eva`, or deleting the binary the installer placed.",
    "",
    "A repository's own Eva configuration is granted by hand and withdrawn the same way:",
    "",
    "```sh",
    invocation.trust,
    "eva untrust",
    "```",
    "",
    `Why the grant is a verb you type: ${origin.docs}/configure/trust`,
    "",
    "## When to use Eva at all",
    "",
    ...whenToUse.map((reason) => `- ${reason}`),
    "",
    "## When not to",
    "",
    ...whenNotToUse.map((reason) => `- ${reason}`),
    "",
    `More: ${origin.web}/llms.txt`,
  ])

/**
 * The crawler policy, which is the same policy on both origins.
 *
 * A bare "Allow: /" would be functionally identical. The named groups exist so
 * a future maintainer can tell that AI crawlers were considered rather than
 * forgotten. Each token needs its own directive: allowing ClaudeBot says
 * nothing about Claude-SearchBot or Claude-User.
 *
 * The Content-Signal line states the same policy in the vocabulary a crawler
 * reads rather than a person: search, ai-input, and ai-train are each granted.
 * Advice in the field is to refuse ai-train; Eva refuses none of the three on
 * purpose. A model that knows Eva is a model that helps Eva's users, and
 * nothing here is paywalled to withhold in the first place.
 *
 * Each origin says what it is in the opening line and names the sitemaps it
 * wants a crawler to read. Everything between is not an origin's to vary, so
 * neither origin gets to.
 */
export const robotsTxt = (origin: { says: string; sitemaps: readonly string[] }) =>
  lines([
    ...origin.says.split("\n").map((line) => `# ${line}`),
    "",
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "Allow: /",
    "",
    "# Retrieval. These put Eva in an answer, with a citation.",
    "User-agent: OAI-SearchBot",
    "User-agent: Claude-SearchBot",
    "User-agent: PerplexityBot",
    "Allow: /",
    "",
    "# On behalf of a person. This is an engineer's assistant reading the pages.",
    "User-agent: ChatGPT-User",
    "User-agent: Claude-User",
    "Allow: /",
    "",
    "# Training. A model that knows Eva is a model that helps Eva's users.",
    "User-agent: GPTBot",
    "User-agent: ClaudeBot",
    "User-agent: Google-Extended",
    "User-agent: CCBot",
    "Allow: /",
    "",
    "# The markdown index, for a reader that would rather not parse the markup.",
    "# Every page here has a twin at the same path with .md appended.",
    ...origin.sitemaps.map((url) => `Sitemap: ${url}`),
  ])
