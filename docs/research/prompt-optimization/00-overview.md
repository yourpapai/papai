<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# papai LLM prompt, tool, and UX optimization — research overview

**Date:** 2026-04-21
**Refresh:** 2026-06-12
**Scope:** the runtime prompt assembled by `src/system-prompt.ts`, the tool layer in `src/tools/`, the tool-failure wrapper in `src/tool-failure.ts` / `src/error-analysis.ts`, the memory block in `src/memory.ts`, the orchestrator loop in `src/llm-orchestrator.ts`, and how all of these interact to produce the final reply sent to Telegram, Mattermost, or Discord.
**Audience:** maintainers who want a concrete, evidence-backed plan for making the bot's answers more predictable, safer, and more useful.

This folder is a research report, not a patch. Nothing here changes production behavior on its own. Each file contains a focused analysis, a list of concrete recommendations (with file paths where applicable), and references to the external sources that justify the recommendations. References are collected in [`10-references.md`](./10-references.md).

## Refresh status

This research set has been refreshed against the current codebase and current public prompt-engineering, agent, context-engineering, structured-output, MCP, and prompt-injection literature. The original April 2026 findings are still useful as a baseline, but several items are now partially implemented:

- System-prompt fragments are now gated by available tools and user tool preferences.
- Compact and long-term memory blocks now carry explicit low-trust XML tags and caps.
- The main LLM loop now uses an explicit `stopWhen: stepCountIs(25)`.
- Telegram and Discord now have reply formatting post-processors, and the bot sends typing heartbeats while waiting.

The most planning-ready summary is now [`11-refresh-and-planning-brief.md`](./11-refresh-and-planning-brief.md).

## Reading order

The files are numbered so they can be read top-to-bottom, but each is self-contained.

| #   | File                                                                     | Focus                                                                                                 | Primary artifact     |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------- |
| 00  | [this file](./00-overview.md)                                            | Executive summary, TOC, methodology                                                                   | —                    |
| 01  | [`01-current-state-audit.md`](./01-current-state-audit.md)               | Verbatim snapshot of today's prompt, tool descriptions, error envelopes, memory block                 | raw material         |
| 02  | [`02-system-prompt-flaws.md`](./02-system-prompt-flaws.md)               | Issues with the current prompt and a proposed rewrite structured with XML sections                    | prompt rewrite       |
| 03  | [`03-tool-design-schemas.md`](./03-tool-design-schemas.md)               | Tool naming, descriptions, input schemas, `.describe()` conventions, consolidation vs granularity     | schema checklist     |
| 04  | [`04-tool-output-steering.md`](./04-tool-output-steering.md)             | Output envelopes, `next_actions` / `hint` fields, truncation-with-steering, response_format parameter | output envelope spec |
| 05  | [`05-error-handling-recovery.md`](./05-error-handling-recovery.md)       | Error codes, `agentMessage` vs `userMessage`, self-correction loops, retry policy                     | error catalog        |
| 06  | [`06-confirmation-safety.md`](./06-confirmation-safety.md)               | Destructive-action confirmation, HITL patterns, prompt-injection hardening, trust boundaries          | safety checklist     |
| 07  | [`07-memory-context.md`](./07-memory-context.md)                         | Memory-block layout, summary quality, fact decay, context-window budgeting, just-in-time retrieval    | memory layout        |
| 08  | [`08-ux-reply-formatting.md`](./08-ux-reply-formatting.md)               | Cross-platform markdown, progress signals, "show-your-work" cues, empty/edge/error states             | reply guide          |
| 09  | [`09-orchestration-routing.md`](./09-orchestration-routing.md)           | `streamText` loop, `stopWhen`, `prepareStep`, small-model routing, planning vs acting                 | orchestration spec   |
| 10  | [`10-references.md`](./10-references.md)                                 | All sources cited in this report                                                                      | bibliography         |
| 11  | [`11-refresh-and-planning-brief.md`](./11-refresh-and-planning-brief.md) | Updated synthesis for brainstorming and implementation planning                                       | planning brief       |

## Methodology

1. **Codebase audit.** Two Explore subagents extracted the current system prompt (`src/system-prompt.ts`), the tool layer (`src/tools/`), the tool-failure wrapper (`src/tool-failure.ts`, `src/error-analysis.ts`, `src/errors.ts`), memory injection (`src/memory.ts`, `src/conversation.ts`), and the proactive-mode prompt (`src/deferred-prompts/proactive-llm.ts`). Quotes in this report are verbatim from that audit.
2. **External research.** I pulled guidance from Anthropic's "Building Effective Agents", "Writing tools for agents", "Effective context engineering", and "Effective harnesses for long-running agents"; Claude API prompt-engineering docs; Vercel AI SDK v5/v6 release notes and `streamText` reference; OWASP LLM01 (prompt injection); MCP tool-annotation spec; LangChain/LangGraph HITL patterns; and production write-ups on structured output, error-feedback loops, and model routing. Every recommendation cites at least one source.
   The 2026-06-12 refresh added current Anthropic agent/tool/context guidance, OpenAI reasoning/structured-output/security guidance, MCP tool annotations, OWASP LLM01/cheat-sheet guidance, and papers on CoT, ReAct, self-consistency, planning, reflection, automatic prompt optimization, context engineering, and prompt-injection defense.
