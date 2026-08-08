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
//
// What happened to the turn is the Outcome, and only the Outcome. A provider
// that broke and a person who stopped the turn are both answered with a claim
// of failure and the words to go with it, because that is what the Trace holds
// and a caller reading something else would be reading a second account of one
// turn. The error is what the Outcome cannot carry: the record itself failing,
// where there is nothing in the Trace to read instead.
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

	// The Trace now holds the turn's own account of how it went, and the
	// Outcome above is that account. Returning the stream's error beside it
	// would put the same fact in two shapes, and two callers reading one turn
	// would each believe a different one — which is how a screen comes to say
	// something the record does not. What is left to report is the record
	// failing, because that is the fact no Trace holds.
	var notWritten unrecorded
	if errors.As(streamErr, &notWritten) {
		return outcome, notWritten.err
	}
	return outcome, nil
}

// unrecorded marks a failure to write rather than a failure to work.
//
// The two are told apart because a Unit answers them differently. A provider
// that broke is an Outcome: the turn ran, it failed, and the Trace says so in
// the claim that closed the Run. A Trace that would not take the record is not
// an account of the turn at all — it is the instrument failing, and a caller
// has nothing in the Trace to read instead, so it is the one thing that
// reaches them as an error.
type unrecorded struct{ err error }

func (u unrecorded) Error() string { return u.err.Error() }
func (u unrecorded) Unwrap() error { return u.err }

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

	block := newBlocks(t.Recorder)
	for {
		payload, err := stream.Next(ctx)
		if errors.Is(err, io.EOF) {
			// Whatever is still pending is part of the answer, so it is
			// committed before the turn is called complete.
			return block.close(ctx)
		}
		if err != nil {
			// A failed stream still produced whatever came before it, and the
			// Trace has to hold that: a partial answer that reached nobody's
			// record is the failure with no instrument. The commit is out of
			// reach of the cancellation for the same reason, because the
			// commonest way for a stream to end early is somebody stopping
			// it, and that is not a reason to lose what had arrived.
			if ferr := block.close(context.WithoutCancel(ctx)); ferr != nil {
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

		if err := block.add(ctx, payload); err != nil {
			return err
		}
	}
}

// blocks accumulates the chunks of one content block so that they commit as
// one group. Anything that is not a chunk closes the block and commits on its
// own.
//
// It holds the Recorder rather than being handed one on each call. Where a
// group ends and where it goes are one decision: a caller free to name a
// different Recorder for the chunk and for the flush could split one content
// block across two Runs, and the sink's fold — which is why the group is the
// unit at all — would have nothing left to fold within.
//
// This is the other half of the sink's fold, and the half that decides what it
// can do. The sink merges consecutive chunks of one block within a group; this
// is what puts them in one group. A version of this that committed a chunk at
// a time would leave every fold in trace correct and every one of them idle.
type blocks struct {
	rec *core.Recorder

	pending []events.Payload
	block   int
}

func newBlocks(rec *core.Recorder) *blocks { return &blocks{rec: rec} }

// add takes one payload: a chunk joins the open block, and anything else
// closes the block and commits on its own.
func (b *blocks) add(ctx context.Context, payload events.Payload) error {
	text, isText := payload.(events.Text)
	if !isText {
		if err := b.close(ctx); err != nil {
			return err
		}
		return b.commit(ctx, payload)
	}

	if len(b.pending) > 0 && text.Block != b.block {
		if err := b.close(ctx); err != nil {
			return err
		}
	}
	b.block = text.Block
	b.pending = append(b.pending, text)
	return nil
}

// close commits what the open block has accumulated, and does nothing when
// there is none.
func (b *blocks) close(ctx context.Context) error {
	if len(b.pending) == 0 {
		return nil
	}
	group := b.pending
	b.pending = nil
	return b.commit(ctx, group...)
}

// commit is the one place a group reaches the Recorder, and the one place a
// refusal is marked as the record failing rather than the turn failing.
func (b *blocks) commit(ctx context.Context, payloads ...events.Payload) error {
	if err := b.rec.Record(ctx, payloads...); err != nil {
		return unrecorded{err: err}
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
