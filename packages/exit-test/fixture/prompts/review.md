Review the source file below and report what you find.

Answer with a JSON array only, in this shape and nothing else:

[{"line": 12, "severity": "warn", "note": "what is wrong, in one sentence"}]

`line` is the 1-based line number the finding is on. `severity` is exactly
one of "info", "warn" or "error". Report at least one finding; an empty
array means the file is clean.

The source file:

{{source}}
