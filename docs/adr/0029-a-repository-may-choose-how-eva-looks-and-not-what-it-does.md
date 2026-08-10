---
status: accepted
---

# A repository may choose how Eva looks, and not what it does

Eva reads a repository's own `.eva/config.toml`, found by walking up from the working directory to the repository it is in. What that file may set is an allow list. Everything else is refused by name.

## Why a repository gets a say at all

Look and feel is the thing a team most wants to share and least wants to retype: the same theme, the same keys, checked in beside the code. A person who has to configure their console per clone configures it once and then does not.

## Why the list is an allow list

`.eva/` in a cloned repository is content from the internet. product.md puts it in the same category as a fetched web page — a prompt-injection surface, not a convenience feature — and the threat is not hypothetical: a settings file is read before the first prompt, by a process holding a credential.

A deny list would admit every key added after it was written. That is the one failure mode a trust boundary cannot have, because the key that gets added is the one nobody thought about. So the question is not which keys are dangerous but which are known to be safe, and a setting added later is refused until someone decides otherwise.

Today the list is `model` and nothing else. Look and feel joins it when there is any.

## What is refused, and what each would have been

Every one of these is a real attack a repository could otherwise run on the first prompt after a clone, with nothing on screen to say so:

| Key                                 | What a repository could have done                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `provider.base_url`                 | pointed every turn at a server it names, seeing the prompts and the transcript                 |
| `provider.api_key_env`              | read the credential from a variable it chooses                                                 |
| `provider.name`, `provider.script`  | answered from a recording it wrote, so the model a person thinks they are talking to is a file |
| `trace.path`, `trace.kind`          | moved the Trace — the single source of truth — somewhere it controls                           |
| `identity.tenant`, `identity.actor` | attributed the run to someone else, which is the tenancy boundary                              |

`model` is on the allow list because choosing a model is choosing how the work is done rather than who does it. It cannot move the traffic or the credential. It can cost money, which is the honest cost of admitting it, and a budget is the thing that bounds that rather than a settings file.

## The message

A refusal names three things: the key, the file that tried to set it, and the file that may. Configuration is the surface a person touches before anything else works, so a refusal that sends them looking is a product failure. It names the leaf rather than the table above it, because a person who wrote `base_url` and is told `provider` is not theirs to choose has to work out which line to delete.

## The walk

Up from the working directory, stopping at the repository boundary. Settings belong to this checkout, and a directory that happens to be its parent is not part of it — a `.eva/` above a clone is somebody else's.

The boundary is checked *after* the settings in each directory, so the repository root's own `.eva/` is found rather than cut off by the `.git` that marks the root.

## Consequences

**A named file is still the file that is read.** `--config` and `EVA_CONFIG` mean what they meant. The repository's settings apply over whichever file is the person's, because the trust argument does not change with where the person's own settings live.

**Load now touches the working directory.** It reads `os.Getwd` and walks it. A process with no working directory reads nothing and the person's own configuration stands.

**Falsifier:** the design is failing if a capability key ever takes effect from a repository's file, by any path — a new key added to the struct without a thought about the list, a table opened wholesale that turns out to contain one. That is not a bug to fix in place: it means the allow list stopped being the only way in, and the way in is what has to be redesigned.
