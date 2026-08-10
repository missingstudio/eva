---
status: accepted, the Trace-naming consequence withdrawn by 0041
---

# A failed claim carries a class, and a projection spends the class rather than the prose

> ADR 0041 withdrew one consequence below: a failed turn no longer names the
> Trace. The argument for it was made when the failure was one line; it is now
> two, and the second says something a person can act on. The line is withdrawn
> rather than overturned — nothing else surfaces the Trace path, so the gap it
> leaves is real and is expected to be filled by something better placed than a
> failure message.

A Run that fails closes on a Claim whose Summary is the words of whatever broke — a vendor's error document, a status line, a request identifier. Those words are written for whoever is debugging that thing. A person who typed a prompt and got one back has been handed the program's internals in place of an answer, so the console stopped showing them and said `no response` instead.

That cost the other half. `no response` is the same line for a credential to fix, a network to wait out, and a vendor to wait out — three failures that want three different things from the person reading it, told apart nowhere except in a Trace file they would have to know to open.

Both halves are available at once, because the two facts are not the same fact. What went wrong is a value from a fixed set. How it went wrong is prose. Only the second is unsafe to show.

So `Claim` carries `ErrorClass` beside `Summary`, `core.Outcome` carries it beside its own, and a projection chooses one of Eva's own sentences from the class:

```go
func Unanswered(class events.ErrorClass) string {
	switch class {
	case events.ErrorAuthFailed:
		return NoResponse + " — the credential was refused"
	...
```

It lives in `render`, beside the fold that turns committed Events into an answer, because it is the same kind of thing: what a person reads in place of a turn. It was the console's own until the one-shot command needed it too — that path had been exiting non-zero in silence — and two copies of a sentence a person reads are two products that drift.

## The class answers two questions, and the set is cut for both

`ErrorClass` began as an answer to one question: is another attempt worth making. That is why a model that does not exist, a balance that will not cover the turn, and a request the API would not accept were one value — they decide retrying identically, and nothing else read the class.

Something else reads it now, and on the second question those three are three different mornings. One is a name in a file the person who wrote it can change. One is an account to go and settle. Only the third is genuinely unplaceable. So `no_such_model` and `billing` are their own members, and `other` keeps the meaning it should always have had: a failure something looked at and could not place.

The same split reaches the OpenAI wire, where reading the error document rather than the status line fixes a second thing: `insufficient_quota` arrives as a 429, and read as the rate limit it looks like, it spends the whole retry policy to discover the account still has no credit.

## The class is stated, never parsed

Both Providers already classified every refusal — the class rode as far as the `Retry` record and was dropped on the failure that ended the turn. Recovering it downstream would have meant reading the message back, which is a parser that breaks the first time a sentence is reworded, and breaks silently.

So the class travels as a value. `providers.Fault` is the failure a Wire hands up with its class attached, `providers.ClassOf` is how a caller asks, and `Driver.Break` takes the class as a parameter because the Wire is the only thing that knows it: a stream cut mid-frame and a response the API failed on purpose reach that method looking alike.

## The empty class is not a member of the set

A failure nothing classified stays unclassified all the way to the record, and the console shows the bare line for it. There is no default.

`ErrorOther` would have been the convenient one, and it is a different statement: something looked at this failure and could not place it. Defaulted, it would be the claim on every Run that succeeded, every Run somebody interrupted, and every failure arriving from a path with no opinion — and anything counting unplaceable failures would be counting all of them. This is the absence-is-not-zero rule of ADR 0024, applied to a reason instead of a counter.

## The record holds what the screen spends

The class goes into the Claim, not only into the Outcome. A Unit that reported a reason it did not commit would let a screen say something the Trace cannot account for, which is the one thing an Outcome exists to stop (ADR 0017).

It is an additive field on one schema version, so a Trace written before it still reads — as a failure nobody classified, which is what it is.

## Consequences

**A new class must earn a sentence.** `events.ErrorClasses()` is the set, and a test walks it: a class with no line of its own fails, rather than shipping as `no response`. That is the mechanism this whole change exists to install — the distinction was lost before because nothing made anyone answer for it.

**`ErrorUnreachable` is new.** A transport that never reached a server had been folded into `ErrorOther` with a comment saying the set had no member for it. It has one now, because "your network" and "their servers" are the two most different things a person can be told and the console could not tell them apart.

**The prose is one step further away, and the step is signposted.** What the provider said is in the Trace verbatim and reaches no screen. Keeping it there without saying so read as having destroyed it, so a failed turn names the file: once per Session in the console, because a line repeated after every failure is a line nobody finishes reading, and every time from the one-shot command, which is one turn and has no second failure to have remembered it from.

The path crosses into the console on `About`, the way every other fact about the world outside does. The masthead does not draw it — it is not something a person checks before trusting an answer; it is what they want after one did not arrive.

**Nothing tells a person what to do.** Every line names what happened and stops. `render` can see that a credential was refused and cannot see whether the fix is a new key, a renewed login, or a suspended account — and a step Eva has not checked is a guess, which is worse than silence because it sends somebody to fix a thing that was never broken. Making a remedy checkable means reaching the configuration and the auth store, which is a layer this one deliberately cannot see.

**Falsifier:** this holds while the classes stay coarse enough that one sentence covers each. A class that meant three different things to three different vendors would put the console back to choosing between a sentence that is too vague to act on and the vendor's own words — and the answer then is a finer set, not a richer message.
