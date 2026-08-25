# @missingstudio/eva-web-app

The Session page for [Eva](../../README.md): a browser reads one Session
live, and writes nothing. It is one artifact, and
[`eva.web`](../../plugins/web/README.md) serves it without building it — the
posture, single-tenant or multi-tenant, is read when the surface starts.

At W1 the page lists the Sessions Eva holds, each with its Header. It reaches
them over the wire [`eva.api`](../../plugins/api/README.md) serves on the same
port, through the Client `packages/client-runtime` builds — and the count of
Session API calls that go around that Client is zero, which is a check that
fails rather than a habit. The glossary in
[docs/context.md](../../docs/context.md) defines **Session**, **Surface**, and
**Transcript**.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.

## Installation

Install once at the repository root:

```bash
bun install
```

## Usage

Build the page, then serve it:

```bash
# every workspace that has a build script, this one included
bun run build

# the surface that serves what the build left in apps/web/dist
bun run eva serve --web
```

`eva serve --web` prints the address it bound to. Nothing is built at serve
time: a page that is not there is reported with the command that fixes it.

For the page alone, with hot reload and no Eva behind it:

```bash
cd apps/web && bun run dev
```

## Layout

| Path              | What                                                  |
| ----------------- | ----------------------------------------------------- |
| `src/main.tsx`    | mounts the router into `index.html`                   |
| `src/routes.tsx`  | the route tree, written in code rather than generated |
| `src/page.tsx`    | the one route: the build, and the listing             |
| `src/eva.ts`      | the one Client, over the same-origin wire             |
| `src/sessions.ts` | what the page reads: the Sessions, or not yet         |
| `src/build.ts`    | the version and the stamp, injected by the build      |
| `src/styles.css`  | plain local styling until `packages/brand` lands      |

Routes are code-based, so the build needs no route generator and no plugin
beside the toolchain the repository already has.

## The name

The marketing site on the `feat/website` branch holds this same directory,
and becomes `apps/www` when that branch lands. This package takes the `-app`
suffix so `plugins/web` keeps the plain `@missingstudio/eva-web`.

## Development

Tests live in [src/page.test.tsx](src/page.test.tsx): the page is rendered to
a string, because what a browser gets is proven against a real socket in
[plugins/web](../../plugins/web/README.md) and the wire behind it is proven in
[packages/conformance](../../packages/conformance). Run the suite from the
repository root:

```bash
bun run test
```
