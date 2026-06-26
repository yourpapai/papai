<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0173: Backstage Phase 2.4 — Forms and Status

## Status

Implemented

## Date

2026-06-01

## Context

This is the final `/admin` consumer-side adoption sweep of the backstage remediation. Phase 1 (ADR-0169) shipped the 13 kit primitives plus `fmtNum`/`fmtBytes`; Phases 2.1 (ADR-0170), 2.2 (ADR-0171), and 2.3 (ADR-0172) adopted them in the sections carrying the number/table/guard, header, and instances findings. Phase 2.4 closes the six remaining audit findings from `docs/superpowers/specs/2026-06-01-backstage-admin-ui-fixes-design.md` §7 — **A7** (floating Reminders control), **B2** (native `<button>` across the remaining sections), **B3** (raw `<input>`), **B4** (plain-text status in Memos/Reminders/SubjectDetail), **B7** (unpanelled plugin config + duplicate inner headings), and **C2** (masked credentials via `Secret`).

Eight files were still rendering kit-bypassing markup: `RemindersSection`, `MemosSection`, `IdentitiesSection`, `GroupsSection`, `BillingSection`, `CredentialsForm`, `PluginConfigForm`, and `SubjectDetail`. Every primitive this phase needs already existed — `Btn`, `Input`, `Field`, `Toolbar`, `Panel`, `StatusPill`, `Secret` from Phase 1, plus the `testid` pass-through on `Btn`/`Input`/`Select` and the `password` type on `Input` landed in Phase 2.3 — so this phase is **consumer-only**: no primitive changes, just one TDD refactor per file.

Two constraints shaped the refactor. First, the `data-testid` contract that the admin/E2E suites drive forms by (`reminders-load`, `memos-user-id`, `identities-load`, `billing-refresh`, `edit-<key>`, `input-<key>`, `submit-<key>`, …) must survive the swap — preserved via the Phase 2.3 `testid` props. Second, credential and plugin-config secret values arrive **already masked from the server** (`/admin/llm` masks `llm_apikey`; plugin config snapshots mask sensitive keys), so `Secret`'s reveal button is a visual affordance only — `onReveal` is left unset in both forms, and a functional reveal would require a new server endpoint that is explicitly out of scope.

## Decision Drivers

- **Close the remaining `/admin` findings (A7/B2/B3/B4/B7/C2)** and finish `/admin` kit adoption so the raw-button/raw-input/plain-status/masked-markup anti-patterns stop recurring.
- **Consumer-only:** rely on the existing kit plus the Phase 2.3 `testid`/`password` enhancements; touch no shared primitive this phase.
- **Preserve the `data-testid` contract** that the admin and E2E suites drive the affected forms by.
- **Preserve the server-masking invariant:** `Secret` reveals only the already-masked value; do not imply a functional reveal.
- **TDD Red→Green per task; one task per file; commit scoped to the file plus its test.** Delete the now-dead local CSS rule in the same file when a styled raw control becomes a kit component (verify nothing else references it).
- **No `admin.css` edits:** orphaned shared rules (`.masked-value`, `.masked-hint`) are left untouched in case other code emits them; only per-file `<style>` blocks are pruned.

## Considered Options

### Option 1: One-task-per-file consumer sweep, adopting the existing kit verbatim (chosen)

Refactor each of the eight files onto the existing primitives (`Btn`/`Input`/`Field`/`Toolbar`/`Panel`/`StatusPill`/`Secret`), forwarding `testid`s via the Phase 2.3 props, and pruning per-file dead CSS in the same commit.

- **Pros:** no primitive churn (Phase 2.3 already paid for `testid`/`password`); the `data-testid` and sensitive-field contracts survive via opt-in props; each task is independently reviewable and committable; `/debug` and `client/settings` inherit nothing new to adopt later in Phase 3.
- **Cons:** the duplicated masked-value markup (CredentialsForm and PluginConfigForm both wrap `Secret` in a `data-testid="masked-value-…"` span) is not consolidated into a shared admin-local component — two near-identical call sites remain.

