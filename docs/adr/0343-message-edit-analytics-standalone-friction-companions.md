<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0343: Message-Edit Analytics — Standalone C0 Friction Companions over Turn/Semantics Coupling

## Status

Accepted

## Date

2026-08-08

## Context

ADR-0340 shipped message-edit handling (W1 steer / W2 regen-or-ask / W3 silent), but the analytics pipeline had no visibility into the new flow: the edit-window distribution (how often each policy branch fires) and the W2 regen funnel (prompt shown → adjust/note → regen started/completed/failed, plus the history-only fallbacks) were unmeasured friction blind spots. The design is in `docs/superpowers/specs/2026-07-29-message-edit-analytics-design.md`; the implementation plan is `docs/superpowers/plans/2026-07-29-message-edit-analytics.md`.

The analytics platform already had a staged, governance-gated pipeline: source-fact builders → non-throwing observer → fail-closed normalizer → C0 daily aggregate counters → curated snapshot props → Metabase models, with registry-driven closure/privacy/eligibility sweeps that automatically cover any newly registered event.

The hard scoping question was semantic: a W2 regen is a new agent turn triggered by an edit. Giving it full turn/session/outcome semantics would entangle edit analytics with the turn-level vocabulary (invocation modes, session attribution, outcome recording) that was explicitly not yet designed.

## Decision Drivers

- **Reuse the established pipeline.** Fact builders, normalizer, aggregate counters, snapshot props, and registry sweeps already exist; the feature should register into them rather than build a parallel measurement path.
- **C0-safe by construction.** No edit content may appear in any fact — only window, phase, durationMs, and the standard envelope. Facts must pass the privacy-contract and eligibility sweeps unchanged.
- **Facts mirror the path actually taken.** `regen_started` is emitted only immediately before a real `processMessage` call; `regen_failed` is observed before the rethrow. Silent paths (auth-denied, group-ignored, missing messageId, command edit, empty text, same-text no-op) stay silent.
- **Scope discipline.** No turn/session/outcome semantics for regen turns — explicitly reserved for a future RQ3 catalog amendment rather than silently defined in code.
- **Honest funnels.** The history-only fallbacks (no `processMessage` wired, platform without buttons) are first-class funnel exits, not dropped events.

## Considered Options

### Option 1 — Standalone `edit` source family with two C0 events (chosen)

Register `edit_classified` (one per authorized, content-changed edit, carrying `window: w1|w2|w3`) and `edit_regen` (carrying a seven-phase funnel enum plus optional `durationMs`) as a new `edit` source family. They flow through the standard pipeline into 10 closed daily counters (`edit_classified_w1|w2|w3`, `edit_prompt_shown|adjust|note`, `edit_regen_started|completed|failed`, `edit_history_only`), gain curated snapshot props (`prop_window`, `prop_phase`), and surface as one `edit_funnel` UNION ALL card in Metabase model 04.

- **Pros:** zero new infrastructure — registry-driven sweeps (contracts, closure, privacy, eligibility, snapshot props/schema) cover the events automatically; C0 counters exist in both snapshot modes; funnel exits are enumerable and fail-closed (unknown window/phase → `unknown_enum` rejection, out-of-schema props increment nothing); catalog amendment (§14.1) keeps governance honest.
- **Cons:** edit metrics are detached from turn metrics — cross-referencing a regen with its turn's outcome requires the future RQ3 amendment; 10 new counter names and 2 snapshot columns enlarge the controlled vocabulary.

### Option 2 — Full turn/session/outcome semantics for regen turns

Model the W2 regen as a first-class turn with an `'edit'` invocation mode, session attribution, and outcome recording.

- **Pros:** regen turns join cleanly with the existing turn metrics; no special funnel vocabulary needed.
- **Cons:** requires designing and governing new turn-level vocabulary that nobody had specified — a large semantic commitment smuggled in via a metrics feature. Rejected as premature; recorded as an explicit non-goal with a follow-up amendment path.

### Option 3 — Piggyback on existing turn/message events

Attach edit metadata (window, regen outcome) as extra props on the turn facts the regen already produces.

- **Pros:** no new event names or counters.
- **Cons:** W1 and W3 edits produce no turn at all (steer note, silent correction) — their classification would be invisible; pollutes turn props with edit-only concerns; violates the established one-fact-per-observation registry pattern. Rejected.

