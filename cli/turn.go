package cli

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
	"github.com/missingstudio/eva/providers"
)

// Turn is one prompt answered by one model call. It is the smallest Unit Eva
// has: it takes a Spec and returns an Outcome, exactly as a workflow, an
// agent, or a factory does at a longer timescale.
//
// A Turn is not a Run. A Run is one execution of a Unit against a Session, and
// it is the Run the Recorder stamps; a Turn is the Unit being executed. The
// words are close and the glossary keeps them apart on purpose.
//
// What a Turn does not hold is as telling as what it does. It has no clock, no
// identifier source, no output stream, and no way to write to the Session —
// the Recorder owns all four. A Turn says what happened; it does not decide
// how that is recorded, and it cannot record one thing and report another.
type Turn struct {
	Provider providers.Provider
	Recorder *core.Recorder

	// Session is read, never written. The transcript the answer is
	// conditioned on is a fold over committed Events, so the Recorder is what
	// puts things into it.
	Session *core.Session

	// Model is which model to answer with.
	Model string

	// Interrupt says whether a cancellation of this turn is a clean cancel:
	// whether something is listening for it and lets the Run close, rather
	// than the process dying under it. It is a property of whoever drives the
	// Turn, so it is told rather than worked out here.
	Interrupt bool

	// Arriving is told each chunk as the Provider yields it, before any of it
	// is committed. It is nil on every path but the console, where nobody is
	// watching a turn happen.
	//
	// It exists because a Trace and a person want different things from one
	// stream. A Trace record is a unit of meaning, so chunks are held until
	// the content block they belong to is whole — and an ordinary answer is
	// one content block, so a person watching the record arrive would watch
	// nothing until the answer was over.
	//
	// What is told here is not a record and is never kept. It goes to a live
	// area that is erased when the Run closes, and what replaces it is the
	// fold over what the Trace holds. So a chunk that never reached the Trace
	// — a process killed mid-block — leaves nothing behind that says it did,
	// and nothing a person keeps came from anywhere but the record.
	Arriving func(chunk string)
}

var _ core.Unit = (*Turn)(nil)

// Execute answers one prompt.
//
// Every step reaches the Trace before it reaches anyone: there are no quick
// paths, and a turn that produced output nobody recorded would be the one
// failure the project has no instrument to detect (invariant 1).
func (t *Turn) Execute(ctx context.Context, spec core.Spec) (core.Outcome, error) {
	// The intent rides on Started, which is what puts the prompt in the Trace
	// and therefore in the Session. A transcript whose first message lives
	// only in this process is one a Trace cannot reconstruct.
	started := events.Started{Intent: spec.Intent, Capabilities: capabilities(t.Interrupt)}
	if err := t.Recorder.Record(ctx, started); err != nil {
		return core.Outcome{}, err
	}

	streamErr := t.stream(ctx)

	outcome := core.Outcome{Result: events.ResultDone, Summary: "answered"}
	switch {
	case errors.Is(streamErr, context.Canceled):
		// A turn somebody stopped is not a turn that failed, and the closed
		// set of Results has no third word for it. It closes as failed and
		// says plainly what happened, rather than reporting the plumbing that
		// carried the cancellation. It gets no caveat: a claim of failure is
		// already the reason a Run is set aside, and a caveat over it would
		// say nothing the claim does not.
		outcome = core.Outcome{Result: events.ResultFailed, Summary: "interrupted"}
	case streamErr != nil:
		outcome = core.Outcome{Result: events.ResultFailed, Summary: streamErr.Error()}
	}

	// The claim is committed whichever way the turn went, and under a context
	// the cancellation cannot reach. A Run that failed and left no Finished
	// record is a Run a reader cannot tell from one that is still going — and
	// an interrupted Run is exactly the one whose close would otherwise be
	// cancelled along with it. The Recorder closes the Run rather than the
	// Turn writing the record, because anything the Run could not understand
	// qualifies the claim and has to be committed with it.
	if err := t.Recorder.Finish(context.WithoutCancel(ctx), outcome.Claim()); err != nil {
		return outcome, err
	}
	return outcome, streamErr
}

