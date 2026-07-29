<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Message-edit analytics (W2 regen + edit windows) — design

**Date:** 2026-07-29
**Status:** Approved (design); implementation not started
**Binding specifications:** [`docs/research/analytics-metrics/02-metric-catalog.md`](../../research/analytics-metrics/02-metric-catalog.md) (amended by this design, appendix A),
[`03-privacy-consent-threat-model.md`](../../research/analytics-metrics/03-privacy-consent-threat-model.md) (no structural change),
[`docs/operations/analytics-runbook.md`](../../operations/analytics-runbook.md)
**Prior decisions:** [`09-stage-a-evidence.md`](../../research/analytics-metrics/09-stage-a-evidence.md) §"Message-edit analytics coverage" (W1 covered via `turn_steered`; W2 deferred to this amendment)

This spec covers analytics coverage for the message-edit feature
(`src/message-edit/`): the edit-window distribution and the W2 regen funnel,
as standalone friction metrics. It does not add turn, session, or outcome
semantics to regen turns (explicit non-goal, see §5).

## Decisions

| Decision | Outcome |
|---|---|
| Primary metric purpose | RQ4 friction only (edit-regen as a friction signal) — no RQ3 outcome semantics |
| Fact coverage breadth | All edit windows (`w1`/`w2`/`w3`), not just the W2 regen path |
| Friction Signature v1 | Untouched — edit metrics are standalone companions (7-component signature unchanged) |
| Vocabulary shape | Two facts: `edit_classified` (window) + `edit_regen` (funnel phase) — orthogonal dimensions |
| Guest handling | Existing eligibility machinery; aggregate-only C0 cells, no new rules |
| Content privacy | No edit content in any fact — window, phase, durationMs, standard envelope only (C3-safe by construction) |
| invocation_mode | `'normal'` (user-initiated chat flow); `'edit'` noted as a reserved future direction |
| Deploy timing | With the Stage C flip or any post-Stage-B-window deploy — never mid-window |
| Backfill | None — edits are not journaled as events; live-only, honestly noted in the catalog |

## 1. Fact vocabulary

Two new registry events. Builders live in a new focused module
`src/analytics/edit-observer.ts` (mirrors `turn-observer.ts`).

### `edit_classified`

Fired once per authorized, content-changed edit in `onIncomingEdit`, after
`classifyEdit` resolves the window.

Props: `{ window: 'w1' | 'w2' | 'w3' }`

Silent paths stay silent (no fact): auth-denied, group-ignored
(`shouldIgnoreGroupMessage`), missing `messageId`, command edit, empty text,
and the same-text no-op (`prior.text === msg.text`). This matches the
established rule that accepted-message analytics begins only after
authorization and real change.

### `edit_regen`

Fired at each executed W2 funnel step.

Props:
`{ phase: 'prompt_shown' | 'prompt_adjust' | 'prompt_note' | 'regen_started' | 'regen_completed' | 'regen_failed' | 'history_only', durationMs?: number }`

- `durationMs` is present only on `regen_completed` / `regen_failed`
  (regen-start → settle clock, monotonic, `Math.max(0, Math.round(...))`).
- `history_only` covers both no-buttons-platform and missing-`processMessage`
  skips; the two are distinguishable via the envelope's platform dimension.
- No `prompt_expired` phase: pending edit prompts are in-memory until consumed
  (`edit-prompt-store.ts` has no TTL); a never-clicked prompt simply never
  emits past `prompt_shown`.
- Facts mirror the path actually taken, never the intended one:
  `regen_started` is emitted only immediately before a real `processMessage`
  call, and `regen_failed` is observed in a catch-then-rethrow.

## 2. Emission points

| File | Facts |
|---|---|
| `src/message-edit/handle.ts` (`onIncomingEdit`) | `edit_classified` for w1/w2/w3 after `classifyEdit`; `edit_regen{history_only}` when W2 lacks `processMessage` |
| `src/message-edit/w2-regen.ts` (`handleW2WithSideEffects`) | `edit_regen{prompt_shown}` after the button prompt posts; `edit_regen{history_only}` when the platform has no buttons |
| `src/message-edit/w2-regen.ts` (`buildEditPromptHandlers`) | `edit_regen{prompt_adjust}` in `onAdjust`; `edit_regen{prompt_note}` in `onNote` |
| `src/message-edit/w2-regen.ts` (`regenerateFromEditedText`) | `edit_regen{regen_started}` immediately before `processMessage`; `edit_regen{regen_completed, durationMs}` after; `edit_regen{regen_failed, durationMs}` on catch-then-rethrow |

The observer is non-throwing by runtime contract; emitters never await
analytics. W1 keeps its existing `turn_steered` fact (commit 1acd7319a) —
`edit_classified{window:'w1'}` additionally records the classification, so the
window distribution is complete without conflating the two event types.

## 3. Registration, eligibility, aggregation

