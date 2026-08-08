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
// Consecutive text chunks of one content block fold into a single record at
// commit (docs/adr/0004), so a Trace record is a unit of meaning rather than a
// token. The fold is lossy and the loss is permanent: inter-token timing is
// gone, and a Trace cannot be used to debug streaming latency. That trade is
// the ADR's, and its falsifier is recorded there.
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
// The group is folded, then the whole of it is encoded before any of it is
// written, so a group that cannot be encoded leaves no bytes in the Trace and
// consumes no Trace position. The encoded group then goes out in a single
// write, so a reader never meets half of it.
//
// Fewer Events come back than went in whenever the fold merged something.
func (s *Sink) Append(ctx context.Context, group []events.Event) ([]events.Event, error) {
	if len(group) == 0 {
		return nil, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	group = fold(group)

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

// fold merges consecutive chunks of one content block into a single Text
// record (docs/adr/0004).
//
// Consecutive is the whole rule: a run of chunks ends at the first Event that
// is not a Text of the same block, the same Run, and the same Session. So the
// fold can never reorder a Trace, and it can never merge two things a reader
// would have to tell apart.
//
// The merged record keeps the envelope of the first chunk — its identifier,
// its wire position, and its timestamp. The wire position counts what was
// sent, and what was sent began there; the timestamp is when the block started
// arriving, which is the figure time-to-first-token is measured from.
func fold(group []events.Event) []events.Event {
	out := make([]events.Event, 0, len(group))

	for _, e := range group {
		text, isText := e.Payload.(events.Text)
		if !isText || len(out) == 0 {
			out = append(out, e)
			continue
		}

		prev := out[len(out)-1]
		prevText, prevIsText := prev.Payload.(events.Text)
		if !prevIsText || prevText.Block != text.Block || !mergeable(prev, e) {
			out = append(out, e)
			continue
		}

		prevText.Chunk += text.Chunk
		out[len(out)-1].Payload = prevText
	}

	return out
}

// mergeable reports whether two Events are the same record in every respect a
// reader folds, filters, or migrates on.
//
// Everything except the identifier, the wire position, and the timestamp has
// to agree, and those three are the three the merged record keeps from the
// first chunk. The strictness is the point: a record that differs anywhere
// else is one a reader would have to tell apart, and merging it would destroy
// the difference silently. It also stops the fold absorbing a malformed
// envelope — a chunk with no schema version must still reach the encoder that
// rejects it, rather than disappearing into the chunk before it.
func mergeable(a, b events.Event) bool {
	if a.Version != b.Version || a.Session != b.Session || a.Run != b.Run {
		return false
	}
	if a.Tenant != b.Tenant || a.Actor != b.Actor {
		return false
	}
	switch {
	case a.Parent == nil && b.Parent == nil:
		return true
	case a.Parent == nil || b.Parent == nil:
		return false
	default:
		return *a.Parent == *b.Parent
	}
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
