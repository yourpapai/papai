<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0422: AnalyticsPreferences Consent Findings — Shipped

## Status

Accepted

## Date

2026-08-10

## Context

`docs/archive/2026-08-09-analytics-preferences-ux-findings.md` (paired spec
`docs/archive/2026-08-09-analytics-preferences-ux-findings-design.md`) closed
fifteen open UX findings against `AnalyticsPreferencesSection` plus the two
shared-primitive defects those findings forced. The design and plan were
written on the `ui-ux-review-04` branch before the OpenSpec cutover and merged
as-is, arriving as a late `docs/superpowers/` addition after the freeze. This
is the third late-arrival drain batch (2 plans + 2 specs), following the first
(ADRs 0383–0419) and the second (ADR-0421).

## Decision Drivers

- The section's consent controls could not be reached by keyboard: a
  `SegmentedControl` with no matching option dropped out of the tab order
  entirely, so a user whose stored preference fell outside the option set had
  no way to change it.
- Consent copy claimed outcomes the code did not deliver, and the
  legitimate-interest branch was tangled enough that it could only be checked
  by mounting the component.
- A field's head control was described by nothing rather than by its hint, so
  the `aria-describedby` contract was silently empty for the row that most
  needed it.

## Decision

Archive the plan and spec as shipped. The work landed on `ui-ux-review-04`
bottom-up in three layers:

**Shared primitives**

- `b10d97819` fix(ui): a segmented control with no matching option stays reachable
- `9c2d3cd02` feat(ui): a live region that exists before it has anything to say
- `f0f802799` fix(ui): make LiveRegion a single reconciled element across tone changes
- `921ef8866` fix(settings): a field's head control is described by its hint, not by nothing

**Pure copy module**

- `641048920` feat(settings): analytics consent copy is a pure, testable function

**The section itself**

- `00a1379a7` refactor(settings): analytics consent rows become real settings fields
- `3e47acd52` fix(settings): analytics consent says what it did and why it can't
- `f2ad0d8f0` fix(analytics-preferences): wire busy to action Btns, cover error describedby
- `de22d584c` fix(analytics-preferences): signal and surface refresh failures

**Fixtures, visual states, bookkeeping**

- `b72105889` test(stories): capture unavailable rights and legitimate-interest consent
- `b9f15a316` docs(ux-review): close the analytics consent findings
- `26dbe2a26` test(ux-backlog): count the AnalyticsPreferencesSection review document
- `8bbd7eb4e` test(visual): regenerate the AdminUsersSection screenshot region

`LiveRegion` was introduced here as a shared primitive and later extended by
the live-region adoption sub-project (ADR-0423).

## Consequences

### Positive

- Consent state is now expressible as a pure function of preference state
  (`analytics-preferences-copy.ts`), so the legitimate-interest branch is unit
  tested without mounting Svelte.
- The section renders through real `SettingsFieldShell` rows, inheriting the
  settings UI's spacing, labelling, and error channel rather than re-deriving
  them locally.

### Negative

- `LiveRegion` shipped with its message mounted alongside the region in the
  same tick, which does not reliably announce. That defect was recorded as a
  finding at the time and fixed by the follow-on sub-project (ADR-0423) rather
  than here.

## Implementation Status

Implemented. `client/shared/ui/LiveRegion.svelte` and
`client/shared/ui/SegmentedControl.svelte` carry the primitive fixes;
`client/settings/sections/analytics/analytics-preferences-copy.ts` holds the
pure copy function, whose `unsetAdmitsCollection` mirrors the server-side
lawful-basis logic in `src/analytics/governance/eligibility.ts`;
`client/settings/sections/AnalyticsPreferencesSection.svelte` renders the rows.
Covered by `tests/client/settings/sections/AnalyticsPreferencesSection.test.ts`
and the section's Storybook fixtures.

## References

- Plan: `docs/archive/2026-08-09-analytics-preferences-ux-findings.md`
- Spec: `docs/archive/2026-08-09-analytics-preferences-ux-findings-design.md`
- Review document: `docs/ux-reviews/AnalyticsPreferencesSection.md`
- Follow-on: ADR-0423 (live-region adoption)
- Drain context: `docs/superpowers/README.md` "Late arrivals from origin/master";
  lane-0-parity convention per ADR-0418 / ADR-0419 / ADR-0421
