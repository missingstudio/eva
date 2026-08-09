package tui

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/theme"
	"time"
)

// A turn in flight says something beside the spinner, and it is not the same
// thing every turn.
//
// What a caption is for is the stretch where nothing has arrived yet: a spinner
// alone says the program is running, and a person waiting on an answer is asking
// a slightly different question. What it must never do is claim anything, which
// is why the elapsed figure is asserted beside it — that is the part carrying
// meaning, and it has to survive the decoration going in front of it.
func TestATurnInFlightIsCaptioned(t *testing.T) {
	c := drawn(t)
	c.layout(60, 12)

	// Fixed, so that what a person sees is what this test reads. The console
	// picks at random and a test that let it would be asserting on a coin.
	at := 0
	c.pick = func(int) int { return at }

	// A Run in flight, without one actually running: what makes the console
	// busy is holding a way to cancel.
	_, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	t.Cleanup(cancel)

	c.since = time.Now().Add(-3 * time.Second)
	c.recaption()

	got := plain(c.status())
	if !strings.Contains(got, captions[0]) {
		t.Errorf("the status line does not carry the caption %q:\n%s", captions[0], got)
	}
	if !strings.Contains(got, "3s") {
		t.Errorf("the caption displaced the elapsed figure:\n%s", got)
	}
}

// A caption changes on a clock of its own, not on the spinner's frame.
//
// Twelve times a second is unreadable, and never is not evidence that anything
// is still happening. The interval is what makes it neither.
func TestACaptionChangesOnItsOwnClock(t *testing.T) {
	c := drawn(t)

	at := 0
	c.pick = func(int) int { return at }
	c.recaption()
	first := c.caption

	if c.captionDue() {
		t.Error("a caption just chosen is already due to be replaced")
	}

	// Long enough ago that the next tick asks for another.
	stays := time.Duration(c.look.Layout.CaptionSeconds) * time.Second
	c.captioned = time.Now().Add(-stays - time.Second)
	if !c.captionDue() {
		t.Fatalf("a caption %s old is not due, want it replaced after %s", stays+time.Second, stays)
	}

	at = 1
	c.recaption()
	if c.caption == first {
		t.Errorf("the caption is still %q after it came due", first)
	}
}

// The same caption twice reads as an interface that has stopped rather than one
// that is still going, so a repeat is picked past.
//
// A list this long repeats about once every four changes if nothing does.
func TestACaptionDoesNotRepeatItself(t *testing.T) {
	c := drawn(t)

	// A source that always answers the same, which is the worst case rather
	// than an unlikely one: it is what a random source does eventually.
	c.pick = func(int) int { return 2 }
	c.recaption()
	stuck := c.caption

	c.recaption()
	if c.caption != stuck {
		t.Fatalf("caption = %q, want %q — a source with one answer has nothing else to give", c.caption, stuck)
	}

	// Given anything else to choose, it chooses it.
	asked := 0
	c.pick = func(int) int {
		asked++
		if asked == 1 {
			return 2
		}
		return 3
	}
	c.recaption()
	if c.caption == stuck {
		t.Errorf("the caption stayed %q when another was available", stuck)
	}
}

// Every caption is about waiting, and none of them claims Eva did anything.
//
// Eva at this stage has no tools and acts on nothing: no file is read, no
// command is run, no repository is searched. A caption that said otherwise would
// be the interface making a claim the program cannot keep, and a person would
// have no way to tell it apart from the lines on this screen that are true.
func TestNoCaptionClaimsEvaActedOnAnything(t *testing.T) {
	// The verbs of a factory that has tools. When Eva grows them, these stop
	// being lies — and this test is where that is noticed rather than where it
	// is worked around.
	claims := []string{
		"read", "reading", "wrote", "writing", "ran", "running",
		"search", "searching", "scann", "file", "repo", "test",
		"build", "compil", "fetch", "download", "install", "commit",
	}

	for _, caption := range captions {
		for _, claim := range claims {
			if strings.Contains(strings.ToLower(caption), claim) {
				t.Errorf("the caption %q says Eva %q, which it cannot do", caption, claim)
			}
		}
	}
}

// How long a caption stays is a person's to choose. The setting was validated,
// accepted, and read by nothing, which is worse than refusing it: a person who
// set it had every sign that it had worked.
func TestHowLongACaptionStaysIsConfigured(t *testing.T) {
	seconds := 30
	look, err := theme.Build(true, theme.Settings{CaptionSeconds: &seconds})
	if err != nil {
		t.Fatalf("build the Theme: %v", err)
	}

	_, c, err := NewConsole(context.Background(), &fixed{model: "m"}, nil, &bytes.Buffer{}, WithTheme(look))
	if err != nil {
		t.Fatalf("build the interface: %v", err)
	}

	// Past the default, and short of what was asked for.
	c.captioned = time.Now().Add(-20 * time.Second)
	if c.captionDue() {
		t.Error("a caption 20s old is due, and 30s was asked for")
	}

	c.captioned = time.Now().Add(-31 * time.Second)
	if !c.captionDue() {
		t.Error("a caption 31s old is not due, and 30s was asked for")
	}
}