## Decision

Option 1 shipped:

1. **Registration** (`src/analytics/`): `edit_classified`/`edit_regen` added to `EventNameV1Schema`, strict props schemas in `event-props-common.ts`, `EditClassifiedFact`/`EditRegenFact` boundary types, `'edit'` source family in `registry.ts`, two metadata entries in `registry-events.ts` (privacy class C0, RQ4 coverage), fail-closed builder cases in `normalizer-props-derived.ts`, `editIncrements` wiring in `aggregate-increments.ts`, and `textProp('window')`/`textProp('phase')` in `jobs/snapshot-props.ts`.
2. **Emission** (`src/analytics/edit-observer.ts`, `src/message-edit/`): `buildEditSeed` + `observeEditClassified`/`observeEditRegen` helpers; `handle.ts` emits `edit_classified` immediately after `classifyEdit` and `history_only` on the missing-`processMessage` W2 branch; `w2-regen.ts` emits `regen_started` immediately before `processMessage`, `regen_completed`/`regen_failed` with monotonic-clock `durationMs`, `prompt_shown`/`prompt_adjust`/`prompt_note` around the ask-first buttons, and `history_only` on the no-buttons fallback.
3. **Reporting**: `edit_funnel` card in `analytics/metabase/sql/04-reliability-friction-performance.sql` summing the 10 counters per UTC day; catalog §14.1 ("Edit handling metrics — standalone friction companions") plus registry props-table rows in `02-metric-catalog.md`; Stage A evidence rows with implementation commits in `09-stage-a-evidence.md`.

## Consequences

### Positive

- The edit-window distribution and W2 regen funnel are measurable as standalone friction metrics with zero bespoke measurement infrastructure — the registry sweeps validate the new events automatically.
- Privacy posture is unchanged: facts carry only window/phase/duration, pass privacy-contract canaries, and aggregate into closed C0 counters present in both snapshot modes.
- Funnel honesty: history-only exits (unwired `processMessage`, buttonless platforms) are counted, and `regen_failed` is recorded before the error rethrows, so failures can never masquerade as silent success.
- The semantics boundary is explicit in the catalog (§14.1) and evidence docs, giving the future RQ3 turn-semantics amendment a clean, governed entry point.

### Negative

- Edit metrics cannot yet be joined to turn outcomes — that analysis is blocked until the RQ3 amendment lands.
- The controlled vocabulary grew (2 events, 10 counters, 2 snapshot props) for a feature with no production volume yet; the Stage A→B gates must confirm the events actually fire in practice.

### Risks

- `buildEditSeed` builds a seed at each emission point (classification, prompt outcome, each button callback); a drift in seed construction between points could fragment funnel attribution. Mitigation: all emissions share the same `buildEditSeed` helper and `sourceEventId` suffix convention (`:edit_classified`, `:edit_regen_<phase>`).
- Counter-name drift across the four registration sites (controlled types, registry, aggregate, SQL `IN` list) would silently zero a funnel stage. Mitigation: registry-closure and metabase-model tests pin the names end-to-end.

## Related Decisions

- ADR-0340: Message Edit Handling — defines the W1/W2/W3 windows and the W2 regen/ask-first flow this ADR instruments.
- ADR-0326: Content-Free Analytics Pipeline Staged Rollout — the staged pipeline and governance model the edit events register into.
- ADR-0341: Analytics Stage B Readiness — the fail-closed delivery gates whose evidence doc records this feature's gate evidence.

## References

- Spec: `docs/superpowers/specs/2026-07-29-message-edit-analytics-design.md`
- Plan: `docs/superpowers/plans/2026-07-29-message-edit-analytics.md`
- Catalog amendment: `docs/research/analytics-metrics/02-metric-catalog.md` §14.1
- Evidence: `docs/research/analytics-metrics/09-stage-a-evidence.md` (commits `369473878`, `ea232ac6b`, `2c8890af4`, `0e69a9177`, `35b0fb2ee`)
- Implementation: `src/analytics/edit-observer.ts`, `src/message-edit/handle.ts`, `src/message-edit/w2-regen.ts`, `analytics/metabase/sql/04-reliability-friction-performance.sql`
