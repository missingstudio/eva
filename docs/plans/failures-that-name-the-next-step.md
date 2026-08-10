# Failures that name the next step

Status: **landed**, except where a stage below says otherwise. A design for what Eva says when something goes wrong, and how it comes to be able to say it. The decisions it reached are recorded as ADR 0038, for the class and the sentence, and ADR 0041, for the checked remedy. Where this page and an ADR disagree, the ADR wins.

Eva reports failures honestly and, past the configuration boundary, unhelpfully. A person whose turn was refused is told a credential was refused. A person whose model name is a typo is told the same thing every other unclassifiable failure says. This document argues that the missing half is not gentler prose, but a **checked remedy**. The reason Eva does not offer one today is architectural rather than stylistic. The layer that knows the fix is not the layer that writes the sentence.

## The rule this is built on

> **A remedy is Evidence, not a Claim.**

`AGENTS.md` opens with the distinction and the whole project turns on it. It applies to error messages without modification. "Run `eva login`" is a claim about the world. Eva may print it only after it has read the auth store and established that no live login is there. A remedy Eva has not checked is a guess, and a guess printed in Eva's own voice is worse than silence. It sends a person to fix a thing that was never broken, and it teaches them to stop reading the line.

The console already states the strict half of this rule, at `internal/tui/console.go:643`:

> The lines say what is true rather than what to do. "Check your key" would be an instruction this console cannot stand behind: it can see that a credential was refused and it cannot see whether the fix is a new key, a renewed login, or an account somebody suspended.

That reasoning is correct and this document does not overturn it. It observes something narrower: **the console cannot see which of those it is, and `cli` can.** `cli` holds the configuration, the auth store, and the environment. It knows whether the mode is `api_key` or `subscription`, and which variable was named. It knows whether a login exists, whether it expired, and whether it has a refresh token. Every one of the three possibilities the comment lists is distinguishable, one layer down from where the sentence is written.

So the remedy is not forbidden. It is unreachable. The work is to make it reachable without letting the console reach anything else.

## What already works

Eva has a house style for this, and it is confined almost entirely to the boundary a person touches before anything runs. These are the models to copy, not to invent past:

- **The missing API key names the export and the file** (`internal/config/config.go:243`). It says which variable, in which provider's name, and where to name a different one. Its comment states the reason plainly. Configuration is the surface a user touches before anything else works, so its error messages are part of the product.
- **A retired setting says what replaced it** (`internal/config/config.go:472`, `retired`). The key that went away carries its own migration note rather than reading as a typo.
- **An unsupported auth mode spells the working pair** (`internal/config/config.go:527`). It names which provider does support a login, and gives the line to write instead.
- **A missing or dead login names the verb** (`internal/auth/source.go:58,64`). ``run `eva login` `` — checked, because the store was just read.
- **`eva login` ends by printing the configuration that puts it to work** (`internal/cli/login.go:67`). The next step is on the screen instead of in a document.
- **`eva auth status` names the credential that is set and unused** (`internal/cli/login.go:115`). It exists to dissolve exactly one confusion, and it is the best remedy surface in the repository. Its whole output is checked facts about the machine in front of you.
- **The registries name the valid set from themselves** (`internal/providers/registry.go:97`, `internal/trace/registry.go:79`, `internal/theme/theme.go:236`). The offer cannot go stale, because it is read rather than written.
- **A keybinding refusal teaches the spelling** (`internal/tui/keymap/keymap.go:155,172,178`). It says what a terminal actually reports and how to write it.

Every one of these passes the rule: each names a fact Eva established, and each next step is one the machine can stand behind.

## Where it stops

*This section is the diagnosis that motivated the work, written against the tree before any of it landed. Findings 1, 2, 3 and the failed-turn half of 5 are now fixed; 4 and the startup half of 5 are not. The line numbers are the ones the findings were made against.*

Past configuration, the quality falls off a cliff.

### 1. The console's failure lines are true and terminal

`unanswered` (`internal/tui/console.go:643`) maps six classes to six sentences. They are honest, they are short, and none of them tells a person anything they can act on. Worse, two of the six are actionable in most real cases and are treated as though they were not:

