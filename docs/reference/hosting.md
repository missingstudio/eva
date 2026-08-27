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

The build prerenders every page a crawl of the links can reach. Three pages for
the marketing site, twenty-five for the documentation.

## 2. Vercel serves `dist/client`

Each site carries a `vercel.json`, and that file is the whole configuration:
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
`packages/ui/src/site.ts`, so a preview deployment on a `vercel.app` domain
still names the production origins in its links.

## 3. What a file cannot answer

Some routes are server handlers with no file behind them. A deployment of
`dist/client` alone does not serve these:

| Route          | Site | What it is                            |
| -------------- | ---- | ------------------------------------- |
| `/robots.txt`  | both | the crawler policy, and the sitemaps  |
| `/sitemap.xml` | both | every page, for an answer engine      |
| `/llms.txt`    | docs | the index a coding assistant fetches  |
| `/raw/$`       | docs | the markdown source of a page         |
| `/api/search`  | docs | what the search field in the bar asks |

The first four are static text that happens to be produced by a handler, so
the prerenderer can write them as files. `/api/search` is a query, and it
cannot become a file without moving the documentation to a search index the
browser downloads.

## 4. Cloudflare

`wrangler.jsonc` and the `deploy` script in each site are the Cloudflare
Workers path, and they answer every route in the table above:
`dist/server/server.js` is the worker and `dist/client` is its asset directory.
Both hosts read the same build output, so a site can move between them without
a code change.
