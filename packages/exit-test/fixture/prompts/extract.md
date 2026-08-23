Extract the meeting facts from the document below.

Answer with JSON only, in this shape and nothing else:

{
"meeting": {
"date": "2026-01-31",
"attendees": [{"name": "A. Person", "email": "a@example.com"}],
"decisions": [{"topic": "what was decided", "owner": "A. Person", "due": "2026-02-14"}]
}
}

`date` and `due` are ISO dates. `email` and `due` are optional: leave a key
out when the document does not say. Use only what the document says; add no
key the shape above does not have.

The document:

{{document}}
