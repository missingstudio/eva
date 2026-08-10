<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/eva-banner-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/eva-banner-light.png">
    <img alt="Eva — an autonomous, multi-tenant, AI-native software factory" src="docs/assets/eva-banner-dark.png" width="100%">
  </picture>
</p>

<h1 align="center">Eva</h1>

<p align="center"><strong>Evidence, not claims.</strong></p>
<p align="center">
  An autonomous, multi-tenant, AI-native software factory
</p>

<p align="center">
  <a href="https://github.com/missingstudio/eva/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/missingstudio/eva/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://go.dev/"><img alt="Go 1.26" src="https://img.shields.io/badge/Go-1.26-00ADD8?logo=go&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue"></a>
</p>

---

Most AI tools tell you what they did. Eva writes it down first.

Every question you ask, every answer that comes back, every retry, and every token counted is appended to a file on your disk as it happens. What you see on screen is read back out of that file. If Eva shows you an answer, the file already had it. There is no second version of events.

That sounds like a small thing. It is the whole design.

## What it looks like

```
$ eva

 EVA
 Evidence, not claims

 version  0.1.0+e839c8a
 model    claude-sonnet-4-5
 branch   main
 cwd      ~/code/eva

 type /help for slash commands

› what's the difference between a cache write and a cache read?

A cache write stores your prompt prefix so later calls can skip re-reading
it. A cache read is one of those later calls hitting the stored copy…

› /cost
session 1.2k in / 340 out · cache 2.0k write / 1.1k read · cost unreported
```

Notice `cost unreported`. Neither Anthropic nor OpenAI returns a dollar figure with a response. So Eva says so, rather than multiplying tokens by a price it looked up somewhere. A number you can argue with a bill about has to come from the bill.

> [!NOTE]
> **Eva is early.** Today it is a good terminal chat client with a very carefully built foundation. It can read your question and answer it. It cannot read your files, run your tests, or touch your shell — there are no tools yet.

## Where this is going

Eva is being built toward a control plane for coding agents. Work arrives as a spec with acceptance criteria a machine can check. Several harnesses race the same spec in isolated environments. A verifier Eva owns decides what actually passed, and the whole race is scored from the same record everything else is scored from.

The reason for building the foundation this carefully first is the ladder in [docs/explanation/the-ladder.md](docs/explanation/the-ladder.md): ten rungs from a model to a company, climbed in order. Every step adds the one thing the rung below it cannot do, so every step you don't take is a way this fails.

| Rung                          | What breaks without it                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| **Model**                     | —                                                                |
| **Workflow**                  | Control flow is handed to the model before the model can hold it |
| **Agent**                     | Nothing adapts. Every path has to be written in advance          |
| **Environment + verifier**    | Nothing tells the agent it is wrong, so it never converges       |
| **Harness**                   | A run has no bounds — no budget, no policy, no tools it may use  |
| **Scheduler + spec format**   | More agents is not a factory. A factory needs a queue and a spec |
| **Software factory**          | Work stays one at a time                                         |
| **Learning loop + economics** | No evals, and no cost per merged change                          |
| **Intent + authority**        | Nobody owns what was decided, and nobody answers for it          |
| **Autonomous company**        | —                                                                |

Nineteen stages, each with an exit test it can fail. One of them is built. The plan is a draft; the stage that shipped is not.

## Install

