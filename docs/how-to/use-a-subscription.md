# How to use a ChatGPT or Codex subscription

Pay OpenAI monthly and use that instead of an API key. At the end, Eva will answer
turns against your subscription, and `eva auth status` will name the account and its
expiry.

## Before you start

- Eva built, as in [tutorial/first-run.md](../tutorial/first-run.md).
- A paid ChatGPT or Codex plan.
- A browser on any machine.

## Steps

1. Log in.

   ```bash
   ./eva login
   ```

   Eva prints a URL and a short code. Open the URL, enter the code, and approve it.
   Eva writes the credential to `~/.eva/auth.json` and never prints it.

2. Tell Eva to use it. In `~/.eva/config.toml`:

   ```toml
   [provider]
   name = "openai"
   auth = "subscription"
   ```

   Both lines are needed. `name` picks the provider; `auth` picks which credential
   that provider uses.

## Verify

```bash
./eva auth status
```

```
provider: openai
auth:     subscription
store:    /Users/you/.eva/auth.json
login:    account acct_1a2b, valid until Mon, 11 Aug 2026 09:14:00 IST
```

A `login:` line naming an account and an expiry means the credential is live. Ask
Eva anything to confirm it answers.

## The rule that surprises people

**`auth` decides, and nothing overrides it.**

If `auth = "subscription"`, an exported `OPENAI_API_KEY` is ignored. Eva does not try
the environment first and fall back. `eva auth status` says which one it will use, so
you can check before you spend anything.

Most tools try the environment first. That is how people bill the wrong account for a
month without noticing. See
[adr/0031](../adr/0031-a-credential-has-a-mode-and-the-mode-alone-decides.md).

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `No response — the credential was refused` and `run eva login` | There is no live login under `subscription`. Run `eva login`. Eva offers this step only after it has read the store and found nothing, so the step is a checked fact. |
| `No response — the credential was refused` with **no** next step, and a live login | Logging in again is not what this needs. Eva says so rather than sending you round a loop that cannot help. |
| `/login` inside the chat does nothing | Correct. A login reaches the network and waits on a person, which is everything a slash command must not do. It is a shell verb beside `init`. See [adr/0032](../adr/0032-a-login-is-a-cli-verb-and-its-credential-lives-in-one-auth-store.md). |
| A subscription is refused for a provider other than OpenAI | Only the OpenAI pairing ships. Eva names the supported pair rather than failing vaguely. |

## Related

- [how-to/connect-a-provider.md](connect-a-provider.md) — API keys instead
- [adr/0033](../adr/0033-the-openai-provider-speaks-the-responses-api-with-no-sdk.md) — why two transports, identical past the dial
