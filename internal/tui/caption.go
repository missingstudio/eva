package tui

import (
	"math/rand/v2"
	"time"
)

// captions are what the status line says beside the spinner while a turn is in
// flight.
var captions = []string{
	"thinking",
	"pondering",
	"considering",
	"mulling it over",
	"turning it over",
	"working it out",
	"chewing on it",
	"weighing it up",
	"gathering thoughts",
	"finding the words",
	"composing",
	"drafting",
	"reasoning",
	"deliberating",
	"ruminating",
	"puzzling",
	"cogitating",
	"musing",
	"reflecting",
	"assembling an answer",
	"joining the dots",
	"sifting",
	"untangling",
	"circling in",
	"warming up",
	"listening to the wire",
}

// caption chooses one, avoiding the one already on screen.
func (c *Console) recaption() {
	c.captioned = time.Now()

	for range 4 {
		next := captions[c.pick(len(captions))]
		if next != c.caption {
			c.caption = next
			return
		}
	}
}

func (c *Console) captionDue() bool {
	return time.Since(c.captioned) >= time.Duration(c.look.Layout.CaptionSeconds)*time.Second
}

// randomPick is what a console picks with when nobody has said otherwise.
func randomPick(n int) int { return rand.IntN(n) }
