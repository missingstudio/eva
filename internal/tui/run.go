package tui

import (
	"context"
	"errors"
	"io"

	tea "charm.land/bubbletea/v2"
	"github.com/missingstudio/eva/internal/api"
)

func Run(ctx context.Context, session api.Session, local Local, in io.Reader, out io.Writer, opts ...Option) error {
	program, c, err := NewConsole(ctx, session, local, in, out, opts...)
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
func stopped(err error) bool {
	if errors.Is(err, tea.ErrProgramPanic) {
		return false
	}
	return errors.Is(err, context.Canceled) || errors.Is(err, tea.ErrInterrupted)
}