| Class | What a person reads today | What Eva could have checked |
| --- | --- | --- |
| `auth_failed` | the credential was refused | which credential, from where, and whether a login is expired |
| `rate_limit` | the rate limit was reached | how long the server asked for, and whether Eva gave up because the ask exceeded the cap |
| `unreachable` | the provider could not be reached | whether `provider.base_url` was overridden, which is the one cause local to this machine |
| `overloaded` | the provider is overloaded | how many attempts were made, over how long |
| `server_error` | the provider failed the request | — |
| *(none)* | No response | — |

### 2. `ErrorOther` is three remedies wearing one name

This is the structural finding. `internal/providers/anthropic/failure.go:50` collapses `invalid_request`, `not_found`, and `billing` into `ErrorOther`, and its comment gives the reason:

> A request the API would not accept, a model that does not exist, and a balance that will not cover the turn are all the same shape: the next attempt fails the same way and costs the same money.

That is true about **retry semantics** and false about **remedy semantics**, and `ErrorClass` today answers only the first question. A model that does not exist is the single most fixable failure Eva can encounter. The name came out of a file Eva can quote, at a path Eva knows. Yet it arrives at the console as `No response`, the line reserved for failures nobody classified at all.

### 3. Nothing says where the detail went

The console deliberately shows none of the vendor's account, and the reasoning is right. A person who typed a prompt is owed the fact that changes what they do next, not a request identifier. The Trace holds the vendor's words verbatim for whoever is debugging the provider. But nothing on screen says the Trace exists, or where it is. So the rule reads as "the detail was destroyed" rather than "the detail is over there".

### 4. An unknown configuration key gets no nearest match

`internal/config/config.go:336` and `:474` name the offending key and, for a retired key, what replaced it. A key that is merely *misspelled* gets nothing — even though the schema's key set is known, finite, and derivable from the struct. The nearest key by edit distance is a computed fact, not a guess, which is precisely what makes it admissible.

### 5. One failure, one line, on stderr

`internal/cli/app.go:95` prints `eva: %v` and stops. `eva init` and `eva login` both already print a fact, a blank line, and an indented next step. The shape is in the product, just not on the failure path.

## The shape of a failure Eva reports

Four parts. Each earns its place separately, and a part Eva cannot establish is omitted rather than filled in.

1. **What happened** — the class, in Eva's own words. Always present. This is what `unanswered` does today.
2. **What it means here** — the fact Eva checked about *this* machine, *this* configuration, *this* attempt. Present when there is one.
3. **What to do next** — the command or the line to write, verbatim. Present only when part 2 makes exactly one step correct.
4. ~~**Where the detail is** — the Trace path.~~ *Withdrawn.* Shipped and then removed. Once parts 2 and 3 existed, this was the least useful line on a three-line failure, and the only unshortened absolute path Eva printed. Nothing else names the Trace path today, which is a real gap — but a failure message was the wrong place to close it. See ADR 0041.

Two rules follow directly from the honesty rule and are load-bearing:

- **No part 3 without part 2.** A step with no established fact behind it is advice, and Eva does not give advice.
- **Exactly one step, or none.** If two remedies are both possible, Eva has not finished checking. Offering both hands the person the diagnosis to do, dressed as help. Offering the more likely one is a guess with better odds, which is still a guess.

## Design

### `Remedy` is a domain type the frontend fills

The console must not reach configuration. depguard holds that boundary. It is why every visual choice crosses as `theme.Theme` and `keymap.Keymap` rather than as `config.Config`. See `docs/agents/design-rules.md`, "Config flows inward as domain types". The remedy crosses the same way. `tui.About` is the exact precedent: a small struct declared where it is consumed, assembled by `cli`, and handed over through `Control`.

```go
// Remedy is a next step Eva has checked, and never one it is guessing at.
//
// Because is the fact Eva established; Do is what a person types, verbatim.
// The two travel together because a step with no fact behind it is advice,
// and Eva does not give advice.
type Remedy struct {
	Because string
	Do      string
}
```

`Control` gains one method:

