<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0322: Context-Tools Clarity — Conditional Failure-Case Payload Guidance Instead of System-Prompt Tokens

## Status

Accepted

## Date

2026-08-07

## Context

The four always-on context tools (`get_current_time`, `search_tools`, `load_tool`, `expand_result`) had description and organization gaps that hurt LLM usability:

1. **No recovery guidance on failure.** `search_tools` returned a bare empty `results` array on a miss, and `load_tool` returned unknown names without telling the model what to do next — the LLM had to guess recovery strategies.
2. **Misleading schema serialization.** `expand_result.offset` was an unbounded integer, so the provider received `maximum: 9007199254740991` (`MAX_SAFE_INTEGER`) — noise that bloats and degrades schema quality.
3. **Misnamed constants.** `COMPACTION_PREVIEW_BYTES` and `EXPAND_DEFAULT_LIMIT_BYTES` were fed to string `.slice()` as character limits — they are character counts, not bytes, so the names lied about units.
4. **Conflicting guidance.** `get_current_time`'s description did not acknowledge that every user message already carries an authoritative injected `<current_time>` line, inviting redundant tool calls.

The standing system prompt is a scarce token budget paid on every turn. Adding permanent recovery instructions there to fix rare failure branches would tax the happy path.

Source: spec `docs/superpowers/specs/2026-07-23-context-tools-clarity-design.md`; plan `docs/superpowers/plans/2026-07-23-context-tools-clarity.md`.

## Decision Drivers

- **Zero standing prompt cost.** The always-on system prompt must not grow; guidance has to live where it costs nothing when things go well.
- **Byte-identical happy path.** Existing payload shapes for successful calls must stay unchanged so consumers and tests are unaffected.
- **Descriptions are reworded, never grown.** Token discipline applies to tool descriptions too.
- **Schema quality sent to providers.** Avoid serializing meaningless bounds like `MAX_SAFE_INTEGER`.
- **Naming correctness.** Constants must state the unit they actually measure.

## Considered Options

### Option 1: Conditional payload guidance + reworded descriptions (chosen)

Put `hint`/`warning` strings into result payloads **only** in the failure/empty branch, reword descriptions in place, bound the leaky schema field, rename the misnamed constants.

- **Pros**: Guidance appears exactly when needed; happy-path payloads stay byte-identical; no system-prompt token growth; failure branch is self-teaching.
- **Cons**: Recovery text is duplicated in tool code rather than centrally authored; payloads grow slightly in failure cases only.

### Option 2: Standing system-prompt additions

Add recovery instructions for all four tools to the always-on system prompt.

- **Pros**: Single place to edit guidance; visible even before any failure occurs.
- **Cons**: Pays tokens on every turn for rare failure branches; prompt grows monotonically over time; explicitly ruled out by the spec.

### Option 3: Systemic serializer fix (strip `MAX_SAFE_INTEGER` globally)

Fix the schema serializer once for all unbounded integers instead of bounding `offset` locally.

- **Pros**: Fixes every tool at once.
- **Cons**: Broader blast radius, touches shared serialization; the bounded `.max()` also gives the LLM an actionable limit — a local fix carries semantic value beyond cosmetic cleanup. Deferred as out of scope.

## Decision

Adopt **conditional failure-case payload guidance**:

- `search_tools` returns `hint` (deduped, sorted list of domains in the current discoverable set) only when `results` is empty, and its `limit` description is reworded into an actionable retry policy.
- `load_tool` returns `warning` naming unrecognized tools (pointing back to `search_tools`) only when `unknown` is non-empty.
- `expand_result.offset` gains `.max(EXPAND_MAX_OFFSET_CHARS = 100_000_000)` so schema serialization stops emitting `MAX_SAFE_INTEGER`.
- `get_current_time` is reworded as a fallback to the injected `<current_time>` line; the dead `.describe('No arguments required.')` on its empty input schema is dropped.
- `COMPACTION_PREVIEW_BYTES` → `COMPACTION_PREVIEW_CHARS` and `EXPAND_DEFAULT_LIMIT_BYTES` → `EXPAND_DEFAULT_LIMIT_CHARS` (character counts, not bytes); `COMPACTION_THRESHOLD_BYTES` stays — it correctly gates on `Buffer.byteLength`.

## Rationale

Guidance lives where it costs nothing on the happy path: payloads teach recovery only in the branch that needs it, and descriptions are rewritten within their existing token budget. This preserves the byte-identical happy-path contract while making failure branches self-explanatory, and keeps the standing system prompt untouched.

## Consequences

### Positive

- LLM recovers from empty searches and unknown tool names without extra prompt tokens.
- Provider-facing schemas no longer carry `MAX_SAFE_INTEGER` noise.
- Constant names match their units, preventing future unit-confusion bugs.
- `get_current_time` calls are suppressed when the injected line already answers.

### Negative

- Recovery strings live in tool source; changing guidance requires a code change, not a prompt edit.
- Failure-branch payloads are slightly larger (acceptable — failure is rare and the tokens are earned).

### Risks

- None material; happy-path shapes unchanged, covered by tests asserting `hint`/`warning` presence and absence.

## Implementation Notes

- Files: `src/tools/disclosure/search-tools.ts`, `src/tools/disclosure/load-tool.ts`, `src/tools/compaction/expand-result.ts`, `src/tools/compaction/constants.ts`, `src/tools/compaction/wrap-compaction.ts`, `src/tools/get-current-time.ts` plus companion tests.
- All 25 tests across the five touched test files pass; `bun run lint` and `bun run typecheck` gate the change.

## References

- Spec: `docs/superpowers/specs/2026-07-23-context-tools-clarity-design.md`
- Plan: `docs/superpowers/plans/2026-07-23-context-tools-clarity.md`
