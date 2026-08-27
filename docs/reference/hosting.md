# Hosting

How the two websites are deployed. The release path for the binary and the npm
packages is in [ci-cd.md](ci-cd.md); the build tools are in
[toolchain.md](toolchain.md).

## 1. Two sites, one repository

| Site          | Directory   | Origin                       | Serves                                      |
| ------------- | ----------- | ---------------------------- | ------------------------------------------- |
| Marketing     | `apps/www`  | `https://evafactory.co`      | the landing page, the changelog, install.sh |
| Documentation | `apps/docs` | `https://docs.evafactory.co` | every page under `content/docs`             |

Both are TanStack Start applications. `vite build` writes two directories:

- `dist/client` — the pages the build prerendered, the hashed assets, and the
  icons the `ui` package vendors for both sites.
- `dist/server` — one bundle that exports a web fetch handler.

The build prerenders every page a crawl of the links can reach, plus the paths
§3 names. The two lists are `machinePathsFor` in `apps/www/src/lib/pages.ts`
and `emittedFor` in `apps/docs/src/lib/twins.ts`, and each site's
`machine.test.ts` folds its own list rather than reading it out of the build
config — so the count is a thing to measure rather than a number stated here
and corrected by hand.

## 2. Vercel serves `dist/client`

Each site carries a `vercel.json`, **generated** by
`scripts/vercel-config.ts` from the lists the sites already hold — `pagePaths`
for the marketing origin, `docSlugs` and `sections` for the documentation.
It cannot be a build output: Vercel reads `vercel.json` _before_ it runs the
build. So it is committed, the way `routeTree.gen.ts` and `site-data.json` are.
It used to be written by hand, which meant a new page needed four edits in one
file and nothing said so when it got three.

**When it regenerates.** Never on its own — you run `bun run edge`. Two things
tell you to.

The pre-commit hook watches the modules the generator reads and runs
`--check` against them, so a commit that would carry a stale file is refused
before it is made. It refuses rather than fixing: `vp staged` runs a task
against a temporary index and discards what the task stages, so a `git add`
from inside the rule does not survive — the file would be rewritten on disk,
left unstaged, and the commit would carry the stale one anyway.

`scripts/vercel-config.test.ts` is the second, and it is what catches a commit
made with `--no-verify` or from a clone whose hooks were never installed
(`bun run hooks:setup`).

That file is the whole configuration:
the install command, the build command, `dist/client` as the output, and a
one-year immutable cache for `/assets`, where every name carries a content
hash.

Vercel is configured to deploy the prerendered files and nothing else, so
`dist/server` is unused there. Two Vercel projects, both from this repository,
and one field to set in each dashboard:

| Setting                                  | Marketing  | Documentation |
| ---------------------------------------- | ---------- | ------------- |
| Root Directory                           | `apps/www` | `apps/docs`   |
| Include files outside the Root Directory | on         | on            |

The second is Vercel's default and must stay on. Both builds read the
repository root: the icons come from `packages/ui/public`, the marketing build
reads `scripts/install.sh` and `scripts/site-data.ts`, and `bun install`
resolves a workspace.

Neither site needs an environment variable. Both origins are written in
`packages/machine/src/site.ts`, so a preview deployment on a `vercel.app` domain
still names the production origins in its links.

## 3. Every route is a file, and the build says which

A route that answers with text rather than markup has no component, and
prerender discovers a route by looking for one. So none of these was found,
none was written, and every one of them answered 404 in production for as long
as the sites were deployed:

| Route          | Site | What it is                            |
| -------------- | ---- | ------------------------------------- |
| `/robots.txt`  | both | the crawler policy, and the sitemaps  |
| `/sitemap.xml` | both | every page, for an answer engine      |
| `/llms.txt`    | both | the index a coding assistant fetches  |
| `/raw/$`       | docs | the markdown source of a page         |
| `/api/search`  | docs | what the search field in the bar asks |

The fix is a list of the paths the build must render, held as data beside the
site rather than written inside the build config:

- `apps/www` reads it from `machinePathsFor` in `src/lib/pages.ts`.
- `apps/docs` reads it from `emittedFor` in `src/lib/twins.ts`, which takes the
  slugs as an argument because they live in the `ui` package and that module may
  not import one.

Each site's `machine.test.ts` folds the same function. The checks used to
assert on the text of `vite.config.ts`, which failed on a rename and passed on
a behaviour change.

