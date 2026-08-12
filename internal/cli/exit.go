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
//
// It used to travel as both: every function under Main returned (int, error),
// so what happened and what it cost were two returns that could disagree — and
// one of them did, with the one-shot command returning a failing code and no
// error at all. What kind of failure a thing was got re-decided at fourteen
// return sites, none of which a test could reach without running the whole
// program.
//
// So the rule below Main is that a function returns an error or returns
// nothing. What that error costs a script is code's answer and what a person
// reads of it is report's, and each is one function nothing else duplicates.

// misuse is a failure the command line or the configuration caused.
//
// It is the one distinction a shell is owed, which is why it is the one this
// file draws. A file Eva will not act on is a thing the person who ran it can
// go and fix; a provider that would not answer is not — and a supervisor that
// treated the first as retryable would be retrying a typo forever.
type misuse struct{ err error }

func (m misuse) Error() string { return m.err.Error() }
func (m misuse) Unwrap() error { return m.err }

// rejected marks a failure as the command line's or the configuration's.
//
// A nil error stays nil, so this wraps a call's result where it is made rather
// than needing a branch of its own around every one.
func rejected(err error) error {
	if err == nil {
		return nil
	}
	return misuse{err: err}
}

// unanswered is a turn that ran and did not answer.
//
// It is an error because it is a non-zero exit, and it carries the class rather
// than a sentence so that the words are chosen where the console's are chosen.
// A second table of sentences for the second frontend would be two products
// that drift.
type unanswered struct {
	class  events.ErrorClass
	remedy render.Remedy
}

func (u unanswered) Error() string { return render.Unanswered(u.class) }

// code is what the process leaves behind for a run that ended this way.
//
// It is a total function of the error, which is the whole point of classifying
// one: a code that is derived cannot disagree with the reason it was derived
// from, and a code decided at the point of return could.
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
//
// The why goes to stderr because stdout is the answer, and a pipeline that
// captured a failure line as though it were one would be a pipeline acting on a
// sentence about a credential.
//
// A turn that ran and did not answer is written without the prefix. "eva:" says
// the program failed, and it did not: it reached the provider, the provider
// declined, and the record holds the whole of it. Prefixing that would tell a
// person to go and look at Eva for something Eva has nothing to do with.
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
