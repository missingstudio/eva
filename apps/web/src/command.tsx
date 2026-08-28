/**
 * What a command wrote, and nothing before one has run.
 *
 * Nothing here knows what any of the commands do: the rows live where the
 * Domains do, so `/mode` and `/undo` reach this page by being on the wire and
 * not by being drawn a second time. There is no field of its own either — the
 * composer dispatches a line that names a command, the way the terminal does,
 * because two fields would be two answers to what one line means.
 *
 * What a command writes is the whole of its answer, so it is drawn on the
 * panel the open Run is drawn on — it is the program talking, in words it
 * chose. A command that would have asked lists its options there instead,
 * because this door supplies no way to pick one.
 */
export const Wrote = ({ text }: { readonly text?: string }) =>
  text === undefined || text === "" ? null : (
    <p
      className="panel-terminal my-2 whitespace-pre-wrap rounded-md px-3 py-2 text-sm"
      role="status"
    >
      {text}
    </p>
  )