- Contracts: strict props schemas added to the per-event props union
  (`contracts.ts`), both events registered in `registry-events.ts` with
  privacy class, aggregate mapping, source family (`chat`), and RQ4 coverage.
- Envelope: standard source context via `buildAnalyticsSourceContext(msg,
  auth, 'normal', null)`; guests produce guest-role sources.
- Eligibility: no new rules — the existing consent/eligibility matrix decides;
  guests and ineligible actors contribute aggregate-only C0 cells.
- Aggregate mapping (closed daily counters): `edit_classified` by window (3
  counters), `edit_regen` by phase (7 counters). Guests included
  (aggregate-only is still counted).
- Metabase: one edit-funnel card added to model
  `04-reliability-friction-performance.sql` with the standard honesty block
  (denominator suppression below 30, Wilson bounds, censored/unknown counts);
  `tests/analytics/metabase-models.test.ts` updated.

## 4. Privacy contract impact

No structural change to `03-privacy-consent-threat-model.md`. The facts carry
no message content, no edit content, no prior/regen text — only closed enums
and a duration. Registry-append is automatically covered by the executable
controls: strict-schema fuzz (control 2), C3 canary scans over normalized JSON
(control 3), consent matrix (control 7), and the synthetic captured-egress
sweep.

## 5. Non-goals (written into the catalog amendment)

- No `turn_started`/`turn_completed`/`chat_message_accepted` for regen turns.
- No supersede retraction: the original turn's outcome is not modified; no new
  terminal state, no censoring rule.
- Sessions, sessionizer fixtures, and outcome materializations unchanged.
- Friction Signature v1 unchanged (no 8th component).
- Reserved direction: a future RQ3 amendment may add `invocation_mode: 'edit'`
  plus regen turn semantics; this amendment reserves the concept without
  spending the enum value.

## 6. Error handling

- `regen_failed` is observed before the error is rethrown; the W2 user-facing
  behavior is unchanged.
- Prompt-post failure already degrades to history-only behavior; the
  `history_only` fact reflects the executed path.
- Analytics emission is fire-and-forget inside the non-throwing observer; a
  failure inside the runtime is contained there (bounded queues, rejection
  accounting) and never alters the edit flow.

## 7. Testing

- Registry-driven suites cover the two new events automatically: contracts,
  registry-closure, strict-schema fuzz, C3 canary scans, eligibility matrix,
  privacy-contract sweep.
- `tests/message-edit/handle.test.ts`: `edit_classified` per window (w1, w2,
  w3); silent-path proofs (same-text no-op, auth-denied, command edit → no
  facts); `history_only` on missing `processMessage`.
- `tests/message-edit/w2-regen*.test.ts`: full funnel (prompt_shown →
  prompt_adjust → regen_started → regen_completed with durationMs), note path,
  failure path (`regen_failed` + throw preserved), no-buttons `history_only`.
- Guest edit (guest mode, guest-role source) → aggregate-only counters, zero
  canonical rows.
- Aggregate mapping: C0 cells per window/phase for member + guest.

## 8. Rollout

- Implementation lands on the analytics branch; deploy with the Stage C flip
  or any post-Stage-B-window deploy (restart-gap and definition-stability
  rules).
- Live-only: no backfill source exists (edits are not journaled as events);
  the catalog amendment records this honestly.
- Evidence: gate results appended to `09-stage-a-evidence.md`; the W2 row in
  the coverage-decisions table is updated from "v1 exclusion" to "covered via
  amendment" at implementation time.

## Appendix A — proposed 02-metric-catalog amendment text

> ### Edit handling metrics (standalone friction companions)
>
> **`edit_classified`** — one per authorized, content-changed edit, after
> window classification. Props: `window` (`w1` active-run steer, `w2` last-turn
> regen, `w3` baseline-only). Silent paths (unauthorized, group-ignored,
> command, empty, same-text) emit nothing.
>
> **`edit_regen`** — one per executed W2 funnel step. Props: `phase`
> (`prompt_shown`, `prompt_adjust`, `prompt_note`, `regen_started`,
> `regen_completed`, `regen_failed`, `history_only`) and optional `durationMs`
> (regen start→settle, completed/failed only). `history_only` covers
> no-buttons platforms and unwired `processMessage`; distinguish via the
> platform dimension.
>
> Both events are RQ4 friction companions. They carry no message or edit
> content. They do not create turn, session, or outcome semantics: regen turns
> are invisible to turn/session/outcome materializations, the original turn is
> never retracted or marked superseded, and Friction Signature v1 is unchanged.
> Guests contribute aggregate-only counters. Events are live-only; no backfill
> source exists.
>
> Metrics: edit rate per eligible actor-day, window distribution, regen funnel
> conversion (prompt_shown → adjust → completed), regen failure rate, regen
> duration percentiles. All with the standard honesty block.
