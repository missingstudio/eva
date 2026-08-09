package providers

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers/retry"
)

// Wire is one Provider's own half of a turn: how to make an attempt, how to
// read what an attempt returns, and how to let it go.
//
// It is the seam the second network Provider proved was real. What differs
// between two Providers is the wire — a vendor's SDK against a hand-rolled
// POST, a typed error document against a status line, two frame vocabularies.
// What does not differ is everything around it: that the caller pulls one
// payload at a time, that a retry is a record before it is a wait, that the
// books close once, and that a turn nobody priced says so. Written twice, that
// second half was two hundred lines the same in both, down to the sentence in
// the caveat — and the next Provider would have copied them again.
type Wire interface {
	// Dial makes one attempt at reaching the API.
	//
	// A nil Refusal is an attempt that connected. Anything else is an attempt
	// that did not, and the Refusal says whether another one could go
	// differently — the Driver decides whether there is another to make.
	//
	// Nothing is retried inside here. One call is one attempt, which is what
	// lets the attempt that failed reach the Trace before the wait that
	// follows it.
	Dial(ctx context.Context) *Refusal

	// Pump advances a connected attempt by one frame, and tells the Driver
	// what that frame said.
	//
	// It is called only after Dial returned nil, and only while the turn is
	// still going. A frame that says nothing the Trace needs may tell the
	// Driver nothing at all; the Driver calls again.
	Pump(d *Driver)

	// Close releases whatever Dial opened. It is called once, and on a Wire
	// that never dialled.
	Close() error
}

// Fault is a failure that says which class it belongs to.
//
// It exists because the class was being computed and then thrown away. A
// Refusal carried one as far as the Retry record and no further, so a turn that
// ran out of attempts — or had none to make, as a rejected credential does —
// reached its caller as prose, and everything downstream that needed to tell an
// expired key from a dropped connection had to read that prose back. Anything
// that reads a message to recover a fact the sender knew is a parser waiting to
// be broken by a reworded sentence.
//
// The message is unchanged and stays the whole of the failure. This adds a
// second way to ask about it, not a second failure.
type Fault struct {
	Err   error
	Class events.ErrorClass
}

func (f *Fault) Error() string { return f.Err.Error() }
func (f *Fault) Unwrap() error { return f.Err }

// ClassOf is why a turn failed, or the empty class when nothing said.
//
// The empty answer is deliberate and is not ErrorOther. A caller that cannot
// place a failure must be able to say so, and a function that guessed "other"
// would hand it a classification it never made — which is the same untruth as
// showing a person a reason nobody established.
func ClassOf(err error) events.ErrorClass {
	var fault *Fault
	if !errors.As(err, &fault) {
		return ""
	}
	return fault.Class
}

// Refusal is one attempt the API turned away.
type Refusal struct {
	// Err is what the turn fails with when this refusal is the last one. It is
	// the whole of the failure a caller sees, so it names the Provider and
	// what went wrong.
	Err error

	// Class is why the attempt failed, in the schema's fixed set. It is what a
	// Retry record carries, so it is read from what the API said rather than
	// inferred from the shape of the failure.
	Class events.ErrorClass

	// Again says whether another attempt could go differently. A rejected
	// credential and a model that does not exist fail the same way and cost
	// the same money on every attempt, so they say false and the policy is
	// never consulted.
	Again bool

	// After is the delay the server itself asked for, and is zero when it
	// asked for nothing.
	After time.Duration
}

// Driver turns a Wire into a Stream.
//
// It is a queue and a state machine rather than a loop, because the caller
// pulls one payload at a time and the interesting things happen between pulls.
// A retry is yielded before the wait it caused, so the Trace holds the attempt
// at the moment it failed rather than however many seconds later the answer
// arrived.
//
// It is also the thing a Wire hands its frames to. Both roles are one type
// because they are one turn: what a Wire says and what a caller reads are the
// same queue, and a second object between them would only be a place for the
// two to disagree.
type Driver struct {
	wire   Wire
	policy retry.Policy

	// connected says an attempt is open and Pump is what advances it.
	connected bool
	// attempts is how many requests have been made, and owed is the wait the
	// last refusal asked for and the next attempt must take first.
	attempts int
	owed     time.Duration

	// queue is what has been produced and not yet handed over.
	queue []events.Payload
	// spend is what the API has said this turn cost so far.
	spend Spend

	// fatal is the failure to report once the queue is drained, and done says
	// the turn ended. Both wait for the queue, because a payload already
	// produced is part of the turn whichever way it ended.
	fatal  error
	done   bool
	closed bool
}

