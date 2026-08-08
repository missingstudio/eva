// Package anthropic answers a turn from the Anthropic Messages API.
//
// It is the Provider a run uses when nothing selects a recording, and it is
// where the honesty of a cost report is decided. Two things follow from that,
// and the rest of the package is those two things.
//
// The API reports what a turn cost across two frames, so one Usage payload
// accumulates across the stream and emits once, at the end. Each figure it
// carries is either something the API said or nothing at all; the reasoning
// behind every absence is beside the field that stays absent.
//
// An attempt that failed spent money and produced no tool call, so it is a
// payload of its own rather than something the client swallows. The SDK's own
// retrying is turned off here precisely so that every attempt is observable.
package anthropic
