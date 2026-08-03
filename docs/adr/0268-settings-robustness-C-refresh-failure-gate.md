<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0268: Settings Section Robustness — C: Refresh-Failure Gate

## Status

Implemented (with divergence)

## Date

2026-07-07

## Context

Five settings sections follow a "PATCH → `await load()` → set success status" mutation flow, and each gated its top-level render on a plain `{#if <errVar> !== null}` → full-section `ErrorState`. Because the post-mutation *reload* writes the same error variable, a successful save followed by a failed reload replaced the entire form (and any just-set success status) with a full-section error screen — discarding the user's successful save from the UI. `CodingIdentitySection`, `GroupProviderSection`, `TaskProviderSection`, `GuestModeSection`, and `ReleaseSubscriptionSection` all had this failure mode; the sibling `ByokSection`/`CodeHostSection`/`MemorySection`/`CodingCredentialsSection` already did the right thing (gate the full `ErrorState` on "never loaded"; surface a reload error as a non-blocking inline banner).

The shared design (`docs/superpowers/specs/2026-07-07-settings-section-robustness-design.md`, Workstream C) and plan (`docs/superpowers/plans/2026-07-07-settings-robustness-C-refresh-failure-gate.md`) resolved it by converging each of the five onto the already-correct pattern: tighten the top-level gate from `{#if <errVar> !== null}` to `{#if <errVar> !== null && <notLoaded>}` (where `<notLoaded>` is the section's existing "never loaded" sentinel), and inside the loaded branch add a non-blocking `<p class="status-error" role="alert">` inline banner for the loaded-but-refresh-failed case. No backend, schema, or fetcher changes. The plan recommended running Workstream B first so the reload's own error write is contextId-guarded; the two compose cleanly.

## Decision Drivers

- **A refresh failure must not nuke a loaded section.** Once a section has loaded, a failed post-mutation reload must keep the form/controls (and any success status) visible and surface the error inline — never replace the section with a full `ErrorState`.
- **The first load still dead-ends clearly.** A failure *before* the section has ever loaded still shows the full framed `ErrorState` + retry (the gating sentinel distinguishes "never loaded" from "loaded then refresh failed").
- **Converge on the pattern the codebase already contains.** Mirror `ByokSection`/`CodeHostSection`/`MemorySection` (gate on `currentData === null` / `enabled === null` / `instanceData === null`) rather than inventing a new banner component or a global error bus.
- **Leave the already-correct sections untouched.** `ByokSection`, `CodeHostSection`, `CodingCredentialsSection`, `MemorySection`, and `IdentitySection` (which uses a silent `refresh()` after save) are out of scope and must not be modified.
- **Client-DOM test per section.** Load successfully, trigger a mutation whose subsequent reload fails, and assert the form/controls (and success status where set) survive with an inline error and no `.ui-error` takeover.

## Considered Options

### Option 1 — Tighten the gate on the existing "never loaded" sentinel; add an inline `<p class="status-error" role="alert">` (chosen)

For each of the five sections, change `{#if <errVar> !== null}` to `{#if <errVar> !== null && <notLoaded>}` and add an inline banner inside the loaded branch.

- **Pros:** directly resolves the failure mode with a per-section one-line gate change + one banner; reuses the `status-error`/`role="alert"` convention already used elsewhere; the sentinel (`loaded`/`data`/`instanceData`/`enabled`) already exists, so no new state; smallest blast radius.
- **Cons:** adds a second error-render path (full `ErrorState` vs inline banner) that each section must keep mutually exclusive via the sentinel; the displayed data is stale until the next successful reload (accepted trade-off).

### Option 2 — A separate silent `refresh()` that never flips the blocking error view

Adopt `IdentitySection`'s approach: a save calls a silent refresh whose errors render inline and never touch the blocking `loadError`.

- **Pros:** structurally guarantees a refresh failure can never take over the body.
- **Cons:** larger refactor — each section must split `load` into a blocking first-load vs a non-blocking refresh; diverges from the five sections' current single-`load` shape; `IdentitySection` is the only section shaped this way, so it is the exception, not the convention.

### Option 3 — Keep the full `ErrorState` but add a retry that restores the form

Leave the takeover and just ensure the `ErrorState` retry re-loads.

- **Pros:** no gate change.
- **Cons:** rejects the core driver — the user's successful save vanishes behind the error screen and the form is gone until a manual retry succeeds; the success status is lost entirely.

## Decision

The chosen Option 1 shipped across all five sections and their client tests:

1. **`CodingIdentitySection`.** Gate tightened to `{#if loadError !== null && !loaded}`; inside the loaded branch a `<p class="status-error" role="alert" data-testid="coding-identity-load-error">` banner renders above the success/status lines, so a failed post-save reload keeps the form, the policy/member Selects, and the `Saved.` status.
2. **`GroupProviderSection`.** Gate tightened to `{#if loadError !== null && data === null}`; inline banner `data-testid="group-provider-load-error"` renders inside the `data !== null` branch, preserving the task-instance Select.
3. **`TaskProviderSection`.** Gate tightened to `{#if error !== null && instanceData === null}`; inline banner `data-testid="task-provider-load-error"` renders at the top of the loaded branch, preserving the bind form and Select.
4. **`GuestModeSection`.** Gate tightened to `{#if error !== null && enabled === null}`; inline banner `data-testid="guest-mode-load-error"` renders above the help text, preserving the header toggle.
5. **`ReleaseSubscriptionSection`.** Gate tightened to `{#if loadError !== null && enabled === null}` (preserving its custom `ErrorState title="Couldn't load subscription"`); inline banner `data-testid="release-subscription-load-error"` renders above the caption, preserving the header toggle.
6. **Per-section test coverage.** Each of the five sections gained a client DOM test that loads successfully, triggers the mutation whose follow-up reload returns 500, and asserts `.ui-error` is absent while the control (and success status, where set) plus the inline banner survive.

## Consequences

### Positive

- A failed post-mutation reload no longer discards a successful save from the UI in any of the five sections; the form/controls and success status survive with a clear inline `role="alert"` banner.
- The first-load failure path is unchanged — a never-loaded section still dead-ends on the framed `ErrorState` + retry.
- All five sections now follow the same render convention as `ByokSection`/`CodeHostSection`/`MemorySection`, removing a split in the settings surface.
- The already-correct sections were left untouched, as specified.

### Negative

- Each section now has two error-render paths (full `ErrorState` vs inline banner) whose mutual exclusion depends on the sentinel staying correct; a future edit that resets the sentinel on reload could regress the gate.
- The displayed data after a refresh failure is stale until the next successful load/retry (the correct UX trade-off, but the section shows potentially outdated state alongside the error banner).

### Risks

- **Sentinel integrity.** The gate is only as good as the "never loaded" flag. If a future refactor clears `loaded`/`data`/`instanceData`/`enabled` to `null` on a refresh, the full `ErrorState` would take over again. Workstream B's contextId guard helps here by preventing stale writes, but does not protect the sentinel itself.
- **Inline pass-through of backend reload errors.** The banner surfaces the raw backend message via `formatFetchError`, which could expose an unhelpful string if the backend message is poor.

## Related Decisions

- **ADR-0266: Settings Section Robustness — A: Save-Locking Selects** — sibling workstream from the same shared design; shares the `CodingIdentitySection`/`GroupProviderSection`/`TaskProviderSection` touch points.
- **ADR-0267: Settings Section Robustness — B: Stale contextId Guard** — sibling workstream from the same shared design; Workstream C's plan recommended running B first, and the reload-error writes guarded by B compose cleanly with the gates added here.
- **ADR-0253: ReleaseSubscriptionSection UX Fixes** — that same-day-earlier rewrite already delivered Workstream C's `ReleaseSubscriptionSection` outcome (the `loadError !== null && enabled === null` gate + the `release-subscription-load-error` inline banner); see Implementation Notes.
- **ADR-0261: Coding Identity Fixes** — concurrent rewrite of `CodingIdentitySection` whose `loadError / loading / loaded` render gate overlaps with this workstream's Task 1.
- The already-correct `ByokSection`/`CodeHostSection`/`MemorySection`/`CodingCredentialsSection` pattern this convergence mirrors.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/settings/sections/CodingIdentitySection.svelte:109` | Gate `{#if loadError !== null && !loaded}`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:114-116` | Inline banner `data-testid="coding-identity-load-error"` inside the loaded branch. | `read` confirms. |
| `client/settings/sections/GroupProviderSection.svelte:80` | Gate `{#if loadError !== null && data === null}`. | `read` confirms. |
| `client/settings/sections/GroupProviderSection.svelte:85-87` | Inline banner `data-testid="group-provider-load-error"` inside `data !== null`. | `read` confirms. |
| `client/settings/sections/TaskProviderSection.svelte:113` | Gate `{#if error !== null && instanceData === null}`. | `read` confirms. |
| `client/settings/sections/TaskProviderSection.svelte:118-120` | Inline banner `data-testid="task-provider-load-error"` at the top of the loaded branch. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:90` | Gate `{#if error !== null && enabled === null}`. | `read` confirms. |
| `client/settings/sections/GuestModeSection.svelte:95-97` | Inline banner `data-testid="guest-mode-load-error"` above the help text. | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:85` | Gate `{#if loadError !== null && enabled === null}` (custom `ErrorState title` preserved). | `read` confirms. |
| `client/settings/sections/ReleaseSubscriptionSection.svelte:90-92` | Inline banner `data-testid="release-subscription-load-error"` above the caption. | `read` confirms. |
| `tests/client/settings/sections/CodingIdentitySection.test.ts:243-264` | Failed-reload test: no `.ui-error`, form + `coding-identity-load-error` + `Saved.` survive. | `read` confirms. |
| `tests/client/settings/sections/GroupProviderSection.test.ts:321-336` | Failed-reload test: no `.ui-error`, `group-task-instance` + `group-provider-load-error` survive. | `read` confirms. |
| `tests/client/settings/sections/TaskProviderSection.test.ts:306-322` | Failed-reload test: no `.ui-error`, `context-task-instance` + `task-provider-load-error` survive. | `read` confirms. |
| `tests/client/settings/sections/GuestModeSection.test.ts:221-235` | Failed-reload test: no `.ui-error`, `guest-mode-toggle` + `guest-mode-load-error` survive. | `read` confirms. |
| `tests/client/settings/sections/ReleaseSubscriptionSection.test.ts:126-138` | Failed-reload test: no `.ui-error`, `release-subscription-toggle` + `release-subscription-load-error` survive. | `read` confirms. |

Plan-vs-implementation notes:

- **`ReleaseSubscriptionSection`'s C behavior was already delivered by ADR-0253.** The plan (Task 5) assumed the gate was still `{#if loadError !== null}` and prescribed tightening it to `loadError !== null && enabled === null`. In the shipped tree the gate and the `release-subscription-load-error` inline banner are already present — they were introduced by ADR-0253's `loadError`/`actionError` state-machine rewrite (whose notes describe exactly this "loaded-but-refresh-failed" branch and the `release-subscription-load-error` testid). The robustness spec (dated 2026-07-07) appears to have been written against a pre-0253 snapshot. Net result: Task 5's outcome is verified present, but the edit is attributable to ADR-0253, not to this workstream — effectively a verification-only/no-op at merge. The dedicated regression test (`ReleaseSubscriptionSection.test.ts:126-138`) is present and passes.
- **`CodingIdentitySection`'s Task 1 overlaps ADR-0261.** ADR-0261's same-day rewrite established the `loadError / loading / loaded` render gate; this workstream's `!loaded` tightening and `coding-identity-load-error` banner land on top of that rewrite. The end state is verified present; attribution between the two same-day plans is not separable from the tree alone.
- **Inline banners carry explicit `data-testid`s beyond the plan's snippet.** The plan's snippet used a bare `<p class="status-error" role="alert">`. Shipped adds a per-section `data-testid` (`…-load-error`) on each banner, which the regression tests then assert on — a small, additive enhancement that makes the banners queryable.
- **`GuestModeSection` already guarded (Workstream B).** Its `load()` carries the `id !== contextId` guard; the C gate composes with it as the plan anticipated (B first). `GuestModeSection` was not a Workstream C original-spec target list discrepancy — it is in the spec's C table — and its gate `error !== null && enabled === null` plus the `loading && enabled === null` second branch match the plan's "read the region first" guidance.
- **The four already-correct sections + `IdentitySection` were not modified**, as specified; verified absent of `…-load-error` testids and unchanged gating.

The source plan `docs/superpowers/plans/2026-07-07-settings-robustness-C-refresh-failure-gate.md` is archived alongside this ADR to `docs/archive/`. The shared design spec (`2026-07-07-settings-section-robustness-design.md`) is archived with ADR-0266.
