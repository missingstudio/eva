package providers

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers/retry"
)

type Wire interface {
	// Dial makes one attempt at reaching the API.
	Dial(ctx context.Context) *Refusal

	// Pump advances a connected attempt by one frame, and tells the Driver
	// what that frame said.
	Pump(d *Driver)

	// Close releases whatever Dial opened. It is called once, and on a Wire
	// that never dialled.
	Close() error
}

type Fault struct {
	Err   error
	Class events.ErrorClass
}

func (f *Fault) Error() string { return f.Err.Error() }
func (f *Fault) Unwrap() error { return f.Err }

// ClassOf is why a turn failed, or the empty class when nothing said.
func ClassOf(err error) events.ErrorClass {
	var fault *Fault
	if !errors.As(err, &fault) {
		return ""
	}
	return fault.Class
}

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

type Driver struct {
	wire   Wire
	policy retry.Policy

	connected bool
	// attempts is how many requests have been made, and owed is the wait the
	// last refusal asked for and the next attempt must take first.
	attempts int
	owed     time.Duration

	// queue is what has been produced and not yet handed over.
	queue []events.Payload
	spend Spend

	// fatal is the failure to report once the queue is drained, and done says
	// the turn ended. Both wait for the queue, because a payload already
	// produced is part of the turn whichever way it ended.
	fatal  error
	done   bool
	closed bool
}

var _ Stream = (*Driver)(nil)

func Drive(wire Wire, policy retry.Policy) *Driver {
	return &Driver{wire: wire, policy: policy.OrDefault()}
}

// Failed is a turn that was over before it began: a Call this Provider cannot
// send, or a recording with no turn left in it.
func Failed(err error) Stream { return &Driver{fatal: err} }

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

func (d *Driver) Close() error {
	d.queue, d.done = nil, true
	if d.closed || d.wire == nil {
		return nil
	}
	d.closed = true
	d.connected = false
	return d.wire.Close()
}

func (d *Driver) Say(payloads ...events.Payload) {
	d.queue = append(d.queue, payloads...)
}

func (d *Driver) Spend() *Spend { return &d.spend }

func (d *Driver) Complete() {
	d.closeBooks(true)
	d.done = true
}

func (d *Driver) Break(class events.ErrorClass, err error) {
	d.closeBooks(false)
	d.connected = false
	d.fatal = &Fault{Err: err, Class: class}
}

func (d *Driver) Attempts() int { return d.attempts }

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

func (s *Spend) CacheWrite(n int64, stated bool) { s.take(&s.u.CacheWriteTokens, n, stated) }

func (s *Spend) CacheRead(n int64, stated bool) { s.take(&s.u.CacheReadTokens, n, stated) }

func (s *Spend) Reasoning(n int64, stated bool) { s.take(&s.u.ReasoningTokens, n, stated) }

// Reported says whether the API stated any figure at all. A turn it said
// nothing about emits no Usage record, because a record of absences says the
// same thing at more cost to whoever reads it.
func (s *Spend) Reported() bool { return s.reported }

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
