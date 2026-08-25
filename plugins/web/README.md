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

A non-local `--host` is refused, and the refusal opens no port:

```
eva serve --web --host 0.0.0.0
  ← refused: a non-local bind needs a token, and tokens arrive at 9b
```

| Config key | Shape  | Default | What                                         |
| ---------- | ------ | ------- | -------------------------------------------- |
| `posture`  | `name` | `local` | `local` single-tenant, `hosted` multi-tenant |

The posture is read when the surface starts, and it changes no byte of what is
served: single-tenant and multi-tenant are the same `apps/web` build. What each
posture then permits arrives with the token at stage 9b.

## The bind

A local page binds to loopback. A remote page needs a token, and stage 9b is
what issues one — so until 9b exists a non-local bind is **refused** rather
than served unauthenticated. A refusal is a supported outcome and it names the
stage that changes it. It is never a warning printed above a served page: a
warning above a running server is an unauthenticated server with a note on it.

Local is loopback: `127.0.0.1`, the rest of 127.0.0.0/8, `::1`, `localhost`,
and the IPv4-mapped spelling of the same addresses. Everything else is remote,
`0.0.0.0` and `::` first of all — they are every interface the machine has. A
spelling `isLocal` does not know is refused, because a refusal that names its
reason costs a person one flag and a page served to a network costs more.

The posture does not open the door: `hosted` is a tenancy and not a token.

`refusal(host)` is a pure function, and `apps/cli` calls it before it boots —
`SurfaceInfo.start` has `never` in its error channel, so a refused bind cannot
come out of the row and still exit non-zero. `serveWeb` calls it too, before it
creates a server, so no path through this plugin serves a bind it refuses.

## The row

`eva.web` declares `interactive: false`, because the page takes no input: Eva
never asks it anything, and an ask that arrived anyway is answered rather than
left waiting. `streaming: true`, because SSE carries the live tail.

`eva serve --web` starts this row **by id**. It is not the first interactive
surface, which is what `eva` with no verb picks.

## What it does not do

- **It does not build the page.** The artifact is `apps/web`'s, and the asset
  root is a path the composition root injects.
- **It does not answer the Session API.** The page reaches Eva over the wire
  [`eva.api`](../api/README.md) serves, and this row only carries it: the
  `Client` the row is started with is what the wire answers from, and the
  surface itself starts to ask at W2.
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
- `refusal(host)` — why this bind is refused, or nothing when it is local. The
  app prints it and exits non-zero.
- `isLocal(host)` — whether a bind reaches this machine only.
- `serveWeb(options)` — binds, serves, and returns the `Frontend` that holds
  until the Scope closes. A refused bind creates no server. `options.api` is
  offered every request first, and before the built page is looked for: a call
  is answered from the record, and a build nobody ran says nothing about
  whether Eva can answer it.
- `Answering` — something that may answer a request before the assets do, and
  says whether it did. It is how one port carries the page and the calls the
  page makes.
- `assetFor(root, url)` — the file a request is answered with, with the deep
  link falling back to the page and nothing above the root ever returned.
- `mediaType(path)`, `hasPage(root)`, `unbuilt(root)`, `urlOf(address)`.

## Development

Tests live beside the source. [src/assets.test.ts](src/assets.test.ts) holds
the path rules; [src/bind.test.ts](src/bind.test.ts) holds what counts as
local, which needs no socket at all; [src/serve.test.ts](src/serve.test.ts)
binds a real ephemeral port and reads the page back over it, because a page a
browser loads is not proven by a test that never opens a socket — and it
proves a refused bind by connecting to the port it named and being refused. Run the suite from the repository
root:

```bash
bun run test
```