// stream replays the provider's turn into the Trace.
//
// Payloads are recorded a content block at a time rather than one at a time,
// because the group is what the sink folds within. A block is also the largest
// batch that is safe to hold: everything already recorded survives the process
// dying, so buffering a whole turn would trade the property invariant 1 rests
// on for a smaller file.
func (t *Turn) stream(ctx context.Context) error {
	stream, err := t.Provider.Stream(ctx, providers.Call{
		Model:    t.Model,
		Messages: t.Session.Messages(),
	})
	if err != nil {
		return fmt.Errorf("provider %s: %w", t.Provider.Name(), err)
	}
	// The turn's outcome is what the caller acts on. A stream that failed to
	// close has nothing to add to it, and the Trace already holds what
	// happened.
	defer func() { _ = stream.Close() }()

	var block blockGroup
	for {
		payload, err := stream.Next(ctx)
		if errors.Is(err, io.EOF) {
			// Whatever is still pending is part of the answer, so it is
			// committed before the turn is called complete.
			return block.flush(ctx, t.Recorder)
		}
		if err != nil {
			// A failed stream still produced whatever came before it, and the
			// Trace has to hold that: a partial answer that reached nobody's
			// record is the failure with no instrument. The commit is out of
			// reach of the cancellation for the same reason, because the
			// commonest way for a stream to end early is somebody stopping
			// it, and that is not a reason to lose what had arrived.
			if ferr := block.flush(context.WithoutCancel(ctx), t.Recorder); ferr != nil {
				return ferr
			}
			return fmt.Errorf("provider %s: %w", t.Provider.Name(), err)
		}

		// Whoever is watching the turn happen is told first, because being
		// told is the only reason they are watching. It is told what arrived,
		// which is not the same act as recording it: the record is committed
		// below, a content block at a time.
		if text, isText := payload.(events.Text); isText && t.Arriving != nil {
			t.Arriving(text.Chunk)
		}

		if degraded, isCaveat := payload.(events.Degraded); isCaveat {
			// A caveat is not a record of its own. The Recorder composes one
			// for the whole Run and commits it with the claim, so a Provider
			// that noticed two things — and a Run whose Trace also holds a
			// record nobody understood — still close on a single Degraded
			// rather than on a scattering of them a reader has to reconcile.
			t.Recorder.Degrade(degraded.Missing...)
			continue
		}

		if err := block.add(ctx, t.Recorder, payload); err != nil {
			return err
		}
	}
}

// blockGroup accumulates the chunks of one content block so that they commit
// as one group. Anything that is not a chunk closes the block and commits on
// its own.
type blockGroup struct {
	pending []events.Payload
	block   int
}

func (g *blockGroup) add(ctx context.Context, rec *core.Recorder, payload events.Payload) error {
	text, isText := payload.(events.Text)
	if !isText {
		if err := g.flush(ctx, rec); err != nil {
			return err
		}
		return rec.Record(ctx, payload)
	}

	if len(g.pending) > 0 && text.Block != g.block {
		if err := g.flush(ctx, rec); err != nil {
			return err
		}
	}
	g.block = text.Block
	g.pending = append(g.pending, text)
	return nil
}

func (g *blockGroup) flush(ctx context.Context, rec *core.Recorder) error {
	if len(g.pending) == 0 {
		return nil
	}
	group := g.pending
	g.pending = nil
	return rec.Record(ctx, group...)
}

// capabilities is what a Run can do in this build.
//
// Capability is discovered twice and the per-run value wins, so this is the
// per-run answer rather than a property of the binary. Everything a tool, a
// sandbox, or a scheduler would need is false until the stage that builds it,
// because a capability claimed and absent is worse than one that is missing:
// a missing capability degrades a Run, and a false claim corrupts it.
//
// interrupt is the first one that differs between two Runs of one binary. The
// console listens for a cancellation and lets the Run close; a signal to the
// one-shot command kills the process where it stands, which is not a clean
// cancel however it looks from outside.
func capabilities(interrupt bool) events.Capabilities {
	return events.Capabilities{
		// The interface that drives the turn says whether it is listening.
		Interrupt: interrupt,
		// The machine-readable stream is the contract this stage exists to
		// establish.
		StructuredEvents: true,
		// Real provider figures reach the Trace, and are never estimated to
		// fill a gap. A turn the provider reported nothing for emits no Usage
		// and closes the Run with a caveat saying so — which is the capability
		// working rather than an exception to it.
		CostReport: true,
	}
}
