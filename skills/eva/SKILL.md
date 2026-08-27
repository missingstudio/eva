---
name: eva
description: Run a coding prompt through Eva from a shell and branch on the exit code. Use when a script, a git hook, or a CI job has to run a coding prompt and act on whether it succeeded.
license: MIT
metadata:
  homepage: https://evafactory.co
  repository: https://github.com/missingstudio/eva
---

# Eva

Eva is an open-source, autonomous software factory. It runs coding work end to
end, from a spec a machine can check to evidence that it was done. It runs on
the machine that calls it: there is no hosted API, no account, and no key to
request from a website.

## When to use Eva

- A coding prompt has to run without a person at a terminal, and the caller
  needs an exit code rather than a transcript to parse.
- The work has to be recorded. Eva folds everything it shows from a durable
  trace on disk, and records what the provider said each request cost.
- One contract should reach several model vendors. The provider is a plugin,
  and `--model provider/model` picks one per run.

## When not to use Eva

- The caller needs a hosted endpoint. Eva has none.
- The caller needs one spec raced across several harnesses, or unattended
  overnight runs. Both are on the roadmap and neither ships today.
- The caller needs the work verified against acceptance criteria. Eva records
  an agent's claim as a claim, never as evidence.

## Install

```sh
npm i -g @missingstudio/eva
```

Homebrew and a shell script are the other two channels:
<https://docs.evafactory.co/install>.

## Run it

`--print` is the whole scriptable surface. It answers once, writes the answer
to stdout, and exits.

```sh
eva -p "review the diff and name the riskiest change"
```

The prompt is a flag and never a bare argument, so a misspelled command is
reported as a misspelling rather than run as a prompt.

| Flag                       | What it does                           |
| -------------------------- | -------------------------------------- |
| `-p, --print <prompt>`     | answer once and exit                   |
| `--model <provider/model>` | set the model for this run             |
| `--config <path>`          | overlay a config file, repeatable      |
| `--plugin <id>`            | load a plugin for this run, repeatable |
| `--without-plugin <id>`    | skip a plugin for this run, repeatable |

## Read the exit code

| Code | When                                                                      |
| ---- | ------------------------------------------------------------------------- |
| 0    | the help, the version, a grant, `config show`, or a Run that ended `done` |
| 1    | a parse error, an unreadable config, or a Run that ended any other way    |
| 130  | the second Ctrl+C                                                         |

An unread config key is a **Finding**: Eva writes it to stderr and the run
continues, and the exit code is whatever the run itself earned. A stale config
key does not break a pipeline, and a silent one does not go unmentioned.

```sh
eva -p "review the diff" > review.txt || exit 1
```

## Credentials

Eva reads a model key from the environment of the shell that runs it. The key
never reaches a config file, a log, or the session record. Set it the way the
provider documents: <https://docs.evafactory.co/connect-a-model>.

## Repository trust

Eva reads a project's `.eva` directory only after someone runs `eva trust` in
it. Until then that configuration is inert, so cloning a repository does not
hand it Eva's behaviour.

```sh
eva trust
```

## Everything else

- Every capability, as a machine-readable index:
  <https://evafactory.co/.well-known/agent-skills/index.json>
- What Eva is and when to reach for it: <https://evafactory.co/llms.txt>
- Every documentation page as markdown: <https://docs.evafactory.co/llms.txt>
- The command surface: <https://docs.evafactory.co/reference/cli>
