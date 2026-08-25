# @missingstudio/eva-web-app

The Session page for [Eva](../../README.md): a browser reads one Session
live, and writes nothing. It is one artifact, and
[`eva.web`](../../plugins/web/README.md) serves it without building it — the
posture, single-tenant or multi-tenant, is read when the surface starts.

At W1 the page lists the Sessions Eva holds, shows one Session's committed
transcript, and follows the Session that is open. It reaches all of it over
the wire
[`eva.api`](../../plugins/api/README.md) serves on the same port, through the
Client `packages/client-runtime` builds — and the count of Session API calls
that go around that Client is zero, which is a check that fails rather than a
habit. The glossary in [docs/context.md](../../docs/context.md) defines
**Session**, **Surface**, **Transcript** and **Block**.

The page takes no input of any kind: no prompt box, no permission answer, no
model switch. Those are W2's, and they wait for the permission gate.

## What a Session page draws

Reading is progressive. The page says which Session it is from the id it was
asked for, so a long Session is named at once; the title joins it when the
listing answers, and the transcript when the record does.

`attach` sends the record — this Session's own events — and the fold happens
here. [`packages/session-view`](../../packages/session-view/README.md) is the
one fold that decides what a Run did, so the terminal and the page cannot
disagree about it, and every Block it gives back is drawn:

| Block       | What the page draws                                   |
| ----------- | ----------------------------------------------------- |
| `words`     | the text, as it was said                              |
| `reasoning` | the same, set apart                                   |
| `tool`      | a card: the name, the tool kind, the Tool Status      |
| `result`    | the same card, with the Disposition beside the Status |
| `diff`      | the path, and how many hunks changed in it            |
| `image`     | the image, from the bytes the record holds            |
| `unknown`   | what it was, and that this page could not draw it     |

A Block the page cannot draw is drawn as one it could not draw. A Surface may
render less than another; it may never know more — so nothing is dropped, and
a reader never finds a hole where the record holds something.

The diff comes from the record's own fields, and the cost line from the
Transcript's own cost fold. Nothing on the page prices anything: this side of
the wire holds no Catalog, so what a reader sees is the cost a Provider
reported.

## The fold, and the tail behind it

Two calls carry the page. `attach` says where the record ends and `watch` from
that position says what commits after it, exactly once — so nothing that
commits between the two calls is missed, and nothing already folded arrives
twice. That is the whole of what a reload costs, and it is what a Cursor is
for.

The page holds them apart, as the terminal's `Frame` does: the Turns are the
fold, and the tail is what the open Run has streamed so far. The tail grows by
append while a Run is open and it is empty again exactly when the fold has
replaced it — a Run that closes is folded again, and a reader sees those words
once, in the tail and then as a Turn.

The tail carries words and nothing else. What is not text is not lost: it is in
the record already, and the fold that replaces the tail holds it as a Block.

Converging after a reload and after a drop is the next plan's. A refused Cursor
ends the follow here and leaves the fold on the screen, because this watch only
ever resumes from a fold it has just taken.

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

| Path                | What                                                         |
| ------------------- | ------------------------------------------------------------ |
| `src/main.tsx`      | mounts the router into `index.html`                          |
| `src/routes.tsx`    | the route tree, and where a read meets a drawing             |
| `src/paths.ts`      | the two spellings of one route, in one place                 |
| `src/page.tsx`      | the listing: the build, and the Sessions Eva holds           |
| `src/session.tsx`   | one Session: which it is, what was said, what it cost        |
| `src/blocks.tsx`    | one Block, in page primitives                                |
| `src/eva.ts`        | the one Client, over the same-origin wire                    |
| `src/sessions.ts`   | what the page reads: the Sessions, or not yet                |
| `src/transcript.ts` | what it reads of one Session: the Header, the fold, the tail |
| `src/build.ts`      | the version and the stamp, injected by the build             |
| `src/index.ts`      | the drawing half, for `packages/conformance`                 |
| `src/styles.css`    | plain local styling until `packages/brand` lands             |

Routes are code-based, so the build needs no route generator and no plugin
beside the toolchain the repository already has. The views take what they draw
as props, so the reads live in `routes.tsx` and `transcript.ts` — and what is
on the page is provable without a socket.

## The name

The marketing site on the `feat/website` branch holds this same directory,
and becomes `apps/www` when that branch lands. This package takes the `-app`
suffix so `plugins/web` keeps the plain `@missingstudio/eva-web`.

## Development

Tests live beside the sources and render the page to a string, because what a
browser gets is proven against a real socket in
[plugins/web](../../plugins/web/README.md) and the wire behind it is proven in
[packages/conformance](../../packages/conformance).
[src/page.test.tsx](src/page.test.tsx) holds the listing,
[src/blocks.test.tsx](src/blocks.test.tsx) the Block mapping,
[src/session.test.tsx](src/session.test.tsx) the Header before the fold, the
tail after it and the cost line,
[src/transcript.test.ts](src/transcript.test.ts) the follow itself — the fold,
the tail, and the fold that replaces it — and
[src/fold.test.ts](src/fold.test.ts) the count of folds. Run the suite from the
repository root:

```bash
bun run test
```
