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
//
// The console draws in the update loop, which is also the goroutine that reads
// keys. So a frame is not only what a person waits for between pictures — it is
// what a keystroke waits behind, and a cost here is felt as an interface that
// types late. That is why these exist at all: "it feels slow" is a claim, and
// the project does not run on claims.
//
// Every benchmark below draws at one size and against a transcript of a stated
// length, because both are what the cost is proportional to. What the figures are
// read against is one of their own: a frame that folds nothing is what a person
// spends most of their time looking at, and the test at the foot of this file is
// the only one of these a machine gates.

// benchWidth and benchHeight are an ordinary terminal. A benchmark at a size
// nobody uses measures a case nobody has.
const (
	benchWidth  = 120
	benchHeight = 40
)

// benchBlocks are the transcript lengths measured: a short conversation, and a
// long one. Nothing here is an extreme — a hundred blocks is an afternoon.
var benchBlocks = []int{20, 100}

// benchAnswers are the sizes of an arriving answer, in KiB. A page, a long
// answer, and one with a listing in it.
var benchAnswers = []int{1, 8, 32}

// benchConsole is a console with a transcript of the stated length, fitted to a
// window.
//
// The blocks alternate voice, because the gutter is drawn per voice and a
// transcript of one voice would measure the cheaper half of it.
func benchConsole(tb testing.TB, blocks int) *Console {
	tb.Helper()

	_, c, err := NewConsole(context.Background(), &fixed{model: "a-model"}, strings.NewReader(""), &strings.Builder{})
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

// benchAnswer is plain prose of about the stated number of KiB.
func benchAnswer(kib int) string {
	const line = "Words in an answer that is still arriving. "
	return strings.Repeat(line, kib*1024/len(line))
}

// BenchmarkFrame is the most expensive frame of a streaming turn: the
// transcript, plus the whole answer so far folded again.
//
// The fold is forced on every iteration, because that is the frame being
// measured. A console decides for itself how often to pay this — see
// BenchmarkStreamingSecond — and what this says is what the payment costs when
// it comes due. It is also what a keystroke waits behind when it does.
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

// BenchmarkStreamingSecond is one second of an answer arriving: twelve frames,
// with a chunk of it landing before each.
//
// It is the figure the budget is written against, because it is the one a person
// experiences. A frame that folds is expensive and a frame that does not is
// nearly free, so what a second of streaming costs depends on how many of each
// there were — which is the console's own decision and therefore has to be
// measured rather than reasoned about.
//
// The answer size is the whole turn's, split across the twelve chunks. So the
// larger sizes are also the case where the fold is skipped most, which is the
// behaviour under test.
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

// benchChunks cuts an answer into the pieces a second of streaming delivers.
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
//
// It is the frame a person spends most of their time looking at, and it is the
// one that should cost nothing at all. Everything it spends is spent redoing
// work whose input has not moved.
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

// BenchmarkCompose is the transcript drawn as one piece of text: the console's
// own half of a frame, without the pane's.
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

// BenchmarkPane is what the pane charges for being handed content: the pane's
// half of a frame, without the console's.
//
// It is measured apart because the two halves have different answers. One is
// the console's to cache; the other happens after the content has crossed a
// boundary, and no arrangement of code on this side changes it.
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

// BenchmarkView is the whole window drawn for a new frame: the pane's visible
// rows, and the chrome under them.
//
// The chrome a message arrives to is retired first, which is what the update
// loop does before it asks for a picture. Left in place it would measure a view
// that had nothing to draw.
func BenchmarkView(b *testing.B) {
	c := benchConsole(b, 100)
	b.ReportAllocs()
	for b.Loop() {
		c.drawnChrome = false
		_ = c.View()
	}
}

// BenchmarkKeypress is one ordinary character typed, and the picture it causes.
//
// Both halves, because a keystroke is not finished until the frame it asked for
// is drawn — that is what the person waiting for their own character is waiting
// for. Nothing about it depends on the transcript, so a cost here that grows
// with the conversation is a cost that should not exist.
func BenchmarkKeypress(b *testing.B) {
	c := benchConsole(b, 100)
	key := tea.KeyPressMsg{Code: 'a', Text: "a"}
	b.ReportAllocs()
	for b.Loop() {
		_, _ = c.Update(key)
		_ = c.View()
	}
}

// BenchmarkResize is a window dragged across forty columns.
//
// A drag rather than one column, because one column is not a thing a person
// does: a mouse crossing a window's edge reports every width it passes through,
// and what a person waits for is all of them.
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
//
// The transcript alone is not enough: a block holds what it was drawn as, and
// re-wrapping reads the markdown the fold still holds. A console whose fold is
// empty measures a resize with nothing to redo.
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
//
// This is the one figure from the benchmarks above that is gated, and the
// reason is that it is the only one that does not measure the machine. A
// wall-clock threshold on a shared runner fails for reasons that have nothing
// to do with the code, and a check that fails for the wrong reason is a check
// people learn to rerun.
//
// What it protects is the property, not the number: a screen that did not
// change must not be rebuilt from its source. The bound is deliberately loose
// enough to survive an honest change and tight enough that putting the whole
// transcript back into the per-frame path fails it.
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

// A keystroke and the picture it causes draw the chrome once.
//
// Two things ask for the chrome — the fit, which needs its height, and the view,
// which needs the pieces — and for a while both drew it. Nothing on screen said
// so: the two drawings were identical, and the only evidence was a keystroke
// costing twice what it had to on the goroutine that reads keys.
//
// So the gate is the allocation count, which is what a second drawing shows up
// in. It is a bound rather than a figure, because the prompt, the status line,
// and the footer are allowed to change what they cost. What it catches is the
// count doubling.
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
