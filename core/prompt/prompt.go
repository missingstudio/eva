// Package prompt holds the base system prompt every turn is conditioned on,
// and the budget it is held to.
//
// The prompt is part of the build rather than part of the configuration. It is
// compiled in, it arrives in a diff like any other source, and a change that
// spends more of the context window than the budget allows fails the same
// check that a broken test does. Context spend is therefore a reviewed,
// versioned figure from the first commit, rather than something that grows a
// plausible paragraph at a time until somebody thinks to measure it.
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

// Base is the base system prompt.
//
// It is a function rather than a variable because a variable is something a
// caller can assign to, and a base prompt one package could change under
// another is a prompt the byte budget no longer describes.
func Base() string { return base }

// Budget is what the base system prompt may spend, in bytes.
//
// 2 KiB is the bar owainlewis/neo holds itself to, and it is a working figure
// rather than a derived one: it is enough for what Eva is and how it answers,
// and small enough that a paragraph added without thought does not fit. Raise
// it deliberately, in a commit that says what the extra bytes buy on every
// turn — never to make a red check green.
const Budget = 2 << 10

// Fits reports whether a prompt is inside the budget, and names both figures
// when it is not.
//
// It is a size comparison and nothing else. Deterministic size budgets are the
// only spend this project gates a merge on: a gate that measured a duration
// would be red on a loaded machine and green on a quiet one, and a check that
// fails for reasons nobody caused is a check people learn to ignore.
func Fits(text string) error {
	size := len(text)
	if size <= Budget {
		return nil
	}
	return fmt.Errorf("prompt: the base system prompt is %d bytes and the budget is %d bytes, so it is %d over",
		size, Budget, size-Budget)
}
