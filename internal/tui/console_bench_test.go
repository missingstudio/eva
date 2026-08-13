package tui

import (
	"context"
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/missingstudio/eva/internal/events"
)

// What a frame of this interface costs, measured rather than asserted.

// benchWidth and benchHeight are an ordinary terminal. A benchmark at a size
// nobody uses measures a case nobody has.
const (
	benchWidth  = 120
	benchHeight = 40
)

// benchBlocks are the transcript lengths measured: a short conversation, and a
// long one. Nothing here is an extreme — a hundred blocks is an afternoon.
var benchBlocks = []int{20, 100}

var benchAnswers = []int{1, 8, 32}

func benchConsole(tb testing.TB, blocks int) *Console {
	tb.Helper()

	backend := &fixed{model: "a-model"}
	_, c, err := NewConsole(context.Background(), backend, backend, strings.NewReader(""), &strings.Builder{})
	if err != nil {
		tb.Fatal(err)
	}
	c.layout(benchWidth, benchHeight)

	for i := range blocks {
		voice := evaVoice
		if i%3 == 0 {
			voice = personVoice
		}
		c.keep(block{text: benchTurn(i), voice: voice})
	}
	return c
}

// benchTurn is one turn's worth of drawn markdown: a heading, a paragraph that
// wraps, a list, and a fenced block. A benchmark over one long line would miss
// what the gutter costs, which is per line.
func benchTurn(n int) string {
	return fmt.Sprintf("## Turn %d\n\n%s\n\n- one\n- two\n\n```go\nfunc main() {}\n```\n",
		n, strings.Repeat("The quick brown fox jumps over the lazy dog. ", 12))
}

func benchAnswer(kib int) string {
	const line = "Words in an answer that is still arriving. "
	return strings.Repeat(line, kib*1024/len(line))
}

func BenchmarkFrame(b *testing.B) {
	for _, blocks := range benchBlocks {
		for _, kib := range benchAnswers {
			answer := benchAnswer(kib)
			b.Run(fmt.Sprintf("blocks=%d/arriving=%dKB", blocks, kib), func(b *testing.B) {
				c := benchConsole(b, blocks)
				c.live.write(answer)
				b.ReportAllocs()
				for b.Loop() {
					// What makes the fold due: no drawing to fall back on, and
					// nothing owed for the last one.
					c.live.stale()
					c.refresh()
				}
			})
		}
	}
}

func BenchmarkStreamingSecond(b *testing.B) {
	const frames = 12

	for _, blocks := range benchBlocks {
		for _, kib := range benchAnswers {
			chunks := benchChunks(benchAnswer(kib), frames)
			b.Run(fmt.Sprintf("blocks=%d/answer=%dKB", blocks, kib), func(b *testing.B) {
				c := benchConsole(b, blocks)
				b.ReportAllocs()
				for b.Loop() {
					c.live.forget()
					for _, chunk := range chunks {
						// What the chunk case and the spinner's tick do
						// between them, and in that order.
						c.live.write(chunk)
						c.live.due()
						c.refresh()
					}
				}
			})
		}
	}
}

func benchChunks(answer string, n int) []string {
	out := make([]string, 0, n)
	size := len(answer) / n
	for i := range n {
		at := i * size
		if i == n-1 {
			out = append(out, answer[at:])
			break
		}
		out = append(out, answer[at:at+size])
	}
	return out
}

// BenchmarkIdleFrame is a frame with nothing arriving: the transcript, drawn
// again for a screen that did not change.
func BenchmarkIdleFrame(b *testing.B) {
	for _, blocks := range benchBlocks {
		b.Run(fmt.Sprintf("blocks=%d", blocks), func(b *testing.B) {
			c := benchConsole(b, blocks)
			b.ReportAllocs()
			for b.Loop() {
				c.refresh()
			}
		})
	}
}

// BenchmarkLive is the arriving answer folded once, which is the part of a
// frame that grows with the answer rather than with the transcript.
func BenchmarkLive(b *testing.B) {
	for _, kib := range benchAnswers {
		answer := benchAnswer(kib)
		b.Run(fmt.Sprintf("arriving=%dKB", kib), func(b *testing.B) {
			c := benchConsole(b, 0)
			b.ReportAllocs()
			for b.Loop() {
				_ = c.folded(answer)
			}
		})
	}
}

