package tui

import (
	"fmt"
	"strings"
	"testing"
)

// The live area is a window on a stream, and it shows the end of it. An answer
// longer than the window would otherwise push the view past the screen while
// it arrives — and the whole of it goes above the view when the Run closes,
// rendered, which is what a person actually reads it as.
func TestTheLiveAreaShowsTheEndOfWhatHasArrived(t *testing.T) {
	lines := func(n int) string {
		out := make([]string, n)
		for i := range out {
			out[i] = fmt.Sprintf("line %d", i)
		}
		return strings.Join(out, "\n")
	}

	for _, c := range []struct {
		name    string
		height  int
		arrived string
		want    string
	}{
		{
			name:    "an answer that fits is shown whole",
			height:  24,
			arrived: lines(3),
			want:    lines(3),
		},
		{
			name:    "a window that has said how tall it is keeps room for the rest of the view",
			height:  6,
			arrived: lines(20),
			want:    "line 16\nline 17\nline 18\nline 19",
		},
		{
			name:    "a window that has not said keeps to a length a screen will hold",
			height:  0,
			arrived: lines(20),
			want:    "line 10\nline 11\nline 12\nline 13\nline 14\nline 15\nline 16\nline 17\nline 18\nline 19",
		},
		{
			name:    "a window with no room at all still shows the last line",
			height:  1,
			arrived: lines(20),
			want:    "line 19",
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			got := (&Console{height: c.height}).tail(c.arrived)
			if got != c.want {
				t.Errorf("tail = %q, want %q", got, c.want)
			}
		})
	}
}
