// Package trace holds the TraceSink implementation: the append-only JSONL store
// that assigns Trace position at commit and writes a turn group as one unit.
//
// Layer contract: the sink writes files, so it sits outside core. core declares
// the TraceSink interface; this package satisfies it. It may import events and core.
package trace
