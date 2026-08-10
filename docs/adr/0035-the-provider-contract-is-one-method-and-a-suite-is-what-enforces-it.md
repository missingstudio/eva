---
status: accepted
---

# The Provider contract is one method, and a suite is what enforces it

`Provider` is `Stream(ctx, Call) Stream`. No `Name`, no second return value. The rules that method carries — which payload kinds cross, that usage arrives once, that every ending repeats itself — live in `internal/providers/providertest` as tests every Provider is driven through.

## What came off the interface

**`Name()`.** Every production call site interpolated it into an error, and every one of them already held the name: it came from the configuration and was passed to `providers.Open`. Meanwhile each Provider declared the name twice — a package constant and a method returning it — and nothing checked that `Register` used the same string the method returned. ADR-0028 made the registry key the name; a method answering with a second copy is a copy that can disagree.

**The error return.** `Stream` could fail, and `Next` could fail, and the one caller wrapped both with the same format string. Two error channels for one turn is two things to learn and one thing to do with them. A Call this Provider cannot send — no model, no transcript, an Author it has no word for — now fails from the first `Next`, which is already where every other failure of a turn arrives. `providers.Failed(err)` is a Stream that reports it.

The cost is real and small: a malformed Call is discovered one call later than it was. Nothing is sent either way, and the test that proved it — *the server saw no requests* — still proves it.

## What could not come off it

The interface was always wider than its signature. A caller must know that `io.EOF` is the sentinel, that four of the schema's eleven payload kinds cross this seam, that `Degraded` is a caveat the caller folds rather than a record it writes, that `Usage` arrives at most once and last, that a `Retry` precedes its wait, and that every ending is terminal and repeats.

None of that is expressible in Go's type system. `events.Payload` is a sealed interface whose seal lives in `events`, so no narrower interface here can restrict it, and inventing a second sealed set would put the schema in two places — which is the bug ADR-0005 exists to stop.

So the rules stay prose in the doc comment, and the doc comment stops being the only thing holding them.

## The suite is the enforcement

`providertest.Contract` asks for two things: a way to build a Provider that answers an ordinary turn, and — when one can be built — a way to build one whose turn the API priced nothing for. Everything else the suite supplies.

It was written because the coverage was accidental. Reading past `io.EOF` and cancelling a stream were tested for the Anthropic Provider and neither of the other two. Nothing anywhere asserted the cross-Provider rules. And the gap had already produced a bug: the fake Provider emitted a `Usage` of seven absences for a recording with no usage table — the exact record both network Providers refuse to emit — so an unpriced fake turn reached the Trace making the opposite claim from a real one, with no caveat on the Run. Every fixture in the repository happened to set a usage table, which is why nobody saw it.

The three suites had also each grown their own vocabulary for the same act: `ask`/`text`, `drain`/`folded`, `replay`, and a fourth pair in the console tests. Three names for "pull a Stream to payloads" is three chances to pull it differently.

## Consequences

**A new Provider gets its contract tests by writing down how to build one.** Two closures and a `Call`.

**Both OpenAI transports are driven through it.** A transport is a way that Provider answers, and the contract does not vary by which host answered.

**The replaying Provider was retired beside this work (ADR-0036), which is the argument rather than an exception to it.** The rules it was breaking are now asserted somewhere that outlives any one implementation, so what a Provider must do is written down whether or not the Provider that first broke it still exists.

**The suite tests what is shared and not what is true of one wire.** Truncation caveats, error-class mapping, the subscription backend restating an item, retry-after arithmetic — those stay in each Provider's own tests, because they are each Provider's own.

**`cli/turn.go` refuses a payload kind outside the contract** rather than recording whatever arrives. The suite checks the Providers in this repository; the guard is what stops one that is not.

**Falsifier:** if a Provider legitimately needs to yield a kind outside the four — a tool call, when tool use lands — the contract widens by an ADR and the suite and the guard change together, in one commit, which is the point of having both.
