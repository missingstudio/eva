// Package fake replays a recorded model turn from a file.
//
// It exists so that no test and no demo needs network access or an API key.
// What it replays is a recording, not a simulation: the file names the chunks
// and the usage figures, and the Provider hands them back in order. A test
// that fails therefore fails because Eva changed, not because a model did.
package fake

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
)

// Name is what configuration selects this Provider by.
const Name = "fake"

// Script is a recorded provider session: one entry per turn, replayed in
// order.
type Script struct {
	// ChunkDelayMS is how long the replay waits before each chunk of an answer.
	//
	// It is zero by default, and zero is what every test wants: a recording
	// that paced itself would spend its own runtime doing nothing. It is for
	// the other reader of this file — a person watching Eva answer with no API
	// key, for whom a turn that arrives all at once shows neither the answer
	// streaming nor the spinner turning beside it.
	//
	// It paces chunks and not the turn, because a chunk is what a person sees
	// arrive.
	ChunkDelayMS int `toml:"chunk_delay_ms"`

	Turns []Turn `toml:"turn"`
}

// Turn is one recorded answer.
type Turn struct {
	// Blocks are the content blocks of the answer, replayed in the order the
	// file lists them. A real turn is several — text, then a tool call, then
	// more text — and a turn is where they belong, because a provider call
	// returns a turn rather than a block.
	Blocks []Block `toml:"block"`
	// Usage is what the provider reported for this turn. A figure left out of
	// the file is left out of the Event: nil means the provider did not report
	// it, and 0 means none were used.
	Usage Usage `toml:"usage"`
}

// Block is one content block: the unit the sink folds on when it commits.
// Chunks of one block become one Trace record, so a recording that splits an
// answer across two blocks records two.
//
// The block index is the position in the file rather than a number the author
// writes. Two ways to say which block a chunk belongs to is one way for a
// recording to contradict itself.
type Block struct {
	// Chunks is the block, split the way a stream would deliver it.
	Chunks []string `toml:"chunks"`
}

// Usage is the recorded cost of a turn, in the file's own encoding.
//
// It exists because a recording is TOML and the schema's payload is JSON, and
// it mirrors that payload field for field so that the conversion in Stream is
// what checks it: Go compares struct types by their fields and ignores the
// tags, so a counter added to the schema and not to this one stops the build
// here. A hand-written copy is what let the previous version of this type drop
// a field silently, and the one Provider the tests depend on is the worst place
// for a schema to be quietly out of date.
type Usage struct {
	InputTokens      *uint64  `toml:"input_tokens"`
	OutputTokens     *uint64  `toml:"output_tokens"`
	CacheWriteTokens *uint64  `toml:"cache_write_tokens"`
	CacheReadTokens  *uint64  `toml:"cache_read_tokens"`
	ReasoningTokens  *uint64  `toml:"reasoning_tokens"`
	ServerToolTokens *uint64  `toml:"server_tool_tokens"`
	USD              *float64 `toml:"usd"`
}

// reported says whether the recording stated any figure at all. A turn it said
// nothing about emits no Usage record, because a record of seven absences says
// the same thing at more cost to whoever reads it.
func (u Usage) reported() bool {
	return u != Usage{}
}

// This Provider puts itself in the set configuration can select.
//
// It reads a file and sends nothing, so it asks for no credential. A recording
// that refused to open for want of an API key it never uses would make every
// test that replays one carry a secret.
func init() {
	providers.Register(Name, func(o providers.Options) (providers.Provider, error) {
		if o.Recording == "" {
			return nil, fmt.Errorf("provider %q needs a recording: set provider.script", Name)
		}
		return Load(o.Recording)
	})
}

// Provider replays a Script.
type Provider struct {
	mu     sync.Mutex
	script Script
	turn   int
}

var _ providers.Provider = (*Provider)(nil)

