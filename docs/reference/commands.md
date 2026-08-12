# Commands and keys

Everything you can type: at a shell, at the chat prompt, and on the keyboard.

## Commands

| Command               | What it does                       |
| --------------------- | ---------------------------------- |
| `eva`                 | Open the chat                      |
| `eva -p "<question>"` | Answer once, print to stdout, exit |
| `eva init`            | Write a starter settings file      |
| `eva login`           | Sign in to a subscription          |
| `eva auth status`     | Show how Eva will authenticate     |
| `eva version`         | Report the build, toolchain, and platform |
| `eva help`            | Show this list                     |

## Flags

| Flag              | What it does           |
| ----------------- | ---------------------- |
| `--config <path>` | Pick a settings file   |
| `-p <question>`   | Ask one question       |

Two flags, and that is deliberate. Everything else is a setting, because settings are
reviewable and flags are not. The settings are in
[configuration.md](configuration.md).

## Slash commands

Type `/` at the start of a line in the chat. Eva handles these locally. They never
reach a model, so they cost nothing.

| Command                | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `/help`                | List the commands                                 |
| `/cost`                | What this conversation has cost so far            |
| `/clear`               | Start a fresh conversation                        |
| `/model`               | Show which model is answering                     |
| `/model gpt-5.6-terra` | Switch models, keeping the conversation           |
| `/login`               | Explains that logging in happens outside the chat |

`/model` swaps the model mid-conversation without dropping context, so the next
answer still knows what you talked about. Eva keeps no list of valid model names,
because a list compiled last month would reject a model released last week. If the
provider does not recognise the name, that answer fails and says so.

`/clear` starts a new conversation rather than deleting messages from the current
one. Your old messages stay in the Trace either way.
([why](../adr/0019-clearing-the-transcript-opens-a-new-session.md))

## Keys

| Key                                                                         | What it does                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------ |
| <kbd>enter</kbd>                                                            | Send                                             |
| <kbd>shift</kbd>+<kbd>enter</kbd> or <kbd>alt</kbd>+<kbd>enter</kbd>        | New line without sending                         |
| <kbd>ctrl</kbd>+<kbd>c</kbd>                                                | Stop the answer in progress, keep what you typed |
| <kbd>ctrl</kbd>+<kbd>d</kbd>                                                | Quit                                             |
| <kbd>tab</kbd>                                                              | Finish a slash command                           |
| <kbd>shift</kbd>+<kbd>↑</kbd> <kbd>↓</kbd>, <kbd>pgup</kbd> <kbd>pgdn</kbd> | Scroll back                                      |
| <kbd>ctrl</kbd>+<kbd>home</kbd> / <kbd>ctrl</kbd>+<kbd>end</kbd>            | Jump to the top / back to live                   |

Interrupting is safe. The conversation stays usable, and the Trace records that you
stopped it.

Every one of these is rebindable under `[keymap.bind]`. See
[how-to/theme-a-repository.md](../how-to/theme-a-repository.md).

## Exit codes

`eva -p` exits non-zero when the answer failed, and writes the reason to stderr. That
makes it safe in a pipeline: stdout is the answer and nothing else.

```bash
eva -p "explain this error" > answer.md || echo "that failed"
```

More in [how-to/script-with-eva.md](../how-to/script-with-eva.md).

## When something fails

```
› what is this?

No response — the credential was refused
provider.auth is "api_key", so what anthropic refused is the key in
$ANTHROPIC_API_KEY
```

Two lines, both true. The first names the kind of failure, in Eva's own words rather
than the vendor's error document. The second appears only when Eva checked something
about your machine, and only when that fact leaves exactly one next step.

A missing login says `run eva login`, because that is certainly the fix. A refused key
says which key was sent and stops, because revoked, wrong organisation, and suspended
account all look identical from here. Sending you to fix something that was never
broken costs you every later hint that would have been right.
([why](../adr/0041-a-remedy-is-checked-and-the-layer-that-can-check-it-is-not-the-layer-that-says-it.md))

## Related

- [configuration.md](configuration.md) — every setting and its default
- [../tutorial/first-run.md](../tutorial/first-run.md) — ask your first question
- [../how-to/](../how-to/) — one guide per task
- [../../CONTEXT.md](../../CONTEXT.md) — what each word means
