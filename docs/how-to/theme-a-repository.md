# How to give a repository its own look

Commit a `.eva/config.toml` so everyone working in a repo sees the same colours,
glyphs, and key bindings. At the end, Eva will pick the file up automatically when
anyone runs it inside that repo.

## Before you start

- Eva built, as in [tutorial/first-run.md](../tutorial/first-run.md).
- Write access to the repo.

## Steps

1. Create the file at the repo root.

   ```bash
   mkdir -p .eva
   ```

2. Set only look and feel in `.eva/config.toml`.

   ```toml
   [theme]
   name = "contrast"

   [theme.colors]
   person  = "#7AA6DC"
   failure = "#FF9E8A"

   [theme.markdown]
   heading = "#7AA6DC"

   [theme.symbols]
   prompt = "› "

   [keymap.bind]
   follow = ["ctrl+g"]
   ```

   `[theme.layout.margin]` and `[theme.layout.padding]` take `top`, `right`,
   `bottom`, and `left`, and hold cells back at the window's edges.

   `name` is one of the looks Eva ships with — `eva`, `contrast`, or `mono` — and
   everything under it is applied over that look. `[theme.markdown]` colours the answer
   itself; leave one out and Eva's renderer chooses it for the terminal's background.

3. Commit it.

   ```bash
   git add .eva/config.toml && git commit -m "chore: shared Eva look"
   ```

Eva finds the file by walking up from wherever you are, and stops at the repository
boundary.

## Verify

Run Eva inside the repo and confirm the prompt glyph changed. Then check that your own
settings still decide everything else:

```bash
./eva auth status
```

The provider and credential must be unchanged. A repo cannot alter them.

## What a repository may not set

**A repo may change how Eva looks, never what it does.**

You clone a repo from the internet, and Eva reads that file before your first
question, in a process holding your API key. So what the file may set is a short
allow-list: appearance and key bindings.

| A repo may set                                                 | A repo may not set                                |
| -------------------------------------------------------------- | ------------------------------------------------- |
| `[theme.colors]`, `[theme.symbols]`, and the rest of `[theme]` | The provider                                      |
| `[theme.markdown]`, the answer's own colours                   | `editor`, which names a program Eva would start   |
| `[keymap.bind]`                                                | `base_url`, or any other destination for traffic  |
|                                                                | `api_key_env`, the variable your key is read from |
|                                                                | `auth`, so no repo can select a subscription      |
|                                                                | `[trace] path`, so no repo can move your record   |

Anything outside the allow-list is refused **by name**, so you learn which line was
rejected rather than wondering why nothing happened. See
[adr/0029](../adr/0029-a-repository-may-choose-how-eva-looks-and-not-what-it-does.md).

Treat a cloned `.eva/` as untrusted content, in the same category as a fetched web page.

## Where settings come from

Four sources, each overriding the one before:

1. Built-in defaults
2. Your file (`~/.eva/config.toml`, or `EVA_CONFIG`)
3. The project's file (`.eva/config.toml`)
4. `--config <path>`

Eva works with none of them. Set nothing and it looks exactly as it did before any of
this was configurable, because a default is not a choice. Colours follow your
terminal's background and what it can display.

## Troubleshooting

| What you see                                         | What to do                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Eva refuses to start, naming a key                   | A typo, or a key a repo may not set. The message names it. Fix or remove that line.                         |
| Your theme did not apply                             | Check you are inside the repo, and that the file is at the root rather than in a parent above the boundary. |
| A named setting is called retired rather than a typo | The key existed once. Eva distinguishes the two so you get migration guidance instead of "unknown key".     |

## Related

- [how-to/connect-a-provider.md](connect-a-provider.md) — what only you can set
- [adr/0030](../adr/0030-look-and-feel-are-configuration-and-the-default-is-not-a-choice.md) — why every glyph is configurable
- [adr/0009](../adr/0009-config-and-profiles-are-toml.md) — why an unknown key is an error
