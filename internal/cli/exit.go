package cli

import (
	"errors"
	"fmt"
	"io"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/render"
)

// Exit codes. They are part of the contract a script reads, so they are named
// rather than written as literals at the point of return.
const (
	// ExitOK is a turn that ran and claimed Done.
	ExitOK = 0
	// ExitFailure is a turn that started and did not finish.
	ExitFailure = 1
	// ExitUsage is a command line or a configuration Eva would not act on.
	ExitUsage = 2
)

// A failure travels as an error, and is priced and worded here.

type misuse struct{ err error }

func (m misuse) Error() string { return m.err.Error() }
func (m misuse) Unwrap() error { return m.err }

func rejected(err error) error {
	if err == nil {
		return nil
	}
	return misuse{err: err}
}

type unanswered struct {
	class  events.ErrorClass
	remedy render.Remedy
}

func (u unanswered) Error() string { return render.Unanswered(u.class) }

func code(err error) int {
	var wrong misuse
	switch {
	case err == nil:
		return ExitOK
	case errors.As(err, &wrong):
		return ExitUsage
	default:
		return ExitFailure
	}
}

// report says why a run ended this way, and is the only place that says it.
func report(stderr io.Writer, err error) {
	var (
		joined interface{ Unwrap() []error }
		turn   unanswered
	)
	switch {
	case err == nil:
		return
	case errors.As(err, &joined):
		// A run can fail twice — the turn did not answer, and the Trace behind
		// it did not reach the disk — and each is reported as itself. Looked
		// for before either, because a pair holding one of them would otherwise
		// be reported as that one and the other would go unsaid.
		for _, one := range joined.Unwrap() {
			report(stderr, one)
		}
	case errors.As(err, &turn):
		_, _ = fmt.Fprintln(stderr, turn.Error())
		// Then what that means on this machine. The path a script runs is the
		// one whose author is most likely to be looking at a machine they did
		// not configure, so the checked fact is worth as much here as it is in
		// the console — and it is the same fact.
		if next := turn.remedy.Said(); next != "" {
			_, _ = fmt.Fprintln(stderr, next)
		}
	default:
		_, _ = fmt.Fprintf(stderr, "eva: %v\n", err)
	}
}
