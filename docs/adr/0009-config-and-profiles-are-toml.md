---
status: accepted
---

# Config and profiles are TOML

Configuration and profiles are TOML, read with `github.com/BurntSushi/toml`.

Decoding is **strict**: an unknown key is an error carrying migration guidance, never a silent ignore. This is rule 13 — fail closed, fail loud — applied to the file a user hand-edits most often. A typo that quietly disables a setting is the failure mode this stops.

TOML is chosen for the properties that matter in a hand-edited file: no significant whitespace, and no value that reads as one type and parses as another.

## Consequences

Config is the surface a user touches before anything else works, so its error messages are part of the product. A rejected key names itself, says what replaced it, and exits non-zero.

Stage 0 needs no other file format.
