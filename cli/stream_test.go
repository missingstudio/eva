package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/missingstudio/eva/events"
)

// A Subscriber's failure is the reason Committed returns an error at all: the
// machine-readable stream is a contract a script parses, and a script that
// stopped receiving records while the turn ran on would read a turn that ended
// cleanly and be wrong. These are the two ways that can happen.

// errBrokenPipe is what a stream nobody is reading any more says.
var errBrokenPipe = errors.New("broken pipe")

// brokenPipe is a writer that takes nothing, which is what stdout is once the
// process reading it has gone.
type brokenPipe struct{}

func (brokenPipe) Write([]byte) (int, error) { return 0, errBrokenPipe }

// one is an Event of the kind the stream carries most.
func one() events.Event {
	return events.Event{
		ID:      "evt_1",
		Seq:     1,
		Version: events.SchemaVersion,
		Kind:    events.KindText,
		Run:     "run_1",
		Session: "sess_1",
		Payload: events.Text{Chunk: "answered."},
	}
}

// A stream that cannot be written reports it, and says which record was lost.
func TestABrokenMachineReadableStreamIsReported(t *testing.T) {
	err := eventStream{out: brokenPipe{}}.Committed(context.Background(), one())

	if !errors.Is(err, errBrokenPipe) {
		t.Fatalf("err = %v, want the writer's own failure", err)
	}
	if !strings.Contains(err.Error(), string(events.KindText)) {
		t.Errorf("err = %v, want it to name the kind that did not reach the stream", err)
	}
}

// A record this schema cannot encode is reported rather than written as
// whatever it happens to serialise to. The Recorder rejects one before it ever
// commits, so this is the second line of a defence rather than the first — and
// a stream that printed a record no reader could decode would be a stream that
// broke its own contract silently.
func TestARecordThatCannotBeEncodedIsReported(t *testing.T) {
	e := one()
	// A Kind that contradicts its payload: the codec rejects the pair rather
	// than silently correcting either half.
	e.Kind = events.KindUsage

	var out bytes.Buffer
	err := eventStream{out: &out}.Committed(context.Background(), e)

	if err == nil {
		t.Fatalf("a record the codec rejects was written as %q", out.String())
	}
	if out.Len() != 0 {
		t.Errorf("the stream holds %q, want nothing — a rejected record is not half-written", out.String())
	}
}

// Every committed Event is one line, and every line is an Event. That is the
// whole of what a script reading stdout is promised.
func TestEachCommittedEventIsOneLineOfJSON(t *testing.T) {
	var out bytes.Buffer
	stream := eventStream{out: &out}

	for i, payload := range []events.Payload{
		events.Started{Intent: "what is this project"},
		events.Text{Chunk: "Eva is a software factory."},
		events.Finished{Claim: events.Claim{Result: events.ResultDone, Summary: "answered"}},
	} {
		e := one()
		e.Seq, e.Payload = uint64(i+1), payload
		e.Kind, _ = events.KindOf(payload)
		if err := stream.Committed(context.Background(), e); err != nil {
			t.Fatalf("commit event %d: %v", i+1, err)
		}
	}

	lines := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(lines) != 3 {
		t.Fatalf("the stream holds %d lines, want one per Event:\n%s", len(lines), out.String())
	}
	want := []events.Kind{events.KindStarted, events.KindText, events.KindFinished}
	for i, line := range lines {
		var e events.Event
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			t.Fatalf("line %d is not an Event: %v\n%s", i+1, err, line)
		}
		if e.Kind != want[i] {
			t.Errorf("line %d is a %q, want %q — the stream reordered the Trace", i+1, e.Kind, want[i])
		}
	}
}
