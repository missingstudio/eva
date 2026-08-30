#!/usr/bin/env bun
// The workspace entry: `bun apps/cli/src/eva.ts …` runs Eva from source.
// The published binary is bin/eva.mjs, which runs the packed build instead.
import { Effect, Exit, Logger, LogLevel, References, Tracer } from "effect"
import { fromProcess, main, type World } from "./index.js"

/**
 * The level `EVA_LOG` names, or nothing when it names none. The names are
 * Effect's own, in any case: all, trace, debug, info, warn, error, fatal,
 * none. A value that names no level leaves the run as it was.
 */
const levelOf = (asked: string | undefined): LogLevel.LogLevel | undefined =>
  LogLevel.values.find((level) => level.toLowerCase() === asked?.toLowerCase())

/**
 * A tracer that says each span as it ends. Nearly every function in the tree
 * is an `Effect.fn("…")`, so this is the call tree of a run, said innermost
 * first as it unwinds. It writes to the error stream, because standard output
 * is the answer.
 */
const saying = (err: World["err"]): Tracer.Tracer => {
  class Said extends Tracer.NativeSpan {
    override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
      super.end(endTime, exit)
      const took = Number(endTime - this.startTime) / 1e6
      err(`eva: ${this.name} ${took.toFixed(1)}ms${Exit.isFailure(exit) ? " failed" : ""}\n`)
    }
  }
  return Tracer.make({ span: (options) => new Said(options) })
}

/**
 * The run, with what `EVA_LOG` asked for over it. The level says what is
 * logged and sends it to the error stream; a level of debug or finer opens
 * the spans as well, because a span is a detail.
 */
const watched = <A, E>(
  run: Effect.Effect<A, E>,
  level: LogLevel.LogLevel,
  err: World["err"],
): Effect.Effect<A, E> => {
  const logged = run.pipe(
    Effect.provideService(References.MinimumLogLevel, level),
    Effect.provideService(Logger.LogToStderr, true),
  )
  return LogLevel.isLessThanOrEqualTo(level, "Debug")
    ? Effect.withTracer(logged, saying(err))
    : logged
}

const world = fromProcess()
const level = levelOf(world.env["EVA_LOG"])

Effect.runPromise(level === undefined ? main(world) : watched(main(world), level, world.err))
  .then((code) => process.exit(code))
  .catch((cause: unknown) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exit(1)
  })
