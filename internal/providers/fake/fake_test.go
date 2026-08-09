package fake_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
	"github.com/missingstudio/eva/internal/providers/fake"
)

// write puts a recording somewhere the test owns and returns its path.
func write(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "script.toml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write the recording: %v", err)
	}
	return path
}

// replay drains one turn into the payloads it produced.
func replay(t *testing.T, p providers.Provider) []events.Payload {
	t.Helper()
	ctx := context.Background()

	stream, err := p.Stream(ctx, providers.Call{Model: "test-model"})
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	defer func() { _ = stream.Close() }()

	var out []events.Payload
	for {
		payload, err := stream.Next(ctx)
		if errors.Is(err, io.EOF) {
			return out
		}
		if err != nil {
			t.Fatalf("next: %v", err)
		}
		out = append(out, payload)
	}
}

// A recorded turn holds its content blocks, in the order the file lists them.
// A real turn is several blocks — text, then a tool call, then more text — and
// a recording that could hold only one had to end before the second began.
//
// The block index is the position in the file rather than a number the author
// writes. Two ways to say which block a chunk belongs to is one way for a
// recording to contradict itself.
func TestARecordedTurnStreamsItsBlocksInFileOrder(t *testing.T) {
	provider, err := fake.Load(write(t, `
[[turn]]

  [[turn.block]]
  chunks = ["Eva is ", "a software factory."]

  [[turn.block]]
  chunks = ["It builds, ", "tests, ", "and maintains software."]

  [turn.usage]
  input_tokens = 12
  output_tokens = 34
`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	got := replay(t, provider)

	type chunk struct {
		block int
		text  string
	}
	want := []chunk{
		{0, "Eva is "}, {0, "a software factory."},
		{1, "It builds, "}, {1, "tests, "}, {1, "and maintains software."},
	}
	if len(got) != len(want)+1 {
		t.Fatalf("the turn produced %d payloads, want %d chunks and one Usage", len(got), len(want))
	}
	for i, w := range want {
		text, ok := got[i].(events.Text)
		if !ok {
			t.Fatalf("payload %d = %#v, want Text", i, got[i])
		}
		if text.Block != w.block || text.Chunk != w.text {
			t.Errorf("payload %d = block %d %q, want block %d %q", i, text.Block, text.Chunk, w.block, w.text)
		}
	}

	usage, ok := got[len(got)-1].(events.Usage)
	if !ok {
		t.Fatalf("the last payload is %#v, want Usage", got[len(got)-1])
	}
	if usage.InputTokens == nil || *usage.InputTokens != 12 ||
		usage.OutputTokens == nil || *usage.OutputTokens != 34 {
		t.Errorf("usage = %+v, want the recorded figures", usage)
	}
	// A figure the file leaves out is absent, not zero.
	if usage.ReasoningTokens != nil || usage.USD != nil {
		t.Errorf("usage = %+v, want the unrecorded figures absent", usage)
	}
}

// The script records turns, and the Provider replays them one per call. A
// recording that has run out says so, rather than repeating its last turn.
func TestTheScriptIsReplayedOneTurnPerCall(t *testing.T) {
	provider, err := fake.Load(write(t, `
[[turn]]
  [[turn.block]]
  chunks = ["first"]

[[turn]]
  [[turn.block]]
  chunks = ["second"]
`))
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	for _, want := range []string{"first", "second"} {
		got := replay(t, provider)
		text, ok := got[0].(events.Text)
		if !ok {
			t.Fatalf("payload 0 = %#v, want Text", got[0])
		}
		if text.Chunk != want {
			t.Errorf("chunk = %q, want %q", text.Chunk, want)
		}
	}

	if _, err := provider.Stream(context.Background(), providers.Call{}); err == nil {
		t.Fatal("a third turn was replayed, want an error saying the recording ran out")
	}
}

// Decoding is strict for the same reason configuration is: a key the author
// expected to mean something, that in fact means nothing, makes a test pass for
// a reason nobody chose.
func TestARecordingIsRejectedRatherThanPartlyUnderstood(t *testing.T) {
	for _, c := range []struct {
		name string
		body string
		want string
	}{
		{
			name: "a key the recording does not have",
			body: "[[turn]]\n  [[turn.block]]\n  chunk = [\"one\"]\n",
			want: "chunk",
		},
		{
			name: "the block field the format no longer has",
			body: "[[turn]]\nblock = 0\nchunks = [\"one\"]\n",
			want: "block",
		},
		{
			name: "a recording with no turns",
			body: "# nothing here\n",
			want: "records no turns",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := fake.Load(write(t, c.body))
			if err == nil {
				t.Fatal("the recording loaded, want an error")
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("error = %v, want it to name %q", err, c.want)
			}
		})
	}
}

func TestAMissingRecordingNamesTheFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "there-is-no-such-file.toml")

	_, err := fake.Load(path)
	if err == nil {
		t.Fatal("a missing recording loaded, want an error")
	}
	if !strings.Contains(err.Error(), path) {
		t.Errorf("error = %v, want it to name %s", err, path)
	}
}

