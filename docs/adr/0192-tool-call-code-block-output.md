<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0192: Tool Call Code Block Output

## Status

Implemented

## Date

2026-06-10

## Context

The AI output visibility feature (ADR-0144) delivered per-context tool-call and
reasoning detail. The reporter (`src/ai-progress-reporter.ts`) accumulated tool
and reasoning entries into a single buffered block, wrapped under "AI execution
details" / "Tool calls" headers, with inline backtick-quoted JSON payloads. The
format had two problems:

1. **Inline backtick formatting broke on multi-line or large JSON.** Platform
   renderers (Telegram, Mattermost, Discord) collapse or truncate inline code
   spans containing newlines, so multi-line tool inputs/outputs lost their
   structure in chat.
2. **A monolithic block per turn.** Grouping every tool call under one header
   produced a single large message that was hard to scan and that platforms with
   message-length limits could split unpredictably across render boundaries.

The 2026-06-10 plan prescribed switching from inline backtick formatting to
fenced ` ```json ` code blocks, emitting each tool call as a separate
`reply.formatted()` message, and removing the "AI execution details" / "Tool
calls" / "Reasoning" wrapper headers. No spec preceded the plan.

## Decision Drivers

- **Readability**: per-tool self-describing messages are easier to scan than one
  monolithic block.
- **Cross-platform rendering**: fenced ` ```json ` blocks render
  multi-line JSON reliably, unlike inline backtick spans.
- **No wrapper headers**: the "AI execution details"/"Tool calls"/"Reasoning"
  wrappers added noise; per-tool messages make them redundant.
- **Sanitization preserved**: the ADR-0144 secret redaction and
  `[circular]`/`[redacted]` markers must survive the format change.
- **Buffered delivery invariant**: visibility is delivered after the final answer
  (ADR-0144), not streamed mid-turn; the change stays within the existing flush.
- **No-output behavior unchanged**: visibility-off and empty-reasoning paths
  must remain silent.

## Considered Options

### Option 1: Keep single block, switch to fenced blocks (rejected)

Replace inline backticks with fenced ` ```json ` blocks but keep one
buffered message per turn.

- **Pros**: minimal churn; one `reply.formatted()` call.
- **Cons**: still a monolithic block; platform message-length limits still force
  unpredictable splits; the "AI execution details" wrapper still adds noise.

### Option 2: Per-tool separate messages with fenced code blocks (chosen)

Store per-tool formatted messages and send each as a separate
`reply.formatted()` call during flush.

- **Pros**: each tool call is self-contained and scannable; fenced blocks render
  multi-line JSON; messages stay under platform length limits.
- **Cons**: more `reply.formatted()` calls per turn; ordering relies on
  sequential sending.

### Option 3: Stream per-tool messages during the turn (rejected)

Emit each tool message live as the tool finishes.

- **Pros**: live visibility.
- **Cons**: breaks the ADR-0144 buffered-delivery invariant (single details block
  after the final answer); intermediate messages are noisy and unreliable across
  platforms and conflict with mid-run steering and the live-status indicator.

## Decision

1. **Per-tool messages.** The reporter stores `toolMessages: string[]` and
   `reasoningMessages: string[]` instead of flat `toolLines`/`reasoningLines`.
   `flush()` concatenates started-tool messages, finished-tool messages, and
   reasoning messages into `allMessages` and sends each via
   `reply.formatted(message)`, sequenced through a promise `reduce` chain to
   preserve order. (The plan specified a `for...of` await loop; the shipped code
   uses `reduce` for the same sequential effect.)

2. **`formatCodeBlock(value, settings)` helper** wraps `formatValue` output in
   ` ```json\n...\n``` ` fences. Used for tool input, output, and raw
   reasoning payloads.

3. **`formatToolFinishedMessage` / `formatToolStartedMessage`** return a complete
   multi-line message string (`Tool \`name\` success in Nms`header, blank line,`Input:`+ fenced block, optional`Output:`/`Error:` sections) instead of
   appending to a shared lines array.

4. **`formatReasoningMessage`** returns `Reasoning\n\n```json\n"<text>"\n``` `;
   raw detail emits the trimmed reasoning text, sanitized detail emits the
   `Provider reasoning available (N characters). Enable raw detail to view.`
   placeholder, both JSON-stringified inside the fence.

5. **Wrapper headers removed.** No "AI execution details", "Tool calls", or
   section headers; each message is self-describing.

6. **Divergence from plan — error redaction.** The plan's
   `formatToolFinishedMessage` wrapped `event.error` in `formatCodeBlock` (value
   sanitization only). The shipped code routes errors through `formatErrorValue`,
   which under non-raw detail redacts `Error`/`string` instances to `[redacted]`
   before fencing. This strengthens error redaction beyond the plan; tests assert
   `[redacted]` for secret-bearing errors.

## Consequences

### Positive

- Per-tool messages render reliably across platforms and stay under length
  limits.
- Fenced ` ```json ` blocks preserve multi-line JSON structure that inline
  backticks collapsed.
- Sanitization (secrets, URLs, attachment content, circular refs) is preserved
  unchanged through `formatValue`/`formatErrorValue`.
- Visibility-off and empty-reasoning no-output paths are unchanged.

### Negative

- More `reply.formatted()` calls per turn (one per tool call plus reasoning)
  increases platform API writes; sequential sending via the `reduce` chain
  serializes them.
- Platforms that coalesce or deduplicate rapid identical messages could
  theoretically collapse repeated identical tool messages (not observed in
  practice).

### Risks

- Sequential `reduce`-chain sending relies on each `reply.formatted()` resolving
  before the next; a slow platform call delays subsequent messages. Mitigated by
  being best-effort within the existing flush path.
- Error redaction via `formatErrorValue` is stricter than the plan: an operator
  expecting raw error bodies under sanitized detail sees `[redacted]` instead,
  matching the ADR-0144 safe-defaults intent.

## Related Decisions

- ADR-0144: AI Output Visibility Controls — the per-context visibility and
  sanitization model and buffered-delivery invariant this format change builds
  on.
- ADR-0102: Behavior Audit Progress Reporting with Structured Events — the
  structured-event reporter pattern (event → formatted text) this reporter follows.
- ADR-0107: Behavior Audit Progress UX Plan — Execution and Architectural
  Divergence — precedent for recording where shipped code diverged from a plan's
  prescriptive steps.

## Implementation Notes

- `src/ai-progress-reporter.ts:116` `formatCodeBlock`; `:121`
  `formatToolFinishedMessage`; `:135` `formatToolStartedMessage`; `:141`
  `formatReasoningMessage`; `:149` `createAiProgressReporter` with
  `toolMessages`/`reasoningMessages` arrays and `reduce`-chain flush at `:180`.
- `tests/ai-progress-reporter.test.ts` asserts ` ```json ` fenced blocks
  per message; the `:358` "sends multiple tool calls as separate messages" test
  asserts `textCalls.toHaveLength(2)` with one fenced block each.
- Error path diverges from the plan: `formatErrorValue` (`:130`) redacts
  `Error`/`string` errors to `[redacted]` under sanitized detail, stronger than
  the plan's `formatCodeBlock(event.error)`.
