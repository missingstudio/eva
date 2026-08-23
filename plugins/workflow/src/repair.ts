import type { Fault } from "@missingstudio/eva-schema"

/**
 * The id the built-in repair Template registers under. It is a prompt row, so
 * a person replaces it by config, and a Workflow named `<workflow>.repair`
 * in the prompt domain outranks it for that Workflow alone.
 */
export const REPAIR_TEMPLATE_ID = "workflow.repair"

// One Fault as one line, in Eva's words. "" is the root, said in words.
export const faultLine = (fault: Fault): string =>
  `at ${fault.at === "" ? "the root" : fault.at} — wanted ${fault.wanted}`

/**
 * The built-in repair Template. It holds the same filled Step Instruction
 * unchanged, every Fault as one line, and one closing ask — never the JSON
 * Schema again, because it is already in the first-pass Instruction and two
 * copies can disagree, and never a library's raw messages.
 */
export const REPAIR_TEMPLATE = `{{instruction}}

The answer you gave does not conform:
{{faults}}

Answer again with only the corrected output.`
