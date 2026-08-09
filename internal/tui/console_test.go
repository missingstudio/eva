package tui

import (
	"context"
	"fmt"
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

// The live area is a window on a stream, and it shows the end of it. An answer
// longer than the window would otherwise push the view past the screen while
// it arrives — and the whole of it goes above the view when the Run closes,
// rendered, which is what a person actually reads it as.
func TestTheLiveAreaShowsTheEndOfWhatHasArrived(t *testing.T) {
	lines := func(n int) string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("line %d", i)
		}
		return strings.Join(out, "\n")
	}

	for _, c := range []struct {
		name    string
		height  int
		arrived string
		want    string
	}{
		{
			name:    "an answer that fits is shown whole",
			height:  24,
			arrived: lines(3),
			want:    lines(3),
		},
		{
			name:    "a window that has said how tall it is keeps room for the rest of the view",
			height:  6,
			arrived: lines(20),
			want:    "line 16\nline 17\nline 18\nline 19",
		},
		{
			name:    "a window that has not said keeps to a length a screen will hold",
			height:  0,
			arrived: lines(20),
			want:    "line 10\nline 11\nline 12\nline 13\nline 14\nline 15\nline 16\nline 17\nline 18\nline 19",
		},
		{
			name:    "a window with no room at all still shows the last line",
			height:  1,
			arrived: lines(20),
			want:    "line 19",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := (&Console{height: c.height}).tail(c.arrived)
			if got != c.want {
				t.Errorf("tail = %q, want %q", got, c.want)
			}
		})
	}
}
