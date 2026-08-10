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

## There is no `--json`, on purpose

Anything that wants machine-readable output reads the trace instead. See
[how-to/read-the-trace.md](read-the-trace.md).

The trace holds the same events, in the same format, whether you used the chat or
`-p`. Every record in it was committed before anything appeared on screen. Parsing
stdout would give you less, and would give it to you later.

This replaced an earlier `eva -p --json`. The reason is worth knowing if you are
tempted to add it back: an interface drawn in place writes cursor moves to its
output, so redirecting the console captures cursor movement rather than an answer.
The record is the machine-readable surface.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Escape codes in the captured file | You captured the chat, not `-p`. Add `-p "<question>"`. |
| Exit 0 but an empty file | Check stderr. A turn that produced no text still closes cleanly. |
| You need the events, not the prose | Read `~/.eva/trace.jsonl`, filtered by the run. See [how-to/read-the-trace.md](read-the-trace.md). |

## Related

- [how-to/read-the-trace.md](read-the-trace.md) — the machine-readable surface
- [reference/architecture.md](../reference/architecture.md) — the event schema
