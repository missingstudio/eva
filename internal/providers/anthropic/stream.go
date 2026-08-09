package anthropic

import (
	"context"
	"fmt"
	"io"
	"time"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/packages/ssestream"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
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
// Only two things become payloads here: the text of an answer, and what the
// turn cost. A frame that opens or closes a content block is real and says
// nothing a Trace needs, and a thinking delta is billed inside the output
// tokens the Usage already carries.
func (s *stream) pump() {
	if !s.sse.Next() {
		// The books are closed whichever way the stream ended. A turn that
		// broke after message_start still spent the input tokens the API
		// charged for, and a cost nobody recorded is a cost nobody can bill.
		err := s.sse.Err()
		s.end(err == nil)

		if err != nil {
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
		if frame.Delta.StopReason == sdk.StopReasonMaxTokens {
			// Said where it is learned. Nothing else in the stream says it:
			// the frames of a truncated turn are the frames of a whole one,
			// so an answer that stopped mid-sentence would otherwise reach
			// the Trace looking finished.
			s.queue = append(s.queue, events.Degraded{
				Missing: []string{"the end of the answer, cut off at the model's token cap"},
			})
		}
	case "content_block_delta":
		if frame.Delta.Type == "text_delta" && frame.Delta.Text != "" {
			s.queue = append(s.queue, events.Text{Block: int(frame.Index), Chunk: frame.Delta.Text})
		}
	}
}

// end closes the turn's books: what it cost, or that nobody said.
//
// pump calls it exactly once, on the frame that ends the stream, and whole says
// the stream reached its own end rather than breaking. Everything the API did
// report is emitted either way, because a turn that broke after message_start
// was charged for the input tokens regardless.
//
// A Provider says each thing where it learns it and says it once. What a Run's
// single caveat ends up reading is composed at the close, by the one thing that
// sees every degradation rather than only this Provider's.
func (s *stream) end(whole bool) {
	if s.spent.reported() {
		s.queue = append(s.queue, s.spent.usage())
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
	s.queue = append(s.queue, events.Degraded{
		Missing: []string{"what this turn cost: the provider reported no usage"},
	})
}

// spend accumulates what the API says a turn cost.
//
// The figures arrive across two frames and each one is cumulative rather than
// incremental, so a field is overwritten by the latest frame that carried it
// and left alone by a frame that did not. Adding them instead would double the
// input tokens of every turn.
type spend struct {
	input, output, cacheWrite, cacheRead *uint64
}

// reported says whether the API stated any figure at all. A turn it said
// nothing about emits no Usage record, because a record of four absences says
// the same thing at more cost to whoever reads it.
func (s *spend) reported() bool {
	return s.input != nil || s.output != nil || s.cacheWrite != nil || s.cacheRead != nil
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

// take records one figure.
//
// A frame that carried no figure leaves the counter absent, which is what keeps
// a turn the API said nothing about from reporting zeros. The API types these
// signed and a negative count is not a thing that exists, so one is read as
// none rather than as an enormous unsigned number.
func (s *spend) take(reported bool, n int64, into **uint64) {
	if !reported {
		return
	}
	if n < 0 {
		n = 0
	}
	*into = events.Tokens(uint64(n))
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
