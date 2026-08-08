package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
	"github.com/missingstudio/eva/providers"
)

// Turn is one prompt answered by one model call. It is the smallest Unit Eva
// has: it takes a Spec and returns an Outcome, exactly as a workflow, an
// agent, or a factory does at a longer timescale.
//
// A Turn is not a Run. A Run is one execution of a Unit against a Session, and
// it is the RunID below; a Turn is the Unit being executed. The words are
// close and CONTEXT.md keeps them apart on purpose.
type Turn struct {
	Provider providers.Provider
	Sink     core.TraceSink
	Session  *core.Session
	Run      events.RunID

	// Model is which model to answer with.
	Model string

	// Out receives each committed Event as one line of JSON. It is nil when
	// nothing is consuming the machine-readable stream.
	//
	// Events are written after the sink commits them, not before, so what a
	// consumer reads carries the Trace position the Trace actually holds.
	Out io.Writer

	// Clock and IDs come from the caller because core is pure and this is the
	// layer that owns the outside world.
	Now   func() events.Timestamp
	NewID func() events.EventID
}

var _ core.Unit = (*Turn)(nil)

// Execute answers one prompt.
//
// Every step appends to the Trace before it reaches anyone: there are no quick
// paths, and a turn that produced output nobody recorded would be the one
// failure the project has no instrument to detect (invariant 1).
func (t *Turn) Execute(ctx context.Context, spec core.Spec) (core.Outcome, error) {
	emitter := &core.Emitter{
		Tenant:  spec.Tenant,
		Actor:   spec.Actor,
		Run:     t.Run,
		Session: t.Session.ID,
	}

	if err := t.commit(ctx, emitter, events.Started{Capabilities: capabilities()}); err != nil {
		return core.Outcome{}, err
	}

	t.Session.Append(core.Message{Author: core.AuthorUser, Text: spec.Intent})

	answer, streamErr := t.stream(ctx, emitter)
	if streamErr == nil {
		t.Session.Append(core.Message{Author: core.AuthorAssistant, Text: answer})
	}

	outcome := core.Outcome{Result: events.ResultDone, Summary: "answered"}
	if streamErr != nil {
		outcome = core.Outcome{Result: events.ResultFailed, Summary: streamErr.Error()}
	}

	// The claim is committed whichever way the turn went. A Run that failed
	// and left no Finished record is a Run a reader cannot tell from one that
	// is still going.
	if err := t.commit(ctx, emitter, events.Finished{Claim: outcome.Claim()}); err != nil {
		return outcome, err
	}
	return outcome, streamErr
}

// stream replays the provider's turn into the Trace and returns the answer.
func (t *Turn) stream(ctx context.Context, emitter *core.Emitter) (string, error) {
	stream, err := t.Provider.Stream(ctx, providers.Call{
		Model:    t.Model,
		Messages: t.Session.Messages(),
	})
	if err != nil {
		return "", fmt.Errorf("provider %s: %w", t.Provider.Name(), err)
	}
	// The turn's outcome is what the caller acts on. A stream that failed to
	// close has nothing to add to it, and the Trace already holds what
	// happened.
	defer func() { _ = stream.Close() }()

	var answer strings.Builder
	for {
		payload, err := stream.Next(ctx)
		if errors.Is(err, io.EOF) {
			return answer.String(), nil
		}
		if err != nil {
			return answer.String(), fmt.Errorf("provider %s: %w", t.Provider.Name(), err)
		}
		if text, ok := payload.(events.Text); ok {
			answer.WriteString(text.Chunk)
		}
		if err := t.commit(ctx, emitter, payload); err != nil {
			return answer.String(), err
		}
	}
}

// commit appends one Event to the Trace and then writes what was committed.
func (t *Turn) commit(ctx context.Context, emitter *core.Emitter, payload events.Payload) error {
	event := emitter.Emit(t.NewID(), t.Now(), payload)

	committed, err := t.Sink.Append(ctx, []events.Event{event})
	if err != nil {
		return err
	}
	if t.Out == nil {
		return nil
	}
	for _, e := range committed {
		line, err := json.Marshal(e)
		if err != nil {
			return fmt.Errorf("encode %s event: %w", e.Kind, err)
		}
		if _, err := fmt.Fprintf(t.Out, "%s\n", line); err != nil {
			return fmt.Errorf("write %s event: %w", e.Kind, err)
		}
	}
	return nil
}

// capabilities is what a Run can do in this build.
//
// Capability is discovered twice and the per-run value wins, so this is the
// per-run answer rather than a property of the binary. Everything a tool, a
// sandbox, or a scheduler would need is false until the stage that builds it,
// because a capability claimed and absent is worse than one that is missing:
// a missing capability degrades a Run, and a false claim corrupts it.
func capabilities() events.Capabilities {
	return events.Capabilities{
		// The machine-readable stream is the contract this stage exists to
		// establish.
		StructuredEvents: true,
		// Every turn emits a Usage Event carrying real provider figures.
		CostReport: true,
	}
}
