<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0169: Backstage Kit Additions (Phase 1)

## Status

Implemented

## Date

2026-06-01

## Context

The operator UIs (`/admin`, `/debug`, `/settings`) had drifted from the "Telemetry" design canvas that defines the project's visual system. A design audit (`bs-audit.jsx`, recorded as React prototypes in the design tool — not shipped code) logged 18 findings against the live `/admin` page: three divergent local `formatBytes` copies (two on base-1000), plain-text status rendering, raw `JSON.stringify` dumped into `<td>`, bare `<button>`/`<input>` elements, duplicated section titles (eyebrow plus `<h2>`), and block-stacked `<dl>` key/value lists. The audit's companion (`bs-kit-additions.jsx`) cataloged 13 missing design-system components and two number-formatting helpers that the live page hand-rolled — and broke.

The shared Svelte kit (`client/shared/ui/`) and CSS tokens (`client/shared/tokens.css`) already matched the prototype tokens, but the kit was missing the 13 primitives the audit required. This ADR covers **Phase 1** of the three-phase remediation: a kit-first layer that ports the helpers and components into the shared kit with Storybook stories and happy-dom tests, with **zero consumer changes**. All surface refactors (audit findings A1, A4, A7, B1–B7, C2 and the regression guards) and the `formatBytes` consolidation onto `fmtBytes` are explicitly deferred to Phases 2–3, where the section files are read in full.

## Decision Drivers

