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

	"github.com/BurntSushi/toml"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
)

// Name is what configuration selects this Provider by.
const Name = "fake"

// Script is a recorded provider session: one entry per turn, replayed in
// order.
type Script struct {
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

// Usage mirrors the normalized Usage payload, with the same nullability.
type Usage struct {
	InputTokens      uint64   `toml:"input_tokens"`
	OutputTokens     uint64   `toml:"output_tokens"`
	CacheWriteTokens uint64   `toml:"cache_write_tokens"`
	CacheReadTokens  uint64   `toml:"cache_read_tokens"`
	ReasoningTokens  *uint64  `toml:"reasoning_tokens"`
	ServerToolTokens *uint64  `toml:"server_tool_tokens"`
	USD              *float64 `toml:"usd"`
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
	for block, content := range turn.Blocks {
		for _, chunk := range content.Chunks {
			payloads = append(payloads, events.Text{Block: block, Chunk: chunk})
		}
	}
	payloads = append(payloads, events.Usage{
		InputTokens:      turn.Usage.InputTokens,
		OutputTokens:     turn.Usage.OutputTokens,
		CacheWriteTokens: turn.Usage.CacheWriteTokens,
		CacheReadTokens:  turn.Usage.CacheReadTokens,
		ReasoningTokens:  turn.Usage.ReasoningTokens,
		ServerToolTokens: turn.Usage.ServerToolTokens,
		USD:              turn.Usage.USD,
	})

	return &stream{payloads: payloads}, nil
}

type stream struct {
	payloads []events.Payload
	at       int
}

// Next returns the next recorded payload, or io.EOF at the end of the turn.
func (s *stream) Next(ctx context.Context) (events.Payload, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s.at >= len(s.payloads) {
		return nil, io.EOF
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
