package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/missingstudio/eva/internal/theme"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

func TestTheCommandListNarrowsAndFillsIn(t *testing.T) {
	c := drawn(t)
	c.layout(80, 24)

	press := func(action keymap.Action) {
		t.Helper()
		c.key(spelled(t, c.keys.Chord(action)))
	}

	press(keymap.Palette)
	if !c.palette.open {
		t.Fatal("the key bound to the list did not open it")
	}
	if got := c.input.Value(); got != "/" {
		t.Errorf("opening the list left the prompt at %q, and a command starts with a slash", got)
	}

	listed := plain(c.palette.view(c.input.Value(), c.styles, c.look.Symbols.Prompt))
	for _, cmd := range commands() {
		if !strings.Contains(listed, "/"+cmd.name) {
			t.Errorf("the list does not offer /%s:\n%s", cmd.name, listed)
		}
	}

	// Typing narrows it. Nothing but /clear and /cost begins with c.
	for _, typed := range "co" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}
	if got := plain(c.palette.view(c.input.Value(), c.styles, c.look.Symbols.Prompt)); strings.Contains(got, "/clear") {
		t.Errorf("the list still offers /clear after \"co\" was typed:\n%s", got)
	}
	if got := plain(c.palette.view(c.input.Value(), c.styles, c.look.Symbols.Prompt)); !strings.Contains(got, "/cost") {
		t.Errorf("the list dropped /cost, which is what \"co\" narrows to:\n%s", got)
	}

	press(keymap.Submit)
	if c.palette.open {
		t.Error("choosing from the list left it open")
	}
	if got := c.input.Value(); got != "/cost " {
		t.Errorf("the prompt holds %q, want the chosen command and a space for its argument", got)
	}
}

// Choosing writes the command rather than running it, because a command may take
// an argument. A list that sent /model on the way out would make the one command
// that takes one unusable from the list.
func TestChoosingACommandDoesNotRunIt(t *testing.T) {
	c := drawn(t)
	c.layout(80, 24)

	c.key(spelled(t, c.keys.Chord(keymap.Palette)))
	for _, typed := range "model" {
		c.key(tea.KeyPressMsg{Code: typed, Text: string(typed)})
	}
	c.key(spelled(t, c.keys.Chord(keymap.Submit)))

	if got := c.input.Value(); got != "/model " {
		t.Fatalf("the prompt holds %q after the command was chosen", got)
	}
	if len(c.transcript) != 0 {
		t.Errorf("choosing a command answered it:\n%s", plain(c.kept()))
	}
}

func TestTheListClosesOnTheKeyThatOpenedItAndOnAnInterrupt(t *testing.T) {
	for _, action := range []keymap.Action{keymap.Palette, keymap.Interrupt} {
		t.Run(string(action), func(t *testing.T) {
			c := drawn(t)
			c.layout(80, 24)

			c.key(spelled(t, c.keys.Chord(keymap.Palette)))
			c.key(spelled(t, c.keys.Chord(action)))

			if c.palette.open {
				t.Errorf("%q did not close the list", action)
			}
			if c.leaving {
				t.Error("the key that closed the list also asked to leave the Session")
			}
		})
	}
}

func TestTheListWalksAndWraps(t *testing.T) {
	c := drawn(t)
	c.layout(80, 24)

	c.key(spelled(t, c.keys.Chord(keymap.Palette)))
	if c.palette.at != 0 {
		t.Fatalf("the list opens on match %d, want the first", c.palette.at)
	}

	c.key(spelled(t, c.keys.Chord(keymap.HistoryForward)))
	if c.palette.at != 1 {
		t.Errorf("one step down chose match %d", c.palette.at)
	}

	c.key(spelled(t, c.keys.Chord(keymap.HistoryBack)))
	c.key(spelled(t, c.keys.Chord(keymap.HistoryBack)))
	if want := len(commands()) - 1; c.palette.at != want {
		t.Errorf("stepping up past the first chose match %d, want the last (%d)", c.palette.at, want)
	}
}

func TestAShortWindowDropsTheListBeforeThePrompt(t *testing.T) {
	c := drawn(t)
	c.layout(40, 6)

	c.key(spelled(t, c.keys.Chord(keymap.Palette)))

	view := plain(c.View().Content)
	if !strings.Contains(view, "›") {
		t.Errorf("a six-row window with the list open dropped the prompt:\n%s", view)
	}
	if lines := strings.Count(view, "\n") + 1; lines != 6 {
		t.Errorf("the view is %d rows in a window of 6:\n%s", lines, view)
	}
}