- **Faithful port:** each prototype component must ship as its own Svelte component matching the prototype API 1:1, so Phase 2/3 adoption is mechanical (spec decision #2).
- **Svelte 5 idiom:** `$props()` runes, scoped `<style>` consuming only existing CSS-variable tokens (no new tokens), BSL header — not the prototypes' inline-style React.
- **TDD write-hook:** the repo's Red→Green hook requires a passing test before implementation files write; every component needs a happy-dom test mirroring the source path under `tests/client/`.
- **Bundle isolation:** `client/stories/**` and `*.stories.svelte` must never leak into the production debug/admin/settings bundles (`bun check:bundle-isolation`).
- **Zero consumer changes in Phase 1:** no existing file is refactored; the primitives land first, then surfaces adopt.
- **Strict TypeScript, no escape hatches:** no `lint-disable`/`ts-ignore` (hook policy blocks them); `max-lines` is a design signal, not a ceiling to game.

## Considered Options

### Option 1: Port faithfully as own Svelte components (chosen)

Each prototype component ships as its own `client/shared/ui/<Name>.svelte` matching the prototype props/behavior 1:1, with a `.stories.svelte` and a `.test.ts`.

- **Pros:** Phase 2/3 adoption is mechanical; honors spec decision #2; no behavior risk from reusing near-equivalents; each primitive is independently testable and documented.
- **Cons:** deliberate overlap with existing primitives (`Stat`↔`MetricCard`, `SummaryList`↔`KV`, `StatusPill` wraps `Pill`) is documented, not eliminated — two ways to do similar things until a future consolidation; more files to maintain.

### Option 2: Reuse existing near-equivalents

Route the audit fixes through the existing `MetricCard`, `KV`, and `Pill` instead of adding `Stat`, `SummaryList`, `StatusPill`.

- **Pros:** fewer files; less overlap to explain.
- **Cons:** breaks the faithful-port decision; prototype APIs differ (e.g. `Stat` warn-on-over, `SummaryList` `pill`+`vColor`, `StatusPill` status-string→tone mapping), forcing wrappers and prop-mapping anyway; Phase 2/3 adoption becomes non-mechanical and risks subtly changing rendered output.

### Option 3: Do nothing / defer the kit

Ship no Phase 1; attempt audit fixes inline in each section.

- **Pros:** no Phase 1 churn.
- **Cons:** Phase 2 refactors cannot proceed (they depend on the primitives); the 18 findings stay broken; the three divergent `formatBytes` copies keep diverging; status rendering stays ad hoc per section.

## Decision

Sixteen tasks, executed in strict dependency order:

1. **Helpers** — add `fmtNum(n, dp=2)` and `fmtBytes(b)` to `client/shared/helpers.ts`. `fmtNum` rounds to ≤`dp` decimals with `en-US` thousands separators, returns `'—'` for null/undefined/empty/non-finite, and passes non-empty strings through unchanged. `fmtBytes` humanizes on **base-1024** (B/KB/MB/GB/TB), returning `'—'` for null/undefined.
2. **Tone mapping** — add `client/shared/ui/status-tone.ts` exporting the `StatusTone` union (`accent|warn|danger|info|neutral|mute`) and `statusTone(status)`, a case-insensitive lookup with `neutral` fallback.
   3–15. **Thirteen components** in `client/shared/ui/`: `StatusPill` (wraps `Pill` + `statusTone`, optional dot suppressed for neutral/mute), `PageHeader` (eyebrow+title+sub+action, uses `Caption`), `Field` (label/required/hint/children), `FormRow` (children + trailing action), `Toolbar` (inline action cluster), `Tag` (neutral/required/optional/info badge), `Code` (monospace value chip, `truncate`/`max`), `JsonCell` (object→key:value chips, `Code` fallback), `Secret` (masked value + reveal via `Btn`), `EmptyState` (icon/title/hint/action), `Meter` (clamped 0–100% ratio bar, warn-on-over), `Stat` ("value of total" with warn-on-over note), `SummaryList` (aligned key/value rows, optional `StatusPill` per item, `cols` grid). Each consumes only existing CSS tokens.
3. **Gate** — `bun test:client` (all 14 new test files green), `bun check:bundle-isolation` (stories never leak into prod bundles), `bun check` (lint/typecheck/format), and `bun build:client` (no compile regressions; new components tree-shake out with no consumers).

Composition is leaf-only: `JsonCell`→`Code`, `Secret`→`Btn`, `Stat`/`PageHeader`→`Caption`, `StatusPill`→`Pill`+`statusTone`, `SummaryList`→`StatusPill`. No existing file is modified in this phase.

## Consequences

### Positive

- Phase 2/3 adoption has a complete, tested primitive set; section refactors become mechanical swaps.
- Number formatting is canonical (`fmtNum`/`fmtBytes`), ending the three divergent `formatBytes` copies once Phase 2 consolidates them.
- Status tone is centralized in `statusTone`, so color is consistent and extendable in one place.
- Every primitive ships with a happy-dom unit test and a Storybook story; bundle isolation is enforced by a dedicated check.

### Negative

- **Deliberate overlap is unresolved.** `Stat`/`MetricCard`, `SummaryList`/`KV`, and `StatusPill`/`Pill` coexist by design; consumers must know which to use until a future consolidation (documented in spec §6, not eliminated).
- **Dead weight until Phase 2.** The new components have no consumers in Phase 1, so they are tree-shaken out of production bundles but still add maintained/tested surface area.
- **Base-1024 is a behavior change at two call sites.** Two of the three former local `formatBytes` copies used base-1000; standardizing on the prototype's base-1024 shifts displayed unit thresholds. Phase 2 must call this out and verify rendered values (spec §5).

### Risks

- **Tone-map drift:** `statusTone` is a shared lookup; unrecognized status strings fall back to `neutral`. The shipped map is a superset of the plan's literal snippet (adds `trace`/`debug`/`warn`/`info`/`fatal`/`retriable`/`non-retriable`), covered by `status-tone.test.ts` — but the map is now a coordination point that must grow as new statuses appear.
- **Story-harness leakage:** a missed `*.stories.svelte` import could leak into a prod bundle; `bun check:bundle-isolation` is the only guard and must stay green.
- **Prototype fidelity is a human assertion.** Tests assert structural CSS selectors (`.ui-*`), not visual parity; visual regressions rely on Storybook preview rather than automated screenshot diffing.

## Related Decisions

- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — establishes the `/admin` and `/debug` operator surfaces this kit serves.
- **ADR-0145: Dashboard Primitives Pass** — the prior `client/shared/ui/` primitives baseline this phase extends.
- **ADR-0166: Storybook Harness — PR 1 (Vertical Slice)** — the Storybook harness and `bun check:bundle-isolation` gate this plan depends on.

## Implementation Notes

Verified present in the codebase:

| File                                  | Role                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client/shared/helpers.ts`            | Added `fmtNum` (round ≤dp, `en-US` separators, `—` for null/∅/non-finite, pass-through strings) and `fmtBytes` (base-1024 B–TB). Present at lines 65–85.                                               |
| `client/shared/ui/status-tone.ts`     | `StatusTone` union + `statusTone()` case-insensitive map with `neutral` fallback. Shipped map is a superset of the plan's snippet (adds log-level and retry states); covered by `status-tone.test.ts`. |
| `client/shared/ui/StatusPill.svelte`  | status string → `Pill` with mapped tone + optional dot.                                                                                                                                                |
| `client/shared/ui/PageHeader.svelte`  | eyebrow + title + sub + action header (uses `Caption`).                                                                                                                                                |
| `client/shared/ui/Field.svelte`       | labeled form control wrapper (label, required, hint, children snippet).                                                                                                                                |
| `client/shared/ui/FormRow.svelte`     | horizontal field row + trailing action snippet.                                                                                                                                                        |
| `client/shared/ui/Toolbar.svelte`     | inline action cluster.                                                                                                                                                                                 |
| `client/shared/ui/Tag.svelte`         | non-status attribute badge (neutral/required/optional/info).                                                                                                                                           |
| `client/shared/ui/Code.svelte`        | inline monospace value chip (`truncate`/`max`).                                                                                                                                                        |
| `client/shared/ui/JsonCell.svelte`    | JSON → key:value chips, `Code` fallback for non-objects.                                                                                                                                               |
| `client/shared/ui/Secret.svelte`      | masked value + reveal affordance (uses `Btn`).                                                                                                                                                         |
| `client/shared/ui/EmptyState.svelte`  | standardized empty/prompt body (icon/title/hint/action).                                                                                                                                               |
| `client/shared/ui/Meter.svelte`       | clamped 0–100% ratio bar, warn-on-over.                                                                                                                                                                |
| `client/shared/ui/Stat.svelte`        | "value of total" metric, warn-on-over note (uses `Caption`).                                                                                                                                           |
| `client/shared/ui/SummaryList.svelte` | aligned key/value rows, optional `StatusPill` per item, `cols` grid.                                                                                                                                   |
| `tests/client/shared/ui/*.test.ts`    | One happy-dom test per component + `status-tone.test.ts`; `tests/client/shared/helpers.test.ts` covers the helpers. Confirmed present via glob.                                                        |
| `client/shared/ui/*.stories.svelte`   | One Storybook story per component under `shared/ui/*`. Confirmed present via glob.                                                                                                                     |

Phase 1 deliverables (helpers + 13 components + stories + tests) all landed as specified. Consumer adoption (the three `formatBytes` consolidations and the audit-fix refactors) is Phase 2/3 work, tracked by separate plans.
