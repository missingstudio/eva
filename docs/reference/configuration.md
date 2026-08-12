# Configuration

Every setting Eva reads, what it defaults to, and where the value comes from.

Eva runs with no configuration file at all. Every setting below has a default, so
a file only records where you differ from it.

`eva init` writes `~/.eva/config.toml` with every option present, commented out,
and a note beside each saying what happens without it. Nothing is chosen for you.
Uncomment a line to change it.

## Where settings come from

Four sources, each overriding the one before it:

| #   | Source              | Path                                          |
| --- | ------------------- | --------------------------------------------- |
| 1   | Built-in defaults   | Compiled in. The table below                  |
| 2   | Your file           | `~/.eva/config.toml`, or `$EVA_CONFIG`        |
| 3   | The project's file  | `.eva/config.toml`, found by walking up       |
| 4   | `--config <path>`   | The file you name                             |

A typo is an error, not a shrug. Write `modl = "..."` and Eva refuses to start and
names the key. A file that silently ignores what you wrote is worse than one that
will not load.

## What Eva does with nothing written down

```toml
model = "claude-sonnet-4-5"     # follows the provider if you leave it out

[provider]
name        = "anthropic"       # anthropic or openai
auth        = "api_key"         # api_key or subscription
api_key_env = "ANTHROPIC_API_KEY"
base_url    = ""                # a proxy, gateway, or local server
max_tokens  = 0                 # 0 lets the provider decide

[trace]
path = "~/.eva/trace.jsonl"     # where the history goes
kind = "jsonl"                  # which writer keeps it

[identity]
tenant     = "local"
actor      = "local"
actor_kind = "human"            # human, agent, or system
```

The model and the key variable follow the provider you pick. Name `openai` and you
get `gpt-5.6-terra` reading `OPENAI_API_KEY`, without saying either out loud.

**`auth` decides, and nothing overrides it.** If it says `subscription`, an exported
`OPENAI_API_KEY` is ignored, and `eva auth status` says so rather than quietly using
it. Most tools try the environment first, which is how people bill the wrong account
for a month. ([why](../adr/0031-a-credential-has-a-mode-and-the-mode-alone-decides.md))

Your key is never written to a settings file. Eva reads it from the environment, or
gets it when you log in.

## Appearance and key bindings

Colours, glyphs, spacing, and key bindings live under `[theme]` and `[keymap.bind]`.
`eva init` lists those too. Set none of them and Eva looks exactly as it did before
any of it was configurable. Colours follow your terminal's background and what it can
display.

```toml
[theme.colors]
person = "#7AA6DC"

[theme.symbols]
prompt = "› "

[keymap.bind]
follow = ["ctrl+g"]
```

The full list of colours, symbols, layout values, and bindable actions is in
[how-to/theme-a-repository.md](../how-to/theme-a-repository.md).

## Environment variables

| Variable            | What it is for                                           |
| ------------------- | -------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic key                                       |
| `OPENAI_API_KEY`    | Your OpenAI key                                          |
| `EVA_CONFIG`        | A different settings file (default `~/.eva/config.toml`) |
| `EVA_HOME`          | A different home for Eva's files (default `~/.eva`)      |

A secret enters at the environment boundary and nowhere else. No configuration key
holds one.

## What a repository may set

A repo can carry `.eva/config.toml`, found by walking up from wherever you are. What
it may set is an allow list: `model`, and everything under `[theme]` and
`[keymap.bind]`.

**A repo can change how Eva looks, never who answers.** You clone a repo from the
internet, and Eva reads that file before your first question, in a process holding
your API key. So it cannot pick the provider, point traffic at another server, rename
the variable your key is read from, or move your Trace. Anything else in that file is
refused by name.
([why](../adr/0029-a-repository-may-choose-how-eva-looks-and-not-what-it-does.md))

## Related

- [commands.md](commands.md) — every command, flag, slash command, and key
- [../how-to/connect-a-provider.md](../how-to/connect-a-provider.md) — point Eva at a model
- [../how-to/use-a-subscription.md](../how-to/use-a-subscription.md) — pay monthly instead of by the key
- [../how-to/theme-a-repository.md](../how-to/theme-a-repository.md) — share colours and bindings
- [../how-to/read-the-trace.md](../how-to/read-the-trace.md) — read what a run did
