---
status: accepted
---

# A remedy is checked, and the layer that can check it is not the layer that says it

A failed turn says what happened and stops. ADR 0038 installed the sentence and argued the stopping: `render` can see that a credential was refused and cannot see whether the fix is a new key, a renewed login, or an account somebody suspended, so it names what happened and leaves the next step to whoever knows which of those it is.

That was right about `render` and wrong as a conclusion about Eva. The layer that wires a run holds the configuration, the auth store, and the environment. It knows the mode is `subscription`, and that the store has no login under it. So `eva login` is the one thing that fixes this — not as a likely guess, but as a fact it just read.

So the remedy was never forbidden. It was unreachable. This decision makes it reachable without letting the console reach anything else.

## A remedy is Evidence, not a Claim

`AGENTS.md` opens with the distinction and it applies here unchanged. "Run `eva login`" is a claim about the world. Eva may print it only after establishing that no live login is there.

This is not fastidiousness. A guess printed in Eva's own voice is worse than silence: it sends somebody to fix a thing that was never broken, they find nothing wrong, and from then on they skip the line — including the time it would have been right. One wrong nudge costs every later correct one.

Two rules carry it, and both are held in code rather than in review:

- **No step without a fact.** `Remedy.Said` returns nothing when `Because` is empty, whatever `Do` holds. The check is at the render layer rather than at the resolver, because the resolver is where the temptation to offer a likely-looking step lives.
- **One step, or none.** Where a fact leaves two remedies both possible, Eva has not finished checking. Offering both is the diagnosis handed back dressed as help; offering the likelier one is a guess with better odds, which is still a guess.

## The type is shared and the checking is not

`Remedy` lives in `render`, beside `Unanswered`, for the reason that one lives there: two frontends read it. The console shows it under the failure line; the one-shot command writes it to stderr, where the person reading is the one most likely to be looking at a machine they did not configure.

The resolving lives in `cli`, which is the only layer holding a configuration, an auth store, and an environment at once. It crosses back as a small domain type on `Control` — the same inversion `About` already uses, and the same rule that keeps `theme.Theme` and `keymap.Keymap` crossing where `config.Config` may not.

It is asked at the failure rather than told at the Run's opening. What makes a remedy checked is that it was checked *now*: a login live at the first prompt is among the commonest things to have expired by the turn that fails.

## Four classes have something to check, and the rest do not

`auth_failed` names which credential was sent — the variable under a key, the account and its expiry under a login — and offers `eva login` only in the two states that verb actually fixes. A live login says so explicitly, because the useful thing to tell somebody about to log in again is that logging in again is not what this needs. The four subscription branches are the four `eva auth status` reports in the same words: one machine state described two ways is two products to reconcile.

`no_such_model` names the model and where a model is chosen — and which of those it says is checked, not assumed. A Session that used `/model` is running a name held in no file, and sending that person to edit one would send them to change a line that is not what answered.

`billing` names the account the turn would have been charged to, because settling one means knowing which.

`unreachable` names a `base_url` somebody set, and says nothing without one. That override is the only cause of an unreachable provider that lives on this machine; under the vendor's own host, "your network" and "their servers" are indistinguishable from here.

`rate_limit`, `overloaded`, `server_error` and `other` establish nothing, and that is the design rather than a gap in it. There is no step on this side of the network.

## The remedy is a projection, never a record

It is computed from the class plus the machine's state, and the machine's state at replay is not its state at failure. A remedy written into a Trace would be a claim about a world that has since moved.

`Claim.Summary` goes on carrying the vendor's prose for whoever is debugging the provider, and it goes on reaching no screen. The class remains the only thing that crosses.

## Consequences

**A new class must be decided here, not defaulted.** A test walks `events.ErrorClasses()` and asserts each class either establishes something on a fully-configured machine or is named as one with no local cause. A class added later fails it rather than silently joining the silent set — the same forcing function 0038 installed for the sentence, applied to the step.

**`UseModel` now records that it was used.** A name switched in a Session and a name read from a file are the same string by the time a turn fails, so the difference is remembered rather than worked out afterwards.

**The auth store is read on a failed turn, in the update loop.** It is a small local file read only after something has already gone wrong. Holding one open from startup was rejected for the reason above: it would answer with what was true then.

**0038's Trace-naming line is withdrawn.** A failed turn no longer says where the provider's own words went. That line was argued for when the failure was one line and unhelpful; a failure is now two lines, and the second is the one a person can act on — so the third was the least useful thing on screen and the only unshortened absolute path Eva printed.

This is a withdrawal rather than a reversal, and the gap it leaves is real: nothing in the product now names the Trace path, so the vendor's account is findable only by someone who already knows where Traces live. The line was the wrong place to fix that. A path belongs somewhere a person can ask for it — `eva auth status` is the shape, a command whose whole output is checked facts about the machine in front of you — rather than on a failure that has two better things to say.

**Falsifier:** the table grows a row whose situation `cli` cannot check locally — one needing a network call, a vendor lookup, or a heuristic over the error document. The remedy would have stopped being Evidence, and the answer is to delete that row rather than relax the rule. A table that only holds checked rows may stay small, and a small set of things Eva can stand behind is the point.
