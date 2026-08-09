---
status: accepted
---

# The transcript is a pane the console owns

The console draws on the alternate screen, and what a person has read so far is a scrolling pane inside its own view. It was the terminal's scrollback: each finished turn was handed to `tea.Println`, which puts a block above the program's view and then forgets it.

This supersedes the placement ADR 0015 chose. It supersedes none of 0015's reasoning about *what may be kept*, which is the part that matters and which is unchanged.

## What 0015 actually decided

Two things, and only one of them is about the screen.

The first is that a live area shows a turn while it happens, and is erased when the Run closes. The second is that what replaces it comes from the Renderer's fold over committed records. Together they give the sentence the whole design turns on: **nothing a person keeps came from anywhere but the record.**

That holds here exactly as it held before. `refresh` builds what the pane shows by concatenating two things it stores separately — the transcript, which only the Renderer writes to, and the arriving text, which is dropped the moment the Run closes. A process killed mid-block still leaves nothing behind that says the block arrived.

0015's falsifier names the change that would break it: a feature that *keeps* arriving text. A pane is not that feature. The chunks live for the length of the Run and are concatenated at draw time, never stored with what is kept.

## Why the scrollback had to go

Three things a person wants are impossible above the view, and all three are the same shortcoming: a block handed to the terminal is a block the program can no longer reach.

**Re-wrapping.** A markdown renderer wraps at the width it was built with. Narrow the window and every answer already printed overflows it; widen it and they stay in a column. The frontend cannot fix what it has already given away.

**Scrolling under the program's control.** The terminal scrolls its own buffer, so the program does not know where in the transcript a person is, cannot say so, and cannot offer to take them back to the end. A person scrolled up during a streaming answer sees a frozen screen with nothing on it to distinguish that from a hang.

**`/clear`.** Below.

## What this changes in ADR 0019

0019's consequences say: "**`/clear` does not clear the screen.** The transcript is the Session, and what is above the view is the terminal's scrollback. A person can still read what they said; the model cannot."

That was a consequence of where the transcript was, not of what a Session is. The pane is the console's, so `/clear` empties it, and a command that visibly does nothing stops being a command a person has to take on trust.

0019's decision is untouched. `/clear` still swaps the Session rather than deleting its messages, the cumulative spend still restarts because it names a Session, and — the clause that must survive verbatim — **the Trace still grows with what was cleared. Nothing is deleted, and nothing has to be.** Emptying a pane is not destroying evidence; it is closing a window on evidence that is still on disk.

## What it costs

Two, named here rather than discovered:

**Terminal-native scrollback.** On the alternate screen the terminal's own buffer is not there. What a person can scroll is what this program holds, which is this Session — so scrollback no longer reaches back past `eva` starting, and after `/clear` it no longer reaches past that either. The Trace does, and it is the thing that was always meant to.

**Terminal-native selection.** Cell-motion mouse reporting takes drag-select from the terminal. Most terminals return it under a modifier — shift-drag in the common ones — but it is no longer the unmodified gesture it was.

A third was paid already and is worth naming beside them: a screen drawn in place cannot be read off its own bytes. Cursor moves and overwrites mean the output stream with its escapes stripped is the fragments of a transcript in the order the cursor visited them, not the transcript. `Console.Screen` is what a driver reads instead, and it is the same string the pane was given.

## Why not the alternatives

**Stay above the view and re-print the transcript on resize.** The blocks are gone; re-printing means holding them anyway, which is the pane's cost with none of the pane's benefit, and it would push a screen of already-read text into scrollback on every resize.

**A pane, but on the main screen rather than the alternate one.** Keeps the terminal's scrollback, and makes the program fight it: every redraw of a pane that shares a buffer with the scrollback either scribbles over history or scrolls it. The alternate screen exists for programs that own the whole window, and this is one.

**Keep the scrollback and accept the three shortcomings.** The honest option, and it was the one in force. It loses on `/clear` alone: a command whose whole job is to empty a transcript, that leaves the transcript on screen, is a command that has to be explained every time it is used.

## Consequences

**The console holds a copy of what it has drawn.** 0015 argued against exactly this — "a frontend that held the transcript itself would be a second copy of what the Trace already holds, and the two would disagree the first time a turn failed halfway." The disagreement it feared is a disagreement about *content*, and it is prevented by where the content comes from: the transcript is written only by the Renderer's `Show`, by a prompt being echoed, and by a command answering. None of the three can invent a turn. A pane that redraws bytes the record produced is a projection, not a second account.

**The pane is bounded by the process.** It holds one Session's turns in memory for as long as the process lives. That is the same order of bytes the terminal was holding in its own buffer a moment ago, and it is small next to the Trace.

**Falsifier:** this holds while the pane's content has exactly three writers and each of them is downstream of a commit or of a person's own keystroke. The first writer that puts something else there — a provider's raw stream, a speculative answer, a summary the console composed — makes the pane a second account, and at that point either the writer goes or the pane does.