```go
// Remedy is the checked next step for a failure of this class, and false
// when Eva could not establish one.
Remedy(class events.ErrorClass) (Remedy, bool)
```

*(Rejected: returning `[]Remedy`. A slice invites a list of maybes, which is the diagnosis handed back to the person. The boolean forces the resolver to reach one answer or admit it has none.)*

`tui` already imports `events`, so the class crosses unchanged. The console composes `unanswered(class)` first. When a remedy came back, it then draws the `Because` and the `Do` on their own lines. Both use the aside voice that already carries the interface talking about itself.

### The resolver lives in `cli`, because that is where the facts are

`cli` is the composition root and the only layer holding the configuration, the auth store path, and the environment at once. The resolution is a table over the class *and the situation*:

| Class | Situation `cli` can check | Remedy |
| --- | --- | --- |
| `auth_failed` | mode is `subscription`, store holds no login | `eva login` |
| `auth_failed` | mode is `subscription`, login expired with no refresh token | `eva login` |
| `auth_failed` | mode is `subscription`, login live | fact only: the account it was refused for; `eva auth status` when a key is also set and unused |
| `auth_failed` | mode is `api_key`, variable set | fact only: which variable, and which provider refused it |
| `no_such_model` | the model came from a file `cli` can name | fact and path: `model = …` in `~/.eva/config.toml` |
| `billing` | — | fact only: this provider will not bill the turn |
| `rate_limit` | the server asked for longer than `retry.Policy.Cap` | fact: the delay asked for, so "wait and ask again" is a figure rather than a mood |
| `unreachable` | `provider.base_url` is set | fact: the override, and the file it came from |
| `overloaded`, `server_error`, `unreachable` (no override), `other` | — | fact only |

The three fact-only rows are not failures of the design. They are the design. Eva says what it knows and stops, which is what it already does. The difference is that the rows above them now say more.

### `ErrorOther` splits

Add two members to the class set: `ErrorNoSuchModel` and `ErrorBilling`. Both providers can already tell them apart — Anthropic from `sdk.ErrorTypeNotFoundError` and `sdk.ErrorTypeBillingError` (`internal/providers/anthropic/failure.go:50`), OpenAI from the error document it currently flattens into prose (`internal/providers/openai/stream.go:100`). The retry answer is unchanged for both: `Again: false`.

This is cheap because the schema was built for it:

- Adding an enum value is additive within a major (ADR 0006), so no stored Trace is rewritten.
- `ErrorClasses()` exists precisely so that anything answering for every member is checked against the set rather than against a list somebody remembered (`internal/events/payload.go:274`). A new class with no sentence fails a test rather than shipping blank.
- `unanswered`'s `default:` branch already handles a class this build has no sentence for. A reader of an older build folding a newer Trace degrades to the bare line, which is the designed behaviour.

`ErrorOther` keeps its meaning — a failure something looked at and could not place — and stops being the drawer everything unfixable-by-retry was swept into.

### The Trace is named once per Session

On the first failed Run of a Session, the console's aside carries a fourth line naming the Trace path. Not on the second, because a nudge repeated is a nudge nobody reads. `cli` knows the path. It crosses as a field on `About`, which the console already holds and already declines to draw when a fact is absent.

**The remedy never enters the Trace.** It is a projection over a record, computed from the class plus the machine's current state. The machine's state at replay is not its state at failure. `Claim.Summary` continues to carry the vendor's prose for whoever is debugging the provider; that is the record. A remedy written into the Trace would be a claim about a world that has since moved.

### The CLI failure takes the shape `init` and `login` already use

```
eva: <what happened>

    <what to do next>
```

One function composes that shape, and every non-zero exit uses it. So a failure at startup and a failure at the console read as the same product.

### Preflight stays the strongest nudge there is

The best failure is the one that happens before the turn. `Credential.Available()` already does this (`internal/providers/credential.go:86`). A credential nobody can produce fails at startup, in a sentence naming the fix, rather than partway through the first question somebody asked. That pattern is correct, and should be extended only where the check is local and free. **It should not be extended to the model name.** Validating a model means a network call before the first frame. That buys a better error at the cost of a slower start, and a new failure mode of its own. `no_such_model` at the first turn is the right trade.

