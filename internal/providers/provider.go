package providers

import (
	"context"

	"github.com/missingstudio/eva/internal/core"
	"github.com/missingstudio/eva/internal/events"
)

type Call struct {
	Model string
	// Messages is the transcript the answer is conditioned on.
	Messages []core.Message
}

// Provider is a model behind one contract, so that a test is deterministic,
// free, and needs no API key. Substitution is the point of the interface: the
// fake implementation replays recorded output, and the network ones sit behind
// the same one method.
type Provider interface {
	// Stream begins one turn. The caller reads the Stream to completion or
	// closes it.
	//
	// It cannot fail. A turn that was asked for something impossible — no
	// model, no transcript, an Author this Provider cannot send — fails from
	// the first Next, because that is already where every other failure of a
	// turn arrives. Two error channels for one turn is two things for a caller
	// to learn and one thing for it to do with them.
	Stream(ctx context.Context, call Call) Stream
}

// Stream is one turn in progress.
//
// It yields payloads of the one Event schema rather than a shape of its own. A
// provider knows what happened; it does not know the Run, the Session, or the
// tenant it happened under, so it does not fill in an envelope. There is no
// second vocabulary to normalize from (invariant 8).
//
// What a caller must know beyond the two methods is written here, and is
// enforced by the conformance suite in providertest rather than by this
// comment. A Provider that satisfies these types and breaks these rules is a
// Provider the suite fails.
//
//   - Four payload kinds cross this seam and no others: Text, Usage, Retry,
//     and Degraded. Started, Finished, and the rest are the Recorder's, and a
//     Provider that yielded one would put a second account of the Run in the
//     Trace (ADR-0011).
//   - Usage arrives at most once, and nothing follows it but the end of the
//     turn. A turn nobody priced yields a Degraded saying so instead — silence
//     is not the same as free (ADR-0024).
//   - A Retry reaches the caller before the wait it caused, so the Trace holds
//     the attempt at the moment it failed rather than however many seconds
//     later the answer arrived (ADR-0012).
//   - Text chunks carry the index of the content block they belong to, and the
//     sink folds consecutive chunks of one block into one record.
type Stream interface {
	// Next returns the next payload of the turn, or io.EOF when the turn is
	// complete. A provider failure arrives here as an error rather than as a
	// panic.
	//
	// Every ending is terminal and repeats itself: reading past io.EOF returns
	// io.EOF again, reading past a failure returns that failure again, and
	// reading after Close returns io.EOF. A caller that loops until an error
	// therefore always stops.
	//
	// A payload says what happened; it does not say what becomes of it. A
	// Degraded yielded here is a caveat rather than a record — the caller folds
	// it into the one a Run closes with — so a Provider states each thing it
	// noticed where it noticed it, and states it once, rather than saving them
	// up to be emitted together.
	Next(ctx context.Context) (events.Payload, error)

	// Close releases the turn, whether or not it ran to completion. Closing
	// twice is not an error.
	Close() error
}
