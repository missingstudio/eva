package tui

import (
	"context"
	"errors"
	"io"

	tea "charm.land/bubbletea/v2"
)

// Run holds a conversation until the person leaves.
//
// It is the whole of what a caller needs to start an interactive Session: hand
// it what a console may drive and the two streams, and it returns when the
// program has ended and nothing is still committing.
//
// The teardown is here rather than at the call site because its ordering is a
// property of the program. Whatever ended it — a key, a closed input, a signal
// — a Run may still be in flight. It is stopped first and waited for second:
// the wait is what keeps a sink from closing under a Run that is still
// committing, and the stop is what keeps the wait short. A caller that had to
// remember that ordering is a caller that will one day forget it, and the
// failure it would cause is the one the project has no instrument to detect.
//
// Being asked to stop is not a failure to report. The caller cancelled the
// Context because the process was asked to stop and already knows it; the
// program's own account of that arrives as a sentinel of the library's, and
// passing it up would put a dependency's words in Eva's voice on the one path
// where a person is owed Eva's. That is the leak render exists to prevent, from
// the other side.
func Run(ctx context.Context, backend Control, in io.Reader, out io.Writer, opts ...Option) error {
	program, c, err := NewConsole(ctx, backend, in, out, opts...)
	if err != nil {
		return err
	}

	_, err = program.Run()

	c.stop()
	c.Wait()

	if stopped(err) {
		return nil
	}
	return err //nolint:wrapcheck // the program's error is the program's.
}

// stopped says the program ended because it was asked to, rather than because
// something went wrong.
//
// It matches the cancellation and not the library's kill sentinel, which is the
// distinction that matters. ErrProgramKilled is wrapped around *every* reason
// the program did not shut down gracefully, a panic included — so matching it
// would report a panic as an orderly stop and print nothing at all. What a
// cancelled Context looks like coming out of the library is that sentinel
// wrapped around the Context's own error, so the Context's error is what is
// asked for.
//
// ErrInterrupted is matched beside it because it means the same thing by
// another route: an InterruptMsg reached the program. This build hands the
// signal to the process surface instead, so nothing produces it today, and it
// costs one clause to be right if anything does.
//
// The panic is named explicitly rather than left to the two clauses above. A
// panic is the one outcome that must never be silent, and a clause that says so
// is worth more than the argument that it cannot get here.
func stopped(err error) bool {
	if errors.Is(err, tea.ErrProgramPanic) {
		return false
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, tea.ErrInterrupted)
}
