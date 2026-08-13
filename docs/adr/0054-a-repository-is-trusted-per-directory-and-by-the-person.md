---
status: accepted
---

# A repository is trusted per directory, and by the person

One server serves many working directories. A Session carries the directory it belongs to,
and the server holds no ambient project. Repository-local configuration loads only after an
explicit grant for that directory, recorded in the person's own configuration.

## What a long-lived server changes

Today Eva runs in a directory and exits. A server outlives any one directory and holds
Sessions for several at once, so one process reads configuration from repositories nobody
vetted.

Risk 2 in `docs/explanation/the-ladder.md` names this exactly: *"Config, skills, hooks, and
extensions that are checked into a repo are untrusted content — the same category as a
fetched web page."*

## Why the grant lands now

Today the only thing a repository may contribute is appearance. ADR 0029 fixed that: a
repository may choose how Eva looks and not what it does. So nothing is exposed right now,
and that is the argument for writing the grant now rather than later.

A grant introduced when the thing behind it is colours is a grant nobody resents. A grant
introduced when the thing behind it is a Hook arrives as a dialog about repositories that
already worked, and a person learns to dismiss it. The habit of dismissing it is what a
prompt-injection surface needs.

ADR 0029 is also the boundary under pressure. It holds only while the answer to "what may a
repository set" stays "appearance". The grant is what makes widening that answer a
reviewable act rather than a quiet one.

## The grant belongs to the person, not to the repository

A repository cannot grant itself trust. The record lives in the person's own
configuration, keyed by the directory. A repository that ships a file claiming to be
trusted is a repository making a claim about itself, which is the shape of the attack.

## Considered options

- **One server per trusted directory set.** Rejected. It multiplies processes for no gain
  and makes "show me my Sessions" impossible to answer.
- **Load repository configuration and sandbox it.** Correct, and it is where this goes.
  The sandbox tier arrives with the extension host at stage 6.5, and a grant is what
  decides whether anything reaches it. The two compose; the grant is not replaced.
- **Trust every repository, and revisit when there is something to lose.** Rejected. That
  is the version where the dialog arrives late and is dismissed.

## Consequences

**A first run in a new directory asks once.** The answer is recorded, and a directory
already granted asks nothing.

**An ungranted directory still works.** Eva runs with its own configuration and says which
repository-local settings it did not read. A degraded report is a valid outcome, and a
silently ignored file is not.

**The grant is per directory, not per repository.** A path is what the server holds and a
path is what a person can verify. Two checkouts of one repository are two grants, which is
correct: they are two directories, and one of them may be a clone from somewhere else.

**The directory is a Location, and a request names one.** A Session carries the directory
it belongs to, and that is not enough on its own: a Server holding many directories cannot
answer a list without being told which one. ADR 0056 makes Location a request parameter for
that reason, and the two meet here — a granted directory and a requested Location are the
same string, so nothing can be asked for that was never granted.