### Option 2: Extract a shared admin-local `MaskedValue` wrapper first, then adopt

Before adopting `Secret`, lift the `data-testid="masked-value-…"` + `Secret` pattern into a `client/admin/components/MaskedValue.svelte` used by both forms.

- **Pros:** one place for the masked-value span markup; future secret-bearing forms reuse it.
- **Cons:** adds a new component and its test/story this phase, expanding scope beyond the audit sweep; the wrapper is admin-coupled (hardcodes the `data-testid` prefix shape), so `/debug`/`/settings` cannot reuse it; the `Secret` reveal-is-visual-only caveat still has to be documented per call site regardless.

### Option 3: Defer B7 (Panel-wrap + duplicate-heading removal) to a Phase 2.5

Adopt B2/B3/B4/C2 now; leave the PluginConfigForm Panel-wrap and the duplicate `<h3>` removal for a later phase.

- **Pros:** smaller phase; B7 is the most markup-invasive task.
- **Cons:** leaves the spec's B7 finding open and the duplicate inner headings in place; the Panel-wrap and `Secret` adoption in PluginConfigForm are tightly coupled (both touch the same `{#each}` body), so splitting them forces touching that block twice; the audit is meant to close `/admin` in one sweep.

## Decision

Eight TDD refactors (Red → Green), each committed separately, plus a verification gate:

1. **`RemindersSection` — A7 + B2 + B3 + B4.** The floating `.reminders__header` (bare input + button) becomes a contained, labeled `<Toolbar>` with a `<Field>`+`<Input>` (`testid="reminders-user-id"`) and a primary `<Btn>` (`testid="reminders-load"`); the two `.reminders__status` spans (recurring `enabled`/`paused`, deferred `status`) become `<StatusPill>`. `.reminders__header` and `.reminders__status` CSS rules deleted.
2. **`MemosSection` — B2 + B3 + B4.** Raw `.memos__user-id-input` → `<Input testid="memos-user-id">`; `.memos__load-btn` → `<Btn variant="primary" type="submit" testid="memos-load">`; the `DataTable` `status` column renders `<StatusPill>` via a `cell(row, col)` snippet keyed on `col.key === 'status'`. `.memos__user-id-input`/`.memos__load-btn` rules deleted.
3. **`IdentitiesSection` — B2 + B3.** Raw `.identities__user-id-input` → `<Input testid="identities-user-id">`; `.identities__reload-btn` → `<Btn variant="primary" type="submit" testid="identities-load">`. Dead input/button rules deleted.
4. **`GroupsSection` — B2.** Refresh button → `<Btn variant="secondary">` in the Panel `action`; per-row revoke button → `<Btn variant="danger" size="sm">` in the `cell` snippet. `.groups__refresh-btn`/`.groups__revoke-btn` rules deleted.
5. **`BillingSection` — B2.** Refresh button → `<Btn variant="ghost" size="sm" testid="billing-refresh">`. `.billing-refresh-btn` rule deleted.
6. **`CredentialsForm` — C2 + B2 + B3 + B7.** Masked `<code class="masked-value">`+`<span class="masked-hint">` → `<Secret value hint="(hidden)">` wrapped in a `data-testid="masked-value-<key>"` span; edit `<input>` → `<Input type={SENSITIVE_KEYS.has(key) ? 'password' : 'text'}>`; Save/Cancel/Edit → `<Btn variant="primary|ghost|secondary">`. The duplicate inner `<h3>LLM credentials</h3>` is dropped (the wrapping `SystemSection` Panel already titles it "llm credentials"). `admin.css`'s `.masked-value`/`.masked-hint` rules left untouched; this file just stops emitting those classes.
7. **`PluginConfigForm` — B2 + B3 + B7 + C2.** Each plugin group's bare `<section class="plugin-group">`+`<h4>{pluginId}</h4>`+`<table>` becomes `<Panel title={plugin.pluginId}>` with the table in the `body` snippet (B7); the duplicate `<h3>Plugin configuration</h3>` is dropped (the section's `PageHeader` titles it). Edit `<input>` → `<Input type={keyState.sensitive ? 'password' : 'text'}>`; Save/Cancel/Edit → `<Btn>`; sensitive non-null values → `<Secret>`. `.plugin-group`/`.plugin-group h4` rules deleted; `.required-badge`/`.empty-state` kept.
8. **`SubjectDetail` — B4.** The recent-requests table's plain-text `<td>{r.finishStatus}</td>` → `<td><StatusPill status={r.finishStatus} /></td>`.
9. **Gate (no commit).** `bun test:client`, `bun typecheck`, `bun knip` (no new unused from removed local styles), `bun check:bundle-isolation`, `bun build:client`.

