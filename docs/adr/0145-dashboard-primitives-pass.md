<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0145: Dashboard Primitives Pass

## Status

Implemented

## Date

2026-05-26 – 2026-05-26

## Context

The dashboard UI audit (`docs/design/dashboard-ui-audit.md`) identified
cross-cutting issues in the shared UI primitives used across the debug and
admin surfaces. The most impactful problems were:

1. **Missing interactive styles** — `Btn` had no `:hover` rules for any of its
   five variants, making buttons feel unresponsive.
2. **Incomplete prop surfaces** — `Btn` lacked an `icon` Snippet; `Panel` had no
   `pad` control; `KV.v` accepted only `string | number`, blocking rich content
   like pills and badges; `TopBar.statusRow` was required even when unused.
3. **Unstyled composite components** — `TreeView` and `PropertiesTable`
   referenced CSS classes in their templates but defined none of them, producing
   unstyled output.
4. **Missing CSS definitions** — `.status-success`, `.truncation-banner`,
   `.masked-value`, and `.masked-hint` were used in markup but never defined.
5. **`.panel` CSS-class collision** — `admin.css` defined a bare `.panel` rule
   (20px padding, no radius) that collided with the `<Panel>` UI primitive.
   Six admin sections (`Billing`, `Groups`, `Identities`, `Memos`, `Reminders`,
   `System`) applied `class="panel"` on their outer `<section>`, causing
   double-padding when those sections also used `<Panel>` internally.

All changes were strictly visual/structural — no fetcher, state-store, or API
behavior changes.

## Decision Drivers

- **Visual correctness**: Unstyled or mis-styled primitives erode trust in the
  dashboard and make subsequent layout work unreliable.
- **Naming hygiene**: A CSS class collision between a global `.panel` rule and
  the `<Panel>` component's `.ui-panel*` namespace is a defect, not a feature.
- **TDD discipline**: Every prop or CSS addition must have a corresponding unit
  test; the project's write-hook pipeline enforces this.
- **Minimal scope**: This pass targets only the highest-leverage cross-cutting
  fixes; section-level content rewrites and new composite components are
  explicitly deferred.

## Considered Options

### Option A: Fix each section independently

Patch each admin section's CSS locally, add hover rules inline, and leave the
`.panel` collision in place.

- **Pros**: Smaller diff per section; no shared-primitive changes.
- **Cons**: The root cause (missing primitive props, class collision) persists;
  each section repeats the same workaround; future sections inherit the same
  problems.

### Option B: Shared-primitive pass + collision removal (chosen)

Fix the shared primitives (`Btn`, `Panel`, `KV`, `TopBar`), define the missing
CSS classes, add scoped styles to `TreeView` and `PropertiesTable`, and remove
the `.panel` collision by hoisting padding to `.admin-section`.

- **Pros**: Root-cause fixes; all sections benefit; no naming collision; clean
  primitive contracts for future section work.
- **Cons**: Larger diff; touches six sections and two CSS files in one pass.

### Option C: Rename `.panel` to `.section-pad` only

Change only the CSS class name without fixing any primitives.

- **Pros**: Smallest possible change for the collision.
- **Cons**: Leaves all other audit items unresolved; the section still bypasses
  the `<Panel>` primitive.

## Decision

**Option B** — shared-primitive pass with collision removal. Subsidiary decisions:

| Topic                 | Decision                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------- | ---------------- | ------ | -------------------------------- |
| Btn hover             | Add `:hover:not(:disabled)` rules for all five variants using design tokens.                       |
| Btn icon              | Add optional `icon` Snippet prop, rendered before children in a `.ui-btn__icon` span.              |
| Panel pad             | Add optional `pad` number prop, forwarded as inline `padding` on `.ui-panel__body`.                |
| KV value              | Broaden `v` from `string                                                                           | number`to`string | number | Snippet`; render via type guard. |
| TopBar statusRow      | Make `statusRow` optional; conditionally render the status row block.                              |
| TreeView / PropsTable | Add scoped `<style>` blocks defining all template-referenced classes using design tokens.          |
| Missing CSS classes   | Define `.status-success`, `.status-error`, `.truncation-banner` in `base.css`; `.masked-value` and |
|                       | `.masked-hint` in `admin.css`.                                                                     |
| `.panel` collision    | Remove bare `.panel` rule from `admin.css`; strip `panel` from six section class lists; add        |
|                       | `.admin-section { padding: 20px }` as the replacement.                                             |

## Consequences

### Positive

- All five `Btn` variants now have visible hover feedback.
- `Btn.icon`, `Panel.pad`, `KV.v` as Snippet, and optional `TopBar.statusRow`
  enable richer section layouts without ad-hoc workarounds.
- `TreeView` and `PropertiesTable` render styled output matching the design
  token system.
- The `.panel` naming collision is eliminated; `<Panel>` primitive and admin
  section styling are independent.
- Every change is covered by unit tests enforced by the TDD write-hook pipeline.

### Negative

- Six admin sections were touched simultaneously; any section-specific
  regression requires checking all six.
- `KV.v` type-widening to include `Snippet` is a breaking-type change for
  consumers that narrow on `string | number` — none currently do.

### Risks

- The `.admin-section { padding: 20px }` replacement is a single rule; if a
  future section needs different padding, it must override via a more-specific
  selector or use the `<Panel pad>` prop.
- Inline `style:padding` on `<Panel>` body may interact with responsive
  breakpoints that override padding at the class level.

## Implementation Notes

Modified primitives: `client/shared/ui/Btn.svelte`, `Panel.svelte`, `KV.svelte`,
`TopBar.svelte`.

Styled composites: `client/shared/TreeView.svelte`, `PropertiesTable.svelte`.

CSS changes: `client/shared/base.css` (status/truncation rules),
`client/admin/admin.css` (masked rules, `.panel` removal, `.admin-section`
addition).

Migrated sections: `BillingSection`, `GroupsSection`, `IdentitiesSection`,
`MemosSection`, `RemindersSection`, `SystemSection` — all stripped the `panel`
class from their outer `<section>`.

Test additions: prop and CSS-source assertions in `tests/client/shared/ui/`,
`tests/client/shared/base-css.test.ts`, `tests/client/admin/admin-css.test.ts`,
`tests/client/shared/PropertiesTable.test.ts`, and
`tests/client/admin/sections/section-panel-class.test.ts`.

Implementation plan:
`docs/archive/2026-05-26-dashboard-primitives-pass.md`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin tools use the same `Btn` and
  `Panel` primitives in admin sections.
- Dashboard UI audit (`docs/design/dashboard-ui-audit.md`) — the source of the
  identified issues; this pass resolves §1.2–§1.8.
