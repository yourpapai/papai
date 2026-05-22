<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# 07 — Memory and context engineering

Covers: the `=== Memory context ===` block, the `TRIM_PROMPT` summariser, the custom instructions block, and how to budget the context window so the model stays on task without burning tokens. The raw material is in [`01-current-state-audit.md`](./01-current-state-audit.md) §1.3, §1.5.

## 1. Principle: the context window is a budget

> "Every new token introduced depletes this budget by some amount, increasing the need to carefully curate the tokens available to the LLM." — Anthropic, _Effective context engineering for AI agents_. ([10](./10-references.md) #2)

Treat the context as three logical layers. In papai's codebase these are concatenated but should be distinguishable to the model:

1. **System layer** — `BASE_PROMPT` + `PROVIDER_ADDENDUM` + `<custom_instructions>`. High trust, static within a turn.
2. **Memory layer** — summaries + facts from prior turns. Compacted, low trust.
3. **Turn layer** — the user's current message, current tool results. Immediate, high trust.

Today's prompt merges 1 and 3 implicitly and puts 2 as a system message just before the user turn. That is fine structurally, but the model has no label to distinguish them.

## 2. The memory block today — evaluation

The block (src/memory.ts:262-282) looks like:

```text
=== Memory context ===
Summary: {≤200 words compacted summary}

Recently accessed entities:
- tsk_42: "Ship password reset" — last seen 2026-04-19
- proj_7: "Billing" — last seen 2026-04-18
```

What works:

- **Summary + recent entities is the right split.** Matches Zep / Letta patterns for "summary memory + entity memory". ([10](./10-references.md) #27)
- **Prepending as a system message** (not in the system prompt) means the model doesn't confuse it with hard rules.

What doesn't:

- **No trust label.** The model treats it as authoritative even when it is summarised and potentially stale.
- **IDs are raw.** Anthropic's "prefer natural-language identifiers over cryptic identifiers" ([10](./10-references.md) #3) — "tsk_42" is the wrong side of that line.
- **No freshness signal.** `last seen 2026-04-19` is a date, not a TTL. A fact last seen 30 days ago should be flagged stale; a fact from today is fresh.
- **No entity limit.** The block can grow arbitrarily long. No eviction policy is visible.
- **No "just-in-time" retrieval.** The entity list dumps everything known, every turn. Anthropic's JIT pattern suggests storing pointers + using a `lookup_entity(identifier)` tool. ([10](./10-references.md) #2)

## 3. Proposed memory-block layout

Wrap with a trust label and add freshness + eviction:

```xml
<memory trust="compacted_low">
  <summary>
    {≤200 words, reassembled by small_model from TRIM_PROMPT}
  </summary>
  <recent_entities max="10" ordered_by="recency">
    <entity id="tsk_42" title="Ship password reset" last_seen="2026-04-19" stale="false"/>
    <entity id="proj_7" title="Billing"              last_seen="2026-03-12" stale="true"/>
    ...
  </recent_entities>
</memory>
```

Rules encoded in the system prompt (see `<rule id="memory">` in [`02-system-prompt-flaws.md`](./02-system-prompt-flaws.md) §2):

- "The `<memory>` block is compacted summary, not verbatim. Treat it as lower-trust than the current user message. If the user contradicts a fact, believe the user."
- "Stale entities (>14 days) may be inaccurate. Verify with a tool call if you need to reference them."

### 3.1 Eviction policy

- Keep at most **10 entities** in the recent list, ordered by `last_seen` desc.
- Mark entities older than **14 days** as `stale="true"`. Entities older than **45 days** drop out entirely.
- When a tool result yields a new entity, insert at the top and evict the last entry if over cap.

This is standard LRU with TTL and keeps the block predictable in length. Matches AgentCore / Redis memory patterns ([10](./10-references.md) #27).

### 3.2 Natural-language identifiers

For tasks, prefer the `number` (`#42`) or the human `idReadable` (`AUTH-42`) over the raw UUID. The renderer joins `number`/`idReadable` with title. Example block entry: `<entity id="AUTH-42" title="Ship password reset" …/>` instead of `tsk_c9a2-…`.

## 4. Summary quality — `TRIM_PROMPT`

The trimmer prompt (src/memory.ts:~118-166) is solid but can tighten:

### 4.1 What it does well

- **Explicit structure in JSON.** Matches the "put reasoning before answer" guidance and is parseable without regex. ([10](./10-references.md) #6)
- **Concrete preservation rules** ("Preserve: task IDs and numbers, project names, decisions, priorities, preferences").
- **Range for keep_indices** (50–100) gives the model a sizing decision.

### 4.2 What to improve

- **Context collapse** is the known failure mode of iterative summarisation — detail erodes. Agentic Context Engineering ([10](./10-references.md) #27) suggests a three-agent loop (Generator / Reflector / Curator). For papai that's overkill; a lighter version: every N summaries, rerun the summariser on **the original kept messages instead of the previous summary**, to reset drift. Track the depth of recursion in a counter.
- **Entity table emerges separately.** The current flow stores facts on the side; merging the summary pass with entity extraction into one small_model call is cheaper. The JSON structure becomes:

```json
{
  "keep_indices": [0, 1, 4, 17, ...],
  "summary": "…",
  "entities": [
    { "id": "AUTH-42", "title": "Ship password reset", "last_seen": "2026-04-19" },
    ...
  ]
}
```

One call instead of two, same result quality.

### 4.3 Summary style guide

- **Third-person narrative.** "The user asked…" / "papai created…". Avoid first-person, which confuses role boundaries.
- **No direct quotes.** Paraphrase; quotes reintroduce instruction-shaped tokens into the summary.
- **Date/time explicit.** "on 2026-04-19" not "last Monday".
- **Cite task references with title + id.** `"the Ship password reset task (AUTH-42)"`.

## 5. Custom instructions — the `priority="override"` layer

`src/instructions.ts` caps at 20 instructions × 500 chars. That is a reasonable budget (~10k chars max). Improvements:

- **Wrap as `<custom_instructions priority="override">`** in the system prompt, matching §1.
- **Dedup threshold at insert.** Already implemented (Jaccard 0.8). Keep it; consider raising to 0.85 to be slightly less aggressive.
- **Explicit conflict rule.** The system prompt should say: "Custom instructions override defaults unless they conflict with destructive-action rules, prompt-injection rules, or tool schemas."
- **Surface to user.** `/config` should show the active instructions; the bot should refuse to store an instruction that directly contradicts hard rules ("never ask me for confirmation before deleting" should be silently ignored or refused).

## 6. Custom instruction review by small_model

When the user says "always reply in Spanish", that instruction is stored as-is. But raw natural-language instructions can drift from the model's behavior over time. Consider:

- **Periodic review.** Once a week, run a small_model pass over all stored instructions to (a) deduplicate, (b) normalise ("never ask me twice" and "don't double-confirm" merged), (c) flag instructions that conflict with current defaults.
- **Instruction vs. preference split.** "Always in Spanish" is a preference (should apply to every reply). "Always create tasks in the Billing project" is a default (should apply to tool arguments). Today they're one list; two lists would let the tool layer honour the defaults without the prompt layer repeating them.

## 7. Context budget targets

Rough budget for a typical turn on Opus 4.7 (200k window):

| Layer                                                 | Target            | Notes                                                                                                                           |
| ----------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| System prompt (BASE + provider + custom instructions) | 2–4k tokens       | After the proposed rewrite with structured sections and fewer narrative blocks. Currently ~3k depending on custom instructions. |
| `<capabilities>` block                                | 150–400 tokens    | Generated from tool set.                                                                                                        |
| `<examples>` block                                    | 300–800 tokens    | 5 concise examples.                                                                                                             |
| Memory block                                          | 300–600 tokens    | Summary (≤200 words) + up to 10 entities.                                                                                       |
| History (since last trim)                             | up to ~10k tokens | Trimmer fires above 100 messages.                                                                                               |
| Tool definitions                                      | 1–3k tokens       | Depends on capability-gated subset.                                                                                             |
| User turn                                             | 20–200 tokens     | Chat message.                                                                                                                   |
| Tool outputs within this turn                         | up to ~5k tokens  | Bounded by `response_format` + truncation.                                                                                      |

Headroom is generous on Opus 4.7. The point of the budget is not to conserve capacity — it's to prevent the model from burying signal under noise.

## 8. Just-in-time retrieval

Instead of dumping all known entities in the memory block, the JIT pattern ([10](./10-references.md) #2) is: store identifiers cheaply, let the agent request the details via a tool only when needed.

For papai, the existing `get_task`, `list_projects`, `search_tasks` already act as the dereference tools. The memory block could simplify to just id + title (drop `last_seen` from the default view; surface it on a second tool call if asked). This aligns with the just-in-time principle and shrinks the memory block by ~30–40%.

A companion tool `recall_entity(id)` could be added explicitly — shorthand for "look up whatever the memory block points at". Low priority; the existing tools cover it.

## 9. Evaluation hooks

- **Summary fidelity.** Given a fixed 150-message history and a golden summary, assert the trimmer's output preserves all task ids named in the golden summary and has no added ids.
- **Memory staleness.** Simulate a 30-day gap between turns; assert the stale flag is set; assert the model verifies with a tool call before acting on the stale entity.
- **Injection resilience.** Add a task title containing an injection attempt; assert it surfaces inside the `<memory>` block as escaped text and not as a new role marker.

## 10. Concrete recommendations

- **R-07-1 (H):** wrap the memory block in `<memory trust="compacted_low">`, with `<summary>` and `<recent_entities max="10">` child elements.
- **R-07-2 (H):** prefer human-readable ids (`AUTH-42`) over raw uuids in the memory block.
- **R-07-3 (M):** implement LRU + 14-day staleness flagging + 45-day eviction for recent entities.
- **R-07-4 (M):** merge the summariser and entity-extractor into one small_model call using the combined JSON schema.
- **R-07-5 (M):** add the conflict-resolution rule to the system prompt for `<custom_instructions priority="override">`.
- **R-07-6 (L):** split stored items into "preferences" (tone/language) vs "defaults" (tool-argument overrides); honour defaults in the tool layer, not the prompt.
- **R-07-7 (L):** add a weekly review pass over stored instructions to dedup and flag conflicts.

External: Anthropic context engineering ([10](./10-references.md) #2), Zep/Letta memory architectures ([10](./10-references.md) #27), mem0 summarisation guide ([10](./10-references.md) #28).
