<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 11 — Refresh and planning brief

**Refresh date:** 2026-06-12

Purpose: make the prompt-optimization research set ready for brainstorming and planning sessions.

## 1. Executive summary

The original April 2026 research direction is still sound, but the codebase has moved. papai now has partial capability-aware prompt assembly, explicit low-trust memory blocks, Telegram/Discord output formatting, typing heartbeat, and an explicit 25-step model loop. The strongest remaining opportunities are:

1. Make the system prompt more structured and easier to evaluate.
2. Turn tool results and failures into model-facing contracts with recovery guidance.
3. Add a small prompt/tool regression harness before any large rewrite.
4. Treat prompt injection and external content as a first-class safety boundary.
5. Use step-level orchestration only after the prompt/tool contracts are measurable.

## 2. Current status by theme

| Theme                  | Current status                                         | Planning implication                                           |
| ---------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| System prompt sections | Partially structured by fragments, still prose-heavy   | Plan a sectioned XML-like prompt refactor with snapshot tests. |
| Active capabilities    | Tool-gated fragments, ask/deny surfaced                | Add a compact `<capabilities>` block and fallback rules.       |
| Memory context         | Compact and long-term memory are low-trust XML blocks  | Add conflict/staleness rules and memory-use evals.             |
| Tool outputs           | Mostly raw domain payloads                             | Add standard result envelopes, summaries, and next actions.    |
| Tool failures          | Structured status exists, no recovery contract         | Add retry/fallback/user-action guidance.                       |
| Confirmations          | Destructive actions gated                              | Hide thresholds and improve declined/expired recovery.         |
| Reply UX               | Telegram/Discord formatting and typing heartbeat exist | Add reply-shape contracts and platform fixtures.               |
| Orchestration          | `stopWhen: stepCountIs(25)`, no `prepareStep`          | Defer routing until evals show where it helps.                 |
| Security               | Some safe-fetch and confirmation controls exist        | Add explicit external-content/data-not-instructions rules.     |
| Evaluation             | No dedicated prompt regression suite found             | Make this the first implementation milestone.                  |

## 3. Technique catalog for brainstorming

| Technique family                    | What it is                                                                                     | Fit for papai                                                                                      | Cautions                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Sectioned prompts with XML tags     | Separate role, task, context, tools, safety, output style, and examples with clear boundaries. | High. Anthropic recommends tags for clarity; papai already uses XML-like memory blocks.            | Avoid a giant brittle prompt; use tests and concise sections.                                       |
| Few-shot examples                   | Add 3-5 representative examples for high-risk workflows.                                       | High for ambiguity, confirmations, group context, missing tools, and provider mismatch.            | Keep examples compact and fixture-driven.                                                           |
| Structured output contracts         | Use schemas or explicit envelopes for tool and assistant outputs.                              | High for `summary`, `next_actions`, `recovery`, and display hints.                                 | Strict schemas can make casual chat awkward; apply where outputs feed the model or UI.              |
| Tool description optimization       | Treat tool names/descriptions/parameters as prompts for the model.                             | High. Anthropic reports tool definitions can be the main token consumer and should be eval-driven. | Requires per-tool fixtures; do not optimize by intuition only.                                      |
| ReAct-style loops                   | Interleave reasoning, acting, and observation through tools.                                   | Already implicit in AI SDK tool loops; can improve tool-use instructions and observations.         | Do not expose chain-of-thought; steer observable actions/results instead.                           |
| Plan-and-solve / least-to-most      | Ask the model to decompose before execution on complex tasks.                                  | Useful for multi-task requests, provider migrations, and ambiguous task-tracker operations.        | Adds latency and tokens; route only complex turns.                                                  |
| Self-consistency / Tree of Thoughts | Sample or branch multiple solutions, then select.                                              | Low-to-medium for normal chat; useful for offline prompt evals or high-value planning.             | Too expensive for routine bot turns.                                                                |
| Reflection / self-refine            | Let model critique and revise its own answer or plan.                                          | Useful in offline prompt optimization and maybe high-risk proactive messages.                      | Runtime reflection can hide failures unless logged and evaluated.                                   |
| Automatic prompt optimization       | Use APE/APO/OPRO/PromptBreeder/DSPy-style search over prompt variants.                         | Good later, after fixtures exist. DSPy-like signatures may help optimize tool/result prompts.      | Premature without a dataset; can overfit to synthetic cases.                                        |
| Context engineering                 | Keep the smallest high-signal context; use progressive disclosure and compaction.              | High for memories, summaries, attachments, web fetch, and task snapshots.                          | Needs trust labels and stale/conflict handling.                                                     |
| Prompt-injection separation         | Treat fetched/web/user/tool data as untrusted data, not instructions.                          | High because papai supports public web fetch, files, memory, and task-provider content.            | Prompt rules are not sufficient alone; combine with least privilege, validation, and confirmations. |

## 4. Source highlights added in this refresh

