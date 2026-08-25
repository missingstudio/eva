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

| Method      | Route                         | What                                     |
| ----------- | ----------------------------- | ---------------------------------------- |
| `list`      | `GET /api/sessions`           | every Session, each with its Header      |
| `attach`    | `GET /api/sessions/:id`       | that Session's record, as events         |
| `watch`     | `GET /api/sessions/:id/watch` | what commits after a Cursor, as a stream |
| `model.get` | `GET /api/sessions/:id/model` | the model that Session is kept at        |

What travels is the contract's own shapes, with no envelope around them and no
rendering in them. A path under `/api` that no route carries is answered 404
here rather than left to fall through, because the page's own server answers an
unknown path with the page — and a call answered with HTML reads as a broken
parse instead of as a miss.

Those four are the whole read half. `submit`, `cancel`, `answer` and
`model.set` are stage 2's, against the permission gate that stage builds
anyway. `create` is in neither half: a page that takes no input opens no
Session.

## `attach` sends the record, not a fold of it

A Transcript is three closures and a Cursor, so a Transcript is not what
travels. What travels is the Trace the Transcript folded — this Session's own
events, through the codec `packages/schema` already carries in both directions
— and the far side folds it again with `foldTranscript`.

That is not a convenience. A projection sent instead would be the only answer
a page had, so a wrong one would read as the truth; a page that folds the
record can be held against the same events by anybody reading the wire. It is
also why no Cursor is sent: the fold on the far side ends where this one does,
because it read the same events.

The far side holds no Catalog, so its fold prices nothing. A page shows the
cost a Provider reported, and never an estimate worked out from no rates.

## `watch` is one way, so it is SSE

`watch` is the one method that answers frames rather than a body, and SSE
already has a name for "the last position I saw" — so the Cursor travels as
`Last-Event-ID`, which is the Cursor with a standard name. The Session is in
the path, so the header carries the position and nothing else.

```
GET /api/sessions/ses_019a/watch
Last-Event-ID: 12

id: 13
data: {"version":1,"kind":"text","payload":{"block":0,"content":{"type":"text","text":"a "}}}

id: 14
data: {"version":1,"kind":"text","payload":{"block":0,"content":{"type":"text","text":"word"}}}
```

A payload travels with no Event over it, because that is what `watch` hands
back: the sink numbers an Event, and a live delta has no number to carry. The
codec is still `packages/schema`'s, one layer in — the same body table, so a
kind either half can read is a kind both halves can read, and a kind this side
does not know arrives as `unknown` and the stream carries on.

**Where the position comes from, and where it is absent.** With a Cursor the
contract guarantees the committed payloads after it, in trace order, exactly
once — so the nth frame sits at `from.seq + n`, and that is exact rather than a
guess. With no Cursor there is nothing to count from: that form carries the
live stream, which is payloads the sink has not numbered, and its frames carry
**no `id:` at all**. It reads like an off-by-one until you see why — a frame
with an invented position is a position a page would resume from, and it would
resume past events it never saw.

**A refused Cursor is a status, before the stream opens.** `watch` with a
Cursor further behind than the replay bound is answered `409 Conflict` with the
Cursor asked for and the head it was measured against, and the far side rebuilds
`ResumeTooFarBehind` from it. It is never a frame inside a stream: the refusal
is decided with nothing said yet, and a stream that had already said `200`
could not take it back.

The response closing is what stops a stream. An open stream nobody is reading
is a `node:http` server that never closes, so the reader going interrupts the
drain — a `server.close()` that had to wait for a stream would be a hang.

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
- `watchFor(method, path, from)` — the same, for the one method that answers a
  stream. It is matched first, because a `Route` answers a body.
- `API_PLUGIN`, `API_ROOT`, `SESSIONS`, `sessionPath(session)`,
  `modelPath(session)`, `watchPath(session)` — the id and the paths, rooted so
  no address is built into the page.
- `headerIn`, `headersIn`, `modelIn`, `eventsIn` — what a body has to be to be
  an answer. `eventsOut` is the record on its way out.
- `CURSOR`, `cursorIn(value)`, `Frame`, `frameOut(frame)`, `framesIn(text)`,
  `payloadIn(frame)`, `refusalOut(refused)`, `refusalIn(from, body)` — the
  stream's own shapes, read by both halves for the reason the paths are.
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
