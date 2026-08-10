<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Prompt injection defense

## Why

External task-tracker data reaches LLM prompts unsanitized. Two verified
vectors in current code: `src/deferred-prompts/poller-alerts.ts:66`
interpolates third-party-writable task titles/urls into alert summaries fed
to `dispatchExecution`, and `src/memory-context-block.ts:35` interpolates
fact identifier/title into the memory context block. The auth gate limits
who can message the bot, but tracker content is written outside papai's
trust boundary (OWASP LLM01, indirect injection) while the agent wields
destructive task-tracker tools behind an LLM-assessed confidence gate.

## What Changes

- New `src/security/prompt-boundary.ts`: wraps untrusted strings in XML
  delimiters carrying a per-process random token, plus a sanitize helper
  that strips boundary-forging sequences and caps length.
- `poller-alerts.ts`: task titles/urls in `buildAlertSummary` are sanitized
  and wrapped before interpolation.
- `memory-context-block.ts`: fact identifier/title/url fields are sanitized
  and wrapped in the rendered memory context.
- Scheduled/alert prompt execution frames the wrapped block as data, never
  instructions, via a one-line boundary note in the dispatched prompt.
- Tests: `tests/security/prompt-boundary.test.ts` plus regression coverage
  for both call sites.

## Capabilities

### New Capabilities

- `prompt-injection-defense` — boundary marking and sanitization of
  untrusted external data before it enters LLM prompts.

### Modified Capabilities

None. `openspec/specs/` has no entries for the touched surfaces.

## Non-goals

- No wrapping of user chat messages — authorized-users-only self-injection
  is out of the threat model (per the legacy plan's own severity table).
- No security audit logger module and no confirmation-gate logging (Tasks 2
  and 6 of the legacy plan) — deferred; can be proposed separately.
- No regex-based input blocking and no alteration of user message content —
  false positives break legitimate task-management phrasing.
- No feature flag: the defense is always-on.
- No changes to frontmatter parsing or custom-instruction handling.

## Impact

- **Code:** new `src/security/` + `tests/security/`; edits to
  `src/deferred-prompts/poller-alerts.ts`, `src/memory-context-block.ts`.
- **Scope model:** no persisted state; nothing keyed by storage context,
  config context, platform instance, or user id. Behavior identical across
  all platform instances and task instances (including null).
- **Tool gating:** no new tools; `tool_prefs` untouched.
- **DB / dependencies:** none; pino logging only (no content logging).
- **Docs:** `docs/architecture/behaviors.md` security posture note.
- **Legacy:** adopts `docs/superpowers/plans/2025-03-24-prompt-injection-defense.md`
  and `docs/superpowers/remaining/2025-03-24-prompt-injection-defense.md`
  (delete-on-adopt, same commit).
