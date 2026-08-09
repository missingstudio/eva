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

// A remedy is a fact and, sometimes, the command that follows from it.
//
// The rule the shape enforces is that there is no step without a fact. A step
// standing on nothing is advice, and advice in Eva's own voice is worse than
// silence: somebody sent to fix a thing that was never broken stops reading the
// line, and the line that would have helped them goes with it.
func TestARemedyNeverOffersAStepItEstablishedNothingFor(t *testing.T) {
	for _, c := range []struct {
		name   string
		remedy render.Remedy
		want   string
	}{
		{
			name:   "nothing established says nothing",
			remedy: render.Remedy{},
		},
		{
			name:   "a step with no fact behind it is not shown",
			remedy: render.Remedy{Do: "eva login"},
		},
		{
			name:   "a fact with no step is worth saying alone",
			remedy: render.Remedy{Because: "the openai login has not expired"},
			want:   "the openai login has not expired",
		},
		{
			name:   "a fact and its step are the fact, then the command to type",
			remedy: render.Remedy{Because: "no openai login is stored", Do: "eva login"},
			want:   "no openai login is stored\n\n    eva login",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := c.remedy.Said(); got != c.want {
				t.Errorf("the remedy reads %q, want %q", got, c.want)
			}
		})
	}
}
