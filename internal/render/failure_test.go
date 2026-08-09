package render_test

import (
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
)

// Every class of failure gets its own line, and every line is this project's
// own words.
//
// The set is read from the schema rather than typed here, so a class added
// later fails this test instead of shipping with nothing to show for it. That
// is the whole mechanism: the reason one word was shown for every failure was
// that nothing made anyone answer for the difference.
//
// ErrorOther is the deliberate exception and is asserted as one. A failure
// something looked at and could not place has nothing to add beyond the bare
// line, and saying "the provider failed in a way we could not place" would
// spend a person's attention on the classifier rather than on their turn.
func TestEveryFailureClassHasItsOwnLine(t *testing.T) {
	classes := events.ErrorClasses()
	if len(classes) == 0 {
		t.Fatal("the schema names no failure classes")
	}

	seen := map[string]events.ErrorClass{}
	for _, class := range classes {
		line := render.Unanswered(class)

		if !strings.HasPrefix(line, render.NoResponse) {
			t.Errorf("%q shows %q, which does not begin by saying nothing came back", class, line)
		}
		if class == events.ErrorOther {
			if line != render.NoResponse {
				t.Errorf("%q shows %q, want the bare line", class, line)
			}
			continue
		}
		if line == render.NoResponse {
			t.Errorf("%q shows the bare line, so it reads as a failure nobody classified", class)
		}
		if first, taken := seen[line]; taken {
			t.Errorf("%q and %q both show %q", first, class, line)
		}
		seen[line] = class
	}

	// A failure nobody classified, and one from a build that knows a class this
	// one does not, both fall back rather than inventing a reason.
	if line := render.Unanswered(""); line != render.NoResponse {
		t.Errorf("an unclassified failure shows %q, want the bare line", line)
	}
	if line := render.Unanswered(events.ErrorClass("quantum_flux")); line != render.NoResponse {
		t.Errorf("an unknown class shows %q, want the bare line", line)
	}
}

// The line that says where the detail went names the file and nothing else.
//
// A Trace nobody configured a path for says nothing at all, rather than
// pointing at an empty string. The console draws no line for an empty one,
// which is how every absent fact is handled.
func TestTheDetailLineNamesTheTraceOrSaysNothing(t *testing.T) {
	if got := render.Detail(""); got != "" {
		t.Errorf("with no Trace path the line reads %q, want nothing", got)
	}

	got := render.Detail("/home/p/.eva/trace.jsonl")
	if !strings.Contains(got, "/home/p/.eva/trace.jsonl") {
		t.Errorf("the line does not name the Trace: %q", got)
	}
}