// The tests below drive the list through its own interface. Nothing here builds a
// console: the list is a filter over a table, and what a person has typed crosses
// in as a string — so a test hands it one.

func TestWhatHasBeenTypedOfACommandNameStopsAtTheArgument(t *testing.T) {
	for _, c := range []struct{ typed, want string }{
		{typed: "", want: ""},
		{typed: "/", want: "/"},
		{typed: "/mod", want: "/mod"},
		{typed: "/model claude-sonnet-4-5", want: "/model"},
		{typed: "/model ", want: "/model"},
	} {
		if got := named(c.typed); got != c.want {
			t.Errorf("named(%q) = %q, want %q", c.typed, got, c.want)
		}
	}
}

func TestTheFilterNarrowsTheTable(t *testing.T) {
	var p palette

	if got := len(p.matches("")); got != len(commands()) {
		t.Errorf("an empty filter left %d of %d commands", got, len(commands()))
	}
	if got := p.matches("/c"); len(got) != 2 {
		t.Errorf("/c matched %d commands, want /clear and /cost", len(got))
	}
	if got := p.matches("/model claude"); len(got) != 1 || got[0].name != "model" {
		t.Errorf("/model with an argument matched %v, want just /model", got)
	}
	if got := p.matches("/nothing"); len(got) != 0 {
		t.Errorf("a filter that matches nothing left %d commands", len(got))
	}
}

// A filter that narrows under a person cannot leave them pointing past the end.
func TestNarrowingTheFilterCannotLeaveTheChoicePastTheEnd(t *testing.T) {
	p := palette{open: true}

	p.walk(-1, "") // the last of them
	if p.at != len(commands())-1 {
		t.Fatalf("a step up from the first chose %d, want the last", p.at)
	}

	p.clamp("/c")
	if p.at > 1 {
		t.Errorf("narrowing to two matches left the choice at %d", p.at)
	}
	if _, there := p.chosen("/c"); !there {
		t.Error("the clamped row is not a row that can be chosen")
	}
}

// Choosing puts the name and a space in the prompt rather than running anything.
func TestChoosingYieldsANameAndASpace(t *testing.T) {
	p := palette{open: true}

	got, there := p.chosen("/mod")
	if !there {
		t.Fatal("/mod matched no command")
	}
	if got != "/model " {
		t.Errorf("choosing /mod gives %q, want %q", got, "/model ")
	}

	if _, there := p.chosen("/nothing"); there {
		t.Error("a filter that matches nothing still offered a choice")
	}
}

func TestTabOffersEachMatchInTurn(t *testing.T) {
	var p palette

	first, there := p.fill("/c")
	if !there {
		t.Fatal("/c completed to nothing")
	}
	second, there := p.fill(first)
	if !there {
		t.Fatal("a second tab completed to nothing")
	}
	if first == second {
		t.Errorf("both tabs offered %q, and /c matches two commands", first)
	}
	if third, _ := p.fill(second); third != first {
		t.Errorf("a third tab offered %q, want the cycle back to %q", third, first)
	}

	// Typing ends the cycle: the next tab reads the prompt again.
	p.typing()
	if got, _ := p.fill("/l"); got != "/login " {
		t.Errorf("after typing, tab offered %q, want /login ", got)
	}
}

// Tab leaves alone what is not a command name being typed.
func TestTabLeavesEverythingThatIsNotACommandName(t *testing.T) {
	for _, typed := range []string{"", "ask something", "/model claude", "/help\nmore"} {
		var p palette
		if got, there := p.fill(typed); there {
			t.Errorf("tab rewrote %q as %q", typed, got)
		}
	}
}

// A closed list draws nothing, and a filter that matches nothing says so rather
// than drawing an empty box.
func TestAClosedListDrawsNothingAndAnEmptyOneSaysSo(t *testing.T) {
	s := newStyles(theme.Default(true))

	var closed palette
	if got := closed.view("/", s, "›"); got != "" {
		t.Errorf("a closed list drew %q", got)
	}

	open := palette{open: true}
	got := plain(open.view("/nothing", s, "›"))
	if !strings.Contains(got, "no command starts with /nothing") {
		t.Errorf("a list with no matches drew %q", got)
	}
}
