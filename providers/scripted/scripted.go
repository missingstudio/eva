// Package scripted replays a recorded model turn from a file.
//
// It exists so that no test and no demo needs network access or an API key.
// What it replays is a recording, not a simulation: the file names the chunks
// and the usage figures, and the Provider hands them back in order. A test
// that fails therefore fails because Eva changed, not because a model did.
package scripted

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"

	"github.com/BurntSushi/toml"
	"github.com/missingstudio/eva/events"
	"github.com/missingstudio/eva/providers"
)

// Name is what configuration selects this Provider by.
const Name = "scripted"

// Script is a recorded provider session: one entry per turn, replayed in
// order.
type Script struct {
	Turns []Turn `toml:"turn"`
}

// Turn is one recorded answer.
type Turn struct {
	// Block is the content block the chunks belong to, and what the sink folds
	// on when it commits (docs/adr/0004). Chunks of one block become one Trace
	// record; a recording that splits an answer across two blocks records two.
	Block int `toml:"block"`
	// Chunks is the answer, split the way a stream would deliver it.
	Chunks []string `toml:"chunks"`
	// Usage is what the provider reported for this turn. A figure left out of
	// the file is left out of the Event: nil means the provider did not report
	// it, and 0 means none were used (docs/adr/0003).
	Usage Usage `toml:"usage"`
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
		return nil, fmt.Errorf("scripted: script %s: %w", path, err)
	}

	var script Script
	md, err := toml.DecodeFile(path, &script)
	if err != nil {
		return nil, fmt.Errorf("scripted: read %s: %w", path, err)
	}
	if undecoded := md.Undecoded(); len(undecoded) > 0 {
		keys := make([]string, 0, len(undecoded))
		for _, k := range undecoded {
			keys = append(keys, k.String())
		}
		return nil, fmt.Errorf("scripted: %s: unknown key %q (the file has %d key(s) the scripted Provider does not know: %s)",
			path, keys[0], len(keys), strings.Join(keys, ", "))
	}
	if len(script.Turns) == 0 {
		return nil, fmt.Errorf("scripted: %s records no turns", path)
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
		return nil, fmt.Errorf("scripted: the script records %d turn(s) and this is turn %d", len(p.script.Turns), p.turn+1)
	}
	turn := p.script.Turns[p.turn]
	p.turn++

	payloads := make([]events.Payload, 0, len(turn.Chunks)+1)
	for _, chunk := range turn.Chunks {
		payloads = append(payloads, events.Text{Block: turn.Block, Chunk: chunk})
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
