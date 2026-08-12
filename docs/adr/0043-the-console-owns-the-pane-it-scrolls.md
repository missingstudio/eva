---
status: accepted
---

# The console owns the pane it scrolls

The transcript is drawn by a pane of Eva's own, over rows rather than over text. It is about 120 lines in `internal/tui/pane.go`, and it replaces a component of the terminal library Eva otherwise draws with.

A dependency dropped is a decision, not a preference, so the measurement that forced it comes first.

## What the measurement said

ADR 0023 put the transcript in a pane the console owns, and the pane was the library's viewport. It takes a string. So every frame handed it the whole conversation, and it did two things with it: split it into lines, and measure the display width of every one of them.

At a hundred kept blocks that cost 799 µs per frame, twelve times a second, for a screen where at most one block had changed.

The obvious repair was to hand it lines it did not have to split, which the library also supports. That measured 784 µs — a saving of 2%. **The splitting was not the cost.** The cost was `maxLineWidth`, an ANSI-aware width scan over every line of the transcript, run again on every call because the type keeps a longest-line figure and has no way to update one incrementally.

No arrangement of code on Eva's side changes that. It happens after the content crosses the boundary.

Composing those same rows from drawings Eva already had cost 4.3 µs. That is the gap this decision closes: the frame's own work was already 180 times cheaper than the charge for handing it over.

## What Eva was paying for

The console used fifteen members of the viewport, and turned two features off on the way in:

- `KeyMap` was set to the empty map, because the defaults bind `j`, `k`, `space`, `f`, `b`, `u`, and `d` — every one a character a person types into a prompt.
- `SoftWrap` was set to false, because a soft-wrapped pane cannot locate an offset without measuring every line above it.

Highlighting, gutters, horizontal scrolling, and the mouse-wheel-with-shift behaviour were unused. What was left in use was: hold rows, know where you are in them, move by a row or a screen, say how many there are, and draw the ones on screen.

That list is the whole of `pane`. It measures nothing it is not drawing, so a frame costs what the window shows and an hour-long conversation draws as fast as its first turn. Measured after: 71 µs, and flat — 20 blocks and 100 blocks cost the same.

## Why this is not a fork

A fork carries the other party's design and diverges from it. This carries none of it. The type takes rows because that is what the console composes, keeps no derived figure that could go stale, and has no feature the console does not use. It is a deep module by this repository's own test — a surface a reader can finish, with the frame's whole cost model behind it.

It is also the type that the console's existing comments already described. The reasons `SoftWrap` was false and `KeyMap` was empty were written down years before this; both are now properties of the pane rather than settings on someone else's.

## Consequences

**The transcript's rows are shared, not copied.** `SetContent` keeps the slice, and the console must not write to it after handing it over. Copying would reintroduce a per-frame copy of the conversation, which is the cost this exists to remove. The console builds a fresh slice per frame, so the two never alias a buffer being written.

**A row wider than the window is cut, and only when it is wider.** The transcript is wrapped before it reaches here, so the rows this happens to are the ones nothing wrapped — a long prompt echoed back, a working directory in the masthead. A row that fits is handed back untouched rather than re-rendered.

**Scrolling behaviour is now Eva's to keep right.** The falsifier is that every scrolling test in `console_test.go` passed against the replacement with no expectation edited: the keys, the wheel, the count of what is below, and the view being exactly the height of the window. A scrolling bug here is Eva's, which is the real price of this decision.

**A page keeps one row of overlap.** The library's page moved by the full height. Moving by height less one leaves a reader one line in common between two screens, which is how a person knows they skipped nothing.

**The library is still what draws everything else.** This replaces one component, not a dependency. The program, the prompt, the spinner, and every style still come from it, and nothing about this decision generalizes to them.

**Falsifier:** the width scan is fixed upstream, incrementally, and the viewport becomes proportional to the window too. Then this is about 120 lines Eva maintains for no measured gain, and the right answer is to delete it and go back. That outcome would be better for everyone, and it is not something a release can be planned around — which is why this landed rather than waiting.
