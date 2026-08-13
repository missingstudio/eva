---
status: accepted
---

# A Login verb lives under the noun that owns it

`eva provider login` obtains a Provider Credential. `eva console login` obtains a
Credential for the managed Console. `eva login` and `eva auth status` fail with the
command that replaced them.

This narrows ADR 0032. That decision made a Login a CLI verb rather than a Command, and
put its credential in one auth store. Both halves stand. What it did not decide is which
noun the verb belongs to, because there was only one subject.

## Two subjects arrived

A Provider Credential says how a turn reaches a model. It is an API key or a
subscription, it belongs to a machine, and it expires when the vendor says so.

A Console Credential says who a *person* is to the managed service. It belongs to a
human, it carries an organization, and it expires on its own schedule.

One verb cannot own both. `eva login` with no noun has to guess, and the guess is wrong
half the time as soon as the second subject exists.

## Why the old verbs fail rather than alias

Rule 12 in `docs/explanation/the-ladder.md`: *"A removed config key fails with migration
guidance. The system never ignores it silently."*

An alias is the silent version of that. It works, so nobody learns the new name, and the
old name has to be carried forever — including in the remedy text, where a sentence
telling a person to run a deprecated command is a sentence that ages badly.

So `eva login` and `eva auth status` exit non-zero and name their replacements. A script
breaks once, loudly, with the fix in the message.

## What it touches

The blast radius is wider than the command table, and each of these is part of the same
change:

- `internal/cli/command.go` — the `login` and `auth` commands
- `internal/cli/login.go` — the handler
- `internal/cli/remedy.go` — the remedy text names `eva login` (ADR 0041)
- `internal/cli/app.go` — the usage text
- `docs/reference/commands.md`, `README.md`, `docs/how-to/use-a-subscription.md`

## Considered options

- **`eva login --console` against `eva login --provider openai`.** Rejected. A flag that
  selects between two unrelated subjects is a noun wearing a flag's clothes.
- **`eva auth provider login` and `eva auth console login`.** Rejected. Three words to
  reach the commonest act, and `auth` is what a turn does rather than what a person does —
  the glossary already draws that line.
- **Keep `eva login` for Providers and add `eva console login` only.** Rejected as the
  destination and it is the smaller change. It leaves the Provider verb without its noun,
  so `eva provider ls` has no home and the asymmetry has to be explained forever.

## Consequences

**The mechanism is already built.** `internal/auth` holds a device-code flow with a user
code, a poll interval, and a timeout. A Console login is a second source in the same
store, not new machinery.

**`eva provider` gains a home for what the registry can answer.** Listing the Providers a
person may select is reading a map that exists (ADR 0028), and that sentence cannot go
stale.

**`eva auth status` becomes two answers.** How a turn authenticates is a Provider
question. Who a person is to the Console is a Console question. Each reports under its own
noun, and neither prints key or token material.
