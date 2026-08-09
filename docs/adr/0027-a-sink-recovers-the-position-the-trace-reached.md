---
status: accepted
---

# A sink recovers the position the Trace reached

`trace.Open` reads the file back before it appends to it, and starts each Session from the position that file shows it reached.

The counter used to start empty in every process, and `Append` gave an unseen Session position 1. The file is opened `O_APPEND`, so a Session written by two processes got two records at Seq 1, two at Seq 2, and so on.

## Why this was not a resume problem

The code said it was. The comment on the counter called it "the high-water mark for this process" and said recovering it "arrives with resume; until then a Session belongs to one process and the counter is complete."

The premise is what was wrong. Nothing binds a Session to a process — a Session identifier is a string in a config-driven path, and the sink appends to whatever file it is pointed at. Two `eva` processes against one Trace do it today. So did anything that opened a sink twice in one process.

ADR 0008 makes Seq the position the sink assigns at commit, per Session, and every projection that reads position as identity — dedupe on replay, a cursor a consumer resumes from, a fold that orders records — reads it as unique. Two records with one position is not a degraded Trace; it is a Trace that lies in a way no reader can detect, because both records are well-formed.

## What reading back costs

One pass over the file at open, decoding two envelope fields per line.

Whole Events are not decoded. A kind this build does not recognise is preserved on read (ADR 0002), and reviving one here only to discard it would put that cost on every open. Two fields are all a position needs.

A line that does not parse is passed over rather than failing the open. That is the format's own property — a reader takes whole lines, so a process killed mid-write costs the last record rather than the file — and refusing to open a Trace with a torn tail would make a crash cost the Session as well as the record.

The cost grows with the file. It is a read of what is already on disk, once per process, against a file that is small next to what it records; when it stops being small, the answer is an index beside the Trace rather than a counter that guesses.

## Considered options

- **Refuse to append to a file holding a Session the sink has not read.** Honest, and rejected: it makes the second process fail rather than work, and the thing it would refuse is the ordinary case of resuming.
- **Give every process a fresh Session.** That is what `/clear` does deliberately (ADR 0019) and it is not resume. A Session that cannot be continued across processes is not durable, and durable is the first word of its definition.
- **Keep the counter per process and make Seq unique by pairing it with the Run.** Rejected. ADR 0008 fixes Seq as per-Session, and a fold that had to carry a second key to order one Session would push this decision into every reader.

## Consequences

**Open does I/O proportional to the Trace.** It did none before. The first call after a long conversation is the one that pays.

**The counter is now the Trace's, not the process's.** Two sinks open on one file at once still race — each recovered the same mark and neither sees the other's writes. One writer per Trace is the contract, and it was the contract before; what changed is that a *sequence* of writers now works, which is what resume is.

**Falsifier:** if a Trace becomes large enough that the read at open is felt, this is the decision to revisit — with an index or a footer, not by going back to guessing at 1.
