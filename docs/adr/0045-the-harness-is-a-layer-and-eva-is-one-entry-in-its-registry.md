---
status: accepted
---

# The Harness is a layer, and Eva is one entry in its registry

`internal/harness` is a layer. It holds the `Harness` contract, the registry that
selects one, and the Assembly that opens a Run on a Session and commits what a Harness
emits. `internal/harness/eva` holds Eva's own implementation, which is where
`internal/loop` goes. `internal/cli` keeps the command line, the process, the exit
codes, and the wiring.

## What was in the wrong place

`internal/cli` held three jobs. It parsed a command line. It owned the process and the
signal. And it assembled a Session with a Provider, a sink, a model, and a set of
Subscribers.

The third is not a frontend's. It is Eva's own Harness, and it sat behind a flag
parser, where nothing but a command line could reach it. A server, a Worker, and a
daemon each need that assembly, and each would have rebuilt it. A second place that
knows how a Run is wired is a second place for the wiring to drift.

## Why the layer is one and not two

The ownership table in `docs/reference/architecture.md` says Eva never delegates the
Trace store or the Session, and the prompting loop. That reads like two
layers: one that holds the Recorder, and one that holds the loop.

It is one layer, because the target tree already puts `resume` and `branch` inside
`harness/`, and both act on a Session. A Harness that could not reach the Session it
resumes would be a Harness that cannot implement half of what the tree assigns it. So
the layer owns the Session lifecycle, and the directory under it owns one
implementation's loop.

## Selection is a registry, and it has one entry

`harness.Open` reads a registry. An implementation registers itself as it loads.
Configuration names the default, and the default is Eva.

There is one entry today, and that is the point. The alternative is a call to Eva's
loop by name, which is one line to write and a layer to rewrite when a second name
arrives. With the registry, a second Harness is a package that registers itself plus
one line of configuration, and the layer that wires a Run learns no implementation's
name.

The registry is also what produces the sentence naming what a person may select. That
sentence cannot go stale, because it is read from the map rather than written beside it.

## What this does not do

It builds no adapter. Rule 4 in `docs/explanation/the-ladder.md` forbids that before
stage 8, because the adapter interface is discovered rather than designed, and starting
pluralistic buys the union of everyone's failure modes.

Reserving the seam is not building on it. The contract's signature is already drafted in
`docs/reference/architecture.md` and is not re-derived here.

## Considered options

- **Leave the assembly in `cli` and add the contract alone.** Rejected. It leaves the
  frontend as the only thing that knows how a Run is wired, which is the drift a server
  and a daemon each pay for.
- **Two layers, splitting the Session Assembly from the Harness.** Rejected. The target
  tree assigns Session lifetime to `harness/`, and the split would invent a layer to
  solve what one directory solves.
- **Move `loop/` at stage 7 instead of now.** Rejected. Selection is a seam from commit
  one, and a thing that is selected has to sit inside the thing that selects it.

## Consequences

**`cli` narrows and does not widen.** Its allow list loses `providers` and `trace` when
this lands. The note in the target tree said to narrow it when the Harness arrives, and
this is that.

**`internal/loop` stops existing as a layer.** Its depguard rule moves with it, and the
glossary entry for `Loop` keeps its meaning: the Unit that answers a prompt, now inside
the Harness that owns it.

**The thing that opens a Run is an Assembly, not a Driver.** `Driver` is already fixed in
`CONTEXT.md` to one Provider's turn state machine, a layer below. Two types under one
word is the defect the glossary exists to prevent, so the glossary gains `Assembly`.

**What crosses the seam is a `Prompt`.** The contract hands a Harness the prompt to answer
and the Run that is open to answer it in. It is one struct, for the same reason `Assembly`
is not called `Driver`: `Turn` is fixed to one exchange with a Provider, and the shape here
spans a whole Run. ADR 0062 has the argument and the name.

**The word "orchestrator" is retired.** It denoted three things that have names: the
adapter that normalizes a foreign Harness, the Scheduler that picks one, and the Assembly
that runs one. `CONTEXT.md` records it as a word this project rejected.
