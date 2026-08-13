---
status: accepted, Attach as a second way to attach superseded by 0061
---

# Selection is a registry

A Provider, a Trace sink, and a projection are each chosen from a set that the implementations put themselves into. Nothing in the layer that wires a run knows one implementation from another.

Every contract in this repository was already open — anything could implement `Provider`, `TraceSink`, or `Subscriber`. Every *selection* was closed, and all three closures were in one file: a switch that named each Provider, a hardcoded `trace.Open`, and an attach that assigned a slice of one.

## What the switch cost

Adding a Provider was four edits in three packages: the implementation, a case in the switch, the sentence telling a person what they may choose, and the settings the switch reads. Two of the four did not stop the build when they were forgotten, so a Provider could work and be missing from the list a person was offered, or be offered and have no way to read its own configuration.

The sentence was the worst of them. `want "anthropic" or "fake"` is a cache of the switch above it, and a cache of something one file away is a cache that will disagree with it. It now reads `Names()`, which *is* the set, so the offer cannot be wrong.

## The pattern

One shape, three applications, copied from the command table this repository already had — one source, several consumers, and a test derived from the source so that an unregistered thing fails the build.

`Register` panics on a duplicate name at load. Two implementations answering to one name is a configuration that cannot mean one thing, and which one a person got would depend on link order — the kind of failure that reproduces on one machine and not the next.

## What crosses the boundary

`providers.Options`, not `config.Config`. The layer that reads TOML is `config`, and it may not be imported by `providers` — a Provider able to read the file that selects it is a Provider able to select itself. So the settings cross as a small struct in the terms `providers` can name, and the mapping happens once, where a run is wired.

`Credential` is a function rather than a string. Resolving a credential can fail, and only a Provider that needs one should be able to fail for want of it: resolved up front, a recording replayed from a file would refuse to open for want of an API key it never sends, and every test that replays one would have to carry a secret. It also keeps the secret out of a struct that gets copied on the way in.

## Attaching a projection, and claiming a capability

`Attach` appends. It used to assign a slice of one, so a second projection silently replaced the first — no metrics tap beside a console, no second screen, no machine-readable stream beside the one a person reads. A fan-out that admits one consumer is a field.

The capability claim came apart from the attachment in the same motion. Watching a turn arrive and claiming Interrupt are things a frontend *is*, and being a Subscriber is a thing it *does*; bundling them meant a projection that watched nothing arrive still claimed it could cancel cleanly. A capability that is missing degrades a Run and a capability claimed and absent corrupts it, so the claim is a word a caller writes rather than a thing attaching implies. The word has since become the act: watching a Session claims Interrupt (ADR 0048). `Attach` itself is gone — with the claim carried by the act, a second way to attach that claimed nothing had no production caller, and the fan-out this section is about is now the watchers' own.

## The fold that cannot be registered

`ui` gained `Shown` and `Silent` rather than a table of functions. Go cannot be asked what a type switch handles, so the lists are written by hand and a test walks the schema's own registry to keep them honest: a kind in neither list fails the build, and a kind in both fails too.

This is weaker than the events registry, which cannot disagree with itself at all. It is what is available without turning a readable switch into a map of closures, and the test is what makes the weakness visible rather than latent. The reason each silent kind is silent is written beside it, because "it does not appear" and "nobody has got to it yet" look identical on a screen and only one is a decision.

## Consequences

**A Provider that is not imported does not exist.** Registration happens at load, so the blank imports in `cli` are what put Providers in the binary. That is one line per Provider in one file, and a build that wants a smaller binary removes one.

**The registries are global.** They are written once at load and read after, so the mutex is for the linter's benefit more than the runtime's. A test that registers a Provider registers it for the whole test binary, which is why the names in the registry tests are prefixed rather than plausible.

**Falsifier:** if selection ever needs something a name and a small struct cannot express — a Provider chosen per Run, or one whose settings only it knows — then the registry is the wrong shape and a factory passed in at the composition root is the one to reach for. Nothing needs that today, and the switch it replaced needed less.