func BenchmarkCompose(b *testing.B) {
	for _, blocks := range benchBlocks {
		b.Run(fmt.Sprintf("blocks=%d", blocks), func(b *testing.B) {
			c := benchConsole(b, blocks)
			b.ReportAllocs()
			for b.Loop() {
				_ = c.compose(c.transcript)
			}
		})
	}
}

func BenchmarkPane(b *testing.B) {
	for _, blocks := range benchBlocks {
		b.Run(fmt.Sprintf("blocks=%d", blocks), func(b *testing.B) {
			c := benchConsole(b, blocks)
			rows := c.composed(c.transcript)
			b.ReportAllocs()
			for b.Loop() {
				c.pane.SetContent(rows)
				_ = c.pane.View()
			}
		})
	}
}

func BenchmarkView(b *testing.B) {
	c := benchConsole(b, 100)
	b.ReportAllocs()
	for b.Loop() {
		c.drawnChrome = false
		_ = c.View()
	}
}

func BenchmarkKeypress(b *testing.B) {
	c := benchConsole(b, 100)
	key := tea.KeyPressMsg{Code: 'a', Text: "a"}
	b.ReportAllocs()
	for b.Loop() {
		_, _ = c.Update(key)
		_ = c.View()
	}
}

func BenchmarkResize(b *testing.B) {
	const dragged = 40

	for _, turns := range benchBlocks {
		b.Run(fmt.Sprintf("turns=%d", turns), func(b *testing.B) {
			c := benchConsole(b, 0)
			benchFold(b, c, turns)
			b.ReportAllocs()
			for b.Loop() {
				// Every width the edge crossed, then the one re-render the
				// settle asks for. The commands the intermediate widths return
				// are dropped, which is what the console does with them too:
				// only the newest is acted on.
				for width := benchWidth; width > benchWidth-dragged; width-- {
					_ = c.resize(width, benchHeight)
				}
				c.reflow()

				// Back to where it started, so that every iteration measures
				// the same drag. It is a second drag and it is not the one
				// being measured.
				b.StopTimer()
				_ = c.resize(benchWidth, benchHeight)
				c.reflow()
				b.StartTimer()
			}
		})
	}
}

// benchFold puts turns in the Renderer, which is what a resize redraws from.
func benchFold(tb testing.TB, c *Console, turns int) {
	tb.Helper()

	for i := range turns {
		for _, e := range []events.Event{
			{Kind: events.KindStarted, Payload: events.Started{}},
			{Kind: events.KindText, Payload: events.Text{Chunk: benchTurn(i)}},
			{Kind: events.KindFinished, Payload: events.Finished{}},
		} {
			if err := c.renderer.Committed(context.Background(), e); err != nil {
				tb.Fatal(err)
			}
		}
	}
}

// A frame that folds nothing allocates within a bound.
func TestAFrameThatFoldsNothingStaysCheap(t *testing.T) {
	const allowed = 150

	c := benchConsole(t, 100)

	// Twice before measuring: the first frame after a block is kept fills
	// whatever the frame caches, and it is the second one that says what a
	// steady screen costs.
	c.refresh()
	c.refresh()

	allocs := testing.AllocsPerRun(20, c.refresh)
	if allocs > allowed {
		t.Errorf("a frame that folds nothing allocated %.0f times, and %d is the bound — "+
			"a screen that did not change is being rebuilt from its source", allocs, allowed)
	}
}

func TestAKeystrokeDrawsTheChromeOnce(t *testing.T) {
	const allowed = 1_500

	c := benchConsole(t, 100)
	key := tea.KeyPressMsg{Code: 'a', Text: "a"}

	cycle := func() {
		_, _ = c.Update(key)
		_ = c.View()
	}
	cycle()

	allocs := testing.AllocsPerRun(20, cycle)
	if allocs > allowed {
		t.Errorf("one keystroke and its frame allocated %.0f times, and %d is the bound — "+
			"the chrome is being drawn more than once for one picture", allocs, allowed)
	}
}
