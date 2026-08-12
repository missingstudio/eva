package tui

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/missingstudio/eva/internal/tui/keymap"
)

// The prompts a person sent come back, newest first, and what they were writing
// comes back after them.
//
// Retyping a prompt is the commonest thing anybody does at this console: the one
// that failed, the one that needed a word changed. What makes recall safe to put
// on the arrow keys is the last assertion here — a person who walked back and
// changed their mind is returned to their own unsent words rather than left
// holding somebody else's sentence.
func TestThePromptsAlreadySentComeBack(t *testing.T) {
	c := drawn(t)
	c.layout(60, 20)

	for _, prompt := range []string{"first question", "second question"} {
		c.input.SetValue(prompt)
		c.key(tea.KeyPressMsg{Code: tea.KeyEnter})
	}

	c.input.SetValue("half of a third")

	press := func(action keymap.Action) {
		t.Helper()
		c.key(spelled(t, c.keys.Chord(action)))
	}

	press(keymap.HistoryBack)
	if got := c.input.Value(); got != "second question" {
		t.Fatalf("one step back gives %q, want the newest prompt sent", got)
	}
	press(keymap.HistoryBack)
	if got := c.input.Value(); got != "first question" {
		t.Fatalf("two steps back gives %q, want the oldest prompt sent", got)
	}
	press(keymap.HistoryBack)
	if got := c.input.Value(); got != "first question" {
		t.Errorf("a step past the oldest gives %q, and there is nothing older", got)
	}

	press(keymap.HistoryForward)
	press(keymap.HistoryForward)
	if got := c.input.Value(); got != "half of a third" {
		t.Errorf("walking back to the end gives %q, want the words that were being written", got)
	}
}

// A prompt of more than one line keeps its own arrow keys.
//
// Recall is bound to the keys the prompt uses to move the cursor between lines,
// and the rule that makes that safe is the cursor's position: a line above means
// the key is the prompt's. Without it a ten-line prompt would be uneditable.
func TestRecallLeavesAMultiLinePromptItsOwnArrows(t *testing.T) {
	c := drawn(t)
	c.layout(60, 20)

	c.input.SetValue("a prompt already sent")
	c.key(tea.KeyPressMsg{Code: tea.KeyEnter})

	// Two lines, with the cursor on the second.
	c.input.SetValue("first line\nsecond line")
	c.input.MoveToEnd()
	if c.input.Line() != 1 {
		t.Fatalf("the cursor is on line %d of a two-line prompt", c.input.Line())
	}

	c.key(spelled(t, c.keys.Chord(keymap.HistoryBack)))

	if got := c.input.Value(); got != "first line\nsecond line" {
		t.Errorf("the key recalled a prompt instead of moving the cursor: %q", got)
	}
	if c.input.Line() != 0 {
		t.Errorf("the cursor is on line %d, so the key did not move it either", c.input.Line())
	}
}

// The same prompt sent twice is one thing to walk back through.
func TestAPromptSentTwiceIsRememberedOnce(t *testing.T) {
	c := drawn(t)
	c.layout(60, 20)

	for range 2 {
		c.input.SetValue("the same question")
		c.key(tea.KeyPressMsg{Code: tea.KeyEnter})
	}

	if got := len(c.past.sent); got != 1 {
		t.Errorf("%d prompts were remembered, and the person typed one twice", got)
	}
}

// spelled is what a chord reads as when a terminal reports it, so a test can
// press what a person presses.
func spelled(t *testing.T, chord string) tea.KeyPressMsg {
	t.Helper()

	if held, key, chorded := strings.Cut(chord, "+"); chorded {
		if held != "ctrl" || len(key) != 1 {
			t.Fatalf("this test cannot press %q", chord)
		}
		return tea.KeyPressMsg{Code: rune(key[0]), Mod: tea.ModCtrl}
	}
	switch chord {
	case "up":
		return tea.KeyPressMsg{Code: tea.KeyUp}
	case "down":
		return tea.KeyPressMsg{Code: tea.KeyDown}
	case "enter":
		return tea.KeyPressMsg{Code: tea.KeyEnter}
	case "tab":
		return tea.KeyPressMsg{Code: tea.KeyTab}
	}
	t.Fatalf("this test cannot press %q", chord)
	return tea.KeyPressMsg{}
}
