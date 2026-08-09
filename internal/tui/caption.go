package tui

import (
	"math/rand/v2"
	"time"
)

// captions are what the status line says beside the spinner while a turn is in
// flight.
//
// They are decoration, and the distinction matters here more than it would
// elsewhere: everything else a person reads on this screen is a fold over what
// the Trace holds, and a caption is a fold over nothing. So a caption may never
// claim anything. It is erased with the live area, it is never written to the
// transcript, and no record is poorer for its absence.
//
// That rules out the captions this kind of list usually has. Eva at this stage
// has no tools and acts on nothing — no file is read, no command is run, no
// repository is searched — so a caption that said any of those would be the
// interface making a claim the program cannot keep, and a person would have no
// way to tell it apart from the ones that are true. What is left is the honest
// subject: waiting, and the model on the other end of it.
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
//
// Avoiding it matters more than it looks: a random choice from a list of this
// length repeats itself about once every four changes, and a caption that
// "changed" to the same words reads as an interface that has stopped rather than
// one that is still going.
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

// captionDue reports whether the caption has been on screen long enough.
//
// It is asked on the spinner's tick, because that is the one thing already
// waking this interface up while a turn runs. A timer of its own would be a
// second reason to redraw for a line that changes eight seconds apart.
// How long a caption stays is the Theme's. It is not the spinner's frame: one
// that changed twelve times a second would be unreadable, and one that never
// changed would stop being evidence that anything is still happening, which is
// the whole reason a spinner is there. The default is eight seconds — long
// enough to read twice, short enough that a slow turn keeps saying something
// new.
func (c *Console) captionDue() bool {
	return time.Since(c.captioned) >= time.Duration(c.look.Layout.CaptionSeconds)*time.Second
}

// randomPick is what a console picks with when nobody has said otherwise.
func randomPick(n int) int { return rand.IntN(n) }