var _ Stream = (*Driver)(nil)

// Drive begins one turn over a Wire. The zero Policy takes the shared default.
func Drive(wire Wire, policy retry.Policy) *Driver {
	return &Driver{wire: wire, policy: policy.OrDefault()}
}

// Failed is a turn that was over before it began: a Call this Provider cannot
// send, or a recording with no turn left in it.
//
// The failure is a Stream rather than a second return value, so that a Provider
// has one way to fail and a caller has one place to read it.
func Failed(err error) Stream { return &Driver{fatal: err} }

// Next returns the next payload of the turn, or io.EOF when it is complete.
func (d *Driver) Next(ctx context.Context) (events.Payload, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if len(d.queue) > 0 {
			payload := d.queue[0]
			d.queue = d.queue[1:]
			return payload, nil
		}
		switch {
		case d.fatal != nil:
			return nil, d.fatal
		case d.done:
			return nil, io.EOF
		case !d.connected:
			d.dial(ctx)
		default:
			d.wire.Pump(d)
		}
	}
}

// Close releases the turn, whether or not it ran to completion.
func (d *Driver) Close() error {
	d.queue, d.done = nil, true
	if d.closed || d.wire == nil {
		return nil
	}
	d.closed = true
	d.connected = false
	return d.wire.Close()
}

// Say queues payloads for the caller, in the order they are given.
func (d *Driver) Say(payloads ...events.Payload) {
	d.queue = append(d.queue, payloads...)
}

// Spend is the turn's books, for a Wire to write what the API said a turn cost.
func (d *Driver) Spend() *Spend { return &d.spend }

// Complete ends the turn cleanly: the books close, and the caller reaches
// io.EOF once the queue is drained.
func (d *Driver) Complete() {
	d.closeBooks(true)
	d.done = true
}

// Break ends the turn with a failure, once the queue is drained.
//
// A payload already produced is part of the turn, so whatever arrived before
// the break is still handed over: a partial answer nobody recorded is the
// failure this project has no instrument to detect.
//
// The class is a parameter rather than something read back out of the error,
// because the Wire is the only thing that knows it. A stream that stopped
// mid-frame and a response the API failed on purpose arrive at this method
// looking alike, and only the code that read the frames can say which is which.
func (d *Driver) Break(class events.ErrorClass, err error) {
	d.closeBooks(false)
	d.connected = false
	d.fatal = &Fault{Err: err, Class: class}
}

// Attempts is how many requests this turn has made, the current one included.
// A Wire reads it to say which attempt a failure belongs to.
func (d *Driver) Attempts() int { return d.attempts }

// dial makes one attempt.
//
// A refusal that another attempt could survive queues a Retry and returns, so
// that the record of the attempt reaches the caller before the wait. The wait
// itself is taken at the top of the next call, which is what makes this one
// attempt per call rather than a loop nothing can observe from outside.
func (d *Driver) dial(ctx context.Context) {
	if d.owed > 0 {
		wait := d.owed
		d.owed = 0
		if err := retry.Sleep(ctx, wait); err != nil {
			d.fatal = err
			return
		}
	}

	d.attempts++
	refusal := d.wire.Dial(ctx)
	if refusal == nil {
		d.connected = true
		return
	}

	// A turn somebody stopped is a turn somebody stopped, whatever the wire
	// made of the cancellation on its way out. Reporting the transport's
	// account of it instead would put a broken pipe in the Trace where a person
	// pressing a key belongs.
	if ctxErr := ctx.Err(); ctxErr != nil {
		d.fatal = ctxErr
		return
	}

	wait, again := d.policy.Wait(d.attempts, refusal.After)
	if !refusal.Again || !again {
		// The class the Retry record would have carried had there been another
		// attempt is the same class the turn ends on. A refusal that exhausted
		// the policy and one that was never worth repeating differ in how many
		// records they left behind, not in why they failed.
		d.fatal = &Fault{Err: refusal.Err, Class: refusal.Class}
		return
	}

	d.owed = wait
	d.Say(events.Retry{
		Attempt:    d.attempts,
		Max:        d.policy.Attempts,
		DelayMS:    int(wait.Milliseconds()),
		ErrorClass: refusal.Class,
	})
}