A response whose content type is not HTML is written at its own path, so
`/robots.txt` becomes `robots.txt` and not `robots.txt/index.html`. A page that
needs a different filename says so with `outputPath`, which is how the 404 body
becomes `404.html` — the one name static hosting looks for.

Two rules that cost something to learn:

- **Prerender keys its work by request path.** Asking for one route's answer
  twice under two names silently drops one of them. The documentation's
  markdown twins are `/raw/<slug>` filed under `<slug>.md`, requested once;
  `vercel.json` rewrites `/raw/*` onto those files so both URLs answer.
- **A module the build reads must not import a package by name.** Vite loads
  `vite.config.ts` through Node, which resolves a bare specifier without the
  bundler's `.js`-means-`.ts` rule and fails on the package's own internal
  imports. `pages.ts` and `twins.ts` import nothing for that reason.

`/api/search` was the exception this table used to name, and it is one no
longer: the route answers with `staticGET`, which is the whole index as one
file, and the search dialog reads it in the browser. Search returned nothing on
the deployed site until that change.

## 3a. What the sites serve a machine

Both origins carry the same contract, because an origin is read — and scored —
on its own. A reader that lands on a documentation page is never sent to the
other host to ask what Eva costs or how to authenticate.

| Path                                   | www | docs | What it is                         |
| -------------------------------------- | --- | ---- | ---------------------------------- |
| `/llms.txt`                            | yes | yes  | the index, with when-to-use        |
| `/llms-full.txt`                       | no  | yes  | every page's markdown, in one file |
| `/<section>/llms.txt`                  | no  | yes  | one area, scoped                   |
| `<path>.md`                            | yes | yes  | a markdown twin of every page      |
| `/pricing.md`, `/auth.md`              | yes | yes  | one source, in `packages/ui`       |
| `/.well-known/ard.json`                | yes | yes  | the resource catalog               |
| `/.well-known/ai-catalog.json`         | yes | yes  | the same catalog, predecessor path |
| `/.well-known/agent-skills/index.json` | yes | yes  | www: capabilities; docs: its pages |
| `/404.html`                            | yes | yes  | a body naming the indexes          |

Both origins answer through `@missingstudio/machine/serve`, which states each
format's content type, the `Vary: Accept` a negotiated twin travels with, and
what a named resource nobody wrote answers with. It returns a `Response` and
knows no framework, so a route composes it and the worker path could too.

`vercel.json` carries what a file cannot: `Vary: Accept`, the `Link` headers
(RFC 8288), and the rewrites that answer `Accept: text/markdown` with the twin.
The generator reads the content types out of the serve module, so the edge
cannot state a type the routes do not send. It adds `Accept-Encoding` to the
`Vary` because the edge compresses and a route does not — that is the edge's
job, not a divergence.

The page enumeration in those rewrites is load-bearing, not ceremony. An
unconstrained `/:page` also matches `/llms.txt` and `/robots.txt`, and an agent
fetching either sends `Accept: text/markdown` — so it would be rewritten onto a
file that does not exist. The alternation is what says "these paths, and no
others, have twins."

The crawler policy itself is one body in `packages/ui`. Each origin says what
it is in the opening line and names the sitemaps it wants read; the twenty-four
lines between are not an origin's to vary.

`scripts/agent-ready.ts` checks the whole contract against a running origin —
the status, the content type, the `Vary`, the `Link`, and the shape of each
body. **CI runs it on every change**: `bun run build`, then
`scripts/serve-static.ts` serving both builds with the same `vercel.json` the
edge applies, then the prober against those. Served locally rather than probed
on a deployment, because ci.yml holds every job to being a pure function of the
tree — and a preview URL is not one.

The prober folds `pagePaths`, `sections`, and `twinOf` from the modules that
own them, because a prober whose idea of "every page" is its own stops probing
the page that was added last.

## 4. Cloudflare

`wrangler.jsonc` and the `deploy` script in each site are the Cloudflare
Workers path: `dist/server/server.js` is the worker and `dist/client` is its
asset directory. Both hosts read the same build output, so a site can move
between them without a code change.

Nothing needs the worker today. Three things would:

- **A markdown 404.** A static host answers an unmatched path with one file,
  and that file is HTML. Deciding to answer a `.md` request with a markdown
  body needs code that knows the path missed.
- **Serving markdown to a bot user agent.** Possible as a rewrite, and
  declined: it would hand GPTBot and ClaudeBot a body with no JSON-LD in it,
  hiding the entity graph from the crawlers that feed knowledge graphs.
- **A documentation MCP server.** A transport, not a file. The worker is where
  it would live, over the same `source` the twins and the search index read.
