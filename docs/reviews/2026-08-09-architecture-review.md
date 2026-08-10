# Architecture review — 2026-08-09

> **Status: snapshot.** This is a point-in-time assessment, kept as written. The
> living home of the open items is [../decisions.md](../decisions.md). Basis: the tip
> of `main` on 2026-08-09, every layer read in full.

The review asked one question. Is this the right foundation to build the twenty
stages on, or is a turn-around needed while one is still cheap? This document is the
snapshot that carries the full argument.

## Verdict

No turn-around. The foundation is structurally sound, and the evidence is
machine-held rather than aesthetic. The review found four things instead: one
schema-grade decision still open, one misplaced module, one undecided divergence
between the plan and the code, and a sequencing risk that matters more than any of them.

## What is deep, and would be destroyed by starting over

Measured as deep modules: a lot of behaviour behind a small interface, at a clean
seam, testable through that interface.

**The Event schema is a settled kernel.** A sealed payload interface closes the kind
set at the compiler. One registry ties kind, type, and decoder together, so encode
and decode cannot disagree. The sink assigns Seq at commit, and usage counters are
nullable so silence is never zero. This is the "complete at stage 0, or it breaks
every adapter and every stored Trace" invariant, done. The reasoning is in ADRs
0001–0008 and 0024.

**Provider/Wire/Driver is a real seam with a real suite.** `Provider` is one method.
`Wire` is only what genuinely differs between vendors: Dial, Pump, Close. The Driver
owns the retry-as-record state machine once, where it had been the same two hundred
lines twice. Two adapters built on different substrates — a vendor SDK, and a
hand-rolled POST — prove the seam. `providertest` makes the contract enforced rather
than commented. It is the strongest module in the repository.

**The layer graph is machine-held.** depguard in strict list-mode fails closed on
every layer, and `core` is denied even the standard library wholesale. Interfaces are
declared at the consumer (`core.TraceSink`, `tui.Control`). So the console cannot
reach a Provider or the Trace as a matter of rule rather than habit.

**The Recorder is the one path to the Trace.** It composes the Run's caveat at close.
This is the honesty instrument the factory thesis rests on, and it is already
load-bearing in tests.

Apply the deletion test to any of these and the complexity reappears across every
caller. They are earning their keep.

## Issue 1 — the transcript schema is the second kernel decision, and it is still a placeholder

This is the one item with rewrite-grade blast radius. `core.Message` is author and
text. Both wires already strain against it: one splits the system message back out
into a separate parameter, the other joins them into an instructions string. The
stage that adds tools demands what the type cannot say:

- "No tool_use is ever persisted without its tool_result" needs messages made of
  typed content blocks, not strings.
- "The transcript stays structurally valid for the next provider call" needs tool
  results that fold back into the transcript in a shape a provider can resend.
- The Session fold is the resume mechanism, and it folds only Started, Text, and
  Finished. Once tool calls exist, a fold that cannot rebuild paired tool blocks is a
  resume broken by construction.

The Event schema was treated as complete-at-stage-0, because a field added later
breaks every stored Trace. The transcript type has the same blast radius: the fold,
the Call, both wires, the contract suite, and every stored Trace a fold must rebuild.
It has had none of the same design investment.

It deserves the same ADR-grade session, designed at least twice.
Message-holds-sealed-blocks mirrors the payload pattern.
Transcript-derived-entirely-from-Events makes Message only the fold's output type.
Where the type lives is part of the decision. A case exists that it belongs to the one
vocabulary, beside the Events, rather than to core. Due before stage 2 is started,
not during.

## Issue 2 — the loop lives in the frontend layer

`cli.Turn` is the embryo of the loop. It is the thing that will grow tool dispatch,
parallel tool groups, approval gates, and the runaway fuse. None of that belongs in
the frontend, and the depguard rules force the question anyway: cli's allow list
would have to swallow the tool registry and everything behind it. The frontend layer
is doing two jobs — composition root, which is correct, and execution engine, which
is misplaced.

The extraction is one construction site today, and a multi-package unpicking after
tools land. It also makes the seam honest: the frontend hands a Unit to the console,
and the loop is testable with no frontend at all. Its new name belongs to the loop
layer. ADR 0037 records why the rename and the move are one act. This extraction was
spun off as its own task and is in progress.

## Issue 3 — the Unit's shape is an undecided divergence

The plan gives Execute a Runtime carrying tools, memory, verifier, and hooks, with
every optional capability shipped as a null implementation. The code gives
dependencies as fields on the implementing type, and no Runtime exists.

Both shapes are defensible, and fields-on-the-struct is arguably the more idiomatic
Go. But only one can be the pattern. Three things hang off whichever wins: the
composition rule that any Unit is a tool to a parent Unit, the null-implementation
rule, and the hook attachment point. Today there is one Unit implementation. The
decision is a one-hour ADR now, and a re-plumbing of every loop later.

## Smaller findings

- **Extend contract-as-suite to sinks.** `providertest` is the best testing idea in
  the repository. `TraceSink` carries the same shape of contract: atomic groups, the
  fold, dense Seq, and kill-9 parseability. Stage 6 adds replay and redaction. A
  `sinktest` suite now means the second sink is born conforming.
- **The fold has a scaling cliff — name it, do not fix it.** Rebuilding a Session is
  linear in the Trace, and Messages copies the transcript per turn. That is fine
  until resume over long Traces. It is worth one line of recorded debt with a
  trigger, and the Cursor type is the natural checkpoint key. It is not worth a fix
  today.
- **Registry asymmetry is fine by the repo's own rule.** Subscribers and renderers
  are still attached by assignment. One adapter means a hypothetical seam, so the
  registry waits for the second kind to exist.
- **Stale doc claims found and fixed in this review.** design-rules described the
  provider switch the registry had already replaced. The README's `/cost` line
  described a per-turn figure the console no longer reports.

## The vocabulary finding

The founder's own report — "I can't grasp what a Turn is" — turned out to be a
modelling bug, not a reading problem. The glossary used "turn" about twenty times,
defined it nowhere, and retired it inside Run's avoid list. The code type's comment
defended a Turn/Run distinction the architecture makes unexpressible: the intent
rides on the Run's opening record, and the fold refuses one answer across two Runs.

Three options were argued to a decision: keep-and-define, rename, and dissolve.
Exchange was the strongest rename candidate. Dissolution won on the crux that two
names with one extension is what the glossary exists to prevent. A scheduled
collision settled it: the plan and the providers layer already use "turn" for one
provider exchange, a different granularity, from the first tool call on. ADR 0037
holds the full argument. CONTEXT.md now defines Turn at the providers' meaning, and
gives the arc to the Run.

## The sequencing observation

The architecture is not the risk. The risk is pace against polish: roughly twenty
thousand lines and thirty-seven recorded decisions of unusual quality, for a chat CLI
with two providers at stage 0 of twenty.

Every claimed moat in the plan lives at stages 2 through 9 — harness racing, the
routing table, escalation through the lease. The discipline machinery is precisely
what allows those stages to be climbed fast without rot. That is its return, and it
only pays if it is spent climbing.

The recommended path: settle the transcript schema, land the loop extraction, and
decide the Unit's shape. Then hold stage 1 and stage 2 to their exit tests, rather
than deepening stage 0 further.