The server-masking caveat is recorded in the Task 6 and Task 7 commit bodies: `Secret`'s reveal button is visual only in both forms because the values are masked server-side; wiring a real reveal needs a new endpoint and is out of scope.

## Consequences

### Positive

- All six remaining `/admin` audit findings (A7/B2/B3/B4/B7/C2) are closed; `/admin` kit adoption is complete.
- Every raw `<button>` is a kit `Btn` with consistent variant/size semantics; every raw `<input>` shares the dark raised style and `Field` labels; every plain-text status is a colored `StatusPill`; every masked secret is a `Secret`.
- `PluginConfigForm`'s per-plugin tables now carry a `Panel` border titled by the plugin id, replacing the bare `<h4>`; the duplicate inner `<h3>`s in both forms are gone, leaving the `Panel`/`PageHeader` title as the single heading source.
- Dead per-file CSS rules are pruned in the same commit as their adopting refactor, reducing style drift.
- The Phase 2.3 `testid`/`password` props carry the `data-testid` and sensitive-field contracts through the swap with no test/E2E rewrite.

### Negative

- **`Secret` reveal is non-functional in both forms.** The reveal button re-shows the already-masked value, not the real secret. A functional reveal would need a new server endpoint and is out of scope; the affordance is documented in commit bodies but not surfaced in-UI, so an operator may expect a working reveal.
- **`admin.css` keeps orphaned shared rules.** `.masked-value`/`.masked-hint` are no longer emitted by `CredentialsForm`/`PluginConfigForm` but remain in `admin.css` in case other code uses them; they are now dead weight for these two consumers.
- **The per-plugin `<h4>` heading is gone.** An operator who used it as an in-page anchor loses it; the `Panel` title replaces it.
- **The masked-value span markup is duplicated** across CredentialsForm and PluginConfigForm (`data-testid="masked-value-…"` + `Secret`), not consolidated — a minor smell deferred to a future cleanup.

### Risks

- **`Secret` reveal affordance confusion:** the reveal button looks functional but is not; the only mitigation is the commit-body note. A future operator may file a bug expecting a real reveal.
- **`statusTone()` fallback:** `StatusPill` maps the status string through `statusTone()` with a `neutral` fallback; an unrecognized deferred-prompt or finish-status value renders neutral until the map grows. Covered by `status-tone.test.ts` for the shipped set, but the map is a coordination point.
- **Visual parity is a human assertion.** Tests assert kit class presence (`.ui-btn`/`.ui-input`/`.ui-pill`/`.ui-secret`/`.ui-toolbar`), not pixel parity; visual regressions rely on Storybook preview.
- **`DataTable` cell-snippet contract:** MemosSection's status pill renders through the `cell(row, col)` snippet; any future change to `DataTable`'s snippet signature would break it.
- **`Input` `password` trusts the config schema's `sensitive` flag.** A provider that mislabels a sensitive field renders it in the clear; the forms trust the schema and do not double-check.

## Related Decisions

- **ADR-0169: Backstage Kit Additions (Phase 1)** — ships `Btn`/`Input`/`Field`/`Toolbar`/`Panel`/`StatusPill`/`Secret` this phase adopts.
- **ADR-0170: Backstage Phase 2.1 — Numbers, Tables, and Guards** — the prior `/admin` consumer-adoption phase.
- **ADR-0171: Backstage Phase 2.2 — Section Headers** — put section headers on `PageHeader`; this phase drops the duplicate inner `<h3>`s in CredentialsForm/PluginConfigForm that 2.2 deferred.
- **ADR-0172: Backstage Phase 2.3 — Instances Section** — shipped the `testid` pass-through on `Btn`/`Input`/`Select` and the `password` type on `Input` this phase relies on.
- **ADR-0121: Debug/Admin Surface Split and Dashboard Redesign** — establishes the `/admin` operator surface these sections live in.
- **ADR-0166: Storybook Harness — PR 1** — the harness and `bun check:bundle-isolation` gate the refactored stories rely on.

