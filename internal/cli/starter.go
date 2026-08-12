package cli

import (
	"fmt"
	"io"
	"strings"

	"github.com/missingstudio/eva/internal/config"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/providers/openai"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/trace"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

func initialise(path string, stdout io.Writer) error {
	written, err := config.Init(path, starter())
	if err != nil {
		return rejected(err)
	}
	_, err = fmt.Fprintf(stdout, "wrote %s\n\nEvery setting in it is commented out, so Eva behaves exactly as it\ndoes now until you uncomment one. Set %s in your environment\nand run eva.\n", written, config.DefaultAPIKeyEnv)
	return err
}

func starter() string {
	look, keys := theme.Default(theme.Dark), keymap.Default()

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

# The program a long prompt is written in, opened by ctrl+o. Left out, Eva reads
# VISUAL and then EDITOR from your environment. It is not a setting a repository
# may choose: what it names is a program Eva starts on this machine.
# editor = ""

[provider]
# Which Provider answers. This build ships: %s.
# name = %q

# How the Provider authenticates: %q reads the variable named below, and %q
# uses the login that "eva login" keeps (%q only). The mode alone decides
# which credential a turn uses.
# auth = %q

# The environment variable the credential is read from.
# api_key_env = %q

# Point a Provider at a gateway or a proxy. Empty is the vendor's own endpoint.
# base_url = ""

# Cap one answer. Zero leaves the cap to the Provider, which is what knows its
# own API.
# max_tokens = 0

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
# One of the looks Eva ships with: %s. Everything below is applied over the look
# you name, so you can take one and change a single colour of it. %q is what Eva
# draws when you name nothing; %q raises the greys for a washed-out terminal or
# tired eyes, and %q names no colour at all.
# name = %q

# The rule above and below the prompt: %s.
# border = %q

[theme.colors]
# Written as #rgb or #rrggbb. Each follows the terminal's background unless you
# choose one here.
# subdued = ""
# person  = ""
# eva     = ""
# spinner = ""
# What a turn that produced no answer is written in. Empty is the subdued grey.
# failure = ""

[theme.markdown]
# Draw the answer with no colour at all, and with ASCII in place of the marks
# Eva would otherwise draw.
# plain = false

# The answer's own colours. Each is empty by default, which leaves it to the
# renderer's own choice for your terminal's background.
# heading    = ""
# code       = ""
# code_block = ""
# emphasis   = ""
# link       = ""
# link_text  = ""
# quote      = ""

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
# How long a turn must take before it says how long it took. Zero says nothing
# about any turn.
# elapsed_seconds = %d
# How much of the clock drawing an answer that is still arriving may take, as one
# part in this many. Lower it for smoother streaming on a fast machine; raise it
# if a long answer makes typing feel late.
# live_share = %d

# What the interface holds back at each edge of the window, in cells. A terminal
# draws no window frame of its own, so text against the first column reads as text
# against the edge of the screen. Rows are scarcer than columns, which is why the
# top and bottom are nothing by default.
#
# A window too small to spare an edge spends it on the answer instead.
[theme.layout.margin]
# top    = %d
# right  = %d
# bottom = %d
# left   = %d

# The same, held back inside the margin rather than outside it. The two are one
# inset today; they part company when Eva draws a background, which will fill the
# padding and stop at the margin.
[theme.layout.padding]
# top    = %d
# right  = %d
# bottom = %d
# left   = %d

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
		config.AuthAPIKey, config.AuthSubscription, openai.Name, config.AuthAPIKey,
		config.DefaultAPIKeyEnv,
		config.EnvHome, strings.Join(trace.Kinds(), ", "), trace.JSONL,
		config.DefaultTenant, config.DefaultActor, string(events.ActorHuman),
		strings.Join(theme.Names(), ", "), theme.Eva, theme.Contrast, theme.Mono, theme.Eva,
		strings.Join(theme.Borders(), ", "), theme.BorderNormal,
		look.Symbols.Prompt, look.Symbols.Placeholder, look.Symbols.Truncation,
		strings.Join(theme.Spinners(), ", "), look.Symbols.Spinner,
		look.Layout.PromptRows, look.Layout.CaptionSeconds,
		look.Layout.ElapsedSeconds, look.Layout.LiveShare,
		look.Layout.Margin.Top, look.Layout.Margin.Right,
		look.Layout.Margin.Bottom, look.Layout.Margin.Left,
		look.Layout.Padding.Top, look.Layout.Padding.Right,
		look.Layout.Padding.Bottom, look.Layout.Padding.Left,
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
