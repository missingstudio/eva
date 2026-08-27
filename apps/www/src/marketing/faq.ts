// The questions a person asks an answer engine before they ask a search
// engine. Each answer opens with the answer, so a retrieved chunk stands on
// its own.
export const faq = [
  {
    question: "What is an open-source autonomous software factory?",
    answer:
      "A system that runs coding work from a spec a machine can check to evidence that it was done, with one contract over every harness, one trace of what they did, one verifier that decides whether the work passed, and one bill that prices it. Eva is an open-source implementation of that category.",
  },
  {
    question: "What is a coding agent harness?",
    answer:
      "A harness is the thing that takes a prompt and drives it to a stopping point. Claude Code, Codex, and OpenCode are harnesses, and so is Eva's own loop. Eva drives harnesses rather than competing to be a better one.",
  },
  {
    question: "How do I verify a coding agent's work instead of trusting its claim?",
    answer:
      "You have something other than the agent check it. Eva records the agent's claim as a claim, in the trace, and never as evidence. The verifier that checks acceptance criteria itself — and can score a diff produced by any harness — is stage 5 on the roadmap.",
  },
  {
    question: "Can Eva run coding agents in parallel, or overnight?",
    answer:
      "Not yet. Racing one spec across harnesses in separate git worktrees is stage 9c, and unattended overnight work needs the queue and daemon at stage 9a. Durable sessions, which both depend on, ship today.",
  },
  {
    question: "What happens if Eva crashes in the middle of a task?",
    answer:
      "Nothing is lost. Everything Eva shows is folded from a durable trace on disk, so a session survives kill -9. There is no in-memory state a crash could lose, because there is none that matters.",
  },
  {
    question: "Is Eva free and open source?",
    answer:
      "Yes. Eva is MIT licensed and the whole tree is public. There is no paid tier that unlocks capability, and self-hosting is not a downgrade path.",
  },
  {
    question: "Do I need new API keys or another subscription?",
    answer:
      "One Anthropic API key, set in your environment. Eva drives the harnesses you already pay for rather than reselling access to them.",
  },
  {
    question: "Where do my code and my key go?",
    answer:
      "Nowhere. Eva runs on your machine. Your key is read from the environment and never reaches a settings file, a log, or the session record.",
  },
  {
    question: "How is this different from running Claude Code directly?",
    answer:
      "Claude Code is a harness. Eva drives harnesses behind one contract, records everything in one trace, and attributes cost per task. Eva's own harness has no privileged position.",
  },
  {
    question: "What actually works today?",
    answer:
      "A terminal client on a plugin kernel: one provider, one interactive surface, durable sessions, and cost accounting. The multi-harness contract and the verifier are on the roadmap.",
  },
] as const