## Implementation Notes

Verified present in the codebase (light confirmation, not exhaustive):

| File                                                 | Role                                                                                                                                                                                                                                                                                                                     | Evidence         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `client/admin/sections/RemindersSection.svelte`      | Imports `Btn`/`Field`/`Input`/`Panel`/`StatusPill`/`Toolbar` (lines 9–14); `<Toolbar>` + `<Field label="user id">` + `<Input testid="reminders-user-id">` + `<Btn testid="reminders-load">` (lines 73–86); recurring + deferred status as `<StatusPill>` (lines 100, 120). No `.reminders__header`/`.reminders__status`. | `grep` confirms. |
| `client/admin/sections/MemosSection.svelte`          | Imports `Btn`/`Input`/`Panel`/`StatusPill` (lines 8–13); `<StatusPill status={row.status}>` in the `DataTable` `cell` snippet (line 116). No `.memos__user-id-input`/`.memos__load-btn`.                                                                                                                                 | `grep` confirms. |
| `client/admin/sections/IdentitiesSection.svelte`     | Imports `Btn`/`Input`/`Panel` (lines 10–13). No `.identities__reload-btn`/`.identities__user-id-input`.                                                                                                                                                                                                                  | `grep` confirms. |
| `client/admin/sections/GroupsSection.svelte`         | Imports `Btn`/`Panel` (lines 9–11). No `.groups__refresh-btn`/`.groups__revoke-btn`.                                                                                                                                                                                                                                     | `grep` confirms. |
| `client/admin/sections/BillingSection.svelte`        | Imports `Btn`/`Panel` (lines 14–15). No `.billing-refresh-btn`.                                                                                                                                                                                                                                                          | `grep` confirms. |
| `client/admin/components/CredentialsForm.svelte`     | Imports `Btn`/`Input`/`Secret` (lines 8–11); `<Secret value={snapshot[key].value ?? '••••••••'} hint="(hidden)">` (line 98) wrapped in `data-testid="masked-value-<key>"` (line 97). No `<h3>LLM credentials</h3>`; no `.masked-value`/`.masked-hint` emitted here.                                                      | `grep` confirms. |
| `client/admin/components/PluginConfigForm.svelte`    | Imports `Btn`/`Input`/`Panel`/`Secret` (lines 8–11); `<Panel title={plugin.pluginId}>` per plugin group (line 72); `<Secret value={keyState.value} hint="(hidden)">` (line 97) wrapped in `data-testid="masked-value-<pluginId>-<key>"` (line 96). No `<h3>Plugin configuration</h3>`; no `.plugin-group`.               | `grep` confirms. |
| `client/admin/components/SubjectDetail.svelte`       | Imports `Panel`/`StatusPill` (lines 7–8); `<td><StatusPill status={r.finishStatus} /></td>` in the recent-requests table (line 146).                                                                                                                                                                                     | `grep` confirms. |
| `tests/client/admin/{sections,components}/*.test.ts` | One test file per source file under the mirroring path (`sections/` + `components/`); all eight target files have a companion test.                                                                                                                                                                                      | `glob` confirms. |

Minor spec-vs-plan note: the spec's §7 A7 row summarizes the fix as "wrap in `Panel` + `Toolbar` + `Field` + `Input`/`Btn`", but the plan's Task 1 scoped the filter to a contained, labeled `<Toolbar>` (the two result Panels already existed and stayed). The implementation follows the plan — the filter Toolbar is contained/labeled but not itself Panel-wrapped. The spec is shared by the other backstage plans and was left in `docs/superpowers/specs/`; only the plan was archived.
