package api

import (
	"errors"
	"sync"
)

// watchBuffer is how far behind a watching client may fall before it stops
// being one.
const watchBuffer = 256

// errBehind is what a client that fell too far behind is told it stopped for.
// It travels back to the Recorder, which is what turns a Subscriber that
// stopped following into the caveat the Run closes with.
var errBehind = errors.New("this client fell behind the Trace and stopped following it")

// backlog is what a watching client has yet to be sent. It is bounded, and what
// it does when full is why it is a thing of its own: a client that cannot keep
// up must never hold up the turn. A record it did not take is a projection that
// stopped following, which the Run says in its close. A chunk is not a record,
// so one that did not fit is a moment of the turn this client did not see.
type backlog struct {
	frames chan frame

	// done is closed when this client stopped following, so that whoever is
	// writing the stream stops with it.
	once sync.Once
	done chan struct{}
	// leave detaches the watcher this backlog fills. A client that stopped
	// following must stop being told, or the next Run would find it there and
	// close Degraded for a projection that left during the last one.
	leave func()
}

func newBacklog(size int, leave func()) *backlog {
	return &backlog{frames: make(chan frame, size), done: make(chan struct{}), leave: leave}
}

// record queues one committed Event, and returns behind when this client has
// fallen too far back to be told any more.
func (b *backlog) record(f frame) error {
	select {
	case b.frames <- f:
		return nil
	default:
		b.stop()
		return errBehind
	}
}

// chunk queues one arriving chunk, and drops it when there is no room.
func (b *backlog) chunk(text string) {
	select {
	case b.frames <- frame{Chunk: text}:
	default:
	}
}

func (b *backlog) stop() {
	b.once.Do(func() {
		close(b.done)
		if b.leave != nil {
			b.leave()
		}
	})
}
