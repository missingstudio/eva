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
harness = "eva"                 # what owns the loop that answers a prompt
editor = ""                     # $VISUAL, then $EDITOR, when you leave it out

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

`harness` names what owns the tool-calling loop. This build ships one, `eva`, and a
name it does not have is refused with the list of the ones it has. Other harnesses
are what the setting exists for, and none has landed.

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
[theme]
name = "contrast"               # eva, contrast, or mono

[theme.colors]
person = "#7AA6DC"

[theme.markdown]
heading = "#7AA6DC"             # the answer's own colours

[theme.layout.margin]
left = 2                        # cells held back at the window's edges
right = 2

[theme.symbols]
prompt = "› "

[keymap.bind]
follow = ["ctrl+g"]
```

`[theme] name` picks one of the looks Eva ships with, and everything you write is
applied over it. `eva` is what Eva draws when you name nothing. `contrast` raises the
greys for a washed-out terminal or tired eyes. `mono` names no colour at all, for a
terminal that draws none and for anyone who wants none.

`[theme.markdown]` is the answer's own palette — headings, code, emphasis, links,
quotations. Leave a colour out and the renderer chooses it for your terminal's
background, which is what Eva did before these existed.

`[theme.layout.margin]` and `[theme.layout.padding]` each take `top`, `right`,
`bottom`, and `left`. Two columns at each side and no rows at top or bottom, by
default: a terminal has few rows, and a row held back is a row of the conversation
nobody can read. The two insets are one today and part company when Eva draws a
background — that will fill the padding and stop at the margin. A window too small
to spare an edge spends it on the answer instead, and gives up the margin first.

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
the variable your key is read from, or move your Trace. Nor can it name your `editor`,
which reads like a look-and-feel setting and is not one: what it names is a program Eva
starts on your machine. Anything else in that file is refused by name.
([why](../adr/0029-a-repository-may-choose-how-eva-looks-and-not-what-it-does.md))

## Related

- [commands.md](commands.md) — every command, flag, slash command, and key
- [../how-to/connect-a-provider.md](../how-to/connect-a-provider.md) — point Eva at a model
- [../how-to/use-a-subscription.md](../how-to/use-a-subscription.md) — pay monthly instead of by the key
- [../how-to/theme-a-repository.md](../how-to/theme-a-repository.md) — share colours and bindings
- [../how-to/read-the-trace.md](../how-to/read-the-trace.md) — read what a run did
