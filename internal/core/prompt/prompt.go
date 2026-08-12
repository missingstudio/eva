// Package prompt holds the base system prompt every turn is conditioned on,
// and the budget it is held to.
package prompt

import (
	// The prompt is prose, so it is written in a file and read as prose. embed
	// is compile-time: the bytes are in the binary, and nothing here reaches
	// the filesystem at run time — which is what lets this live inside core.
	_ "embed"
	"fmt"
)

//go:embed base.md
var base string

func Base() string { return base }

const Budget = 2 << 10

// Fits reports whether a prompt is inside the budget, and names both figures
// when it is not.
func Fits(text string) error {
	size := len(text)
	if size <= Budget {
		return nil
	}
	return fmt.Errorf("prompt: the base system prompt is %d bytes and the budget is %d bytes, so it is %d over",
		size, Budget, size-Budget)
}
