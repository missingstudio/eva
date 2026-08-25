# Triage labels

The skills speak in terms of five canonical triage roles. This file maps those
roles to the strings this repo uses.

| Label in the skills | Label here        | Meaning                                  |
| ------------------- | ----------------- | ---------------------------------------- |
| `needs-triage`      | `needs-triage`    | Maintainer needs to evaluate this issue  |
| `needs-info`        | `needs-info`      | Waiting on reporter for more information |
| `ready-for-agent`   | `ready-for-agent` | Fully specified, ready for an AFK agent  |
| `ready-for-human`   | `ready-for-human` | Requires human implementation            |
| `wontfix`           | `wontfix`         | Will not be actioned                     |

The defaults are kept: each label string equals its name. When a skill names a
role, use the string from the right-hand column.

## Where a role is recorded

The tracker is local markdown ([issue-tracker.md](issue-tracker.md)), so a role
is a `Status:` line near the top of the ticket file, not a label on a service.

```markdown
# A dropped pipe says so

Status: ready-for-agent
```

The GitHub repository already carries a `wontfix` label from its default set.
The other four do not exist there and are not created, because no issue is
tracked on GitHub today. If triage ever moves to GitHub Issues, they are
created on first use and this table needs no change.

## What is triaged, and what is not

Triage is only for issues **this repo did not create** — a bug report, an
incoming request, anything that arrives raw.

A ticket that `/to-tickets` produced from a spec is already agent-ready.
**Do not triage it.** Its status lives in the stage's plan table, and putting a
triage role on it means two places disagree about what state it is in.
