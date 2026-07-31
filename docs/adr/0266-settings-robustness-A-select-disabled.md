<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0266: Settings Section Robustness — A: Save-Locking Selects

## Status

Implemented (with divergence)

## Date

2026-07-07

## Context

The shared `Select` primitive (`client/shared/ui/Select.svelte`) — the dropdown every settings section built on after the `Field`/`Select` consolidation — had `value`/`options`/`onChange`/`testid` props but **no `disabled` prop and no `:disabled` style**. Four settings sections drive a mutation straight off a `Select` choice: `CodingIdentitySection` (policy + designated-member selects → PATCH), `GroupProviderSection` (group task instance → PATCH), `TaskProviderSection` (personal task instance bind → PATCH), and `admin/AdminInstancesSection` (platform/task-instance create forms). None could lock their dropdown while a save/bind/create was in flight, so a user could change the selection mid-request and the in-flight PATCH would persist the *previous* selection while the UI showed the new one — a regression surfaced when `CodingIdentitySection` moved off a raw `<select disabled=…>` onto the shared primitive (ADR-0261).

The shared design (`docs/superpowers/specs/2026-07-07-settings-section-robustness-design.md`, Workstream A) and plan (`docs/superpowers/plans/2026-07-07-settings-robustness-A-select-disabled.md`) resolved it by mirroring `Btn`'s existing `disabled` prop + `:disabled` style: add a backward-compatible `disabled?: boolean` to `Select`, then wire each section's existing in-flight flag (`saving`/`binding`) — plus a new `creating` flag for `AdminInstancesSection`, whose create flows had no busy flag — onto its mutating `Select`(s). No backend, schema, or fetcher changes.

## Decision Drivers

- **No mid-flight selection changes.** A mutating `Select` must be non-interactive while its PATCH/bind/create is in flight, so the persisted value and the displayed value cannot diverge.
- **Mirror `Btn`'s established disabled affordance.** `Btn` already has a `disabled` prop + `.ui-btn:disabled { opacity: 0.5; cursor: not-allowed }` (`Btn.svelte:66`); `Select` should follow the same shape so disabled controls read consistently across primitives.
- **Additive-only shared-primitive change.** Existing `Select` callers omit the prop, so resting appearance is unchanged; the disabled style is a new class, not a restyle of the resting state.
- **Reuse each section's existing in-flight flag.** Wire `saving`/`binding` rather than introducing per-section new state, except where a create flow genuinely has no flag (`AdminInstancesSection`).
- **Client-DOM test per wired section.** Drive a never-resolving mutation and assert the underlying `<select>` reports `disabled === true`, matching the section-test conventions used by the sibling UX-fix ADRs.

## Considered Options

### Option 1 — `disabled` prop on shared `Select`; wire each section's in-flight flag (chosen)

Add `disabled?: boolean` (default `false`) to `Select`, toggle a `ui-select--disabled` class on the `.ui-select` wrapper and pass `disabled` through to the `<select>` element; wire `disabled={saving|binding|creating}` into the four mutating sections.

- **Pros:** one primitive change covers every current and future mutating Select; backward compatible (default `false`); disabled affordance is visually/semantically consistent with `Btn`; minimal per-section diff (one prop each).
- **Cons:** touches the shared primitive, so its stories must be re-shot on future edits; one new section (`AdminInstancesSection`) needs a create-flag added because its create flow had none.

### Option 2 — Per-section disabled styling on the raw `<select>`

Leave `Select` alone and have each section pass a local `disabled` attribute / local CSS.

- **Pros:** zero blast radius on the shared primitive.
- **Cons:** `Select` does not forward an unknown `disabled` to its internal `<select>` today, so this requires a `Select` change anyway; duplicates the disabled affordance four times; future mutating Selects each re-implement it.

### Option 3 — Lock the whole form via a fieldset `disabled` instead of per-control

Wrap each mutating form in `<fieldset disabled={saving}>`.

