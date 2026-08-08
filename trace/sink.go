package trace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/missingstudio/eva/core"
	"github.com/missingstudio/eva/events"
)

// Sink is the append-only JSONL Trace: one Event per line.
//
// The format is chosen for the property that matters after a crash. A reader
// takes whole lines, so a torn tail costs the last record rather than the
// file, and a Trace written by a process that was killed still parses.
//
// What this sink does not do yet: it does not coalesce consecutive text chunks
// of one content block into a single record (docs/adr/0004), so a Trace is
// currently proportionate to tokens rather than to meaning. Nothing here
// depends on that staying true — the fold belongs at commit, which is where
// this file is.
type Sink struct {
	// mu serialises commits. Trace position is assigned under it, so two
	// goroutines cannot be handed the same one.
	mu   sync.Mutex
	file *os.File

	// next is the Trace position each Session will be given, counting from 1.
	// Zero on an Event means "not committed", so the sequence cannot start
	// there.
	//
	// This is the high-water mark for this process. Resuming a Session in a
	// new process needs the mark recovered by reading the Trace back, which
	// arrives with resume; until then a Session belongs to one process and
	// the counter is complete.
	next map[events.SessionID]uint64
}

// Sink is the implementation of the interface core declares. The assertion is
// here rather than in a test because it costs nothing and fails at build time.
var _ core.TraceSink = (*Sink)(nil)

// Open opens the Trace at path for appending, creating it and its directory if
// they do not exist.
func Open(path string) (*Sink, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("trace: make %s: %w", filepath.Dir(path), err)
	}
	// O_APPEND so every write lands at the end of the file as it is at that
	// moment, rather than at an offset this process remembered.
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("trace: open %s: %w", path, err)
	}
	return &Sink{file: file, next: map[events.SessionID]uint64{}}, nil
}

// Append commits a group as one unit.
//
// The whole group is encoded before any of it is written, so a group that
// cannot be encoded leaves no bytes in the Trace and consumes no Trace
// position. The encoded group then goes out in a single write, so a reader
// never meets half of it.
func (s *Sink) Append(ctx context.Context, group []events.Event) ([]events.Event, error) {
	if len(group) == 0 {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Positions are taken from a copy of the counters, and only written back
	// once the group is durable. A rejected group must not leave a gap.
	taken := make(map[events.SessionID]uint64, len(group))
	committed := make([]events.Event, len(group))
	var buf bytes.Buffer

	for i, e := range group {
		seq, ok := taken[e.Session]
		if !ok {
			seq = s.next[e.Session]
			if seq == 0 {
				seq = 1
			}
		}
		taken[e.Session] = seq + 1

		e.Seq = seq
		line, err := json.Marshal(e)
		if err != nil {
			return nil, fmt.Errorf("trace: encode event %d of %d: %w", i+1, len(group), err)
		}
		buf.Write(line)
		buf.WriteByte('\n')
		committed[i] = e
	}

	n, err := s.file.Write(buf.Bytes())
	if err != nil {
		return nil, fmt.Errorf("trace: append: %w", err)
	}
	if n != buf.Len() {
		return nil, fmt.Errorf("trace: append wrote %d of %d bytes", n, buf.Len())
	}

	for session, seq := range taken {
		s.next[session] = seq
	}
	return committed, nil
}

// Close releases the file.
func (s *Sink) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.file == nil {
		return nil
	}
	err := s.file.Close()
	s.file = nil
	if err != nil {
		return fmt.Errorf("trace: close: %w", err)
	}
	return nil
}
