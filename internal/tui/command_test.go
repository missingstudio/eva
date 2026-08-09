package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

// /help lists what a person can type.
//
// It is asserted against the command table rather than against a list written
// here, so a command added without a line in /help fails this rather than
// shipping undiscoverable.
//
// It needs no program and no terminal: /help is the table rendered as text, and
// that relation is the whole of what this checks. A zero Console is enough,
// because a style nobody set renders the words and nothing around them — which
// is what a test wants to read anyway. That a command opens no Run is a
// different claim, and it is asserted where the assembly is.
func TestHelpListsEveryCommand(t *testing.T) {
	said := new(Console).help("")

	for _, cmd := range commands() {
		if !strings.Contains(said, "/"+cmd.name) {
			t.Errorf("/help does not list /%s:\n%s", cmd.name, said)
		}
		if !strings.Contains(said, cmd.about) {
			t.Errorf("/help lists /%s with nothing to say what it does:\n%s", cmd.name, said)
		}
	}
}

// A command nobody has is answered rather than sent to the model.
//
// The console answers it, so a typo costs nothing: forwarded to a provider it
// would cost money and come back as a guess at what was meant.
func TestAnUnknownCommandNamesItself(t *testing.T) {
	said := new(Console).obey("/nonsense")

	if !strings.Contains(said, "/nonsense") {
		t.Errorf("the answer does not name the command that was typed:\n%s", said)
	}
	if !strings.Contains(said, "/help") {
		t.Errorf("the answer does not say where the commands are listed:\n%s", said)
	}
}

// Tab fills in a command from however much of it has been typed, and offers the
// next match when it is asked again.
//
// What it completes from is the table /help reads, so a command cannot be
// completable and undocumented, or the reverse.
func TestTabCompletesACommandFromTheTable(t *testing.T) {
	for _, s := range []struct {
		name  string
		start string
		tabs  int
		want  string
	}{
		{name: "one match is filled in whole", start: "/mo", tabs: 1, want: "/model "},
		{name: "a bare slash offers the first", start: "/", tabs: 1, want: "/" + commands()[0].name + " "},
		{name: "a second tab offers the next", start: "/c", tabs: 2, want: "/clear "},
		{name: "the offers come round again", start: "/c", tabs: 3, want: "/cost "},
		{name: "a name nobody has is left alone", start: "/zz", tabs: 1, want: "/zz"},
	} {
		t.Run(s.name, func(t *testing.T) {
			c := drawn(t)
			c.layout(60, 12)
			for _, typed := range s.start {
				c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
			}
			for range s.tabs {
				c.key(tea.KeyPressMsg{Code: tea.KeyTab})
			}
			if got := c.input.Value(); got != s.want {
				t.Errorf("after %q and %d tab(s) the prompt holds %q, want %q", s.start, s.tabs, got, s.want)
			}
		})
	}
}

// Once there is an argument, tab has nothing to say: no table here knows what a
// model is called.
func TestTabLeavesAnArgumentAlone(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	for _, typed := range "/model some-" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}
	c.key(tea.KeyPressMsg{Code: tea.KeyTab})

	if got := c.input.Value(); got != "/model some-" {
		t.Errorf("tab rewrote an argument to %q", got)
	}
}