- **Pros:** one attribute locks every nested control.
- **Cons:** changes form structure in four sections (larger diff); `Select`/`Input` primitives do not all opt out of fieldset-disabled semantics uniformly; over-broad — it would also disable non-Select controls the design intends to keep editable.

## Decision

The chosen Option 1 shipped in full across the shared primitive, the four wired sections, and their client tests:

1. **`Select` `disabled` prop (`client/shared/ui/Select.svelte`).** `disabled?: boolean` added to `Props` (default `false`); the `.ui-select` wrapper toggles `class:ui-select--disabled={disabled}` and the `<select>` receives `{disabled}`; a `.ui-select--disabled { opacity: 0.6; cursor: not-allowed; }` rule mirrors `Btn`'s disabled style.
2. **`CodingIdentitySection` Selects locked while saving.** Both the policy `Select` (`testid="coding-identity-policy"`) and the designated-member `Select` (`testid="coding-identity-member"`) receive `disabled={saving}`.
3. **`GroupProviderSection` Select locked while saving.** The group-task-instance `Select` (`testid="group-task-instance"`) receives `disabled={saving}`.
4. **`TaskProviderSection` Select locked while binding.** The context-task-instance `Select` (`testid="context-task-instance"`) receives `disabled={binding}`.
5. **`AdminInstancesSection` create Selects locked while creating.** New create-in-flight state wraps both `createPlatform` and `createTask`; the platform-type and task-type `Select`s are locked during their respective create call.
6. **`Select` test coverage.** A new `Select` test asserts the `<select>` reports `disabled === true` and the `.ui-select--disabled` class is present when `disabled` is passed.
7. **Per-section test coverage.** `CodingIdentitySection`, `GroupProviderSection`, and `TaskProviderSection` each gained a client DOM test that drives a never-resolving PATCH and asserts the mutating `<select>` is `disabled` mid-flight.

## Consequences

### Positive

- A mutating `Select` can no longer be re-selected mid-save, so the persisted value and the displayed value cannot diverge across all four sections.
- The disabled affordance is consistent with `Btn` (dimmed + `not-allowed` cursor) and travels with the primitive into every consumer.
- The `Select` change is additive and backward-compatible: existing callers pass no `disabled` and are visually unchanged.
- `AdminInstancesSection` create flows gained a real busy flag, which also feeds the create buttons' `busy`/`disabled` state (not just the Select).

### Negative

- The shared `Select` primitive is touched, so its stories must be re-shot on any future change to confirm additive-only diffs.
- `AdminInstancesSection` has no dedicated section test, so its create-locking is covered by typecheck + suite-green rather than an explicit assertion (the plan explicitly accepted this).

### Risks

- **Blast radius of the `Select` change.** Any future edit to `disabled` forwarding or the `.ui-select--disabled` rule must re-shoot the shared `Select` stories and spot-check consuming sections.
- **Disabled ≠ busy semantics.** The `Select` uses `disabled` (forbidden) rather than a `busy` affordance; this matches the "no mid-flight change" intent but does not signal *why* the control is locked to assistive tech beyond the native disabled semantics.

## Related Decisions

