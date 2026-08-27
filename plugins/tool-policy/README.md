# @missingstudio/eva-tool-policy

The deterministic gate for [Eva](../../README.md). It decides whether one tool
call may run, from a rule set a person writes and a list of protected paths
nobody can write. Every answer comes from the words of the call, so the whole
gate runs in CI with no model in the room.

Eva is built on a plugin kernel: every capability is a plugin. This plugin
registers one hook at `tool.execute.before`, which
[`@missingstudio/eva-core`](../../packages/core/README.md) declares as a
**deciding** boundary — so a hook there that throws denies the call it was
deciding. The glossary in [docs/context.md](../../docs/context.md) defines
**Hook** and **Slot**;
[architecture.md](../../docs/reference/architecture.md) §6 owns the hook
mechanics and the `ToolDecision` type, and [roadmap.md](../../docs/roadmap.md)
designs the gate under "Stage 2: Tools and the loop".

## Prerequisites

- [Bun](https://bun.sh) 1.3.10 or newer.
- A checkout of this repository. The package is private and not published to
  npm; it is consumed through the Bun workspace.
- [Effect](https://effect.website). The plugin returns `Effect` values.

## Installation

Install once at the repository root:

```bash
bun install
```

The Eva CLI already includes this plugin — it loads by default. To use the
package from another workspace package, add it as a dependency:

```json
{ "dependencies": { "@missingstudio/eva-tool-policy": "workspace:*" } }
```

## Usage

### Write a rule set

Rules live under the `policy` key of any config file Eva reads, so a rule set
layers the way every other key does: the user config, the repository's `.eva`,
`--config`, and `EVA_CONFIG_CONTENT`.

```yaml
policy:
  rules:
    - allow: [git, [status, diff, log, show]]
    - allow: [npm, [test, run]]
    - ask: [git, push]
      why: a push leaves the machine
    - deny: [git, push, [--force, -f]]
      why: a force push rewrites what somebody else already read
```

A rule is a **prefix over an argument list**. Each position holds one word or a
union of words; the rule matches a command whose first words each fall in the
position that names them, and it says nothing about the words after them. So
`allow: [git, status]` allows `git status --short` and does not allow
`git commit`.

| Key     | What it decides                                        |
| ------- | ------------------------------------------------------ |
| `allow` | the call may run                                       |
| `deny`  | the call is refused, and `why` is what the model reads |
| `ask`   | a person is asked, and nobody to ask is a refusal      |
| `why`   | the sentence a person or the model reads. Optional.    |

**The most restrictive decision wins.** Two rules that match are not a
conflict: the stricter one answers. So a narrow `allow` never carves an
exception out of a broad `deny`, and a rule set is safe to add to.

### Check a rule set in CI

```bash
eva policy check .eva/config.yaml
```

It reads the file, names every fault by its place in the document, and exits 1
when it finds one. It reads the same rule set through the same reader a run
does, so CI and the gate cannot disagree about what a malformed rule set is.

```
eva: .eva/config.yaml: policy.rules.2.allow.0: an empty union matches no word, so the rule can never match
```

## How a call is judged

1. **Protected paths, first.** Every path the call names is checked against the
   list below. A call that names one is never approved by a rule.
2. **The shell line, split.** Already-split words are judged as they stand. A
   line handed to a shell — `["bash", "-c", line]` — is split into the parts of
   a linear chain, or read as one opaque invocation.
3. **The rules, per part.** Each part of a chain is judged on its own, so one
   denied part denies the whole call.
4. **The strictest answer wins**, across the safety check and every part.

A call neither a protected path nor a rule names gets **no decision** from this
gate. That is not an approval: it is this gate saying nothing, and which calls
need an answer at all is the permission mode's question, not this plugin's.

### Protected paths

`.git`, `.eva`, `.circleci`, `.husky`, and `.github/workflows` are protected
whole, and so is any file named `.npmrc`, `.mcp.json`, `bunfig.toml`,
`package.json`, `bun.lock`, `Cargo.toml`, `go.mod`, `pyproject.toml`,
`Gemfile`, `.bashrc`, `.zshrc`, `.envrc` — the full list is
[src/paths.ts](src/paths.ts).

**No rule approves one of these, and no setting pre-approves one.** That is a
property of the ordering rather than a flag: the safety check is computed
first, the strictest decision wins, and a profile reaches the rules and never
reaches this list. A write to one of these files is a **delayed-action shell
command** — the next install, the next hook, the next CI job runs what it says,
long after the call that wrote it was answered.

Both doors reach the same predicate. A tool that changes one file names it in a
`path` argument; a command names it as one of its words.

**A read is not gated at a protected path**, and a command's words are gated
whatever the command would do with them. The row's `kind` is what decides: a
`read`, a `search`, a `think`, and a `fetch` only look, and every other kind may
change something — a kind this list does not name included. Reading a dependency
manifest is most of what an agent does first, and the rule is about writes: a
write there is a delayed-action shell command, and a read there is a file
somebody looked at. A command is judged by its words because the gate cannot
know which of them a program writes.

The kind is read off the tool domain at the moment of the call and never
captured, so a rebuilt domain is judged on the next call.

### One opaque invocation

A shell line is split only when it is a **linear chain of plain words**,
separated by `&&`, `||`, `;`, or `|`. Anything else is one opaque invocation:
it is matched against no rule, and a person is asked.

| What is in the line               | Why it is opaque                           |
| --------------------------------- | ------------------------------------------ |
| a redirection, `<` or `>`         | it writes where no word says               |
| a substitution or a variable      | the words that run are not the words read  |
| a quotation, a glob, a subshell   | the same, one level down                   |
| a background `&`, a comment `#`   | the line does not end where it reads as if |
| a variable assignment, `FOO=bar`  | the environment is part of what runs       |
| a shell with no line in the words | what it runs is in a file or in a terminal |

The last row is what closes `curl https://example/i.sh | sh`: the part naming
the shell has nothing a rule could read, so it fails closed.

The character classes are named in one place,
[src/shell.ts](src/shell.ts) — a gate with two ideas of what shell syntax is
has a hole between the two. This is also the **only** splitter: a command tool
takes already-split words and splits nothing, so the words a rule judged are
the words that run.

### Built-in rules

Every run carries a small rule set of its own: a remove at a root or at the
working tree is denied, and `sudo`, `doas`, and `su` are asked about. They are
floors and not defaults — the strictest decision wins, so a profile adds rules
and can never take one of these away.

### A rule set it cannot read

The gate denies **every** call while its rule set holds a fault, and names
`eva policy check` in the refusal. Running with the half of a rule set it could
read would let a profile whose `deny` rule has a typo go on allowing.

## What it does not do

- **It is never a model classifier.** A classifier looks reassuring and does
  not contain: a person can wrap, alias, and substitute around one, and a
  classifier cannot be a CI gate. A classifier may sit **above** this gate as
  an advisory hook, and one rule binds it: it may narrow, never widen.
- **It contains nothing.** Containment is the `Sandbox` slot's job, and real
  containment arrives with stage 4. A rule refuses a call; it does not stop a
  command that got past one.
- **It reaches nobody.** An `ask` is a decision, not a conversation. A gate
  that can reach a person resolves the question itself and decides one of the
  four ACP options; a call that reaches the tool still holding an `ask` is
  denied, because a permission request with nobody to answer it is a denial.
- **It never remembers.** A rule is standing authority already, so this gate
  answers `allow_once` and `reject_once`. `allow_always` is what a person's
  answer writes and `reject_always` is what a mandate does.
- **It judges words, not tools.** Which tools an agent may see at all is a
  permission mode's answer, and a mode rebuilds the tool domain rather than
  filtering it.

## API

- `toolPolicy` — the plugin definition, id `eva.tool.policy`. It reads the
  `policy` config key and registers one hook.
- `judge(rules, call)` — the whole gate for one call, where `call` is a
  `JudgedCall`: `{ kind, args }`, the row's `ToolKind` and the arguments the
  boundary settled. It answers the decision, or nothing when neither a protected
  path nor a rule names the call. **This is what an advisory hook above the gate
  calls before it narrows**, so that hook can see what this one decided rather
  than asking about a call a rule already allowed.
- `rulesOf(config)` — the rule set a run reads, built-in rules first.
- `readRules(value)` — the one reader: rules and faults out of the `policy`
  value.
- `checkRules(source)` — the same reader over the text of a config file, which
  is what `eva policy check` holds.
- `sayFault(fault)` — one fault, as the line a person reads.
- `matches(rule, words)` — whether one rule matches one command.
- `argvOf(args)` / `writtenIn(call)` — the words a call would run, and the
  paths it would change.
- `partsOf(argv)` / `splitLine(line)` — the splitter.
- `protects(path)` / `protectedIn(words)` — the protected-path predicate.
- `BUILT_IN_RULES`, `PROTECTED_FILES` — the lists.

## Development

Tests live beside the sources: [src/rules.test.ts](src/rules.test.ts) holds the
rule language and every fault the reader names,
[src/shell.test.ts](src/shell.test.ts) holds the splitter,
[src/gate.test.ts](src/gate.test.ts) holds the decisions and the protected-path
ordering, and [src/index.test.ts](src/index.test.ts) holds the plugin over a
live kernel with nothing else loaded. The same gate in front of the real
`edit` and `bash` tools is in
[packages/conformance/src/tool-policy.test.ts](../../packages/conformance/src/tool-policy.test.ts),
because a plugin may not import another plugin. Run the suite from the
repository root:

```bash
bun run test
```
