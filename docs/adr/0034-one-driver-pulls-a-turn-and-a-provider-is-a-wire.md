---
status: accepted
---

# One driver pulls a turn, and a Provider is a wire

`internal/providers` owns the state machine every turn runs through: the queue a caller pulls from, the retry that is a record before it is a wait, the books that close once, and the caveat a turn nobody priced carries. A Provider supplies the part that is actually its own — how to make one attempt, how to read one frame, how to let go — behind `Wire`.

## What the second Provider proved

The Anthropic Provider's `stream.go` and the OpenAI Provider's were two hundred lines the same. A `diff` of `Next` and `Close` returned three hunks and all three were field renames. The drain-the-queue loop, the `fatal → done → dial → pump` switch, the retry preamble, the `classify → Wait → queue a Retry` block, the struct fields, the `spend` accumulator, and the sentence inside the "nobody priced this" caveat were duplicated character for character.

That was not an accident. The plan for the OpenAI Provider said, in as many words, *build the same queue and state machine as `internal/providers/anthropic/stream.go`* — and the third Provider would have been told the same thing.

One adapter is a hypothetical seam. Two is a real one, and the second one arrived.

## Where the seam is

`Wire` is three methods, and each is the part a vendor genuinely owns:

- **`Dial`** makes exactly one attempt and returns a `Refusal` or nil. Nothing retries inside it. One call is one attempt, which is what lets the attempt that failed reach the Trace before the wait that follows it (ADR-0012).
- **`Pump`** advances a connected attempt by one frame and says what that frame said. A frame that means nothing to the Trace tells the Driver nothing and the Driver calls again.
- **`Close`** releases whatever `Dial` opened.

What is left on either side of that line is worth stating, because it is the whole argument. Provider-specific: the SDK call against the hand-rolled POST, a typed error document against a status line, two frame vocabularies, and which wire field is which counter. Generic: the queue, the EOF-and-fatal ordering, the retry arithmetic and its record, usage-emitted-once, absence-is-not-zero, and the Degraded a silent turn closes with.

`Refusal` carries four things because the Driver needs four: what to fail with, the class for the Retry record, whether another attempt could go differently, and the delay the server asked for. Recoverability is the Wire's to say and how many attempts remain is the Driver's — a Wire that could see the policy would be a Wire that could decide to stop.

## The books moved with it

`Spend` is the other half. Both Providers had rebuilt the same three rules beside the schema that already stated them: a figure the API did not state stays absent, a restated figure overwrites rather than adds, and a negative count reads as none. `internal/events/payload.go` had already recorded this happening once — *"One provider rebuilt the distinction beside the schema and the next one to arrive would have had to know to"* — and it happened again anyway, because the schema made the counters nullable but left the emit-or-degrade decision in each Provider.

It is one decision, so it is in one place. A Wire says `s.Input(n, stated)` and nothing else; whether that becomes a `Usage` or a caveat is not its business.

## Consequences

**A third Provider writes a wire.** Roughly forty lines of dialling and frame-reading, plus a `classify`. It gets retry semantics, usage normalization, cancellation, and terminal-state discipline by satisfying an interface.

**The `Driver` is exported and so are `Say`, `Complete`, and `Break`.** They are only meaningful to a `Wire`, and Go has no way to say so. The alternative was a second object between the Wire and the caller, which would only have been a place for the two to disagree about one turn.

**One behaviour changed.** A refusal is now checked against `ctx.Err()` before it is classified, on every path. The OpenAI Provider used to skip that check when the credential could not be resolved, so a turn that was cancelled *and* had a broken credential reported the credential. It now reports the cancellation, which is what happened first and what a person did.

**Falsifier:** if a Provider ever needs to interleave attempts, hold two connections, or produce payloads from something other than a frame-at-a-time pull — a batch API, a websocket that pushes — then `Wire` is the wrong shape for it and it should implement `Stream` directly rather than bending the Driver. The interface is still open; this is a shape offered to the Providers it fits, not a gate.