- **ADR-0267: Settings Section Robustness — B: Stale contextId Guard** — sibling workstream from the same shared design; touches several of the same sections (`GroupProviderSection`, `TaskProviderSection`) for a different concern.
- **ADR-0268: Settings Section Robustness — C: Refresh-Failure Gate** — sibling workstream from the same shared design; also touches `CodingIdentitySection`/`GroupProviderSection`/`TaskProviderSection`.
- **ADR-0261: Coding Identity Fixes** — concurrent rewrite of `CodingIdentitySection` that moved it onto the shared `Select` primitive (creating the regression this workstream closes) and supplied the `saving` flag wired here.
- The `Btn` `disabled` prop + `:disabled` style (`Btn.svelte`) this change mirrors.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `client/shared/ui/Select.svelte:19` | `disabled?: boolean` in `Props`. | `read` confirms. |
| `client/shared/ui/Select.svelte:23` | `disabled = false` destructured default. | `read` confirms. |
| `client/shared/ui/Select.svelte:32` | `class:ui-select--disabled={disabled}` on the wrapper. | `read` confirms. |
| `client/shared/ui/Select.svelte:33` | `<select {value} {disabled} onchange=…>`. | `read` confirms. |
| `client/shared/ui/Select.svelte:74-77` | `.ui-select--disabled { opacity: 0.6; cursor: not-allowed; }`. | `read` confirms. |
| `tests/client/shared/ui/Select.test.ts:84-103` | Disabled test: asserts `sel.disabled === true` + `.ui-select--disabled` present. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:128` | Policy `Select` `disabled={saving}`. | `read` confirms. |
| `client/settings/sections/CodingIdentitySection.svelte:138` | Designated-member `Select` `disabled={saving}`; `saving` declared at `:44`. | `read` confirms. |
| `client/settings/sections/GroupProviderSection.svelte:99` | Group-task-instance `Select` `disabled={saving}`; `saving` declared at `:29`. | `read` confirms. |
| `client/settings/sections/TaskProviderSection.svelte:134` | Context-task-instance `Select` `disabled={binding}`; `binding` declared at `:39`. | `read` confirms. |
| `client/settings/sections/admin/AdminInstancesSection.svelte:326` | Platform-type `Select` `disabled={creatingPlatform}`. | `read` confirms. |
| `client/settings/sections/admin/AdminInstancesSection.svelte:384` | Task-type `Select` `disabled={creatingTask}`. | `read` confirms. |
| `tests/client/settings/sections/CodingIdentitySection.test.ts:231-241` | "disables the policy Select while a save is in flight" — never-resolving PATCH, asserts `sel.disabled === true`. | `read` confirms. |
| `tests/client/settings/sections/GroupProviderSection.test.ts:305-319` | "disables the task-instance Select while a save is in flight". | `read` confirms. |
| `tests/client/settings/sections/TaskProviderSection.test.ts:324` | "disables the instance Select while a bind is in flight". | `grep` confirms. |

Plan-vs-implementation notes:

- **`AdminInstancesSection` uses two create flags, not one.** The plan specified a single `creating` flag shared by both create flows. Shipped introduces two flow-specific flags — `creatingPlatform` (`:59`) and `creatingTask` (`:60`) — each wrapping only its own `createPlatform`/`createTask` body (`creatingPlatform` set at `:140` / reset at `:151`; `creatingTask` set at `:159` / reset at `:170`) and bound to its own create `Select` + create button (`disabled={creatingPlatform}`/`disabled={creatingTask}`). Net effect is identical (each create Select locks during its own create) and arguably cleaner — one create cannot disable the other form's Select — but it diverges from the single-flag design.
- **`Select` also gained an unrelated `placeholder` prop.** The plan added only `disabled`. Shipped adds `placeholder?: string` (`Select.svelte:20`, `:23`, rendered at `:34-36`) in the same primitive edit, with its own test (`Select.test.ts:105-127`). It is additive and independent of the disabled work, but ships together with it.
- **Disabled style uses `opacity: 0.6`, not `Btn`'s `0.5`.** The plan said to "mirror `Btn`" (which uses `opacity: 0.5`); the spec body specified `0.6`. Shipped follows the spec's `0.6` (`Select.svelte:74-77`). Minor; the disabled affordance is still visually distinct.
- **`CodingIdentitySection` locking overlaps ADR-0261.** ADR-0261's concurrent rewrite of `CodingIdentitySection` moved it onto the shared `Select` and introduced the `saving` flag; this workstream's `disabled={saving}` wiring lands on top of that rewrite. The end state is verified present; attribution between the two same-day plans is not separable from the tree alone.

The source plan `docs/superpowers/plans/2026-07-07-settings-robustness-A-select-disabled.md` is archived alongside this ADR to `docs/archive/`. The shared design spec (`2026-07-07-settings-section-robustness-design.md`) is archived with ADR-0266.