// Load reads a Script from a TOML file.
//
// Decoding is strict, for the same reason configuration is: a key the file
// author expected to mean something, that in fact means nothing, would make a
// test pass for a reason nobody chose.
func Load(path string) (*Provider, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("fake: script %s: %w", path, err)
	}

	var script Script
	md, err := toml.DecodeFile(path, &script)
	if err != nil {
		return nil, fmt.Errorf("fake: read %s: %w", path, err)
	}
	if undecoded := md.Undecoded(); len(undecoded) > 0 {
		keys := make([]string, 0, len(undecoded))
		for _, k := range undecoded {
			keys = append(keys, k.String())
		}
		return nil, fmt.Errorf("fake: %s: unknown key %q (the file has %d key(s) the fake Provider does not know: %s)",
			path, keys[0], len(keys), strings.Join(keys, ", "))
	}
	if len(script.Turns) == 0 {
		return nil, fmt.Errorf("fake: %s records no turns", path)
	}
	// A negative pace is a mistake rather than an instruction, and a mistake
	// that read as "no delay" would be a file quietly doing something other
	// than what it says.
	if script.ChunkDelayMS < 0 {
		return nil, fmt.Errorf("fake: %s sets chunk_delay_ms to %d, which is not a length of time", path, script.ChunkDelayMS)
	}
	return &Provider{script: script}, nil
}

// Name reports the name configuration selects this Provider by.
func (p *Provider) Name() string { return Name }

// Stream replays the next recorded turn.
func (p *Provider) Stream(ctx context.Context, _ providers.Call) (providers.Stream, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.turn >= len(p.script.Turns) {
		return nil, fmt.Errorf("fake: the script records %d turn(s) and this is turn %d", len(p.script.Turns), p.turn+1)
	}
	turn := p.script.Turns[p.turn]
	p.turn++

	var payloads []events.Payload
	var paced []bool
	for block, content := range turn.Blocks {
		for _, chunk := range content.Chunks {
			payloads = append(payloads, events.Text{Block: block, Chunk: chunk})
			paced = append(paced, true)
		}
	}
	// Silence is not the same as free. A Usage of all nils would say nothing at
	// the cost of seven absences, so a recording that reports no usage gets the
	// same caveat the network Providers emit: usage counters are nullable so
	// that silence is not zero, and the caveat is what stops the absence
	// reading as a turn nobody looked at.
	if turn.Usage.reported() {
		payloads = append(payloads, events.Usage(turn.Usage))
	} else {
		payloads = append(payloads, events.Degraded{
			Missing: []string{"what this turn cost: the provider reported no usage"},
		})
	}
	// The closing record is not paced. It is an accounting record rather than
	// something a person watches arrive, and a wait before it would only delay
	// the cost line after the answer is already whole.
	paced = append(paced, false)

	return &stream{payloads: payloads, paced: paced, delay: time.Duration(p.script.ChunkDelayMS) * time.Millisecond}, nil
}

type stream struct {
	payloads []events.Payload
	// paced says, for each payload, whether the replay waits before yielding
	// it. It is a parallel slice rather than a field on the payload because the
	// payloads are the one Event schema, and pacing is this Provider's own
	// business rather than something the schema should carry.
	paced []bool
	delay time.Duration
	at    int
}

// Next returns the next recorded payload, or io.EOF at the end of the turn.
func (s *stream) Next(ctx context.Context) (events.Payload, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.at >= len(s.payloads) {
		return nil, io.EOF
	}

	// Cancellable, because a person who interrupts a paced replay is
	// interrupting a turn and should not have to wait out its pacing first.
	if s.delay > 0 && s.paced[s.at] {
		timer := time.NewTimer(s.delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	p := s.payloads[s.at]
	s.at++
	return p, nil
}

// Close ends the turn. A replay holds nothing that needs releasing, so this
// exists to satisfy the contract every other Provider does need.
func (s *stream) Close() error {
	s.at = len(s.payloads)
	return nil
}