## What Eva must never do

- **Invent a URL.** No `see https://…` for a page that does not exist, and no documentation link that a release can silently break.
- **Say "check your key".** Naming a thing to look at is not a remedy; it is the diagnosis handed back.
- **Print the vendor's prose to the person who typed a prompt.** That rule already holds and this design does not weaken it — it makes the rule survivable by saying where the prose went.
- **Offer a step it has not checked.** Including the plausible one. Especially the plausible one.
- **Guess a nearest match without computing one.** Edit distance over a known set is a fact. "Did you mean" over a hunch is not.
- **Repeat itself.** A remedy is per-failure; a location is per-Session.
- **Grow the exit codes.** Three codes are a contract scripts already read (`internal/cli/app.go:33`). A person is nudged by prose and a script by `eva auth status`, whose output is already machine-readable enough to grow into. Widening the code set is a separate decision with a separate cost, and it is left open below.

## Staging, with a failable exit test each

Each stage stands alone and lands with its doc, per `AGENTS.md`.

**Stage A — the class set stops lying.** *Landed (ADR 0038).* `ErrorNoSuchModel` and `ErrorBilling` are members of the set, and both classifiers name them. The OpenAI wire reads its error document rather than the status line. That also stops `insufficient_quota` spending the whole retry policy behind a 429 it only looks like.
*Exit test, passing:* `render.Unanswered` is walked over `events.ErrorClasses()`, and a class with no line of its own fails rather than shipping as `no response`.

**Stage B — the console can ask.** *Landed (ADR 0041).* `render.Remedy`, the `Control` method, the resolver in `cli`, and the drawing in both frontends.
*Exit test, passing:* with `auth = "subscription"` and an empty store, the transcript holds `eva login`. With a live login it holds the fact and no imperative. An interrupted turn holds neither.

**Stage C — the rest of the table.** *Landed, less one row.* `no_such_model`, `billing`, and `unreachable` under a `base_url` override all resolve. The Trace-naming line shipped and was then withdrawn — see the shape above and ADR 0041.
*Not done:* the shared failure shape for `eva: %v` at startup. The remedy reaches the failed-turn path in both frontends, and a configuration Eva would not act on still exits on one line. Also not done: `rate_limit` past `retry.Policy.Cap`. The delay the server asked for is known to the `Refusal` and to the `Retry` record, and reaches neither the `Outcome` nor `cli`. So the one useful figure is the one thing that cannot be said. Plumbing it is a schema-adjacent change, and wants its own decision.

**Stage D — the configuration boundary.** *Not started.* Nearest-key suggestion over the schema's key set, derived by reflection over the TOML tags rather than from a hand-kept list.
*Exit test:* a file containing `provider.api_key_evn` reports `api_key_env` by name. A file containing a key near nothing reports no suggestion, rather than the least-distant member of the set.

## Open questions

- **Does the exit code set widen?** A script cannot currently tell "fix your configuration" from "the vendor was down", and retry logic in CI wants that distinction. Widening breaks a contract; the alternative is a machine-readable status surface. Neither is free, and this document does not decide it.
- **Does the resolver belong in `cli` forever?** Today `cli` is the only holder of the facts. When a Worker runs a Run with no console attached, the same table has to answer for a dashboard. That is a registry question, and it is premature until the second consumer exists (ADR 0028's own rule).
- **Is `Because` one string or a pair?** The table above sometimes wants a value and its origin. Examples: the delay and who asked for it, or the model and the file it came from. One string composed at the resolver is simpler; two fields let a projection other than the console lay it out differently. Deferred to the second projection.

## Falsifier

After Stage C, the resolution table may grow a row whose situation `cli` cannot check locally. That means a row needing a network call, a vendor lookup, or a heuristic over the error document. The remedy would have stopped being Evidence, and this design would have failed at its own premise. The correct response is to delete that row, not to relax the rule. A table that only ever holds checked rows may end up small. A small table of things Eva can stand behind is the outcome this document argues for.
