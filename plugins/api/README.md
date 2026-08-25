# @missingstudio/eva-api

The Session API of [Eva](../../README.md), over HTTP. A browser cannot call an
Effect interface in another process, so the page brings a wire — and the wire
is a second filler of the seam `packages/client-runtime` holds, not a second
way of reaching Eva. The same methods `eva.tui` calls in this process are the
methods a page calls across a socket.

Eva is built on a plugin kernel: every capability is a plugin. The glossary in
[docs/context.md](../../docs/context.md) defines **Session**, **Surface** and
**Transcript**, and `packages/core` holds the `SessionAPI` this answers.

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The public API returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-api": "workspace:*" } }
```

## Usage

`eva serve --web` binds one port. [`eva.web`](../web/README.md) serves the page
on it and `eva.api` answers the calls the page makes:

```bash
bun run build            # fill apps/web/dist
bun run eva serve --web  # bind, print the address, and hold
```

```bash
curl http://127.0.0.1:7777/api/sessions
[{"id":"ses_019a","title":"read the trace back over HTTP"}]
```

| Method      | Route                         | What                                |
| ----------- | ----------------------------- | ----------------------------------- |
| `list`      | `GET /api/sessions`           | every Session, each with its Header |
| `model.get` | `GET /api/sessions/:id/model` | the model that Session is kept at   |

What travels is the contract's own shapes, with no envelope around them and no
rendering in them. A path under `/api` that no route carries is answered 404
here rather than left to fall through, because the page's own server answers an
unknown path with the page — and a call answered with HTML reads as a broken
parse instead of as a miss.

`attach` and `watch` arrive with the page code that calls them, and `submit`,
`cancel`, `answer` and `model.set` are stage 2's, against the permission gate
that stage builds anyway. `create` is in neither half: a page that takes no
input opens no Session.

## The two entry points

This is the one package in the repository with a second export path, and the
reason is the browser:

```ts
import { apiWire } from "@missingstudio/eva-api" // the routes: node:http
import { httpTransport } from "@missingstudio/eva-api/client" // the page's half
```

Nothing reachable from `./client` imports a `node:` module, so a page bundling
the Transport does not pull a server into its build. Both halves read the paths
and the shapes from the same module, because two halves of one wire have to
agree and a copy of an agreement keeps passing after the agreement moves.

The `pack` script names both entries, because a build emits the one it is given
and `./client` would otherwise resolve to a file nobody wrote.

## One port, two plugins

`eva.api` may not import `eva.web` and `eva.web` may not import `eva.api` — a
plugin imports the contract packages only. So they meet in the composition
root, exactly as the terminal and its renderer do: `eva.api` hands over its
routes when it loads, and `eva.web` asks for them with the `Client` its surface
row is started with. One origin, and no CORS.

A build that does not carry `eva.api` hands over nothing. The page is served,
its calls are answered by nobody, and the Transport reads that as a pipe that
is down — a degradation, and not a crash.

## The Transport

`httpTransport` fills `Transport`: the whole `SessionAPI`, and `health`, which
is the one fact `client-runtime` reads about the pipe. A call that cannot reach
the far side waits and asks again, so **a call made while the pipe is down is
slower, never differently typed** — the rule `droppableTransport` states, kept
by the filler that really has a pipe. `SessionAPI` has no error channel and
this keeps it that way.

A method the read half has not reached is a defect where it is called. A wire
that hung instead would be a page that waits on a stream nobody opened.

## API

- `makeApi({ serve })` — the plugin, id `eva.api`. It registers no row: a wire
  is not a Domain, and the plugin id is what a person turns off.
- `apiWire(api)` — the request handler, answering from any filler of the
  Session API. It says whether it answered, so the server that owns the socket
  can serve the page with what falls past it.
- `routeFor(method, path)` — the route table, as a pure function.
- `API_PLUGIN`, `API_ROOT`, `SESSIONS`, `modelPath(session)` — the id and the
  paths, rooted so no address is built into the page.
- `headerIn`, `headersIn`, `modelIn` — what a body has to be to be an answer.
- `httpTransport(options)` — from `@missingstudio/eva-api/client`.

## Development

Tests live beside the source. [src/routes.test.ts](src/routes.test.ts) binds a
real ephemeral port and reads the routes back over it, because a wire a browser
calls is not proven by a test that never opens a socket;
[src/client/transport.test.ts](src/client/transport.test.ts) holds the health
rule. `packages/conformance` runs the whole Session API contract against this
wire, standing it up behind `eva.web`'s own server. Run the suite from the
repository root:

```bash
bun run test
```
