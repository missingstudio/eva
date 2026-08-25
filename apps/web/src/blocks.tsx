import type { Block, Turn } from "@missingstudio/eva-session-view"

/**
 * How many hunks changed, in words. One is not "1 hunks", and a reader
 * counting files does not want to read a number twice to find out.
 */
export const hunkText = (hunks: number): string => `${hunks} ${hunks === 1 ? "hunk" : "hunks"}`

// An image travels as bytes, so the page draws the bytes. A `uri` on the
// record names a file on the machine that made it, which a browser cannot
// open — it is said beside the image as evidence, not used as a source.
const imageSource = (mimeType: string, data: string): string => `data:${mimeType};base64,${data}`

/**
 * One Block, in page primitives. What the Run did is settled before this is
 * called — the fold in `session-view` settled it — so all this decides is
 * what a reader sees.
 *
 * Every member is drawn, including the one this page has no primitive for.
 * A Surface may render less than another; it may never know less. So a Block
 * nothing here can draw says what it was and that it could not be drawn,
 * rather than leaving a hole a reader would read as nothing having happened.
 */
export const BlockView = ({ block }: { readonly block: Block }) => {
  switch (block.kind) {
    case "words":
      return <p className="words">{block.text}</p>
    case "reasoning":
      return <p className="reasoning">{block.text}</p>
    // A call that is open says where it is in its life, and nothing about how
    // it ended, because it has not.
    case "tool":
      return (
        <div className="call">
          <code>{block.name}</code>
          <span className="tool">{block.tool}</span>
          <span className="status">{block.status}</span>
        </div>
      )
    /**
     * The same call, answered. A Tool Status and a Disposition are both
     * drawn, because neither replaces the other: the Status says where the
     * call is in its life and the Disposition says how it ended, and a
     * status alone reads as a call that worked.
     */
    case "result":
      return (
        <div className="call answered">
          <code>{block.name}</code>
          <span className="tool">{block.tool}</span>
          <span className="status">{block.status}</span>
          <span className="disposition">{block.disposition}</span>
        </div>
      )
    // The path and the count of hunks, which is the whole of what the record
    // holds. Nothing here is a rendering the far side sent.
    case "diff":
      return (
        <figure className="diff">
          <code>{block.path}</code>
          <figcaption>{hunkText(block.hunks)}</figcaption>
        </figure>
      )
    case "image":
      return (
        <figure className="image">
          <img src={imageSource(block.mimeType, block.data)} alt={`an image, ${block.mimeType}`} />
          <figcaption>{block.uri ?? block.mimeType}</figcaption>
        </figure>
      )
    case "unknown":
      return (
        <p className="undrawn">
          this page cannot draw <code>{block.originalKind}</code>, and the record holds one
        </p>
      )
  }
}

/**
 * One Session, as the fold gives it: a Turn per Message, and the Blocks of
 * what was said in it. The Turns are handed over rather than read, so what
 * the page draws is provable without a socket.
 */
export const Turns = ({ turns }: { readonly turns: readonly Turn[] }) =>
  turns.length === 0 ? (
    // A Session that folds to nothing and one whose fold has not arrived are
    // two different things, and a page that drew them alike would be lying
    // about one of them.
    <p className="note">This Session has said nothing yet.</p>
  ) : (
    <ol className="turns">
      {turns.map((turn) => (
        <li key={turn.key} className={`turn ${turn.author}`}>
          <p className="author">{turn.author}</p>
          {turn.blocks.map((block) => (
            <BlockView key={block.key} block={block} />
          ))}
        </li>
      ))}
    </ol>
  )
