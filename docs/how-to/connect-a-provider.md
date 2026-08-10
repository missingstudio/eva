# How to connect a provider with an API key

Point Eva at Anthropic or OpenAI using a key you hold. At the end, `eva auth status`
will report the provider and the credential Eva will actually use.

For a ChatGPT or Codex subscription instead of a key, read
[how-to/use-a-subscription.md](use-a-subscription.md).

## Before you start

- Eva built, as in [tutorial/first-run.md](../tutorial/first-run.md).
- A key from the provider you want.

## Anthropic

Anthropic is the default. Export the key and run Eva:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./eva
```

That is the whole setup. No file is needed.

## OpenAI

OpenAI needs one line in a settings file, because the provider name is a setting.

1. Write a starter settings file.

   ```bash
   ./eva init
   ```

   This writes `~/.eva/config.toml` with every option present but commented out. It
   refuses to overwrite a file that already exists.

2. Name the provider in `~/.eva/config.toml`.

   ```toml
   [provider]
   name = "openai"
   ```

3. Export the key.

   ```bash
   export OPENAI_API_KEY=sk-...
   ```

One line is enough. The model and the key variable both follow the provider you
picked, so you get `gpt-5.6-terra` reading `OPENAI_API_KEY` without naming either.

## Use a proxy, a gateway, or a local server

Set `base_url`. Everything else stays as it is.

```toml
[provider]
name     = "openai"
base_url = "http://localhost:11434/v1"
```

## Verify

```bash
./eva auth status
```

```
provider: anthropic
auth:     api_key
env:      ANTHROPIC_API_KEY (set)
```

The `auth` line is the one that decides. If it says `api_key`, Eva reads the
environment variable named on the `env` line and nothing else.

## Troubleshooting

| What you see                                        | What it means                                                                                                                                                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No response — the credential was refused`          | The key reached the provider and the provider rejected it. Eva names which variable it sent and stops there, because a revoked key, a wrong organisation, and a suspended account are identical from here. |
| Eva refuses to start, naming a key                  | A typo in `config.toml`. A settings file that silently ignored what you wrote would be worse. Fix the named key.                                                                                           |
| `auth status` reports a provider you did not choose | A project `.eva/config.toml` is in play. Run `eva auth status` from outside the repo to compare.                                                                                                           |
| The model name is rejected                          | Eva keeps no list of valid models, so this came from the provider. Check the name against the provider's own list.                                                                                         |

## Related

- [how-to/use-a-subscription.md](use-a-subscription.md) — a monthly plan instead of a key
- [how-to/theme-a-repository.md](theme-a-repository.md) — what a cloned repo may and may not set
- [adr/0031](../adr/0031-a-credential-has-a-mode-and-the-mode-alone-decides.md) — why there is no fallback chain
