package anthropic

import (
	"context"
	"fmt"

	sdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/packages/ssestream"
	"github.com/missingstudio/eva/internal/events"
	"github.com/missingstudio/eva/internal/providers"
)

type wire struct {
	provider *Provider
	params   sdk.MessageNewParams

	sse *ssestream.Stream[sdk.MessageStreamEventUnion]
}

var _ providers.Wire = (*wire)(nil)

func (w *wire) Dial(ctx context.Context) *providers.Refusal {
	sse := w.provider.client.Messages.NewStreaming(ctx, w.params)
	err := sse.Err()
	if err == nil {
		w.sse = sse
		return nil
	}
	_ = sse.Close()

	class, recoverable := classify(err)
	return &providers.Refusal{
		Err:   fmt.Errorf("anthropic: %s: %w", class, err),
		Class: class,
		Again: recoverable,
		After: retryAfter(err),
	}
}

func (w *wire) Close() error {
	if w.sse == nil {
		return nil
	}
	sse := w.sse
	w.sse = nil
	return sse.Close()
}

func (w *wire) Pump(d *providers.Driver) {
	if !w.sse.Next() {
		// The books are closed whichever way the stream ended. A turn that
		// broke after message_start still spent the input tokens the API
		// charged for, and a cost nobody recorded is a cost nobody can bill.
		if err := w.sse.Err(); err != nil {
			class, _ := classify(err)
			d.Break(class, fmt.Errorf("anthropic: %s: %w", class, err))
			return
		}
		d.Complete()
		return
	}

	frame := w.sse.Current()
	switch frame.Type {
	case "message_start":
		opened(d.Spend(), frame.Message.Usage)
	case "message_delta":
		closed(d.Spend(), frame.Usage)
		if frame.Delta.StopReason == sdk.StopReasonMaxTokens {
			// Said where it is learned. Nothing else in the stream says it:
			// the frames of a truncated turn are the frames of a whole one,
			// so an answer that stopped mid-sentence would otherwise reach
			// the Trace looking finished.
			d.Say(events.Degraded{
				Missing: []string{"the end of the answer, cut off at the model's token cap"},
			})
		}
	case "content_block_delta":
		if frame.Delta.Type == "text_delta" && frame.Delta.Text != "" {
			d.Say(events.Text{Block: int(frame.Index), Chunk: frame.Delta.Text})
		}
	}
}

func opened(s *providers.Spend, u sdk.Usage) {
	s.Input(u.InputTokens, u.JSON.InputTokens.Valid())
	s.Output(u.OutputTokens, u.JSON.OutputTokens.Valid())
	s.CacheWrite(u.CacheCreationInputTokens, u.JSON.CacheCreationInputTokens.Valid())
	s.CacheRead(u.CacheReadInputTokens, u.JSON.CacheReadInputTokens.Valid())
}

func closed(s *providers.Spend, u sdk.MessageDeltaUsage) {
	s.Input(u.InputTokens, u.JSON.InputTokens.Valid())
	s.Output(u.OutputTokens, u.JSON.OutputTokens.Valid())
	s.CacheWrite(u.CacheCreationInputTokens, u.JSON.CacheCreationInputTokens.Valid())
	s.CacheRead(u.CacheReadInputTokens, u.JSON.CacheReadInputTokens.Valid())
}
