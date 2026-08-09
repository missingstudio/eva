---
status: accepted
---

# A transcript entry is blocks, so a tool exchange can be rebuilt

`core.Message` holds a list of blocks rather than a string. Three block kinds exist — words, a tool call, and the result that answers it — behind an interface sealed the way the Event schema's payloads are, so the set is closed by the compiler and adding to it is a decision taken beside the wires that have to send it.

The Event schema already carried `ToolCall` and `ToolResult`. What it could not do was give them back: a `Message` of `{Author, Text}` has nowhere to put a call, so a fold over a Trace holding tool records could rebuild that something happened and could not rebuild the conversation.

## The schema could not pair a call with its result

Two fields were missing, and the fold is what made the absence visible. `ToolCall` had no identifier, and `ToolResult` had neither the identifier of the call it answered nor the content the model is shown — only a name, a disposition, and a byte count. A turn with two calls in flight is the ordinary case rather than the exotic one, and nothing in the record said which result belonged to which call.

So `ToolCall` gains `ID` and `ToolResult` gains `Call` and `Content`. The identifier is the provider's own rather than one Eva mints, because the next request has to name the call in the words the provider used; an identifier of ours would be translated at the wire and would be a second identity for one call.

Both are additive, so the schema version does not move. A record written before them decodes with the fields empty, which is what a record written without the distinction can honestly be asked to say.

## Why this is the fold's problem and not the wire's

The transcript is a fold and nothing else. Anything a Trace cannot reconstruct is a second source of truth, and "the transcript stays structurally valid for the next provider call" is the rule the tool loop rests on: a request carrying a call that nothing answers is rejected by every provider, and rejected as a malformed request rather than as a turn that went wrong.

A transcript of strings can hold what was said and not what was done. Discovering that at the stage that adds tools would mean changing the fold, both wires, the contract suite, and the shape every stored Trace is replayed into — while a tool loop is being written on top of it. The type is cheap to change now, and the test that proves it works is one a stage with no tools can still run: constructed tool records fold, and the transcript that comes back is one a provider would take. That is the same pattern the plan already uses for the unknown-kind assertion.

## What did not ship

Neither wire sends a tool block. Nothing yet calls a tool, so a mapping written now would be one nothing exercises and nobody could trust — it lands with the tool registry that produces the blocks, against the API shapes it is tested on.

A block a wire cannot send fails the turn and names the block. It is not left out: a transcript with a call dropped from it asks the model to continue without knowing what it did, and the answer to that is a confident invention where a refusal is a turn that failed and said why.

## What was considered instead

Keeping the string and adding a parallel structure beside it — a list of tool exchanges hanging off the Session — was rejected on the rule that makes the fold worth having. Two accounts of one conversation is exactly the second source of truth ADR 0011 removed, and the two would disagree on the first turn that failed between the call and its result.

Waiting for the stage that needs it was rejected because the cost is not the type. It is that every consumer of the transcript, and the meaning of every stored Trace, changes at the moment the most is being built on top of them.

## Consequences

**A block is a domain concept, and it has a glossary entry.** The set is closed for the reason the Event kind set is: a block a wire has never heard of is a request no provider accepts.

**An entry belongs to an Author, and a result is the person's turn to speak.** Every API that takes tool results takes them in the entry that answers the assistant, so the fold puts them there rather than inventing a third Author each wire would map back.

**A call and its result are committed as one group**, so the fold sees both or neither — which makes "no tool_use without its tool_result" a property of the fold as well as of the writer.

**Falsifier:** if a provider appears whose tool results do not belong to a conversational entry — a side channel, a separate results array — then Author is the wrong home for them and the block list is carrying a shape that is only two vendors deep. Both APIs Eva speaks today agree, and a third that does not is the signal to look again.
