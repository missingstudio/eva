package tui

import (
	"context"
	"io"
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
func Run(ctx context.Context, backend Control, in io.Reader, out io.Writer, opts ...Option) error {
	program, c, err := NewConsole(ctx, backend, in, out, opts...)
	if err != nil {
		return err
	}

	_, err = program.Run()

	c.stop()
	c.Wait()

	return err //nolint:wrapcheck // the program's error is the program's.
}
