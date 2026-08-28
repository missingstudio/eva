/**
 * The framing both wires speak: server-sent events, read and written as
 * frames. One stream carries the record's payloads and another carries the
 * questions that stand, and a frame is the same thing on both — `id:` and
 * `data:` lines up to a blank one — so the split and the remainder rule live
 * here once, below both plugins, rather than once per stream.
 */

// What a stream answers with. Both halves of a wire read it, so both halves
// hold one spelling.
export const EVENT_STREAM = "text/event-stream"

/**
 * One frame of the stream: what was said, and where it sits in the record.
 * `Frame` is the terminal's screen contract, so this one says which frame it
 * is — the two are not the same thing and never meet.
 *
 * `seq` is absent for a stream that carries no positions, and that absence is
 * the point. A frame with a made-up position is a position a reader would
 * resume from, and it would resume past what it never saw.
 */
export interface StreamFrame {
  readonly seq?: number
  readonly data: string
}

// A position is a whole number and may sit behind the record's start, which
// is exactly the case a refusal answers. Anything else names no position.
export const cursorIn = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const seq = Number(value.trim())
  return Number.isSafeInteger(seq) ? seq : undefined
}

export const frameOut = (frame: StreamFrame): string =>
  `${frame.seq === undefined ? "" : `id: ${frame.seq}\n`}data: ${frame.data}\n\n`

// One block between two blank lines, read as a frame. A block with no `data`
// is a comment or a keep-alive and names no payload, so it is not one.
const frameIn = (block: string): readonly StreamFrame[] => {
  let seq: number | undefined
  const said: string[] = []

  for (const line of block.split("\n")) {
    const row = line.endsWith("\r") ? line.slice(0, -1) : line
    if (row.startsWith("data:")) said.push(row.slice("data:".length).trimStart())
    else if (row.startsWith("id:")) seq = cursorIn(row.slice("id:".length))
  }

  return said.length === 0 ? [] : [{ ...(seq === undefined ? {} : { seq }), data: said.join("\n") }]
}

/**
 * The frames whole in what has arrived, and what is left of one that is not.
 * A socket hands over bytes and not frames, so the reader keeps the remainder
 * and asks again: a frame split across two reads is still one frame.
 */
export const framesIn = (
  text: string,
): { readonly frames: readonly StreamFrame[]; readonly rest: string } => {
  const blocks = text.split("\n\n")
  const rest = blocks.pop() ?? ""
  return { frames: blocks.flatMap(frameIn), rest }
}
