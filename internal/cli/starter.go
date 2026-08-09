package cli

import (
	"fmt"
	"strings"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/trace"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

// starter is the configuration a first run is given.
//
// Every line of it is commented out, and that is the point: the file documents
// the surface without choosing anything on a person's behalf, so the defaults
// go on being the defaults until someone deliberately writes one down. A
// starter that pinned today's model would quietly hold a person on it through
// every release after, and they would have no way to tell that was happening.
//
// Nothing here is written out in its own words. The models, the Providers, the
// sinks, the keys, and every value shown are read from the same places the
// program reads them, because a template that restates a default is a template
// that goes stale in the commit that changes one — and nothing fails when it
// does. That is why this is composed here rather than in config: this is the
// layer that can see the registries and the interface, and config is the layer
// that must not.
func starter() string {
	look, keys := theme.Default(true), keymap.Default()

	return fmt.Sprintf(`# Eva — configuration
#
# Every setting below is commented out and shows what Eva does without it.
# Uncomment a line to change it. An unknown key is an error naming the key, so
# a typo here is reported rather than quietly ignored.
#
# A credential is never written in this file. It is read from the environment,
# from the variable named below.

# Which model a turn runs against.
# model = %q

[provider]
# Which Provider answers. This build ships: %s.
# name = %q

# The environment variable the credential is read from.
# api_key_env = %q

# Point a Provider at a gateway or a proxy. Empty is the vendor's own endpoint.
# base_url = ""

# Cap one answer. Zero leaves the cap to the Provider, which is what knows its
# own API.
# max_tokens = 0

# The recording a replaying Provider reads, relative to this file.
# script = "turns.toml"

[trace]
# Where the Trace is written. Every turn is appended there as typed Events, and
# every projection — the console you read, anything that reads it later — is a
# fold over that file.
# path = "%s/trace.jsonl"

# Which sink writes it. This build ships: %s.
# kind = %q

[identity]
# Who a Run acts as. These ride on every Event, and they are here from the
# first commit because adding them later would touch every record already
# stored.
# tenant = %q
# actor = %q
# actor_kind = %q

# How Eva looks, and which keys do what.
#
# These two tables are the only ones a repository may set in its own
# .eva/config.toml, so a team can check its look and feel in beside the code. A
# repository may not set anything above them: a cloned repository is content
# from the internet, and what it looks like is not what it does.
[theme]
# The rule above and below the prompt: %s.
# border = %q

[theme.colors]
# Written as #rgb or #rrggbb. Each follows the terminal's background unless you
# choose one here.
# subdued = ""
# person  = ""
# eva     = ""
# spinner = ""

[theme.symbols]
# prompt      = %q
# placeholder = %q
# truncation  = %q
# The frames a turn in flight is drawn with: %s.
# spinner     = %q

[theme.layout]
# How tall the prompt may grow before it scrolls within itself.
# prompt_rows = %d
# How long one caption stays while a turn runs.
# caption_seconds = %d

[keymap.bind]
# A binding must be a chord or a key that types nothing. Binding a bare letter
# would take that character away from the prompt, so Eva refuses it at startup
# rather than eating your keystrokes.
#
# Naming an action replaces its default entirely.
%s
`,
		config.DefaultModel,
		strings.Join(providers.Names(), ", "), config.DefaultProvider,
		config.DefaultAPIKeyEnv,
		config.EnvHome, strings.Join(trace.Kinds(), ", "), trace.JSONL,
		config.DefaultTenant, config.DefaultActor, string(events.ActorHuman),
		strings.Join(theme.Borders(), ", "), theme.BorderNormal,
		look.Symbols.Prompt, look.Symbols.Placeholder, look.Symbols.Truncation,
		strings.Join(theme.Spinners(), ", "), look.Symbols.Spinner,
		look.Layout.PromptRows, look.Layout.CaptionSeconds,
		bindings(keys),
	)
}

// bindings writes every action and what it answers to, read from the Keymap
// itself so that the file cannot offer an action Eva does not have.
func bindings(keys keymap.Keymap) string {
	var out strings.Builder
	width := 0
	for _, action := range keymap.Actions() {
		if len(action) > width {
			width = len(action)
		}
	}

	for _, action := range keymap.Actions() {
		chords := keys.Chords(action)
		quoted := make([]string, len(chords))
		for i, chord := range chords {
			quoted[i] = fmt.Sprintf("%q", chord)
		}
		fmt.Fprintf(&out, "# %-*s = [%s]\n", width, action, strings.Join(quoted, ", "))
	}
	return strings.TrimRight(out.String(), "\n")
}