3. **Cross-mapping.** For each finding, I identified (a) where in the codebase it lands, (b) which upstream principle it violates or could lean on, and (c) the smallest concrete change that would improve the outcome.

## Top 10 findings at a glance

A full treatment of each is in the linked files. Numbers in parentheses are rough impact estimates — high (H) means it changes user-visible behavior on the majority of turns; medium (M) means it changes behavior on a meaningful minority; low (L) means it is a hardening or cost improvement.

1. **(H) The system prompt is still too prose-heavy.** Some fragments are now gated, but the prompt still lacks explicit XML-like sections for capabilities, context trust, examples, and reply contract. See [02](./02-system-prompt-flaws.md).
2. **(H) Capabilities are partially surfaced but not yet contract-shaped.** Prompt fragments now depend on active tools, and denied/ask-gated tools are listed. papai still lacks a compact `<capabilities>` block explaining active domains, unavailable domains, and fallback behavior. See [02](./02-system-prompt-flaws.md) §"capability-aware slicing".
3. **(H) Tool outputs have no `next_actions` / `hint` field.** Anthropic explicitly recommends tool outputs steer the agent toward the next step; today the model has to infer from raw provider shapes. See [04](./04-tool-output-steering.md).
4. **(M) Error envelopes duplicate information but lack a structured "how to recover" shape.** `agentMessage` is free-form text; a small discriminated union (`recovery: { action: "call_tool"|"ask_user"|"abort", tool?: string, reason: string }`) would make recovery more predictable. See [05](./05-error-handling-recovery.md).
5. **(H) No few-shot examples in the prompt.** Tool-selection and date/recurring parsing are exactly the areas Anthropic and Vercel docs say benefit most from 3–5 canonical examples. See [02](./02-system-prompt-flaws.md) §"few-shot".
6. **(M) Confirmation uses two different shapes** (`status: "confirmation_required"` and confidence-based gating). This works, but the model gets inconsistent signals and the threshold still leaks through tool descriptions. A single `confirmation` envelope would align behavior. See [06](./06-confirmation-safety.md).
7. **(M) Prompt-injection hardening remains incomplete** for tool outputs and external content that echo user-controlled text (task titles, comments, web fetch body, attachment text, memory). OWASP LLM01 and recent research call this out as a leading agent vulnerability. See [06](./06-confirmation-safety.md) §"prompt injection".
8. **(M) Memory trust labels improved; context engineering remains.** Compact and long-term memory are now low-trust XML blocks. Remaining gaps are conflict rules, stale-memory behavior, just-in-time retrieval, and eval coverage. See [07](./07-memory-context.md).
9. **(L) Reply formatting guidance is thin, though platform renderers now help.** Telegram and Discord have output formatters and typing heartbeat exists, but prompt-level reply contracts and platform fixtures remain underdeveloped. See [08](./08-ux-reply-formatting.md).
10. **(L/M) The main loop has an explicit 25-step cap but no `prepareStep` routing.** The same broad tool set stays available across steps. Step-specific active tools, model/effort routing, and stop-on-recovery behavior remain opportunities. See [09](./09-orchestration-routing.md).

## Guiding principles adopted across the report

These are the external principles I use as the yardstick in every file, quoted verbatim from their sources and indexed in [10](./10-references.md).

- **Simplicity, transparency, tool-documentation-as-UX** — Anthropic, _Building Effective Agents_ ([10](./10-references.md) #1).
- **Structured prompts with clear sections using XML or markdown** — Anthropic, _Effective context engineering for AI agents_ ([10](./10-references.md) #2).
- **Return only high-signal information; prefer natural-language identifiers; steer truncation and errors with instructions** — Anthropic, _Writing effective tools for agents_ ([10](./10-references.md) #3).
- **Agents are not always the answer — add multi-step complexity only when simpler solutions fall short** — Anthropic, _Building Effective Agents_ ([10](./10-references.md) #1).
- **Prompt injection is the #1 LLM risk (OWASP LLM01); treat all tool outputs and external fetches as untrusted data** — OWASP GenAI Security Project ([10](./10-references.md) #8).
- **A few well-chosen examples beat paragraphs of rules** — Anthropic, _Claude prompting best practices_ ([10](./10-references.md) #9); Comet, _Few-shot prompting for agentic systems_ ([10](./10-references.md) #10).
- **Route easy/common questions to small models, hard questions to main models** — Anthropic, _Building Effective Agents_ §"Routing" ([10](./10-references.md) #1); MindStudio, _What is an AI model router?_ ([10](./10-references.md) #11).

## How to use this report in practice

- Read [01](./01-current-state-audit.md) once to anchor on what the prompt and tools actually say today.
- Pick a single file from 02–09 based on the symptom you are trying to fix. Each file ends with a numbered list of concrete changes with file paths (e.g. "edit `src/system-prompt.ts:37-82`").
- Treat the changes as a menu, not a plan. Implementing 02 + 04 + 05 together gets you most of the predictability gain; 06 is the security hardening; 07 + 09 are the cost/scale improvements; 08 is polish.

## Non-goals

- This report does **not** propose changing the provider layer or adding new task-tracker features.
- It does **not** evaluate specific model choices (Opus vs Sonnet vs Haiku) — the recommendations are model-agnostic.
- It does **not** replace `docs/research/llm-guidance-research.md`, which covers developer-time conventions for Claude Code / Copilot. That is a different concern from the bot-runtime prompt.
