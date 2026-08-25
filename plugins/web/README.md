# @missingstudio/eva-web

The web surface for [Eva](../../README.md). It registers the `eva.web` row in
the surface Domain, and starting that row binds a loopback port and serves the
page [`apps/web`](../../apps/web/README.md) built. It serves assets it did not
build, so disabling this plugin removes a row from a Domain and nothing else.

Eva is built on a plugin kernel: every capability is a plugin. The glossary in
[docs/context.md](../../docs/context.md) defines **Surface** and **Frontend**,
which are most of this package.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.
- A built page. `bun run build` at the repository root fills `apps/web/dist`.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-web": "workspace:*" } }
```

## Usage

At the command line:

```bash
bun run build            # fill apps/web/dist
bun run eva serve --web  # bind, print the address, and hold
```

The surface prints the address it bound to and the posture it read:

```
http://127.0.0.1:7777 · eva.web in the local posture
```

A page nobody built is a degradation that says why, rather than a surface that
answers every request with 404:

```
no built page at /eva/apps/web/dist; run `vp run -r build`
```

| Config key | Shape  | Default | What                                         |
| ---------- | ------ | ------- | -------------------------------------------- |
| `posture`  | `name` | `local` | `local` single-tenant, `hosted` multi-tenant |

The posture is read when the surface starts, and it changes no byte of what is
served: single-tenant and multi-tenant are the same `apps/web` build. What each
posture then permits arrives with the token at stage 9b.

## The row

`eva.web` declares `interactive: false`, because the page takes no input: Eva
never asks it anything, and an ask that arrived anyway is answered rather than
left waiting. `streaming: true`, because SSE carries the live tail.

`eva serve --web` starts this row **by id**. It is not the first interactive
surface, which is what `eva` with no verb picks.

## What it does not do

- **It does not build the page.** The artifact is `apps/web`'s, and the asset
  root is a path the composition root injects.
- **It does not reach the Session API.** The page reaches Eva over the wire
  `eva.api` serves. The `Client` this row is handed is unused until W2, when
  the surface itself starts to ask.
- **It does not carry the page into the release binary.** The asset root
  resolves inside the workspace. Getting `apps/web/dist` beside a compiled
  binary is `scripts/release/build.ts`'s concern and it is the next thing.

## API

- `makeWeb(options)` — the plugin, id `eva.web`. It takes the asset root, the
  bind, and its writer from the composition root, because a plugin may not
  import an app and because a bind is a fact of one run.
- `WEB_SURFACE` — the surface id string, `"eva.web"`.
- `DEFAULT_HOST`, `DEFAULT_PORT`, `DEFAULT_POSTURE` — `127.0.0.1`, `7777`,
  `local`.
- `serveWeb(options)` — binds, serves, and returns the `Frontend` that holds
  until the Scope closes.
- `assetFor(root, url)` — the file a request is answered with, with the deep
  link falling back to the page and nothing above the root ever returned.
- `mediaType(path)`, `hasPage(root)`, `unbuilt(root)`, `urlOf(address)`.

## Development

Tests live beside the source. [src/assets.test.ts](src/assets.test.ts) holds
the path rules; [src/serve.test.ts](src/serve.test.ts) binds a real ephemeral
port and reads the page back over it, because a page a browser loads is not
proven by a test that never opens a socket. Run the suite from the repository
root:

```bash
bun run test
```
