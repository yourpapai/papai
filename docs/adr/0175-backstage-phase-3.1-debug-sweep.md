<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0175: Backstage Phase 3.1 — Debug Sweep

## Status

Implemented

## Date

2026-06-01

## Context

Phase 1 (ADR-0169) shipped the 13 shared kit primitives plus `fmtNum`/`fmtBytes` into `client/shared/ui/`, and Phases 2.1–2.5 (ADRs 0170–0174) adopted them across every `/admin` section, closing all 18 audit findings from `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` §7. The spec's §3 goal, however, scopes the remediation beyond `/admin`: "sweep `/debug` and `client/settings/` for the identical anti-patterns and adopt the new components there too (maximum cross-surface consistency)." Phase 3.1 is the first half of that remaining scope — the `/debug` consumer-side sweep.

The `/debug` surface (`client/debug/`) carried the same hand-rolled anti-patterns Phase 2 removed from `/admin`: `<section class="panel">`/`<h2>` instead of `Panel`, raw `<button>` instead of `Btn`, raw `<input>`/`<select>` instead of `Input`/`Select`, plain-text status instead of `StatusPill`, label/value grids instead of `SummaryList`/`KV`, a hand-rolled config table instead of `DataTable`, single-line `JSON.stringify` instead of `JsonCell`, inline `toFixed` instead of `fmtNum`, and `.placeholder` empty spans instead of `EmptyState`. The work is consumer-side adoption only: no shared-primitive logic changes, save one additive extension to the shared `status-tone` map (log levels + the failure retriable flag) so `StatusPill` tones render correctly for `/debug`-specific status strings. Deep pretty-printed JSON `<pre>` dumps and `TreeView` usages are deliberately left as-is — they are not the compact-cell anti-pattern, and `TreeView` remains the right tool for deep objects.

## Decision Drivers

- **Cross-surface kit consistency** — `/debug` must converge on the same kit `/admin` adopted in Phase 2, ending the parallel set of hand-rolled controls and the visual divergence between the two operator surfaces.
- **Consumer-only scope** — no shared primitive is rebuilt; the kit shipped in Phase 1 is reused as-is. The lone shared touch (`status-tone`) is an additive map extension, not a behavior change.
- **Preserve `TreeView` and deep `<pre>`** — multiline JSON dumps and `TreeView` are appropriate for deep objects; the sweep targets only the compact-cell anti-pattern, not every non-kit element.
- **Controlled, not bound** — kit `Input`/`Select` are callback-based (`value` + `onInput`/`onChange`), so every `bind:value` becomes a controlled flow with an explicit update handler.
- **TDD Red→Green, one task per file** — each affected file is its own scoped commit, test-first per the repo's write-hook, gated by `bun test:client`/`bun typecheck`/`bun check:bundle-isolation`/`bun build:client`.
- **Already-clean files untouched** — `DebugApp.svelte`, `DebugTopBar.svelte`, `TurnDetail.svelte`, `FailureDetail.svelte` were already on the kit and are not modified; `TurnsPanel.svelte` is clean except its empty-state span (Task 13).

## Considered Options

### Option 1: Consumer-side sweep, one task per file (chosen)

Walk the `/debug` component tree, swapping each anti-pattern for its kit equivalent, plus the one additive `status-tone` extension; commit each file separately under TDD.

- **Pros:** reuses the Phase 1 kit proven in Phase 2 with zero primitive churn; each task is independently reviewable and revertable; the already-clean files stay untouched; `/debug` reaches parity with `/admin`.
- **Cons:** touches ~13 files in one phase; `bind:value`→controlled conversion is mechanical but pervasive, with a small risk of a missed callback; several components lacked BSL headers, so `license-headers` forces incidental header prepends beyond pure kit adoption.

### Option 2: Leave `/debug` hand-rolled, accept the divergence

Ship no Phase 3.1; let `/debug` keep its bespoke controls and plain-text status.

- **Pros:** no churn; no `bind:value` migration risk.
- **Cons:** leaves the spec §3 goal unmet; `/debug` and `/admin` keep diverging as new kit primitives land; the `status-tone` map never gains the log-level/retriable entries `StatusPill` needs; plain-text status and ad hoc `.placeholder` spans persist.

### Option 3: Rebuild `/debug` components from scratch on the kit

Rewrite the `/debug` components wholesale against the kit rather than refactoring in place.

- **Pros:** maximal kit purity; no legacy markup to reason about.
- **Cons:** far larger blast radius than the anti-patterns warrant; re-introduces behavior risk in components with nontrivial state (log scroll/`autoScroll`, notification filtering); violates the consumer-only scope and the spec's "no new visual design" non-goal; loses the per-file scoped-commit reviewability.

## Decision

