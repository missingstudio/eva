package cli

import (
	"context"
	"os"
	"os/signal"
	"sync"
	"syscall"
)

var stopSignals = []os.Signal{os.Interrupt, syscall.SIGTERM, syscall.SIGHUP}

func listen(parent context.Context) (ctx context.Context, asked func() os.Signal, release func()) {
	ctx, cancel := context.WithCancel(parent)

	// Buffered, because signal.Notify never blocks on a full channel: an
	// unbuffered one would drop the signal whenever it arrived before this
	// goroutine reached the receive.
	arrived := make(chan os.Signal, 1)
	signal.Notify(arrived, stopSignals...)

	var mu sync.Mutex
	var got os.Signal

	go func() {
		select {
		case s := <-arrived:
			mu.Lock()
			got = s
			mu.Unlock()
			// Before the cancel, so that a second signal is already the
			// runtime's by the time anything starts shutting down.
			signal.Stop(arrived)
			cancel()
		case <-ctx.Done():
			// Released, or the parent ended. Either way this goroutine is done
			// and the relay has to be taken down with it.
			signal.Stop(arrived)
		}
	}()

	return ctx, func() os.Signal {
			mu.Lock()
			defer mu.Unlock()
			return got
		}, func() {
			signal.Stop(arrived)
			cancel()
		}
}

func stopCode(s os.Signal) int {
	if signo, ok := s.(syscall.Signal); ok {
		return 128 + int(signo)
	}
	return ExitFailure
}