You need [Go 1.26](https://go.dev/dl/) or newer. Nothing else.

```bash
git clone git@github.com:missingstudio/eva.git
cd eva
go build -o eva ./cmd/eva
```

That produces a single binary in the current directory. Put it on your `PATH` if you want it everywhere.

## Connect a model

Eva talks to Anthropic and OpenAI. Pick one.

### With an API key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./eva
```

That's the whole setup. Anthropic is the default, so nothing needs configuring.

For OpenAI, create a settings file and name the provider:

```bash
./eva init                       # writes ~/.eva/config.toml
export OPENAI_API_KEY=sk-...
```

```toml
[provider]
name = "openai"
```

One line is enough. The model and the key variable follow the provider you picked, so you get `gpt-5.6-terra` reading `OPENAI_API_KEY` without saying either out loud.

### With a ChatGPT or Codex subscription

If you pay OpenAI monthly, you can use that instead of an API key:

```bash
./eva login
```

It prints a URL and a short code, you approve it in a browser, and the credential is saved to `~/.eva/auth.json`. Then set the mode in `~/.eva/config.toml`:

```toml
[provider]
name = "openai"
auth = "subscription"
```

Check what Eva will actually use at any time:

```bash
./eva auth status
```

```
provider: openai
auth:     subscription
store:    /Users/you/.eva/auth.json
login:    account acct_1a2b, valid until Mon, 11 Aug 2026 09:14:00 IST
```

> [!IMPORTANT]
> **`auth` decides, and nothing overrides it.** If it says `subscription`, an exported `OPENAI_API_KEY` is ignored, and `eva auth status` will tell you so rather than quietly using it. Most tools try the environment first, which is how people bill the wrong account for a month without noticing. ([why](docs/adr/0031-a-credential-has-a-mode-and-the-mode-alone-decides.md))

Your key is never written to a settings file. Eva reads it from the environment, or gets it when you log in. It never appears in the history file, a log, or anything sent to a model.

## Using Eva

### Chatting

Run `eva` with no arguments and type. Answers stream in as they arrive.

| Key                                                                         | What it does                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------ |
| <kbd>enter</kbd>                                                            | Send                                             |
| <kbd>shift</kbd>+<kbd>enter</kbd> or <kbd>alt</kbd>+<kbd>enter</kbd>        | New line without sending                         |
| <kbd>ctrl</kbd>+<kbd>c</kbd>                                                | Stop the answer in progress, keep what you typed |
| <kbd>ctrl</kbd>+<kbd>d</kbd>                                                | Quit                                             |
| <kbd>tab</kbd>                                                              | Finish a slash command                           |
| <kbd>shift</kbd>+<kbd>↑</kbd> <kbd>↓</kbd>, <kbd>pgup</kbd> <kbd>pgdn</kbd> | Scroll back                                      |
| <kbd>ctrl</kbd>+<kbd>home</kbd> / <kbd>ctrl</kbd>+<kbd>end</kbd>            | Jump to the top / back to live                   |

Interrupting is safe. The conversation stays usable and the history file records that you stopped it.

### Slash commands

Type `/` at the start of a line. These are handled locally and never reach a model, so they cost nothing.

| Command                | What it does                                      |
| ---------------------- | ------------------------------------------------- |
| `/help`                | List the commands                                 |
| `/cost`                | What this conversation has cost so far            |
| `/clear`               | Start a fresh conversation                        |
| `/model`               | Show which model is answering                     |
| `/model gpt-5.6-terra` | Switch models, keeping the conversation           |
| `/login`               | Explains that logging in happens outside the chat |

`/model` swaps the model mid-conversation without dropping context, so the next answer still knows what you talked about. Eva doesn't keep a list of valid model names, because a list compiled last month would reject a model released last week. If the provider doesn't recognise the name, that answer fails and tells you.

`/clear` starts a new conversation rather than deleting messages from the current one. Your old messages are still in the history file either way. ([why](docs/adr/0019-clearing-the-transcript-opens-a-new-session.md))

### From a script

`eva -p` answers one question, prints it to stdout, and exits.

```bash
eva -p "explain this error" > answer.md || echo "that failed"
```

It exits non-zero when the answer failed, and writes the reason to stderr. That makes it safe to use in a pipeline: stdout is the answer and nothing else.

### When something fails

```
› what is this?

No response — the credential was refused
provider.auth is "api_key", so what anthropic refused is the key in
$ANTHROPIC_API_KEY
```

Two lines, both true. The first names the kind of failure, in Eva's own words rather than the vendor's error document. The second appears only when Eva checked something about your machine, and only when that fact leaves exactly one next step. A missing login says `run eva login` because that is certainly the fix. A refused key says which key was sent and stops, because revoked, wrong organisation, and suspended account all look identical from here. Sending you to fix something that was never broken costs you every later hint that would have been right. ([why](docs/adr/0041-a-remedy-is-checked-and-the-layer-that-can-check-it-is-not-the-layer-that-says-it.md))

### Everything you can type

| Command               | What it does                       |
| --------------------- | ---------------------------------- |
| `eva`                 | Open the chat                      |
| `eva -p "<question>"` | Answer once, print to stdout, exit |
| `eva init`            | Write a starter settings file      |
| `eva login`           | Sign in to a subscription          |
| `eva auth status`     | Show how Eva will authenticate     |
| `eva help`            | Show this list                     |

Two flags, and that's deliberate: `--config <path>` picks a settings file, `-p <question>` asks one question. Everything else is a setting, because settings are reviewable and flags are not.

| Environment variable | What it's for                                            |
| -------------------- | -------------------------------------------------------- |
| `ANTHROPIC_API_KEY`  | Your Anthropic key                                       |
| `OPENAI_API_KEY`     | Your OpenAI key                                          |
| `EVA_CONFIG`         | A different settings file (default `~/.eva/config.toml`) |
| `EVA_HOME`           | A different home for Eva's files (default `~/.eva`)      |

## Settings

`eva init` writes `~/.eva/config.toml` with every option present but commented out, and a note beside each saying what happens without it. Nothing is chosen for you. Uncomment a line to change it.

Here is what Eva does with none of it written down:

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

Colours, glyphs, spacing, and key bindings live under `[theme]` and `[keymap.bind]`, and the starter file lists those too. Set none of them and Eva looks exactly as it did before any of it was configurable. Colours follow your terminal's background and what it can display, so it fits in without being told.

Settings are read from four places, each overriding the one before: built-in defaults, your file, the project's file, then `--config`. Eva works fine with none of them.

A typo is an error, not a shrug. Write `modl = "..."` and Eva refuses to start and names the key. A settings file that silently ignores what you wrote is worse than one that won't load.

### Project settings

A repo can carry `.eva/config.toml`, found by walking up from wherever you are. Handy for sharing a team's look:

```toml
[theme.colors]
person = "#7AA6DC"

[theme.symbols]
prompt = "› "

[keymap.bind]
follow = ["ctrl+g"]
```

> [!WARNING]
> **A repo can change how Eva looks, never what it does.** You clone a repo from the internet, and Eva reads that file before your first question, in a process holding your API key. So the list of what it may set is a short allow-list: appearance and key bindings. It cannot pick the model provider, point traffic at another server, rename the variable your key is read from, or move your history file. Anything else in that file is refused by name. ([why](docs/adr/0029-a-repository-may-choose-how-eva-looks-and-not-what-it-does.md))


## Glossary

Eva is strict about naming, because the same concept under three names is how a codebase rots. Five of them show up in the docs and the code:

| Word         | Plain English                                                                |
| ------------ | ---------------------------------------------------------------------------- |
| **Session**  | One conversation. Survives a crash. What resume and rewind will act on.      |
| **Run**      | One question and its answer. A conversation has many.                        |
| **Turn**     | One round trip to the model. A single Run may need several once tools exist. |
| **Trace**    | The history file. The single source of truth for what happened.              |
| **Provider** | A model behind one interface: Anthropic, OpenAI, whatever comes next.        |

The full list is [CONTEXT.md](CONTEXT.md), including the words that were tried and retired.

## How Eva is built

One Go module. Data flows one way, and the compiler enforces it.

```
   you type                                     you read
      │                                            ▲
      ▼                                            │
   ┌──────┐    ┌──────┐    ┌───────────┐        ┌────────┐
   │ tui  │───▶│ loop │───▶│ providers │        │ render │
   └──────┘    └──┬───┘    └───────────┘        └───▲────┘
                  │                                 │
                  ▼          committed first        │
              ┌───────┐  ───────────────────────────┘
              │ trace │      then shown
              └───────┘
```

The important part is the bottom. Nothing reaches your screen that didn't go through the file first. The rendering layer physically cannot talk to a model, a conversation, or the history file. It takes records and returns strings, and that's all it's allowed to import.

| Package                                          | What lives there                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| [`events`](internal/events)                      | The record format. Standard library only.                                 |
| [`core`](internal/core)                          | The domain types and the conversation. No files, no network, no terminal. |
| [`trace`](internal/trace)                        | The file writer. Owns ordering, writes groups atomically.                 |
| [`config`](internal/config)                      | Settings, read strictly.                                                  |
| [`auth`](internal/auth)                          | Sign-in and credential storage.                                           |
| [`providers`](internal/providers)                | The model interface, plus `anthropic` and `openai`.                       |
| [`loop`](internal/loop)                          | The thing that answers one question.                                      |
| [`render`](internal/render)                      | Records in, strings out.                                                  |
| [`theme`](internal/theme), [`tui`](internal/tui) | Appearance, and the chat interface.                                       |
| [`cli`](internal/cli)                            | Wiring. Nothing imports it.                                               |

Those boundaries are an allow-list per package in [`.golangci.yml`](.golangci.yml), running in strict mode. An import nobody explicitly permitted fails the build. Widening a list is a visible line in a diff with a reason next to it, not something that happens by accident.

Three decisions do most of the work:

- **A provider only knows how to dial, read a chunk, and hang up.** Queueing, retrying, and counting are written once and shared. Adding a provider is a few hundred lines, not a copy of the machinery. ([0034](docs/adr/0034-one-driver-pulls-a-turn-and-a-provider-is-a-wire.md))
- **Things register themselves.** Providers and file writers add themselves to the set that settings choose from. So the wiring layer names no implementation, and the error listing your options cannot go stale. ([0028](docs/adr/0028-selection-is-a-registry.md))
- **The screen is a read-only view.** It renders records and nothing else. ([0015](docs/adr/0015-the-live-area-shows-the-stream-and-only-the-record-is-kept.md))

## Working on Eva

```bash
make check
```

That is exactly what CI runs: formatting, build, vet, lint, tests, every package.

| Target       | What it does                                             |
| ------------ | -------------------------------------------------------- |
| `make check` | Everything below, in order                               |
| `make fmt`   | Fails if anything isn't gofmt-clean                      |
| `make lint`  | golangci-lint, where the package boundaries are enforced |
| `make test`  | Every package                                            |
| `make eva`   | Build the binary into the repo root                      |
| `make tidy`  | Tidy dependencies                                        |

The linter version is pinned and run via `go run`, so you don't install anything and your results match CI.

Tests drive the real Anthropic and OpenAI code against a local server speaking the real protocol. There's no mock provider, because a mock is a second implementation that can disagree with the first and be believed. ([0036](docs/adr/0036-a-replaying-provider-is-not-a-provider-a-person-may-select.md))

## Where to read more

|                                                                      |                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [docs/tutorial/first-run.md](docs/tutorial/first-run.md)             | Build it, ask one question, then read that question back out of the trace.                |
| [docs/how-to/](docs/how-to/)                                         | One guide per task: providers, subscriptions, scripting, the trace, repo themes.          |
| [docs/product.md](docs/product.md)                                   | The map to every design document. Start here to find the rest.                            |
| [docs/roadmap.md](docs/roadmap.md)                                   | The plan. Nineteen stages, each with a test it can fail. Draft.                           |
| [docs/decisions.md](docs/decisions.md)                               | Every decision on one page, grouped by topic. Start here.                                 |
| [docs/adr/](docs/adr/)                                               | The decisions in full, one file each. The filename is the decision, so `ls` is the index. |
| [CONTEXT.md](CONTEXT.md)                                             | The glossary. One concept, one name.                                                      |
| [AGENTS.md](AGENTS.md)                                               | How to work in this repo.                                                                 |
| [docs/agents/design-rules.md](docs/agents/design-rules.md)           | The practices the code follows, and which ones a linter enforces.                         |
| [docs/agents/project-structure.md](docs/agents/project-structure.md) | Where a new package or binary goes.                                                       |

Nothing in `docs/adr/` is ever rewritten or deleted. When a later decision overturns an earlier one, the old file says so in its own status line and stays. Being wrong is part of the record too.

## Licence

MIT. See [LICENSE](LICENSE).
