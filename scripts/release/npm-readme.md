# Eva

an open-source autonomous software factory.

Eva runs coding work end to end — from a spec a machine can check, through a
harness that does the work, to evidence that it was done. It runs on your
laptop as a CLI and as a service you reach from anywhere; those are the same
program.

## Install

```sh
npm i -g @missingstudio/eva
```

This package holds no JavaScript to run: it names one prebuilt binary per
platform as an optional dependency, and installing it selects yours. No
runtime, nothing to compile. `bunx @missingstudio/eva` and
`npx @missingstudio/eva` work too.

## Connect a model

Eva talks to Anthropic, so a key is the whole setup:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
eva
```

Your key never reaches a settings file, a log, or the session record.

## Use it

| Command             | What it does                                            |
| ------------------- | ------------------------------------------------------- |
| `eva`               | Open the interactive surface                            |
| `eva -p "<prompt>"` | Answer once, print to stdout, exit                      |
| `eva trust`         | Read this directory's `.eva`, and record the grant      |
| `eva untrust`       | Drop the grant for this directory                       |
| `eva config show`   | Print the resolved config, and where each key came from |
| `eva --version`     | What you have                                           |

Everything else — the documentation, the roadmap, the source, and the other
ways to install — lives at
[github.com/missingstudio/eva](https://github.com/missingstudio/eva).

MIT licensed.