// A cancelled turn stops where it is. Nothing here holds a resource, so what
// is being checked is that cancellation is reported rather than ignored.
func TestACancelledContextStopsTheReplay(t *testing.T) {
	provider, err := fake.Load(write(t, "[[turn]]\n  [[turn.block]]\n  chunks = [\"one\", \"two\"]\n"))
	if err != nil {
		t.Fatalf("load: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	stream, err := provider.Stream(ctx, providers.Call{})
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	defer func() { _ = stream.Close() }()

	cancel()
	if _, err := stream.Next(ctx); !errors.Is(err, context.Canceled) {
		t.Errorf("next after cancel = %v, want context.Canceled", err)
	}
	if _, err := provider.Stream(ctx, providers.Call{}); !errors.Is(err, context.Canceled) {
		t.Errorf("stream after cancel = %v, want context.Canceled", err)
	}
}

func TestTheProviderNamesWhatConfigurationSelectsItBy(t *testing.T) {
	provider, err := fake.Load(write(t, "[[turn]]\n  [[turn.block]]\n  chunks = [\"one\"]\n"))
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	// The literal, not the constant. Configuration is a file a person writes,
	// so the name is a published string: comparing the constant to itself would
	// hold however it were renamed, and every existing config would break.
	if provider.Name() != "fake" {
		t.Errorf("Name() = %q, want %q", provider.Name(), "fake")
	}
}

// A paced recording waits before each chunk, so that a person with no API key
// sees an answer stream and a spinner turn beside it.
func TestAPacedRecordingWaitsBeforeEachChunk(t *testing.T) {
	const delay = 20 * time.Millisecond

	p, err := fake.Load(write(t, fmt.Sprintf(`
chunk_delay_ms = %d
[[turn]]
  [[turn.block]]
  chunks = ["one ", "two ", "three"]
`, delay.Milliseconds())))
	if err != nil {
		t.Fatalf("load the recording: %v", err)
	}

	start := time.Now()
	replay(t, p)

	// Three chunks are three waits. The usage record is not paced, so the
	// bound is three rather than four.
	if took := time.Since(start); took < 3*delay {
		t.Errorf("the turn replayed in %s, want at least %s — the chunks were not paced", took, 3*delay)
	}
}

// An unpaced recording is the default, because a test that paced itself would
// spend its own runtime doing nothing.
func TestARecordingIsUnpacedUnlessItSaysOtherwise(t *testing.T) {
	p, err := fake.Load(write(t, `
[[turn]]
  [[turn.block]]
  chunks = ["one ", "two ", "three"]
`))
	if err != nil {
		t.Fatalf("load the recording: %v", err)
	}

	start := time.Now()
	replay(t, p)
	if took := time.Since(start); took > time.Second {
		t.Errorf("an unpaced turn took %s", took)
	}
}

// The wait is cancellable. A person who interrupts a paced replay is
// interrupting a turn, and should not have to wait out its pacing first.
func TestAPacedReplayStopsWhenTheRunIsCancelled(t *testing.T) {
	p, err := fake.Load(write(t, `
chunk_delay_ms = 10000
[[turn]]
  [[turn.block]]
  chunks = ["never arrives"]
`))
	if err != nil {
		t.Fatalf("load the recording: %v", err)
	}

	stream, err := p.Stream(context.Background(), providers.Call{})
	if err != nil {
		t.Fatalf("open the turn: %v", err)
	}
	defer func() { _ = stream.Close() }()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	if _, err := stream.Next(ctx); !errors.Is(err, context.Canceled) {
		t.Errorf("the paced read answered %v, want the cancellation", err)
	}
	if took := time.Since(start); took > time.Second {
		t.Errorf("the paced read waited %s before noticing the cancellation", took)
	}
}

// A pace that is not a length of time is a mistake, and is refused rather than
// read as no delay at all.
func TestANegativePaceIsRefused(t *testing.T) {
	if _, err := fake.Load(write(t, "chunk_delay_ms = -1\n[[turn]]\n  [[turn.block]]\n  chunks = [\"x\"]\n")); err == nil {
		t.Fatal("a negative chunk_delay_ms was accepted")
	}
}
