<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/eva-banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/eva-banner-light.png">
    <img alt="Eva — an autonomous, multi-tenant, AI-native software factory" src="docs/assets/eva-banner-dark.png" width="100%">
  </picture>
</p>

# Eva

An autonomous, multi-tenant, AI-native software factory. It builds, tests, improves, and maintains software with minimal human intervention.

**Status:** stage 0 in progress. The spine runs: a prompt goes in, typed Events come out, and a Trace lands on disk. `eva` holds a conversation, and a turn renders as styled markdown and reports what it cost. There are no slash commands yet.

```
eva                                     # the console
eva -p "what is this project"           # one-shot: the answer, and what it cost
eva -p "what is this project" --json    # the same turn as typed Events
```

In the console, enter sends a prompt, ctrl+c interrupts the turn in flight and gives the prompt back, and ctrl+d leaves. An interrupted turn leaves a Session the next prompt can still use, and a Trace that says what happened.

The style follows the terminal's background and the colour follows what the terminal can show — neither is configured. The machine-readable path builds no renderer at all, so what a script parses carries no terminal escapes.

Configuration is a file, not a pile of flags. `eva help` prints the command surface; `~/.eva/config.toml` holds the rest, and an API key is read from the environment and never from that file.

## Documents

- [docs/Product.md](docs/Product.md) — the plan: twenty stages, a failable exit test each. Draft.
- [CONTEXT.md](CONTEXT.md) — the glossary. One concept, one name.
- [docs/adr/](docs/adr/) — decisions and their reasons. `0001`–`0008` settle the stage 0 event schema; `0009` fixes config as TOML; `0010` fixes the module layout; `0011` makes the Recorder the only path to the Trace; `0015` keeps what a person watches apart from what is kept; `0017` makes the Outcome the only account of a turn; `0018` gives a Session its own Runs.
- [AGENTS.md](AGENTS.md) — how to work in this repo. `CLAUDE.md` points at it.