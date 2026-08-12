// Package providertest is the Provider contract, written as tests.
package providertest

import (
	"context"
	"errors"
	"io"
	"testing"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
)

type Contract struct {
	// Answers builds a Provider that answers one ordinary turn: some text, a
	// figure for what it cost, and a clean end.
	Answers func(t *testing.T) providers.Provider

	// Unpriced builds a Provider whose turn the API reports no usage for. Nil
	// when a Provider cannot be made to answer one.
	Unpriced func(t *testing.T) providers.Provider

	Call providers.Call
}

func Run(t *testing.T, c Contract) {
	t.Helper()

	if c.Answers == nil {
		t.Fatal("providertest: a Contract needs a Provider that answers")
	}

	t.Run("a turn yields its payloads and then io.EOF", func(t *testing.T) {
		payloads := drain(t, c.Answers(t).Stream(t.Context(), c.Call))
		if len(payloads) == 0 {
			t.Error("the turn yielded nothing at all")
		}
	})

	t.Run("only the four contract kinds cross the seam", func(t *testing.T) {
		for i, payload := range drain(t, c.Answers(t).Stream(t.Context(), c.Call)) {
			switch payload.(type) {
			case events.Text, events.Usage, events.Retry, events.Degraded:
			default:
				// Everything else in the schema is the Recorder's. A Provider
				// that yielded one would put a second account of the Run in the
				// Trace beside the claim that closed it (ADR-0011).
				t.Errorf("payload %d is a %T, which is not a Provider's to yield", i, payload)
			}
		}
	})

	t.Run("usage arrives once, and nothing follows it", func(t *testing.T) {
		payloads := drain(t, c.Answers(t).Stream(t.Context(), c.Call))

		var seen, at int
		for i, payload := range payloads {
			if _, ok := payload.(events.Usage); ok {
				seen, at = seen+1, i
			}
		}
		if seen > 1 {
			t.Fatalf("the turn reported what it cost %d times, want once: a reader summing them would double the bill", seen)
		}
		if seen == 1 && at != len(payloads)-1 {
			t.Errorf("what the turn cost arrived at %d of %d payloads, want last: the books close when the turn does",
				at, len(payloads))
		}
	})

	t.Run("reading past the end keeps returning io.EOF", func(t *testing.T) {
		// Next loops until it has something to return, so a terminal state that
		// neither queued a payload nor ended the turn would spin for ever.
		// Reading past the end is the cheapest way to prove every ending ends.
		s := c.Answers(t).Stream(t.Context(), c.Call)
		defer func() { _ = s.Close() }()
		drainStream(t, s)

		for range 3 {
			if _, err := s.Next(t.Context()); !errors.Is(err, io.EOF) {
				t.Fatalf("reading past the end returned %v, want io.EOF every time", err)
			}
		}
	})

	t.Run("a closed turn stays closed", func(t *testing.T) {
		s := c.Answers(t).Stream(t.Context(), c.Call)
		if err := s.Close(); err != nil {
			t.Fatalf("close: %v", err)
		}
		if _, err := s.Next(t.Context()); !errors.Is(err, io.EOF) {
			t.Errorf("reading a closed turn returned %v, want io.EOF", err)
		}
		// A caller closes on a defer and may close again on its way out of a
		// failure, so the second one is not an error.
		if err := s.Close(); err != nil {
			t.Errorf("closing twice returned %v, want nil", err)
		}
	})

	t.Run("a cancelled turn stops and stays stopped", func(t *testing.T) {
		// The commonest way a turn ends early is somebody pressing ctrl+c, and
		// a Next that ignored a dead context would go on dialling after the Run
		// was over.
		ctx, cancel := context.WithCancel(t.Context())
		s := c.Answers(t).Stream(ctx, c.Call)
		defer func() { _ = s.Close() }()

		cancel()
		for range 3 {
			if _, err := s.Next(ctx); !errors.Is(err, context.Canceled) {
				t.Fatalf("a cancelled turn returned %v, want context.Canceled", err)
			}
		}
	})

	if c.Unpriced == nil {
		return
	}

	t.Run("a turn nobody priced says so rather than reporting zeros", func(t *testing.T) {
		// Silence is not the same as free. A Usage of all absences would say
		// "none were used", which is a different claim from "we were never
		// told" — so the turn carries a caveat instead (ADR-0024).
		var caveats int
		for _, payload := range drain(t, c.Unpriced(t).Stream(t.Context(), c.Call)) {
			switch p := payload.(type) {
			case events.Usage:
				t.Errorf("a turn the API priced nothing for reported a figure: %#v", p)
			case events.Degraded:
				caveats++
			}
		}
		if caveats == 0 {
			t.Error("a turn nobody priced passed without a caveat, so the absence reads as a turn nobody looked at")
		}
	})
}

func drain(t *testing.T, s providers.Stream) []events.Payload {
	t.Helper()

	defer func() { _ = s.Close() }()
	return drainStream(t, s)
}

// drainStream reads to io.EOF under a bound, so that a Provider which never
// ends fails this suite rather than hanging it.
func drainStream(t *testing.T, s providers.Stream) []events.Payload {
	t.Helper()

	var out []events.Payload
	for i := 0; ; i++ {
		if i > 1000 {
			t.Fatal("the turn yielded 1000 payloads and never ended")
		}
		payload, err := s.Next(t.Context())
		if errors.Is(err, io.EOF) {
			return out
		}
		if err != nil {
			t.Fatalf("the turn failed after %d payloads: %v", len(out), err)
		}
		out = append(out, payload)
	}
}
