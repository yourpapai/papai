<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0061: /context Command Redesign

## Status

Accepted

## Date

2026-04-11

## Context

The existing `/context` command exports the full LLM context window as a file attachment, available only to admin users. This has several shortcomings:

1. **Admin-only restriction** prevents regular authorized users from understanding what the bot sees
2. **File download** is a poor UX for a quick diagnostic — users must download and open a file to inspect context usage
3. **No visual summary** — the raw text dump does not convey token utilization at a glance
4. **No model awareness** — the output does not show context window limits or how much capacity remains

The project supports three chat platforms (Telegram, Mattermost, Discord), each with different rendering capabilities. A one-size-fits-all file export ignores these capabilities.

## Decision Drivers

- All authorized users (not just admins) should be able to inspect context usage
- Output must be inline (no file download) for quick scanning
- Must show all four context sources: system prompt, memory, conversation history, tools
- Must provide accurate token counts via real tokenization (not character-based estimation)
- Must show context window utilization against known model limits
- Must render platform-adaptively (monospace, embed, markdown table)
- Must handle unknown models gracefully (no crash, degraded display)

## Considered Options

### Option 1: Keep file export, widen access

- **Pros:** Minimal code change, already works, contains full detail
- **Cons:** Poor UX, no visual summary, ignores platform capabilities, requires downloading a file on mobile

### Option 2: Inline text-only summary for all platforms

- **Pros:** Simple, one renderer to maintain
- **Cons:** Misses Discord embed capabilities, plain text tables render poorly in Telegram/Mattermost

### Option 3: Platform-adaptive visual display with shared grid builder

- **Pros:** Best UX per platform, proportional emoji grid gives instant visual feedback, DI-driven collector is testable, each renderer is small and focused
- **Cons:** More files to create, new dependency (`ai-tokenizer`), new `ChatProvider` interface method

## Decision

We will use **Option 3**: replace the admin-only file export with a visual context window display available to all authorized users, using platform-native rendering.

The architecture introduces:

- **`ContextCollector`** — platform-agnostic core that assembles a `ContextSnapshot` from live context (system prompt, memory, history, tools), tokenizes each section via `ai-tokenizer`, and resolves `maxTokens` from the model name. DI-driven for testability.
- **`context-grid.ts`** — shared 20-column emoji grid builder that produces a proportional visualization from any `ContextSnapshot`
- **Per-platform renderers** — `renderContext(snapshot)` method on each `ChatProvider` producing platform-native output:
  - **Telegram:** `{ method: 'text' }` — inline emoji grid + monospace code block detail
  - **Discord:** `{ method: 'embed' }` — discord.js embed with color-coded utilization (green/yellow/red)
  - **Mattermost:** `{ method: 'formatted' }` — emoji grid + markdown table
- **`ReplyFn.embed`** — optional method for structured embeds (Discord only today)
- **`ContextRendered`** discriminated union\*\* — handler dispatches to `reply.text`, `reply.formatted`, or `reply.embed` based on the method

New dependency: `ai-tokenizer` (pure JS, no WASM, >=97% accuracy for major models).

## Rationale

The emoji grid provides instant visual feedback — a user can see at a glance how much of their context window is consumed and by what category. The 20x10 grid (200 cells) gives sufficient resolution for proportional display while fitting on one screen.

Platform-native rendering leverages each platform's strengths: Discord embeds show structured fields with color coding, Mattermost markdown tables align columns naturally, and Telegram monospace blocks keep fixed-width detail legible.

The DI-driven collector design means the entire tokenization pipeline is testable with deterministic stubs — no network, no WASM, no flaky encoding loads in unit tests. The `makeSafeCounter` wrapper falls back to `chars/4` estimation if the tokenizer throws, so the command degrades gracefully rather than crashing.

Encoding selection (`o200k_base` for GPT-4o/GPT-4.1/o-series, `cl100k_base` fallback) covers the vast majority of models users configure. The prefix-matching `MODEL_CONTEXT_WINDOWS` map handles model variants (e.g., `gpt-4o-2024-08-06` matches `gpt-4o` → 128,000 tokens).

## Consequences

### Positive

- All authorized users can inspect context usage, not just admins
- Inline display eliminates the file-download friction
- Proportional emoji grid gives instant visual comprehension of context utilization
- Per-platform rendering uses each platform's native capabilities
- Token counts are accurate (real BPE tokenization via `ai-tokenizer`)
- Graceful degradation when tokenizer fails or model is unknown
- Fully testable via DI (collector, grid, each renderer)

### Negative

- New runtime dependency (`ai-tokenizer`, 2-8MB lazy-loaded encoding data)
- New `ChatProvider` interface method (`renderContext`) — all providers must implement it
- New `ReplyFn` optional method (`embed`) — only Discord implements it today
- More source files to maintain (collector, grid, three renderers, test files)
- Token counts are approximate for the system prompt section because BPE tokenization is not strictly additive across composed strings

### Risks

- `ai-tokenizer` API may differ from documented shape — mitigated by Task 1 smoke test and Task 6 contingency instructions
- Emoji grid may render inconsistently across mobile clients — mitigated by using inherently-colored square emojis that render natively on all platforms
- Context window map requires manual updates as new models ship — mitigated by prefix matching and `null` fallback for unknown models

## Implementation Notes

- `registerContextCommand(chat, deps?)` replaces `registerContextCommand(chat, adminUserId)` — the `adminUserId` parameter is removed
- The `ContextSnapshot.approximate` flag triggers a footnote when true
- Discord embed color thresholds: green (<50%), yellow (50-80%), red (>80%)
- Grid: 20 columns × 10 rows when `maxTokens` is known; single 20-cell row when unknown
- Minimum 1 cell per non-empty category (nothing disappears at small percentages)
- Tokenizer is lazy-loaded on first use and cached in module scope

## Related Decisions

- ADR-0014: Multi-Chat Provider Abstraction — established the `ChatProvider` pattern this builds on
- ADR-0058: Provider Capability Architecture — capability-gated tool definitions feed the Tools section token count
- ADR-0051: Discord Chat Provider — Discord adapter that receives the embed renderer
