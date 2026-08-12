package cli

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
)

// What a failure costs a script is derived from the failure, and this is the
// derivation.
//
// None of it could be asserted before. The code travelled beside the error as a
// second return and was decided at fourteen places, so reaching any one of them
// meant running the whole program against a machine put into the state that
// provokes it — and two of those places disagreed with each other in a way
// nothing could see.
func TestWhatAFailureCostsAScript(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{
			name: "a run that did what it was asked",
			err:  nil,
			want: ExitOK,
		},
		{
			name: "a configuration Eva would not act on",
			err:  rejected(errors.New("unknown key \"modle\"")),
			want: ExitUsage,
		},
		{
			name: "a provider that would not answer",
			err:  errors.New("dial tcp: connection refused"),
			want: ExitFailure,
		},
		{
			// A turn the provider declined is not a command line anybody got
			// wrong, so retrying it is not a person's job to do differently.
			name: "a turn that ran and did not answer",
			err:  unanswered{class: events.ErrorAuthFailed},
			want: ExitFailure,
		},
		{
			// The mark survives being wrapped, which is what makes it safe to
			// put on an error where the error is made rather than where it is
			// priced.
			name: "a refused command line something else added to",
			err:  fmt.Errorf("reading the configuration: %w", rejected(errors.New("unknown key"))),
			want: ExitUsage,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := code(c.err); got != c.want {
				t.Errorf("code = %d, want %d", got, c.want)
			}
		})
	}
}

// Nothing rejected is still nothing, which is what lets a call's result be
// marked where the call is made instead of behind a branch of its own.
func TestNothingRejectedIsNothing(t *testing.T) {
	if err := rejected(nil); err != nil {
		t.Errorf("rejected(nil) = %v, want nothing", err)
	}
}

// A turn that ran and did not answer is reported in this project's own words,
// and without the prefix that would say the program failed.
//
// It did not fail. It reached the provider, the provider declined, and the
// Trace holds the whole of it — so "eva:" would send a person to look at Eva
// for something Eva has nothing to do with.
func TestATurnThatDidNotAnswerIsNotReportedAsAFaultInEva(t *testing.T) {
	var stderr bytes.Buffer
	report(&stderr, unanswered{
		class:  events.ErrorAuthFailed,
		remedy: render.Remedy{Because: "no openai login is stored", Do: "eva login"},
	})

	got := stderr.String()
	if strings.HasPrefix(got, "eva:") {
		t.Errorf("a turn the provider declined is reported as a fault in Eva:\n%s", got)
	}
	// The sentence, and then what was checked about this machine.
	for _, want := range []string{"the credential was refused", "no openai login is stored", "eva login"} {
		if !strings.Contains(got, want) {
			t.Errorf("the report does not say %q:\n%s", want, got)
		}
	}
}

// A remedy nothing established adds no line, so a failure with nothing to check
// behind it is one sentence rather than one and a blank.
func TestAFailureWithNothingCheckedIsOneSentence(t *testing.T) {
	var stderr bytes.Buffer
	report(&stderr, unanswered{class: events.ErrorRateLimit})

	if lines := strings.Count(strings.TrimSpace(stderr.String()), "\n"); lines != 0 {
		t.Errorf("a rate limit was reported over %d lines, want one:\n%s", lines+1, stderr.String())
	}
}

// A run that failed twice reports both failures.
//
// The turn that did not answer is what the person asked about; the Trace that
// did not reach the disk is what they did not ask about and most need to know,
// and it is the fact nothing else can tell them. Reporting either one alone was
// how the second came to be swallowed by the first.
func TestARunThatFailedTwiceSaysBoth(t *testing.T) {
	var stderr bytes.Buffer
	report(&stderr, errors.Join(
		unanswered{class: events.ErrorAuthFailed},
		errors.New("trace: close: no space left on device"),
	))

	got := stderr.String()
	for _, want := range []string{"the credential was refused", "no space left on device"} {
		if !strings.Contains(got, want) {
			t.Errorf("the report does not say %q:\n%s", want, got)
		}
	}
	// And the Trace's failure is Eva's own, so it keeps the prefix the turn's
	// does not.
	if !strings.Contains(got, "eva: trace: close") {
		t.Errorf("the Trace's failure is not reported as Eva's own:\n%s", got)
	}
}

// A pair holding a refused configuration is still a refused command line, so a
// second failure behind it does not change what a script is told to do.
func TestARunThatFailedTwicePricesTheRefusal(t *testing.T) {
	both := errors.Join(rejected(errors.New("unknown key")), errors.New("trace: close: broken pipe"))
	if got := code(both); got != ExitUsage {
		t.Errorf("code = %d, want %d", got, ExitUsage)
	}
}

// Everything else is Eva's own failure and says so, and a run that ended well
// says nothing at all.
func TestEvasOwnFailureIsReportedAsOneAndSilenceOtherwise(t *testing.T) {
	var stderr bytes.Buffer
	report(&stderr, errors.New("open the Trace: permission denied"))
	if got := stderr.String(); !strings.HasPrefix(got, "eva: ") {
		t.Errorf("the report does not name Eva as the thing that failed:\n%s", got)
	}

	var quiet bytes.Buffer
	report(&quiet, nil)
	if quiet.Len() != 0 {
		t.Errorf("a run that finished wrote %q where a failure goes", quiet.String())
	}
}
