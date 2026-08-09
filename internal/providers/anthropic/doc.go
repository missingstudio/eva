// Package anthropic answers a turn from the Anthropic Messages API.
//
// It is the Provider a run uses when nothing selects a recording, and it is
// where the honesty of a cost report is decided. Two things follow from that,
// and what is left in this package after the wire is those two things — the
// queue they arrive through, and the rules they arrive under, are the Driver's
// and are the same for every Provider.
//
// The API reports what a turn cost across two frames, so this reads both into
// one Spend and the Usage payload emits once, at the end. Each figure it
// carries is either something the API said or nothing at all; the reasoning
// behind every absence is beside the call that leaves it absent.
//
// An attempt that failed spent money and produced no tool call, so it is a
// payload of its own rather than something the client swallows. The SDK's own
// retrying is turned off here precisely so that every attempt is observable.
//
// What the API leaves out is said out loud on the same principle. A cost it
// never reported and an answer it cut off at the cap both leave the stream
// looking whole, so each is stated where it is learned; what a Run's single
// caveat ends up reading is composed elsewhere, by the one thing that sees
// every degradation rather than only this Provider's.
package anthropic
