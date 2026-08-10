# Your first run

You will build Eva, ask it one question, and then read that same question back out
of a file on your own disk. That last step is the point. Eva writes the record
first and reads the screen out of the record, so by the end you will have checked
that claim yourself rather than believed it.

This takes about five minutes.

## What you need

- [Go 1.26](https://go.dev/dl/) or newer. Nothing else.
- An Anthropic API key, from [console.anthropic.com](https://console.anthropic.com/).
- `jq`, for the last step only. Any JSON reader does.

## Step 1: Build it

```bash
git clone git@github.com:missingstudio/eva.git
cd eva
go build -o eva ./cmd/eva
```

That writes one binary, `eva`, into the current directory. There is nothing to
install and no service to start.

## Step 2: Give it a key and open it

```bash
export ANTHROPIC_API_KEY=sk-ant-...
./eva
```

Anthropic is the default provider, so nothing needs configuring. Eva opens with its
masthead:

```
 EVA
 Evidence, not claims

 version  0.1.0+e839c8a
 model    claude-sonnet-4-5
 branch   main
 cwd      ~/code/eva

 type /help for slash commands
```

If instead you see a line saying the key is missing, Eva is telling you
`ANTHROPIC_API_KEY` did not reach it. Export it in *this* shell and run `./eva` again.

## Step 3: Ask something

Type a question and press <kbd>enter</kbd>.

```
› what is the difference between a cache write and a cache read?
```

The answer streams in as it arrives. Now ask what it cost:

```
› /cost
session 1.2k in / 340 out · cache 2.0k write / 1.1k read · cost unreported
```

You have a working Eva. Three steps.

Read `cost unreported` closely, because it is deliberate. Neither Anthropic nor
OpenAI returns a dollar figure with a response. Eva says so rather than multiplying
tokens by a price it looked up somewhere.

## Step 4: Read your own trace

Everything above is already on disk. Leave Eva with <kbd>ctrl</kbd>+<kbd>d</kbd>, then:

```bash
wc -l ~/.eva/trace.jsonl
```

One JSON object per line, appended as each thing happened. Look at the kinds in order:

```bash
jq -r '.kind' ~/.eva/trace.jsonl
```

```
started
text
usage
finished
```

That is one Run: it opened, it said something, it reported what it spent, and it
closed. Now read the record that carries your own question back to you:

```bash
jq 'select(.kind == "started") | .payload.intent' ~/.eva/trace.jsonl
```

```
"what is the difference between a cache write and a cache read?"
```

Your question is in the file because the transcript is a fold over this stream. A
first message that is not a record is a transcript no resume can rebuild.

Look at one whole record to see the envelope every kind carries:

```bash
jq 'select(.kind == "usage")' ~/.eva/trace.jsonl
```

```json
{
  "id": "evt_3",
  "seq": 2,
  "wire_seq": 7,
  "at": { "wall": "2026-08-10T09:14:02Z", "mono_ns": 41287000 },
  "version": 1,
  "kind": "usage",
  "tenant": "local",
  "actor": { "id": "local", "kind": "human" },
  "run": "run_1",
  "session": "sess_1",
  "parent": null,
  "payload": {
    "input_tokens": 1200,
    "output_tokens": 340,
    "cache_write_tokens": 2048,
    "cache_read_tokens": 1100,
    "reasoning_tokens": null,
    "server_tool_tokens": null,
    "usd": null
  }
}
```

Three things in that record are worth your attention:

- **`cache_write_tokens` and `cache_read_tokens` are separate figures.** They are
  priced differently, so one combined number could not compute a cost.
- **`reasoning_tokens` is `null`, not `0`.** Anthropic bills thinking tokens inside
  output tokens and reports no separate figure. A zero there would be a confident
  lie rather than a measurement.
- **`usd` is `null`.** This is the `cost unreported` you saw on screen, in the record
  it came from.

## What you built

You have Eva running, and you have read the file that everything on screen came out
of. The screen is a view over that file, never a second account of events.

Two things Eva cannot do yet, so that you are not surprised: it has no tools, so it
cannot read your files, run your tests, or touch your shell. And it keeps no list of
valid model names, because a list compiled last month would reject a model released
last week.

Where to go next:

| If you want to | Read |
| --- | --- |
| Use OpenAI, or a ChatGPT subscription | [how-to/connect-a-provider.md](../how-to/connect-a-provider.md) |
| Call Eva from a script | [how-to/script-with-eva.md](../how-to/script-with-eva.md) |
| Query the trace properly | [how-to/read-the-trace.md](../how-to/read-the-trace.md) |
| Know what the words mean | [CONTEXT.md](../../CONTEXT.md) |
| Know why it is built this way | [explanation/the-ladder.md](../explanation/the-ladder.md) |
