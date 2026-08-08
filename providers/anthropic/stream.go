package anthropic

import (
	"context"
	"fmt"
	"io"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/packages/ssestream"
	"github.com/missingstudio/eva/events"
	"github.com/missingstudio/eva/providers"
)

// stream is one turn in progress.
//
// It is a queue and a state machine rather than a loop, because the caller
// pulls one payload at a time and the interesting things happen between pulls.
// A retry is yielded before the wait it caused, so the Trace holds the attempt
// at the moment it failed rather than however many seconds later the answer
// arrived.
type stream struct {
	provider *Provider
	params   sdk.MessageNewParams

	// sse is the connection, once there is one.
	sse *ssestream.Stream[sdk.MessageStreamEventUnion]
	// attempts is how many requests have been made, and owed is the wait the
	// last refusal asked for and the next attempt must take first.
	attempts int
	owed     time.Duration

	// queue is what has been produced and not yet handed over.
	queue []events.Payload
	// spent is what the API has said this turn cost so far.
	spent spend

	// fatal is the failure to report once the queue is drained, and done says
	// the turn ended cleanly. Both wait for the queue, because a payload
	// already produced is part of the turn whichever way it ended.
	fatal error
	done  bool
}

var _ providers.Stream = (*stream)(nil)

// Next returns the next payload of the turn, or io.EOF when it is complete.
func (s *stream) Next(ctx context.Context) (events.Payload, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if len(s.queue) > 0 {
			payload := s.queue[0]
			s.queue = s.queue[1:]
			return payload, nil
		}
		switch {
		case s.fatal != nil:
			return nil, s.fatal
		case s.done:
			return nil, io.EOF
		case s.sse == nil:
			s.dial(ctx)
		default:
			s.pump()
		}
	}
}

// Close releases the turn, whether or not it ran to completion.
func (s *stream) Close() error {
	s.queue, s.done = nil, true
	if s.sse == nil {
		return nil
	}
	sse := s.sse
	s.sse = nil
	return sse.Close()
}

// dial makes one attempt.
//
// A refusal that another attempt could survive queues a Retry and returns, so
// that the record of the attempt reaches the caller before the wait. The wait
// itself is taken at the top of the next call, which is what makes this one
// attempt per call rather than a loop nothing can observe from outside.
func (s *stream) dial(ctx context.Context) {
	if s.owed > 0 {
		wait := s.owed
		s.owed = 0
		if err := sleep(ctx, wait); err != nil {
			s.fatal = err
			return
		}
	}

	s.attempts++
	sse := s.provider.client.Messages.NewStreaming(ctx, s.params)
	err := sse.Err()
	if err == nil {
		s.sse = sse
		return
	}
	_ = sse.Close()

	if ctxErr := ctx.Err(); ctxErr != nil {
		s.fatal = ctxErr
		return
	}

	class, recoverable := classify(err)
	wait, again := s.provider.retry.wait(s.attempts, err)
	if !recoverable || !again {
		s.fatal = fmt.Errorf("anthropic: %s: %w", class, err)
		return
	}

	s.owed = wait
	s.queue = append(s.queue, events.Retry{
		Attempt:    s.attempts,
		Max:        s.provider.retry.Attempts,
		DelayMS:    int(wait.Milliseconds()),
		ErrorClass: class,
	})
}

// pump advances the connection by one frame.
//
// Only two things become payloads: the text of an answer, and what the turn
// cost. A frame that opens or closes a content block is real and says nothing
// a Trace needs, and a thinking delta is billed inside the output tokens the
// Usage already carries.
func (s *stream) pump() {
	if !s.sse.Next() {
		// The cost is emitted whichever way the stream ended. A turn that
		// broke after message_start still spent the input tokens the API
		// charged for, and a cost nobody recorded is a cost nobody can bill.
		s.flush()

		if err := s.sse.Err(); err != nil {
			class, _ := classify(err)
			s.fatal = fmt.Errorf("anthropic: %s: %w", class, err)
			return
		}
		s.done = true
		return
	}

	frame := s.sse.Current()
	switch frame.Type {
	case "message_start":
		s.spent.opened(frame.Message.Usage)
	case "message_delta":
		s.spent.closed(frame.Usage)
	case "content_block_delta":
		if frame.Delta.Type == "text_delta" && frame.Delta.Text != "" {
			s.queue = append(s.queue, events.Text{Block: int(frame.Index), Chunk: frame.Delta.Text})
		}
	}
}

// flush emits what the turn cost, once.
//
// A turn the API reported nothing for emits nothing. A Usage of all zeros
// would say "none were used", which is a different claim from "we were never
// told", and this is the field where the two must not be confused.
func (s *stream) flush() {
	if !s.spent.reported {
		return
	}
	s.spent.reported = false
	s.queue = append(s.queue, s.spent.usage())
}

// spend accumulates what the API says a turn cost.
//
// The figures arrive across two frames and each one is cumulative rather than
// incremental, so a field is overwritten by the latest frame that carried it
// and left alone by a frame that did not. Adding them instead would double the
// input tokens of every turn.
type spend struct {
	reported                             bool
	input, output, cacheWrite, cacheRead uint64
}

func (s *spend) opened(u sdk.Usage) {
	s.take(u.JSON.InputTokens.Valid(), u.InputTokens, &s.input)
	s.take(u.JSON.OutputTokens.Valid(), u.OutputTokens, &s.output)
	s.take(u.JSON.CacheCreationInputTokens.Valid(), u.CacheCreationInputTokens, &s.cacheWrite)
	s.take(u.JSON.CacheReadInputTokens.Valid(), u.CacheReadInputTokens, &s.cacheRead)
}

func (s *spend) closed(u sdk.MessageDeltaUsage) {
	s.take(u.JSON.InputTokens.Valid(), u.InputTokens, &s.input)
	s.take(u.JSON.OutputTokens.Valid(), u.OutputTokens, &s.output)
	s.take(u.JSON.CacheCreationInputTokens.Valid(), u.CacheCreationInputTokens, &s.cacheWrite)
	s.take(u.JSON.CacheReadInputTokens.Valid(), u.CacheReadInputTokens, &s.cacheRead)
}

// take records one figure, and remembers that the API reported something.
//
// A frame that carried no figure at all leaves reported false, which is what
// keeps a turn the API said nothing about from emitting a Usage of zeros. The
// API types these signed and a negative count is not a thing that exists, so
// one is read as none rather than as an enormous unsigned number.
func (s *spend) take(reported bool, n int64, into *uint64) {
	if !reported {
		return
	}
	s.reported = true
	if n < 0 {
		n = 0
	}
	*into = uint64(n)
}

// usage is the normalized payload.
//
// Three fields stay absent on every Anthropic turn, and each absence is a
// decision rather than an omission. Thinking tokens are billed inside the
// output tokens above, so a reasoning figure here would be counted twice by
// anything that summed the two. The API reports server tool *requests*, which
// are not tokens. And a dollar figure is never derived from a local price
// table or from wall clock, because billing meters from provider-reported
// usage reconciled against invoices, and a made-up number here would become a
// financial liability.
func (s *spend) usage() events.Usage {
	return events.Usage{
		InputTokens:      s.input,
		OutputTokens:     s.output,
		CacheWriteTokens: s.cacheWrite,
		CacheReadTokens:  s.cacheRead,
	}
}
