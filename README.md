<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/eva-banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/eva-banner-light.png">
    <img alt="Eva — an autonomous, multi-tenant, AI-native software factory" src="docs/assets/eva-banner-dark.png" width="100%">
  </picture>
</p>

# Eva

An autonomous, multi-tenant, AI-native software factory.

## Quick Start

```bash
git clone git@github.com:missingstudio/eva.git
cd eva
go build -o eva ./cmd/eva

./eva init                # write a starter configuration
export ANTHROPIC_API_KEY=...

./eva                     # the console
./eva -p "explain this"   # one turn, rendered to stdout
./eva help                # the flags a process is started with
```

`eva init` writes `~/.eva/config.toml` with every setting commented out and what it does without it written beside it, so the file documents the surface without choosing anything on your behalf. Eva behaves identically until you uncomment a line. It refuses to write over a configuration you already keep.

`eva` opens the console. `eva -p <prompt>` answers one turn onto stdout and leaves, exiting non-zero when the turn failed, which is what a script needs and all it gets. There is no machine-readable output mode: every turn is appended to the Trace as typed Events, and that file, not a stream on stdout, is what a later reader folds.

In the console, enter sends a prompt, ctrl+c interrupts the turn in flight and gives the prompt back, and ctrl+d leaves. An interrupted turn leaves a Session the next prompt can still use, and a Trace that says what happened.

A line that starts with a slash is a command the console answers itself — no Run opens and nothing reaches a Provider.

```
/help            list these commands
/cost            what the last turn cost, and the Session so far
/clear           empty the transcript
/model [name]    report which model answers, or switch to another
```

`/model` switches in the middle of a Session and leaves the transcript alone, so the next turn runs on the new model and is still answered in the light of the earlier ones. `/clear` empties the transcript by opening a new Session rather than by deleting messages from the one in hand — see [`0019`](docs/adr/0019-clearing-the-transcript-opens-a-new-session.md) — and the cumulative spend starts over with it. The Trace keeps everything either way.

Every turn is conditioned on a base system prompt before the transcript, and that prompt is [`internal/core/prompt/base.md`](internal/core/prompt/base.md) — compiled into the binary, reviewed as prose in a diff, and held to a 2 KiB budget that `make check` enforces. What each turn spends before its first word is therefore a figure the repository states, rather than one that grows a paragraph at a time. See [`0020`](docs/adr/0020-the-base-system-prompt-is-compiled-in-and-its-size-is-a-gate.md).

The style follows the terminal's background and the colour follows what the terminal can show, and a person who configures nothing never chooses either. Rendering is a pure consumer of Events with no way to reach a Provider, a Session, or the Trace, so what the screen shows is what the record holds.

Configuration is a file, not a pile of flags. `eva help` prints the command surface; `~/.eva/config.toml` holds the rest, and an API key is read from the environment and never from that file.

A repository may carry its own `.eva/config.toml`, found by walking up from the working directory, so a team can check its look and feel in beside the code:

```toml
[theme.colors]
person = "#7AA6DC"

[theme.symbols]
prompt = "› "

[keymap.bind]
follow = ["ctrl+g"]
```

What that file may set is an allow list, and everything else is refused by name. A cloned repository's `.eva/` is content from the internet, read before the first prompt by a process holding a credential — so it may say how Eva looks and never what a run does. It cannot choose the Provider, move the traffic, name the variable the credential is read from, or move the Trace. See [`0029`](docs/adr/0029-a-repository-may-choose-how-eva-looks-and-not-what-it-does.md).

## Documents

- [docs/Product.md](docs/Product.md) — the plan: twenty stages, a failable exit test each. Draft.
- [docs/Rebuild.md](docs/Rebuild.md) — the base, examined: the rules it is built on, what holds, what was weak, and the staged path that repaired it.
- [CONTEXT.md](CONTEXT.md) — the glossary. One concept, one name.
- [docs/adr/](docs/adr/) — decisions and their reasons. Each file's name is its decision, so `ls docs/adr/` is the index and this line does not have to be one. A decision a later ADR overturned says so in its own status line, clause by clause; nothing is rewritten and nothing is deleted.
- [AGENTS.md](AGENTS.md) — how to work in this repo. `CLAUDE.md` points at it.
- [docs/agents/project-structure.md](docs/agents/project-structure.md) — where a new package, layer, or binary goes.