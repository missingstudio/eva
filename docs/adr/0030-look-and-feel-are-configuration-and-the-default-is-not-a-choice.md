---
status: accepted
---

# Look and feel are configuration, and the default is not a choice

Every colour, glyph, measurement, and key binding is a value in `internal/theme` or `internal/tui/keymap`, built from a person's configuration and handed to the console. `theme.Default(dark)` and `keymap.Default()` are exactly what Eva looked like and answered to before any of this existed.

This supersedes a policy two comments stated: "a style nobody chose is the only style there is", beside the greys, and "a style a person had to select is a style most people never select", beside the console's own.

## What the policy was right about

Both sentences are true of a *first run*, and neither is an argument against a file. What they are an argument against is an interface that asks — a first run that opens on a question, or a default assembled from whatever a person happened not to set. So the reason survives the policy, as the property the new code has to hold: **`Default` is complete, every field of it**, a person who configures nothing sees no change, and the tests that assert on the screen did not move when this landed.

## Why the policy could not stand

Eva's frontends are an extension point. Product.md's stage 6.5 publishes `RegisterRenderer` and names themes in a package manifest; a harness whose interface is meant to be extended by people who did not write it cannot hold "nothing about that interface is configurable" as a permanent rule.

The narrower reason is that the policy was already being paid for. `ui.Subdued` exists — exported, with a comment explaining that the console cannot name the grey without importing the fold — because one colour had to be named in two packages. That is the shape of a missing type.

## Where the two live, and why not together

`theme` is a layer beside `ui` rather than a package under `tui`, because two things draw: the console, and the fold a person reads a turn in. `ui` may not import anything under `tui`, so a Theme under the console would have left the fold with its own greys and `Subdued` would still be exported to bridge them. One package is what makes "subdued" one colour.

`keymap` sits under `tui`, because only a console has keys.

Both are given lipgloss and the standard library and nothing else Eva has. No `events`, so a Theme cannot decide *what* a person is shown as well as how. No `config`, so the layer that reads files is still the only layer that reads files: `cli` maps a `Config` onto a `Theme` and hands it in, which is what lets the console be configurable while remaining unable to read a configuration.

## Two invariants that moved from comments into types

**A binding cannot steal a prompt character.** A console is a prompt, so a binding on a bare printable key takes that character away from whoever is typing — bind `j` to scroll and a person cannot write "just". That rule lived in a comment beside a switch, where it bound whoever read the comment. `keymap.Parse` refuses it, so a keymap that would eat a letter is an error at startup rather than a console that silently will not say a word. It also refuses one chord bound to two actions, because which happened would otherwise depend on the order a switch tested them.

**A hint names the key that works.** The footer read `ctrl+end to follow` as a literal. It now reads the binding, so a rebound key changes the hint with it and help cannot drift from behaviour.

## Settings and Theme are different things

A `Theme` is complete and says what the interface looks like now. `Settings` is partial and says what a person asked to change. Both are kept, because a terminal answers late about its own background: the Theme is rebuilt for the answer that arrived and the settings are applied over it again, so a correction changes the greys a person did not choose and leaves alone the ones they did.

## Consequences

**`ui.New` takes a Theme rather than a bool.** The bool it took is `theme.Default(dark)`, so every call site says what it always meant.

**A symbol is a pointer in configuration and a string in the Theme.** An empty string is a choice — a person who wants no mark before their prompt writes one — and a pointer is how "written as empty" is told from "not written".

**Only hex colours are accepted.** A named colour means carrying a table of names; a terminal index means a colour whose appearance depends on a palette Eva cannot see and cannot show a person.

**Falsifier, and it is the one to watch:** zero-config output changing in any release. The policy this replaced was protecting exactly that, and the tests that assert on `Console.Screen()` are what hold it. If they ever have to be updated to accommodate a default, the default is wrong, not the test.
