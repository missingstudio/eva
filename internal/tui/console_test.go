package tui

import (
	"bytes"
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"charm.land/bubbles/v2/spinner"
	"charm.land/lipgloss/v2"
	"github.com/missingstudio/eva/internal/core"
)

// These tests draw the interface and read what it drew. Nothing here runs a
// turn: what a turn does is asserted where the assembly is, and what is left
// for this package is the part a person looks at.

// fixed is a Control that never answers. It is what the console draws against
// when the drawing is the whole of the question — which is the seam Control
// exists for: a frontend needs a model's name and nothing behind it.
type fixed struct{ model string }

var _ Control = (*fixed)(nil)

func (f *fixed) Answer(context.Context, string) (core.Outcome, error) {
	return core.Outcome{}, nil
}
func (f *fixed) Watch(core.Subscriber, func(string)) {}
func (f *fixed) Model() string                       { return f.model }
func (f *fixed) UseModel(model string)               { f.model = model }
func (f *fixed) Clear()                              {}

// escapes matches any terminal escape sequence, so that a test can assert on
// the words a person reads rather than on the bytes that place them.
var escapes = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)

func plain(s string) string { return escapes.ReplaceAllString(s, "") }

// The footer says which model is answering, at the far end of the window.
//
// A person who has just used /model should not have to use it again to find
// out what it did.
func TestTheFooterPutsTheModelAtTheFarEnd(t *testing.T) {
	c := &Console{control: &fixed{model: "claude-sonnet-4-5"}, width: 40, styles: newStyles(true)}

	got := plain(c.footer())
	if !strings.HasSuffix(got, "claude-sonnet-4-5") {
		t.Errorf("the footer does not end with the model:\n%q", got)
	}
	if w := lipgloss.Width(got); w != 40 {
		t.Errorf("the footer is %d columns wide, want the window's 40:\n%q", w, got)
	}
}

// A window that has not said how wide it is has no far end to put anything at,
// and a model too long for the window would push the line onto a second row —
// which would move the prompt every time the name changed.
func TestTheFooterKeepsQuietWhenItHasNoRoom(t *testing.T) {
	for _, c := range []struct {
		name  string
		width int
	}{
		{name: "the window has not reported a width", width: 0},
		{name: "the model is wider than the window", width: 6},
	} {
		t.Run(c.name, func(t *testing.T) {
			console := &Console{control: &fixed{model: "claude-sonnet-4-5"}, width: c.width, styles: newStyles(true)}
			if got := console.footer(); got != "" {
				t.Errorf("the footer drew %q, want nothing", got)
			}
		})
	}
}

// The status line says a turn is running, for how long, and how to stop it.
//
// The elapsed figure is what a person decides on: an answer that has not
// started arriving looks exactly like an interface that has stopped, and the
// difference between the two is how long it has been.
func TestTheStatusLineSaysHowLongTheTurnHasRun(t *testing.T) {
	c := &Console{
		styles: newStyles(true),
		spin:   spinner.New(spinner.WithSpinner(spinner.MiniDot)),
		since:  time.Now().Add(-3 * time.Second),
		// A Run in flight is one with something to cancel. See busy.
		cancel: func() {},
	}

	got := plain(c.status())
	for _, want := range []string{"3s", "ctrl+c to interrupt"} {
		if !strings.Contains(got, want) {
			t.Errorf("the status line does not say %q:\n%s", want, got)
		}
	}
	if frame := c.spin.View(); !strings.Contains(got, frame) {
		t.Errorf("the status line does not carry the spinner frame %q:\n%s", frame, got)
	}
}

// With no Run in flight the same line says so, rather than disappearing. A
// status line that came and went would move the prompt under a person's hands
// every time a turn started.
func TestTheStatusLineIsStillALineWhenNothingIsRunning(t *testing.T) {
	c := &Console{styles: newStyles(true), spin: spinner.New()}

	if got := plain(c.status()); got != "ready" {
		t.Errorf("the status line reads %q, want %q", got, "ready")
	}
}

// The live area is erased when the Run closes, and what is kept is the fold
// over what the Trace holds. So arriving chunks reach the pane without ever
// reaching the transcript, and the transcript is what survives them.
func TestArrivingTextIsShownWithoutBeingKept(t *testing.T) {
	// Built the way a run builds it, so that the pane, the renderer and the
	// styles are the ones a person would be looking at. The program it returns
	// is never started: nothing here needs a turn.
	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(40, 12)

	c.arriving.WriteString("half an answer")
	c.refresh()
	if got := plain(c.pane.View()); !strings.Contains(got, "half an answer") {
		t.Errorf("the pane does not show what is arriving:\n%s", got)
	}
	if kept := c.transcript.String(); strings.Contains(kept, "half an answer") {
		t.Errorf("the transcript kept an arriving chunk:\n%s", kept)
	}

	// What the Run closing does: the rendered turn arrives, and showing it is
	// what erases the chunks.
	if err := c.Show("the whole answer"); err != nil {
		t.Fatalf("show the turn: %v", err)
	}
	if got := plain(c.pane.View()); strings.Contains(got, "half an answer") {
		t.Errorf("the pane still shows arriving text after the Run closed:\n%s", got)
	}
	if got := plain(c.pane.View()); !strings.Contains(got, "the whole answer") {
		t.Errorf("the pane does not show the turn that was kept:\n%s", got)
	}
}

// A turn is on screen once, not twice.
//
// The rendered turn arrives with the record that closes the Run, and the Run's
// own closing reaches the interface as a separate message afterwards. Erasing
// the chunks on the later one leaves the answer shown twice — once as what
// arrived, once as what was kept — and nothing recomposes after it, so it stays
// that way until the next turn.
func TestAnAnsweredTurnIsShownOnce(t *testing.T) {
	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}
	c.layout(60, 12)

	// A turn arrives in chunks, and is then kept as one rendered block. The
	// words are the same either way, which is the whole difficulty.
	answer := "the answer"
	c.arriving.WriteString(answer)
	c.refresh()
	if err := c.Show(answer); err != nil {
		t.Fatalf("show the turn: %v", err)
	}
	c.close(answered{})

	if got := strings.Count(plain(c.pane.View()), answer); got != 1 {
		t.Errorf("the answer is on screen %d times, want 1:\n%s", got, plain(c.pane.View()))
	}
}