// closeBooks says what the turn cost, or that nobody said.
//
// whole says the turn reached its own end rather than breaking. Everything the
// API did report is emitted either way, because a turn that broke partway was
// charged for the input tokens regardless.
//
// A Provider says each thing where it learns it and says it once. What a Run's
// single caveat ends up reading is composed at the close, by the one thing that
// sees every degradation rather than only this Provider's.
func (d *Driver) closeBooks(whole bool) {
	if d.spend.Reported() {
		d.Say(d.spend.usage())
		return
	}
	if !whole {
		// A turn that broke says so in its claim, and a claim of failure is
		// already the reason a Run is set aside. A caveat here would qualify a
		// claim that needs no qualifying — and it would be the only caveat a
		// failed turn ever got, since a turn that never connected at all
		// reaches none of this.
		return
	}

	// Silence is not the same as free. A Usage of all zeros would say "none
	// were used", which is a different claim from "we were never told", so
	// nothing is emitted — and the caveat is what stops the absence reading as
	// a turn nobody looked at.
	d.Say(events.Degraded{
		Missing: []string{"what this turn cost: the provider reported no usage"},
	})
}

// Spend accumulates what the API says a turn cost.
//
// Every figure is stated or absent, never defaulted: a counter the API said
// nothing about stays nil, because a zero would claim none were used and that
// is a different claim (ADR-0024). Figures may be restated — Anthropic's arrive
// across two frames, each cumulative rather than incremental — so a figure
// overwrites rather than adding to what came before. Adding would double the
// input tokens of every turn.
//
// A dollar figure is never derived here, from a local price table or from wall
// clock. Billing meters from provider-reported usage reconciled against
// invoices, and a made-up number would become a financial liability.
type Spend struct {
	reported bool
	u        events.Usage
}

// Input records the input tokens the API stated. stated is false when this
// frame carried no such figure, which leaves the counter absent.
func (s *Spend) Input(n int64, stated bool) { s.take(&s.u.InputTokens, n, stated) }

// Output records the output tokens the API stated. Thinking is billed inside
// this figure on both APIs, so a reasoning count is a subset of it rather than
// a number beside it.
func (s *Spend) Output(n int64, stated bool) { s.take(&s.u.OutputTokens, n, stated) }

// CacheWrite records the tokens written to the prompt cache.
func (s *Spend) CacheWrite(n int64, stated bool) { s.take(&s.u.CacheWriteTokens, n, stated) }

// CacheRead records the tokens served from the prompt cache.
func (s *Spend) CacheRead(n int64, stated bool) { s.take(&s.u.CacheReadTokens, n, stated) }

// Reasoning records the thinking tokens, which are a subset of the output
// tokens — anything that sums the two has double-counted them.
func (s *Spend) Reasoning(n int64, stated bool) { s.take(&s.u.ReasoningTokens, n, stated) }

// Reported says whether the API stated any figure at all. A turn it said
// nothing about emits no Usage record, because a record of absences says the
// same thing at more cost to whoever reads it.
func (s *Spend) Reported() bool { return s.reported }

// take records one figure.
//
// Both APIs type these signed, and a negative count is not a thing that exists,
// so one is read as none rather than as an enormous unsigned number.
func (s *Spend) take(into **uint64, n int64, stated bool) {
	if !stated {
		return
	}
	if n < 0 {
		n = 0
	}
	*into = events.Tokens(uint64(n))
	s.reported = true
}

func (s *Spend) usage() events.Usage { return s.u }
