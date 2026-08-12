package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
)

// reached is a reach a Command was run against: the second adapter at that seam,
// and the reason the seam is real. The first is the Console.
//
// It records rather than draws, so what a test reads is what the Command asked
// for rather than what a window did with it.
type reached struct {
	model string
	// emptied counts the times the transcript was emptied. A count rather than a
	// flag: a command that emptied twice is a command that opened two Sessions.
	emptied int
	// cost is what this Session is to report having spent.
	cost string
}

var _ reach = (*reached)(nil)

func (s *reached) usingModel() string       { return s.model }
func (s *reached) useModel(name string)     { s.model = name }
func (s *reached) spent() string            { return s.cost }
func (s *reached) empty()                   { s.emptied++ }
func (s *reached) aside(text string) string { return text }

// /help lists what a person can type.
//
// It is asserted against the command table rather than against a list written
// here, so a command added without a line in /help fails this rather than
// shipping undiscoverable.
//
// It needs no program and no terminal: /help is the table rendered as text, and
// that relation is the whole of what this checks. What it is run against is the
// reach list, which is the whole of what any Command may reach.
func TestHelpListsEveryCommand(t *testing.T) {
	said := help(&reached{}, "")

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

// A bare /model reports which model answers, and does not switch.
//
// The alternative is a command that answers a mistyped line by switching to a
// model with no name — and the turn after it would fail somewhere in the Provider
// rather than here, where a person could still read what they typed.
func TestABareModelReportsRatherThanSwitching(t *testing.T) {
	s := &reached{model: "claude-sonnet-4-5"}

	said := model(s, "")
	if !strings.Contains(said, "claude-sonnet-4-5") {
		t.Errorf("/model does not name the model that answers:\n%s", said)
	}
	if s.model != "claude-sonnet-4-5" {
		t.Errorf("a bare /model switched to %q", s.model)
	}
}

// /model with a name switches, and says both names so that a person can read what
// it did.
//
// The Session is untouched: what a switch is for is answering the same
// conversation with something else.
func TestModelSwitchesAndSaysWhatItSwitchedFrom(t *testing.T) {
	s := &reached{model: "claude-sonnet-4-5"}

	said := model(s, "claude-opus-4-1")
	if s.model != "claude-opus-4-1" {
		t.Errorf("/model left the model at %q", s.model)
	}
	for _, want := range []string{"claude-sonnet-4-5", "claude-opus-4-1"} {
		if !strings.Contains(said, want) {
			t.Errorf("the answer does not name %q:\n%s", want, said)
		}
	}
	if s.emptied != 0 {
		t.Error("switching the model emptied the transcript")
	}
}

// /clear empties the transcript and says nothing about having done it.
//
// An empty screen is what was asked for and it is its own evidence. A line
// reporting the emptiness would be the only thing on screen, which is to say the
// command would not have emptied it.
func TestClearEmptiesTheTranscriptAndSaysNothing(t *testing.T) {
	s := &reached{}

	if said := clear(s, ""); said != "" {
		t.Errorf("/clear said %q, and an emptied transcript is its own evidence", said)
	}
	if s.emptied != 1 {
		t.Errorf("/clear emptied the transcript %d times, want once", s.emptied)
	}
}

// /cost reports the fold over what the Trace holds, and nothing it counted itself.
//
// A second count could disagree with the footer's, leaving a person two figures
// for one Session and no way to tell which is the record.
func TestCostReportsTheFoldAndNotACountOfItsOwn(t *testing.T) {
	s := &reached{cost: "1,024 tokens · $0.01"}

	if said := cost(s, ""); said != s.cost {
		t.Errorf("/cost said %q, want the fold's own figures %q", said, s.cost)
	}
}

// /login says where a login happens, and it is not here.
//
// A Login opens a browser and waits for a person to come back, which is
// everything a Command is not. An answer that points somewhere is worth more than
// a refusal.
func TestLoginPointsAtTheVerbThatDoesIt(t *testing.T) {
	said := login(&reached{}, "")

	if !strings.Contains(said, "eva login") {
		t.Errorf("/login does not name the verb that logs in:\n%s", said)
	}
}

// A Command reaches the reach list and nothing else.
//
// This is the assertion the type makes and the test restates, because the type
// making it is the whole point: a Command handed the console could reach the pane,
// and ADR 0023's falsifier is a future writer to the pane that can claim a turn.
// The list below is what /help would have to grow a line for.
func TestACommandReachesOnlyTheSessionList(t *testing.T) {
	// The Console is the other adapter, so it must satisfy the same list. A method
	// dropped from the Console fails to compile; a method added to the interface
	// fails here unless the Console grew one too.
	var r reach = &reached{}
	if _, isConsole := r.(*Console); isConsole {
		t.Fatal("the fake reach is a Console, so this asserts nothing")
	}

	for _, cmd := range commands() {
		// Every command runs against the fake without reaching for a window, a
		// pane, or a Renderer. A command that needed one would panic here rather
		// than in front of a person.
		_ = cmd.run(&reached{model: "a-model"}, "")
	}
}
