# @missingstudio/eva-web-app

The Session page for [Eva](../../README.md): a browser reads one Session
live, and says something to it. It is one artifact, and
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

At W2 it prompts. The composer sends a line, queues one typed while a Run is
open, steers the Run that is going, and stops what is open — through the same
one Client, while `follow` goes on drawing. Steer is the page's half of the
gesture ctrl+s makes at the terminal: it is offered beside the stop while a
Run is open, because steering rides a Run and there is nothing to ride before
one starts. The rules are not this page's: `packages/client-runtime`
holds the composer fold the terminal steps, so a line typed at either door
means one thing. Send is off while the pipe is down, and the reason is drawn
beside it — a send that spooled behind a dead pipe and said nothing would read
as a Run that started.

Beside it is a command line — `/mode`, `/undo` and every other row, run where
the Domains live rather than where the page is. It is the one write here that
is not a Session API call: the contract has no command method, so it rides
beside the Client on the same transport rather than through it.

The page also switches the model this Session is kept at. The model is chosen
from what the Catalog knows and never typed: `GET /api/models` answers the rows
`/model` picks from in a terminal, so the two doors offer one list.

What the page puts into Eva is small and counted all the same — a line, a
steer, a stop, an answer to a permission request that stands, a command, and a
model.

## What a Session page draws

Reading is progressive. The page says which Session it is from the id it was
asked for, so a long Session is named at once; the title joins it when the
listing answers, and the transcript when the record does.

`attach` sends the record — this Session's own events — and the fold happens
here. [`packages/session-view`](../../packages/session-view/README.md) is the
one fold that decides what a Run did, so the terminal and the page cannot
disagree about it, and every Block it gives back is drawn:

| Block       | What the page draws                                   | Component                             |
| ----------- | ----------------------------------------------------- | ------------------------------------- |
| `words`     | the text, as markdown                                 | `Message` · `MessageResponse`         |
| `reasoning` | the same, set apart, behind a disclosure              | `Reasoning`                           |
| `tool`      | a card: the name, the tool kind, the Tool Status      | `Tool` · `ToolHeader` · `ToolContent` |
| `result`    | the same card, with the Disposition beside the Status | the same                              |
| `diff`      | the path, and how many hunks changed in it            | `CommitFile`                          |
| `image`     | the image, from the bytes the record holds            | `Image`                               |
| `unknown`   | what it was, and that this page could not draw it     | none fits                             |
| the cost    | the spend, and the tokens a Provider reported         | `Context`                             |

A Run says markdown — tables, links, fenced code — so the page renders it. A
page that drew the source would be showing a reader the pipe rather than the
answer.

A Session's title is the intent a Run opened on until an `info` gives a better
one, and an intent is a whole prompt. `headerFold` is right to hold all of it;
a heading is the wrong place to draw all of it. So `src/title.ts` shapes one
line for the heading and for the listing row, and the record's own text stays
on the element behind it.

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

## The components, and where they came from

`src/components/ai-elements` and `src/components/ui` are vendored, from
[AI Elements](https://www.npmjs.com/package/ai-elements) and the shadcn/ui
components it builds on. They are code in this repository, not a dependency,
which is the point of that registry: a component can be retyped against the
model the codebase already has.

Each one has been. They ship typed against the Vercel AI SDK's `UIMessage` and
`ToolUIPart`, and **Eva must not gain a second data model** — nothing in
`apps/web` imports `ai` or `@ai-sdk/*`. So each file names Eva's own types, and
the parts of it that draw something Eva's record does not hold are deleted
rather than left to draw from nothing. The header of each file says what
changed, so a later `add` can be read against it.

Two rules hold for these files, and only for these files.

- **They keep their upstream form.** `//` for a line and `/** */` for a block
  is the rule everywhere else in this repository; here the shape upstream wrote
  is what makes a re-sync readable, so it stays.
- **Every disclosure takes its id from the Block's key.** Radix generates one
  from where a component sits in the tree, so the same Block would draw one way
  alone and another way inside a Turn — and
  [packages/conformance](../../packages/conformance) holds exactly those two
  drawings against each other.

To take a new one, or a newer version of one of these:

```bash
cd apps/web && bunx --bun ai-elements@latest add <name>
```

The CLI assumes Next.js. Expect to move what it writes out of a literal `@/`
directory, and to rewrite its `@/…` imports to relative ones: a package that
imports this page compiles these files under its own tsconfig, where `@/` means
nothing.

## The design system

`packages/ui` is Eva's design system — a measured dark-only palette, two
self-hosted faces (a sans for prose, a mono for machine output), a motion
table, and one focus treatment.
`src/styles.css` imports it whole:

```css
@import "@missingstudio/ui/tokens.css";
```

One distinction in it is worth naming, because it is easy to flatten. The
tokens split the hairline between two static surfaces from the boundary that
says "this is a control": WCAG SC 1.4.11 asks 3:1 of the second and nothing of
the first, and the two are measured separately. shadcn/ui spends one `--border`
on both. `src/shadcn.css` keeps them apart — `--color-border` is the graphite
hairline and `--color-input` is the ash control boundary — so a card draws
`border-graphite` and a disclosure draws `border-input`.

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
| `src/composer.tsx`  | what to say next: the line, the send, the stop, the queue    |
| `src/models.tsx`    | the model picker: the Catalog's rows, and the one chosen     |
| `src/title.ts`      | what to call a Session, in one line                          |
| `src/eva.ts`        | the one Client, over the same-origin wire                    |
| `src/sessions.ts`   | what the page reads: the Sessions, or not yet                |
| `src/transcript.ts` | what it reads of one Session: the Header, the fold, the tail |
| `src/build.ts`      | the version and the stamp, injected by the build             |
| `src/index.ts`      | the drawing half, for `packages/conformance`                 |
| `src/components/`   | the vendored components — see below                          |
| `src/lib/utils.ts`  | `cn`, which every vendored component calls                   |
| `src/styles.css`    | the entry: Tailwind, the tokens, the bridge                  |
| `src/shadcn.css`    | shadcn/ui's semantic names, pointed at Eva's                 |
| `components.json`   | where the shadcn CLI writes, for the next `add`              |

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
tail after it, the cost line and what the page offers,
[src/composer.test.tsx](src/composer.test.tsx) the queue, the cancel that
drops it and the send a dead pipe refuses,
[src/models.test.tsx](src/models.test.tsx) the picker and the rows it shares
with the terminal's panel,
[src/transcript.test.ts](src/transcript.test.ts) the follow itself — the fold,
the tail, and the fold that replaces it —
[src/command.test.tsx](src/command.test.tsx) the command line and what it
says when it reaches nothing, [src/title.test.ts](src/title.test.ts) the
shaping of a title, and
[src/fold.test.ts](src/fold.test.ts) the count of folds. Run the suite from the
repository root:

```bash
bun run test
```
