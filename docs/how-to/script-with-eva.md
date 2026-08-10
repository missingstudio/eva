# How to call Eva from a script

Answer one question, print it to stdout, and exit. At the end you will have a
pipeline step that fails loudly rather than emitting half an answer.

## Before you start

- A provider connected, as in [how-to/connect-a-provider.md](connect-a-provider.md).

## Steps

1. Ask one question with `-p`.

   ```bash
   ./eva -p "explain this error" > answer.md
   ```

   Eva writes the answer to stdout and exits. It draws no interface.

2. Check the exit code.

   ```bash
   ./eva -p "explain this error" > answer.md || echo "that failed"
   ```

   Eva exits non-zero when the answer failed, and writes the reason to stderr. So
   stdout is the answer and nothing else.

3. Pipe input in, as with any other command.

   ```bash
   git diff --staged | ./eva -p "write a conventional commit message for this diff"
   ```

## Verify

Force a failure and confirm the script notices:

```bash
env -u ANTHROPIC_API_KEY ./eva -p "hello" > out.txt; echo "exit=$?"
```

```
exit=1
```

`out.txt` is empty, and the reason went to stderr. A step that fails this way cannot
feed a truncated answer into whatever runs next.

## Reading the output as data

`-p` gives you the answer as prose. For anything structured, read the trace: see
[how-to/read-the-trace.md](read-the-trace.md).

The trace holds the same events, in the same format, whether you used the chat or
`-p`. Every record in it was committed before anything appeared on screen. So the
trace tells you more than stdout could, and tells you sooner.

## Troubleshooting

| What you see                       | What to do                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Escape codes in the captured file  | You captured the chat, not `-p`. Add `-p "<question>"`.                                            |
| Exit 0 but an empty file           | Check stderr. A turn that produced no text still closes cleanly.                                   |
| You need the events, not the prose | Read `~/.eva/trace.jsonl`, filtered by the run. See [how-to/read-the-trace.md](read-the-trace.md). |

## Related

- [how-to/read-the-trace.md](read-the-trace.md) — the machine-readable surface
- [reference/architecture.md](../reference/architecture.md) — the event schema
