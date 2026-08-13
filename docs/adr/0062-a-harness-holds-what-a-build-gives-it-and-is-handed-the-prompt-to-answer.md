---
status: accepted
---

# A harness holds what a build gives it, and is handed the prompt to answer

`eva.Loop` holds the Provider, the provider's name, and the base system prompt — what
every turn of this build is answered with. The prompt to answer and the Run to answer it
in arrive together, as a `harness.Prompt`. There is no second struct with the same fields
in it, and no `core.Unit` interface beside `harness.Harness` saying the same thing twice.

## Two structs, five shared fields, and the comments copied with them

The struct at the seam carried the Run, the transcript, the model, the interrupt claim,
and who is watching. `eva.Loop` carried all five again as fields, and `eva.Harness.Answer`
was twelve lines copying one into the other.

The doc comments were copied too. The sentence explaining why the interrupt claim is told
rather than worked out appeared three times. So did the sentence explaining that a second
copy of the provider's name is a copy that could disagree — three copies of a comment
about not making copies.

## This does not reopen ADR 0040

ADR 0040 says what a Unit works with are fields it is built with, not a runtime handed to
it per call. That still holds, and this is what makes it hold: the Provider and the system
prompt are fields of the thing the registry built, and they are the only fields.

A Prompt is not a runtime. It is one prompt and the Run that is open to answer it in — the
shape ADR 0045 established at the seam, arriving whole instead of being taken apart and
reassembled one layer down. The old arrangement built a fresh `Loop` per turn *because*
those fields were per-turn, which is the tell: a field that is rewritten every call was
an argument.

## The shape is a Prompt, because Turn is taken

It was first written as `harness.Turn`, which is the one word `CONTEXT.md` will not lend
it. A turn is one exchange with a Provider, and ADR 0037 retired the prompt-to-answer
reading of it: that arc is a Run. A struct named `Turn` that carries a Run, a transcript,
and a model is the retired reading back in Go, in the most load-bearing place there is —
the signature of the layer's one public contract. Naming it after the arc also says the
wrong thing about its future: one Prompt holds as many turns as there are tools to call
between them, so a `Turn` carrying the whole Run would have been wrong by construction the
day tool calls land.

`Prompt` is the word already in use for what a person asks Eva, and `Harness.Answer` reads
as what it does: it answers a Prompt. The base system prompt is a different noun — it
conditions every turn and is nobody's ask — and `CONTEXT.md` says so in both entries.

## `core.Unit` goes

One implementation, no consumers: nothing in the repository accepted a `core.Unit`. What
answers a prompt is a Harness, and its contract says the same thing with the Run beside
the Spec. A Unit is still the domain's word for anything that takes a Spec and returns an
Outcome, at any timescale — `CONTEXT.md` keeps it. What goes is the second Go interface
for the concept, because one concept gets one name.

## Considered options

- **Keep both and copy the fields.** Rejected. The copy is where the two shapes drift,
  and a field added to one is a field silently missing from the other.
- **Give the struct only the intent and keep the rest as fields.** Rejected. It is the
  arrangement that was there, and per-turn state on a per-build object is what forced a
  fresh Loop per turn.
- **Keep `core.Unit` and have `harness.Harness` embed it.** Rejected. Two interfaces
  where one is unimplemented by anything but the other is the same problem with an
  inheritance edge added to it.
- **Keep the name `Turn` and let `CONTEXT.md` admit a second, narrower sense.** Rejected.
  The rule that takes `core.Unit` out is that one concept gets one name; spending it on an
  interface and then suspending it one section later for a struct is not a glossary. The
  cheaper fix is the name, and `Prompt` was free.
- **`RunRequest`, or `Ask`.** Rejected. `Request` is a word this codebase does not use and
  would collide with a Provider's own; `Ask` is already on the `Question` entry's avoid
  list.

## Consequences

**A second Harness has one shape to read.** What it is built with is its own; the prompt
and the Run to answer it in are a `Prompt`, stated once, where the contract is.

**`eva.Harness` is gone as a name, and `Loop` is what registers.** The registry entry and
the Unit that answers a prompt are the same object, which is what CONTEXT.md always said
a Loop was.

**`CONTEXT.md` gains `Prompt`.** A shape that crosses the layer's one public seam is a term
of the domain, so it is defined where the others are, and the `Turn` entry stands unamended
with its retirement intact.
