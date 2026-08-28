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

| Method      | Route                            | What                                     |
| ----------- | -------------------------------- | ---------------------------------------- |
| `list`      | `GET /api/sessions`              | every Session, each with its Header      |
| `attach`    | `GET /api/sessions/:id`          | that Session's record, as events         |
| `watch`     | `GET /api/sessions/:id/watch`    | what commits after a Cursor, as a stream |
| `model.get` | `GET /api/sessions/:id/model`    | the model that Session is kept at        |
| `create`    | `POST /api/sessions`             | opens a Session, and answers which       |
| `submit`    | `POST /api/sessions/:id`         | opens a Run in that Session              |
| `cancel`    | `POST /api/sessions/:id/cancel`  | stops the Run open in it                 |
| command     | `POST /api/sessions/:id/command` | runs a line where the Domains are        |
| `model.set` | `PUT /api/sessions/:id/model`    | keeps that Session at another model      |
| `answer`    | `PUT /api/requests/:id`          | answers what a Run asked a person        |

What travels is the contract's own shapes, with no envelope around them and no
rendering in them. A `SubmitInput` body _is_ the Prompt and a `CancelCause`
body _is_ the cause, so there is nothing to unwrap on either side, and a write
answers a status and nothing else. A path under `/api` that no route carries is
answered 404 here rather than left to fall through, because the page's own
server answers an unknown path with the page — and a call answered with HTML
reads as a broken parse instead of as a miss.

A `POST` opens or stops work and a `PUT` sets a value, so asking twice is what
tells the two apart. `answer` is the one call keyed by a `RequestID` rather
than by a Session, so it sits outside the listing: the id is the tool call's,
which the `tool_call` record named before anybody was asked.

The command route is the one that is not a `SessionAPI` method. A command
resolves through the rows a process holds and reaches the Domains beside them,
so a door that ran `/mode` for itself would change the approval state of its
own process and leave the Run under the mode it already had. The body is
`{"line"}` — the line whole, because `dispatch` owns what a line means and a
second parser would be one to keep in step. The answer is `{"wrote", "selected"?}`:
`CommandContext.write` collected as one block of text, and the Session the
command opened when it opened one. `pick` is absent, so a command that would
have asked lists its options instead — the contract already says a command
answers in words where a capability is missing, so no command needs work of its
own to cross this wire. Nothing here can fault: a line no row answers is
answered in words with the same status as one that ran.

`create` is the one write that answers a value, because a status alone would
not say which Session was opened. Its body is `{"location"?}` and the field is
optional: a browser holds no honest path, so a caller that names none is
answered with the directory the serving process is in. An absent body reads the
same way, and it has to — a body that is not JSON arrives as nothing, exactly
as no body at all does — so the one shape this route refuses is a `location`
that is there and is not a string.

## A write is asked twice and done once

A write carries a **client-minted key**, in an `Idempotency-Key` header. It
rides a header rather than a body for the reason the Cursor does: the body is
the contract's own shape, and a key inside it would be exactly the envelope
this wire refuses to add.

The key is what makes asking again safe. `SessionAPI` gives a write no error
channel, so a call that cannot reach the far side waits and asks again — and no
caller can tell "the request never left" from "the request landed and the
answer was lost". A `submit` asked again would open a second Run. So this side
keeps the write each path is answering under the key its caller named, and a
repeat of a key waits on the write it already made.

Two limits, stated rather than hidden. The table holds the **last** key per
path, because a caller retries the write it just made and never an older one;
two callers writing to one Session at once already collide inside the Recorder,
and this neither makes that worse nor pretends to fix it. And a write runs on a
fiber of its own rather than inside the request, so **a dropped connection
costs a repaint and not a Run** — the Run finishes, and the record is where its
outcome is.

A body the wire cannot read is refused `400` and nothing is applied: a shape
half understood would be a partly applied write, and nothing later would say
there had been one. On the browser side that refusal is a **defect** rather
than another ask, because a shape the two halves of one wire disagree about
would be refused again however often it is sent.

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

This wire carries all nine methods, so there is no method left that answers at
once with a defect saying it is not carried. The one defect it raises is a
write the far side read and refused, because a shape the two halves disagree
about would be refused again however often it is sent.

## API

- `makeApi({ serve, directory })` — the plugin, id `eva.api`. It registers no
  row: a wire is not a Domain, and the plugin id is what a person turns off.
  `directory` is where a Session goes when the caller named nowhere, and it is
  the serving process's own when nobody hands one over. It reads its own
  `ctx.command.get` for the rows a line resolves through, because
  `PluginContext` extends `Domains` — so the wire reaches the commands without
  importing the plugins that register them.
- `apiWire(api, directory, commands)` — the request handler, answering from any
  filler of the Session API. It says whether it answered, so the server that
  owns the socket can serve the page with what falls past it.
- `routeFor(method, path, body, directory, commands)` — the route table, as a
  pure function. The body arrives as a third argument the way `watchFor` takes
  its Cursor, so a write route is still a description of an answer and never a
  write itself; the directory arrives as a fourth, because where the serving
  process is is a fact of that process and not of the request; the commands
  arrive as a fifth, as an Effect rather than a list, because the rows are read
  at the moment a line runs.
- `watchFor(method, path, from)` — the same, for the one method that answers a
  stream. It is matched first, because a `Route` answers a body.
- `API_PLUGIN`, `API_ROOT`, `SESSIONS`, `REQUESTS`, `sessionPath(session)`,
  `modelPath(session)`, `watchPath(session)`, `cancelPath(session)`,
  `commandPath(session)`, `answerPath(request)` — the id and the paths, rooted
  so no address is built into the page.
- `headerIn`, `headersIn`, `modelIn`, `sessionIn`, `eventsIn` — what a body has
  to be to be an answer. `eventsOut` is the record on its way out.
- `Ran`, `ranIn` — what running a line came to: the text it wrote, and the
  Session it opened when it opened one.
- `submitInputIn`, `cancelCauseIn`, `answerIn`, `locationIn`, `lineIn` — what a body has
  to be to be a write. `modelIn` reads both directions, because `model.set`
  sends back what `model.get` answers, and `locationIn` is the one that accepts
  an absent body: only a `location` that is there and is not a string refuses.
- `CURSOR`, `cursorIn(value)`, `IDEMPOTENCY`, `StreamFrame`, `frameOut(frame)`,
  `framesIn(text)`, `payloadIn(frame)`, `refusalOut(refused)`,
  `refusalIn(from, body)` — the headers and the stream's own shapes, read by
  both halves for the reason the paths are.
- `httpTransport(options)` — from `@missingstudio/eva-api/client`. It answers
  an `HttpTransport`: the seam's `Transport`, and `command(session, line)`
  beside it. A command is not a `SessionAPI` method and is not going to become
  one, so it rides beside the contract rather than inside it.

## Development

Tests live beside the source. [src/routes.test.ts](src/routes.test.ts) binds a
real ephemeral port and reads the routes back over it, because a wire a browser
calls is not proven by a test that never opens a socket;
[src/client/transport.test.ts](src/client/transport.test.ts) holds the health
rule and the write that lands once. `packages/conformance` runs the whole
Session API contract against this wire, standing it up behind `eva.web`'s own
server, and drives the write half from both doors — in this process and over
the socket — against one live kernel. Run the suite from the repository root:

```bash
bun run test
```
