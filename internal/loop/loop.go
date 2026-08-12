package loop

import (
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
)

// Loop is the Unit that answers one prompt. It takes a Spec and returns an
// Outcome, exactly as a workflow, an agent, or a factory does at a longer
// timescale, and the whole account of the prompt-to-answer arc is the Run this
// Unit executes as — there is no third name for that arc.
type Loop struct {
	Provider providers.Provider

	// ProviderName is what configuration selected the Provider by, and is what
	// a failure names. It is told rather than asked of the Provider: the
	// registry key is the name, and a second copy of it on the Provider would
	// be a copy that could disagree with the one a person wrote.
	ProviderName string

	Recorder *core.Recorder

	// Session is read, never written. The transcript the answer is
	// conditioned on is a fold over committed Events, so the Recorder is what
	// puts things into it.
	Session *core.Session

	Model string

	SystemPrompt string

	// Interrupt says whether a cancellation of this turn is a clean cancel:
	// whether something is listening for it and lets the Run close, rather
	// than the process dying under it. It is a property of whoever drives the
	// Loop, so it is told rather than worked out here.
	Interrupt bool

	// Arriving is told each chunk as the Provider yields it, before any of it
	// is committed. It is nil on every path but the console, where nobody is
	// watching a turn happen.
	Arriving func(chunk string)
}

var _ core.Unit = (*Loop)(nil)

func (l *Loop) Execute(ctx context.Context, spec core.Spec) (core.Outcome, error) {
	// The intent rides on Started, which is what puts the prompt in the Trace
	// and therefore in the Session. A transcript whose first message lives
	// only in this process is one a Trace cannot reconstruct.
	started := events.Started{Intent: spec.Intent, Capabilities: capabilities(l.Interrupt)}
	if err := l.Recorder.Record(ctx, started); err != nil {
		// The Run may be open even though this failed. A group is committed
		// before it is published, so a projection that broke on the way out
		// leaves the Started record in the Trace and returns an error anyway —
		// and a Run that opened and never closed is one a reader cannot tell
		// from a Run still going. So it is closed here, and the failure that
		// caused it is what is reported.
		closed := core.Outcome{Result: events.ResultFailed, Summary: "the run could not be opened"}
		_ = l.Recorder.Finish(context.WithoutCancel(ctx), closed.Claim())
		return core.Outcome{}, err
	}

	streamErr := l.stream(ctx)

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
		// The class travels beside the summary rather than being read back out
		// of it. What the Provider knew about why the turn failed is a fact it
		// stated, and a Loop that recovered it by matching on the message would
		// be rebuilding that fact from its own prose — wrong the first time a
		// sentence is reworded, and wrong silently.
		outcome = core.Outcome{
			Result:  events.ResultFailed,
			Summary: streamErr.Error(),
			Class:   providers.ClassOf(streamErr),
		}
	}

	// The claim is committed whichever way the turn went, and under a context
	// the cancellation cannot reach. A Run that failed and left no Finished
	// record is a Run a reader cannot tell from one that is still going —
	// and an interrupted Run is exactly the one whose close would otherwise be
	// cancelled along with it.
	if err := l.Recorder.Finish(context.WithoutCancel(ctx), outcome.Claim()); err != nil {
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

func (l *Loop) conditioning() []core.Message {
	transcript := l.Session.Messages()
	if l.SystemPrompt == "" {
		return transcript
	}
	system := core.Say(core.AuthorSystem, l.SystemPrompt)
	return append([]core.Message{system}, transcript...)
}

// unrecorded marks a failure to write rather than a failure to work.
type unrecorded struct{ err error }

func (u unrecorded) Error() string { return u.err.Error() }
func (u unrecorded) Unwrap() error { return u.err }

func (l *Loop) stream(ctx context.Context) error {
	stream := l.Provider.Stream(ctx, providers.Call{
		Model:    l.Model,
		Messages: l.conditioning(),
	})
	// The turn's outcome is what the caller acts on. A stream that failed to
	// close has nothing to add to it, and the Trace already holds what
	// happened.
	defer func() { _ = stream.Close() }()

	block := newBlocks(l.Recorder)
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
			return fmt.Errorf("provider %s: %w", l.ProviderName, err)
		}

		// Whoever is watching the turn happen is told first, because being
		// told is the only reason they are watching. It is told what arrived,
		// which is not the same act as recording it: the record is committed
		// below, a content block at a time.
		if text, isText := payload.(events.Text); isText && l.Arriving != nil {
			l.Arriving(text.Chunk)
		}

		if degraded, isCaveat := payload.(events.Degraded); isCaveat {
			// A caveat is not a record of its own. The Recorder composes one
			// for the whole Run and commits it with the claim, so a Provider
			// that noticed two things — and a Run whose Trace also holds a
			// record nobody understood — still close on a single Degraded
			// rather than on a scattering of them a reader has to reconcile.
			l.Recorder.Degrade(degraded.Missing...)
			continue
		}

		// Three kinds are a Provider's to record, and the schema admits eleven.
		// The rest belong to the Recorder — a Provider that yielded a Finished
		// would put a second account of the Run in the Trace beside the one the
		// claim closed it with, and a reader would have no way to tell which
		// was the Run's own (ADR-0011). The contract says four kinds cross the
		// seam; this is where saying it stops being a comment.
		switch payload.(type) {
		case events.Text, events.Usage, events.Retry:
		default:
			return fmt.Errorf("provider %s yielded a %T, which is not a Provider's to record", l.ProviderName, payload)
		}

		if err := block.add(ctx, payload); err != nil {
			return err
		}
	}
}

// blocks accumulates the chunks of one content block so that they commit as
// one group. Anything that is not a chunk closes the block and commits on its
// own.
type blocks struct {
	rec *core.Recorder

	pending []events.Payload
	block   int
}

func newBlocks(rec *core.Recorder) *blocks { return &blocks{rec: rec} }

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

func capabilities(interrupt bool) events.Capabilities {
	return events.Capabilities{
		// The interface that drives the turn says whether it is listening.
		Interrupt: interrupt,
		// Every step of a turn reaches the Trace as a typed Event, which is
		// the contract this stage exists to establish. It is what a later
		// adapter normalizes into and what a projection folds, and it is true
		// of the record whether or not anything is reading it right now.
		StructuredEvents: true,
		// Real provider figures reach the Trace, and are never estimated to
		// fill a gap. A turn the provider reported nothing for emits no Usage
		// and closes the Run with a caveat saying so — which is the capability
		// working rather than an exception to it.
		CostReport: true,
	}
}