Thirteen file-scoped TDD refactors plus the `status-tone` extension and a verification gate, in dependency order:

1. **`status-tone` extension** — add `trace`/`debug`/`fatal`/`retriable`/`non-retriable` (and the already-present `warn`/`info`) to `TONE_MAP` in `client/shared/ui/status-tone.ts` so log-level names and the failure retriable flag resolve to correct tones via `statusTone()`; `trace`/`debug`/`non-retriable` → `mute`, `fatal` → `danger`, `retriable` → `info`.
2. **`DebugDetailRail`** — close control `✕` via `Btn variant="ghost" size="sm"`; drop the `.debug-detail-rail__close` rules.
3. **`LogExplorer`** — `Panel title="log explorer" count={filtered.length}` with a `Toolbar` action snippet holding two `Select`s (level, scope), an `Input` (search), and `Btn` clear/turn-filter/auto-scroll controls.
4. **`NotificationsPanel`** — `Panel` + `EmptyState` for the empty case; notification data rendered via `JsonCell` (the text branch keeps `replyText`; the JSON branch moves out of `notificationText`).
5. **`ToolFailuresPanel`** — `Panel` + `EmptyState`; retriable flag rendered as `StatusPill` (consuming the Task 1 `retriable`/`non-retriable` tones).
6. **`LiveContextCard`** — `Panel title="live context"` + `EmptyState` for the no-active-sessions case.
7. **`SessionsList`** — wrap the list in `Panel title="sessions" count={dashboard.sessions.size}`.
8. **`TraceList`** — `Panel` + `EmptyState`; duration via `fmtNum(trace.duration / 1000, 1)` instead of inline `toFixed`.
9. **`SessionCard`** — explicit `StatusPill status={isActive ? 'active' : 'idle'}` next to the user id (active/idle tones already mapped).
10. **`SessionDetail`** — Basic Info grid → `SummaryList`; config `<table>` → `DataTable` (derived `configRows`/`configColumns`); Fact "Last seen" → `KV`. Summary `<pre>`, Instructions, and Conversation History `TreeView` left as-is.
11. **`TraceDetail`** — Basic Info and Token Usage grids → `SummaryList` (Token Usage `cols={3}`); tool-call success → `StatusPill` (`ok`/`failed`); duration via `fmtNum(trace.duration / 1000, 2)`. Deep `<pre class="tool-json">` and `generated-text` untouched.
12. **`LogDetail`** — meta block → `SummaryList` with `Level` rendered as a pill (`pill: true` → `StatusPill`); drop the now-unused `levelClass`.
13. **`TurnsPanel`** — empty snippet `.turns__placeholder` span → `EmptyState title="No turns"`; delete the `.turns__placeholder` rule.
14. **Gate (no commit)** — `bun test:client`, `bun typecheck`, `bun knip`, `bun check:bundle-isolation`, `bun build:client`; optional `/debug` preview for visual parity with `/admin`.

## Consequences

### Positive

- `/debug` and `/admin` share one kit; filters, panels, status, empties, and tables render consistently across both operator surfaces.
- Status tone is centralized: log levels and the retriable flag are colored via `statusTone`, ending per-component plain-text status.
- `fmtNum` replaces inline `toFixed` for duration formatting, gaining the deterministic `'—'` fallback for null/non-finite values.
- Empty states are standardized through `EmptyState`, removing ad hoc `.placeholder`/`.turns__placeholder` spans.
- Config tables, JSON cells, and KV grids route through `DataTable`/`JsonCell`/`SummaryList`/`KV` instead of hand-rolled markup.
- `TreeView` and deep `<pre>` dumps are preserved where they are the right tool — the sweep does not force a compact cell onto deep objects.

### Negative

- `bind:value` → controlled `value` + `onInput`/`onChange` is mechanical but touches every filter; a missed callback would silently break input updates, caught only by the per-file test.
- Several `/debug` components lacked BSL headers; the sweep prepends them where `license-headers` flags, adding minor churn beyond pure kit adoption.
- Overlap persists by design (`SummaryList`/`KV`, `StatusPill`/`Pill`); `/debug` now uses both depending on context, with no consolidation.
- There is no automated visual-parity check — tests assert kit class presence (`.ui-*`), not pixel equality; regressions rely on Storybook/preview.

### Risks