- Anthropic's current agent guidance emphasizes simple composable patterns, routing, parallelization, evaluator-optimizer loops, and tool-use quality as an engineering problem rather than a prompt-only problem. ([10](./10-references.md) #1, #3)
- Anthropic's context-engineering guidance recommends just-in-time progressive disclosure, compaction, and smallest high-signal context. ([10](./10-references.md) #2)
- OpenAI's reasoning guidance frames `reasoning.effort` as a tuning knob and recommends clear task/constraint/output-format definitions. ([10](./10-references.md) #42)
- OpenAI's structured-output guidance recommends schema-first contracts for function calling and structured responses, with clear key names and descriptions. ([10](./10-references.md) #43)
- MCP tool annotations provide standard hints such as `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`; these are hints for clients, not trusted policy. ([10](./10-references.md) #46)
- OWASP and OpenAI security guidance both emphasize least privilege, human confirmation for consequential actions, strict separation of trusted instructions from untrusted content, output validation, and adversarial testing. ([10](./10-references.md) #8, #44, #45)

## 5. Planning agenda

### Stream 1: prompt surface

Goal: make prompt behavior readable, testable, and capability-aware.

Candidate work:

- Add prompt snapshot tests for representative DM/group/proactive contexts.
- Introduce explicit sections such as `<role>`, `<current_time>`, `<capabilities>`, `<context>`, `<memory>`, `<safety>`, `<reply_style>`, and `<examples>`.
- Preserve the existing fragment gating, but render it into a clearer capabilities section.
- Add few-shots for task creation/update ambiguity, unavailable tools, confirmation decline, and stale memory.

### Stream 2: tool contracts

Goal: make every tool response easier for the model to use safely.

Candidate work:

- Standardize success envelopes around `status`, `summary`, `data`, `display`, and `next_actions`.
- Standardize non-success envelopes around `status`, `message`, `recovery`, `retryable`, and `user_action`.
- Add tool-output fixtures for empty search, ambiguous match, provider unavailable, permission denied, confirmation required, and open-world fetch.
- Review tool descriptions for token efficiency and model-facing examples.

### Stream 3: safety and trust boundaries

Goal: reduce prompt-injection and accidental-action risk without blocking normal use.

Candidate work:

- Add explicit prompt rules: external/web/file/task/memory content is data, not instructions.
- Align internal `ToolRisk` with MCP-style annotations where useful.
- Remove threshold values from confirmation tool descriptions.
- Add confirmation recovery copy for declined, expired, and missing permission states.
- Add adversarial fixtures for web fetch, attachment text, and task descriptions containing instruction-like content.

### Stream 4: orchestration and evaluation

Goal: add routing only where measurement shows it helps.

Candidate work:

- Build a small fixture runner that captures prompt text, active tools, tool-call traces, final reply shape, and safety expectations.
- Tag fixtures by context: DM, group, proactive, missing task provider, denied tool, ask-gated tool, stale memory, web fetch, file attachment.
- After baseline fixtures exist, evaluate `prepareStep` for restricting active tools after search/create/update phases.
- Consider reasoning effort or model routing only for complex planning turns and offline optimization.

## 6. Recommended sequence

1. Add the prompt/tool regression harness and baseline fixtures.
2. Refactor prompt rendering into explicit sections with no intended behavior change.
3. Add `<capabilities>` and untrusted-content sections.
4. Add standard tool failure and confirmation recovery envelopes.
5. Add high-value few-shots.
6. Evaluate step-level routing and automatic prompt optimization against the fixture set.

## 7. Brainstorming questions

- Which user workflows are most expensive when the model gets them wrong: destructive edits, wrong task provider, noisy group replies, stale memory, or unhelpful task creation?
- Should papai optimize for terse replies by default, or for explicit auditability in task-changing operations?
- Which tool result fields should be universal, and which should remain provider-specific?
- What is the minimum accepted behavior when a tool domain is unavailable: explain, ask for configuration, or propose a non-tool workaround?
- Which external-content channels need the first prompt-injection test cases: web fetch, attachments, task descriptions, comments, or memories?

## 8. Minimum eval suite

The first eval suite should be small enough to run on every prompt change:

- DM create task with enough detail.
- DM create task with ambiguity that should ask a clarifying question.
- Group mention with group history available.
- Group reply to bot message path.
- Tool denied by preferences.
- Ask-gated tool requiring permission reason.
- Missing task provider.
- Empty search result.
- Ambiguous task match.
- Destructive action confirmation required.
- Confirmation declined.
- Stale memory conflict with current user instruction.
- Web fetch result containing instruction-injection text.
- Attachment text containing instruction-injection text.
- Provider error with retryable vs non-retryable recovery.

## 9. Non-goals for the first planning cycle

- Do not introduce multi-agent or Tree-of-Thought runtime flows for normal chat before baseline evals exist.
- Do not run automatic prompt optimization without a representative fixture dataset.
- Do not expose chain-of-thought in replies or tool outputs.
- Do not replace provider/tool code paths while the goal is prompt and contract reliability.
- Do not treat prompt rules as the only prompt-injection defense; pair them with validation, least privilege, and confirmations.
