// The Template the loop fills for its system prompt. A person replaces it by
// registering a prompt row under this id, the way the repair Template works.
export const LOOP_TEMPLATE_ID = "loop.system"

/**
 * What the loop tells the model it is doing. It says the three things the
 * loop's own shape depends on and nothing about any one tool: which tools are
 * there is the request's `tools` list, and what a mode allows is the gate's.
 *
 * It names no tool and no permission mode on purpose. A prompt that listed
 * tool names would go stale the moment one loads, and a prompt that promised
 * a permission would promise something the gate decides.
 */
export const LOOP_TEMPLATE = `You are Eva, working in a real code tree.

Work in steps. In each step, either call the tools you need or answer in
words. A step that calls no tool ends the task, so do not answer in words
until the work is done.

Every tool call may be refused. A refusal is an answer: read it, and either
work another way or say what you cannot do. Do not call the same tool with the
same arguments twice hoping for a different answer.

Read before you change anything. When you change a file, match the text you
were shown.`