- **`statusTone` `neutral` fallback** — an unrecognized status string (e.g. an unknown tool name passed to `StatusPill`) renders neutral until the map grows. Covered by `status-tone.test.ts` for the shipped set, but the map remains a coordination point.
- **`TreeView`/deep `<pre>` is a deliberate non-goal** — a future deep-object kit primitive would require another sweep; this phase does not pre-empt it.
- **Phase 1 dependency** — the sweep assumes the Phase 1 kit contracts (`Panel`/`Btn`/`Input`/`Select`/`StatusPill`/`SummaryList`/`KV`/`DataTable`/`JsonCell`/`EmptyState` props) and Phase 2.3's `Btn`/`Input`/`Select` `testid` and `Input` `password`. A Phase 1 regression in any of those breaks `/debug` consumers.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — ships the 13 primitives plus `fmtNum`/`fmtBytes` and `status-tone` this sweep adopts.
- **ADR-0170: Backstage Phase 2.1 — Numbers, Tables, and Guards** — first `/admin` consumer adoption; established the sweep pattern.
- **ADR-0171: Backstage Phase 2.2 — Section Headers** — `PageHeader` adoption in `/admin`.
- **ADR-0172: Backstage Phase 2.3 — Instances Section** — shipped `Btn`/`Input`/`Select` `testid` and `Input` `password` this phase depends on.
- **ADR-0173: Backstage Phase 2.4 — Forms and Status** — `StatusPill` adoption this phase mirrors in `/debug`.
- **ADR-0174: Backstage Phase 2.5 — System Summary** — closes `/admin`; this phase opens Phase 3.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — establishes the `/debug` operator surface.
- **ADR-0166: Storybook Harness — PR 1** — the `bun check:bundle-isolation` gate the verification relies on.

## Implementation Notes

Verified present in the codebase (light confirmation via `grep`, not exhaustive):

| File                                                | Role                                                                                                                                                  | Evidence         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `client/shared/ui/status-tone.ts`                   | `TONE_MAP` contains `trace`/`debug`→`mute`, `warn`→`warn`, `info`→`info`, `fatal`→`danger`, `retriable`→`info`, `non-retriable`→`mute` (lines 28–34). | `grep` confirms. |
| `client/debug/components/LogExplorer.svelte`        | Imports `Btn`/`Input`/`Panel`/`Select`/`Toolbar` (lines 5–9).                                                                                         | `grep` confirms. |
| `client/debug/components/NotificationsPanel.svelte` | Imports `Panel`/`EmptyState`/`JsonCell` (lines 9–11).                                                                                                 | `grep` confirms. |
| `client/debug/components/ToolFailuresPanel.svelte`  | Imports `Panel`/`EmptyState`/`StatusPill` (lines 8–10).                                                                                               | `grep` confirms. |
| `client/debug/components/LiveContextCard.svelte`    | Imports `EmptyState`/`Panel` (lines 8–9).                                                                                                             | `grep` confirms. |
| `client/debug/components/DebugDetailRail.svelte`    | Imports `Btn` (line 7).                                                                                                                               | `grep` confirms. |
| `client/debug/components/SessionsList.svelte`       | Imports `Panel` (line 3).                                                                                                                             | `grep` confirms. |
| `client/debug/components/SessionCard.svelte`        | Imports `StatusPill` (line 9).                                                                                                                        | `grep` confirms. |
| `client/debug/components/SessionDetail.svelte`      | Imports `DataTable`/`KV`/`SummaryList` (lines 3–5).                                                                                                   | `grep` confirms. |
| `client/debug/components/TraceDetail.svelte`        | Imports `fmtNum`/`formatTime`/`formatTokens` from helpers (line 2); `fmtNum` used for duration.                                                       | `grep` confirms. |
| `client/debug/components/TraceList.svelte`          | Imports `fmtNum`/`formatTime`/`formatTokens` from helpers (line 2); `fmtNum(trace.duration / 1000, 1)` at line 39.                                    | `grep` confirms. |
| `client/debug/components/LogDetail.svelte`          | Imports `SummaryList` (line 3).                                                                                                                       | `grep` confirms. |
| `client/debug/components/TurnsPanel.svelte`         | Imports `EmptyState` (line 10).                                                                                                                       | `grep` confirms. |

Minor spec-vs-plan notes:

- The plan's Task 1 planned to _add_ the log-level and retriable `TONE_MAP` entries. ADR-0169 records the Phase 1 `status-tone.ts` as already shipping a superset of the plan's snippet (including `trace`/`debug`/`warn`/`info`/`fatal`/`retriable`/`non-retriable`), so Task 1 functioned as a regression guard confirming the tones rather than a net-new addition. No divergence in the final map.
- The plan flagged that several `/debug` components lacked a BSL header; components edited during the sweep prepend the standard 4-line HTML-comment header where `license-headers` required it.
- The `/settings` sweep (spec §3) is deliberately out of scope: Phase 3.2 (`/settings` user sections + shared `ConfigFieldRow`) and Phase 3.3 (`/settings` admin sections) handle it, followed by deletion of the dead `.settings-form *`/`.settings-table`/`.masked-value`/`.placeholder` rules from `settings.css`.

The spec is shared by the other backstage plans and was left in `docs/superpowers/specs/`; only the plan was archived.
