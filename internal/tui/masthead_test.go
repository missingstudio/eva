package tui

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

// The console says there is more here than a prompt, and names the command it
// dispatches on rather than one written out beside it.
func TestTheMastheadPointsAtTheHelpCommand(t *testing.T) {
	c := drawn(t)
	c.layout(80, 24)

	got := plain(c.masthead())
	if !strings.Contains(got, "type /help for slash commands") {
		t.Errorf("the masthead does not say how to find the commands:\n%s", got)
	}
}

// The hint reads the table, so a command that is renamed renames itself here.
// A hint naming a command Eva does not answer to is the first thing a person
// tries and the first thing that fails them.
func TestTheHintNamesACommandTheConsoleAnswersTo(t *testing.T) {
	named := strings.TrimSuffix(strings.TrimPrefix(hint(), "type /"), " for slash commands")

	for _, c := range commands() {
		if c.name == named {
			return
		}
	}
	t.Errorf("the masthead points at /%s, and no command answers to it", named)
}

// It is drawn once, under the facts, and not repeated per row of the bar.
func TestTheHintIsDrawnOnce(t *testing.T) {
	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.about = About{Version: "9.9.9", Branch: "main", Dir: "~/x"}
	c.layout(80, 24)

	if got := strings.Count(plain(c.masthead()), "slash commands"); got != 1 {
		t.Errorf("the hint appears %d times, want 1", got)
	}
}
