# Implementation Plans

Written by the improve skill on 2026-08-16 against commit `458aed1`, for an
audit of `packages/tui`, `packages/tui-core` and `plugins/tui`.

**These were executed in the same session, at the operator's instruction,
rather than handed to an executor.** The per-plan files are gone; this index
and the entries added to `docs/decisions.md` are the record. Every row below
is DONE and verified — see "What landed" for the shape of each fix, which
differs from what was planned in one important way.

## Execution order & status

| Plan | Title                                                     | Priority | Effort | Depends on | Status |
| ---- | --------------------------------------------------------- | -------- | ------ | ---------- | ------ |
| 001  | The rich renderer is drawn in a check, and CI proves it   | P1       | M      | —          | DONE   |
| 002  | A pasted block arrives whole, on either renderer          | P1       | M      | 001        | DONE   |
| 003  | A piped run writes every line of the conversation, once   | P1       | S      | —          | DONE   |
| 004  | A Run is over when `submit` returns                       | P2       | S      | —          | DONE   |
| 005  | A screen is written over rather than erased first         | P2       | M      | 001        | DONE   |
| 006  | Enter on a palette row runs it, as the panel says it does | P1       | S      | —          | DONE   |

## What landed

**001 — the rich renderer is checked.** Plan 001 assumed the render suite
could be a vitest file. It cannot: vitest workers here run under **Node
22.23.2**, and OpenTUI's renderer needs Bun's FFI, so `testRender` fails with
"OpenTUI native FFI is not available for this runtime yet". The plan's named
fallback was taken, and improved on: `packages/tui/src/render-check.tsx` is a
type-checked Bun script that draws 11 screens through the real `App` and
asserts on `captureCharFrame()`. CI runs it in the `opentui-renderer` job in
place of the old `bun -e` blob.

The old gate proved only that `createCliRenderer()` resolved. It passed a
Frame missing `banner`, `notes`, `cursor`, `took` and `work`, was never
type-checked, and exited before React rendered. Given 1.5s it threw
`TypeError: undefined is not an object (evaluating 'frame.banner.version')`.

The new gate found a real defect on its first run: `Working` in `app.tsx`
never rendered `work.hint`, so the rich renderer never showed "esc again to
interrupt" while the stream renderer did — against the `Frame` contract's
"every renderer says the same words". Fixed.

**002 — paste.** `Renderer` gained `onPaste` beside `onKey` and `onEnd`. The
rich renderer reads OpenTUI's `usePaste` and decodes with `decodePasteBytes`;
the stream renderer asks the terminal for bracketed paste (`CSI ?2004h`) and
reads the `paste-start`/`paste-end` markers Node's readline already names,
giving it back on `stop`. `pasted()` in `plugins/tui/src/line.ts` inserts the
block at the caret, counting code points and normalizing `\r\n` and `\r`.
A paste never reaches the keymap, so a newline in one is text.

**003 — the piped conversation.** `append` in `stream.ts` now resets `shown`
when the fold gets shorter (the guard `told` already had) and, when a stream
ends, advances `shown` only past the turn the stream printed — so what the Run
took is written instead of being marked shown unwritten.

**004 — the Run's end.** `runPrompt` no longer waits on its watcher for the
close. The watcher subscribes after it is forked, so a Run closing in the same
turn was a close it never heard, and it then waited forever. Verified: with the
fake's one-turn delay removed, the old code left `work.running` true
indefinitely. `submit` is now what says the Run is over; the watcher gets a
bounded drain (`SETTLE`, injectable as `SurfaceDeps.settle`) and is then
stopped.

**005 — the repaint.** The screen path wrote `CSI 2J` plus the whole frame on
every draw — a frame per streamed word, ten a second during a Run — blanking
the screen between frames. It now homes the cursor, writes each row clearing
the tail, and erases below; an identical frame writes nothing.

**006 — the palette runs what it says it runs.** Reported from use: selecting
`/theme` from the palette did not open the theme picker; the person had to
type `/theme` again. `take` refused to run any command with an
`argumentHint`, so it typed `/theme ` onto the line instead. The panel's own
hint reads `enter run · tab complete`, and the two commands that name an
argument — `/theme` and `/model` — are exactly the two that answer a bare
line with a choice of their own. Enter now runs, tab still completes.
`argumentHint` says what an argument would look like, never that one is
needed, and running with none is not inventing one.

## Verification

All of the following pass on the working tree:

```
bun run check     # 172 files clean
bun run test      # 62 files, 950 tests
bun run pack
bun packages/tui/src/render-check.tsx
printf '/help\n' | node apps/cli/bin/eva.mjs
```

Four entries were added to `docs/decisions.md`: the paste contract, the Run's
end, the repaint, and what enter on a panel row means.

## Deliberately not done

- **Draw coalescing.** `on()` in `surface.ts` still draws on every Console
  event, and the rich renderer still re-renders the whole React tree per
  streamed payload with no `memo`. The repaint fix removes the visible flicker
  and the redundant writes; a timer-based coalescer would need a trailing
  flush and would churn every synchronous-draw test. The measured pure cost is
  low — 0.051 ms per projection at 400 turns — so what remains is reconcile
  cost, unmeasured.
- **`input.newline` is bound to `shift+enter`** (`plugins/keymap/src/index.ts:10`),
  which most terminals cannot send without the kitty keyboard protocol. After
  the paste fix a person can reach a multi-row buffer by pasting but still
  cannot type one. That is a keymap decision for a maintainer.
- **A hostile checkout's `.git` file** can point `banner.ts` at an arbitrary
  path, whose `HEAD` is read and one line shown in the banner. The config
  trust gate is the real boundary here; noted, not changed.

## Findings considered and rejected

- **`printable()` excludes code 32, so space looks unhandled.** Not a bug:
  both readline and OpenTUI name it `space`, and `line.ts:117` handles it.
  Verified against `@opentui/core@0.5.3`.
- **Several audit candidates were already settled in `docs/decisions.md`** —
  the OpenTUI FFI risk, a pipe drawing no chrome, `ask` being unreached, the
  quiet-pipe notice rule. Decided, not defects.

## A note for the next run

The working tree was dirty and moving while this work happened: a `draws`
capability landed on the `Renderer` contract mid-audit. Every finding was
re-verified against the tree as it stood before any edit. There is also a rare
pre-existing flake in the suite — one failure seen in ~15 full runs, including
once before any change was made, with a test name that did not exist in the
source. Worth watching; not introduced here.
