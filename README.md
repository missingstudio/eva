<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo/eva-logo-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo/eva-logo-black.svg">
    <img alt="Eva — an open-source autonomous software factory" src="assets/logo/eva-logo-black.svg" width="36%">
  </picture>
</p>

<p align="center">an open-source autonomous software factory.</p>

<p align="center">
  <a href="https://github.com/missingstudio/eva/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/missingstudio/eva/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/missingstudio/eva/actions/workflows/security.yml"><img alt="Security" src="https://github.com/missingstudio/eva/actions/workflows/security.yml/badge.svg"></a>
  <a href="https://github.com/missingstudio/eva/actions/workflows/audit.yml"><img alt="Audit" src="https://github.com/missingstudio/eva/actions/workflows/audit.yml/badge.svg"></a>
  <a href="https://bun.sh/"><img alt="Bun 1.3" src="https://img.shields.io/badge/Bun-1.3-black?logo=bun&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue"></a>
</p>

<p align="center">
  <img alt="Eva answering a question in the terminal" src="assets/eva-cli.png" width="100%">
</p>

---

Eva is an open-source, autonomous software factory. It runs coding work end to
end — from a spec a machine can check, through a harness that does the work, to
evidence that it was done. Eva ships its own harness and drives the ones you
already pay for behind one contract, with one trace, one verifier, and one
bill. It runs on your laptop as
a CLI and as a service you reach from anywhere; those are the same program.

> [!NOTE]
> **Eva is early.** Today it answers a prompt at a terminal and runs a declared
> Workflow, on a plugin kernel: a small core loads plugins, and every capability
> — the model, the surface, the trace, the themes, the Workflow itself — is one.
> No agent yet, and nothing verifies work beyond the shape of it. Where this
> goes next is the [roadmap](docs/roadmap.md).

### Install

```bash
# Homebrew, on macOS
brew install --cask missingstudio/tap/eva

# The install script, on macOS and Linux
curl -fsSL https://raw.githubusercontent.com/missingstudio/eva/main/scripts/install.sh | sh

# npm — a prebuilt binary for your platform, no runtime needed
npm i -g @missingstudio/eva

# From source, with Bun 1.3 or newer
git clone git@github.com:missingstudio/eva.git && cd eva && bun install && bun run eva
```

The script checks the download against the release's signed checksums before it
installs anything, and says so either way. Read
[scripts/install.sh](scripts/install.sh) first if you prefer, or pass
`--require-signature` to make an unverifiable download a refusal. Every archive
also carries a provenance attestation:
`gh attestation verify <archive> --repo missingstudio/eva`.

### Connect a model

Eva talks to Anthropic and to OpenAI, so a key is the whole setup:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY=sk-...
eva
```

Your key never reaches a settings file, a log, or the session record. Any
OpenAI-compatible endpoint — Ollama, llama.cpp, vLLM, LM Studio, a hosted
gateway — is named in config instead, and its models join `/model`:
[provider-compatible](plugins/provider-compatible/README.md) has the keys.

### Use it

| Command                 | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| `eva`                   | Open the interactive surface                              |
| `eva -p "<prompt>"`     | Answer once, print to stdout, exit                        |
| `eva run <name> [file]` | Run a Workflow: one input in, the last Run's text out     |
| `eva serve --web`       | Serve the page that watches a Session, at a loopback bind |
| `eva trust`             | Read this directory's `.eva`, and record the grant        |
| `eva untrust`           | Drop the grant for this directory                         |
| `eva config show`       | Print the resolved config, and where each key came from   |
| `eva --version`         | What you have                                             |

A **Workflow** is a declared list of Steps — one Instruction and one model
request each — where the file owns the control flow and the model fills the
slots. A Step may name a JSON Schema, and a Candidate that does not conform is
asked again with every Fault named — once by default. Nothing it does depends
on what a model decided, which is why it comes before agents. You declare one under the
`workflows` key or as `.eva/workflows/<name>.yaml`; none ship:

```bash
git diff --staged | eva run commit-msg     # piped standard input
eva run review src/auth/login.ts           # a positional file
eva run release-notes --input CHANGELOG.md # or --input
```

One route at a time — two at once is refused with both named.
[eva-workflow](plugins/workflow/README.md) is the whole surface.

In the chat, type `/` for the local commands: `/help`, `/model`, `/cost`, and
`/clear`. They never reach a model, so they cost nothing. `eva -p` and
`eva run` exit non-zero when the answer fails, which makes them safe in a
pipeline.

The global flags are valid on every command: `--model provider/model` sets the
model for this run, `--config <path>` overlays a config file, and `--plugin` /
`--without-plugin` add or skip a plugin. The full surface, including how it is
parsed, is [reference/command-line.md](docs/reference/command-line.md).

### Settings

A repository can carry a `.eva` directory to share a team's setup. Eva reads it
only after you run `eva trust` there — the grant is yours to give, so it is a
verb you run rather than a file a repository can ship. `eva config show` names
every resolved key and where it came from.

### Documentation

|                                                                   |                                               |
| ----------------------------------------------------------------- | --------------------------------------------- |
| [docs/README.md](docs/README.md)                                  | The map — start here                          |
| [docs/context.md](docs/context.md)                                | The glossary. One concept, one name           |
| [reference/architecture.md](docs/reference/architecture.md)       | The plugin model, the kernel, every interface |
| [reference/writing-plugins.md](docs/reference/writing-plugins.md) | Author a plugin                               |
| [reference/command-line.md](docs/reference/command-line.md)       | Every command and flag                        |
| [reference/toolchain.md](docs/reference/toolchain.md)             | How to build and test, and CI's jobs          |
| [docs/development.md](docs/development.md)                        | How a change is made, and where each stage is |
| [reference/ci-cd.md](docs/reference/ci-cd.md)                     | How a change is checked and a release ships   |
| [docs/product.md](docs/product.md)                                | What Eva is for, and who for                  |
| [docs/roadmap.md](docs/roadmap.md)                                | What we build, in what order                  |

### Contributing

```bash
bun install && bun run verify
```

That is exactly what CI checks on every change. Read [AGENTS.md](AGENTS.md)
for the commit and branch rules, and
[docs/development.md](docs/development.md) for the loop one change goes
through, before you open a pull request.

---

MIT licensed. See [LICENSE](LICENSE).
