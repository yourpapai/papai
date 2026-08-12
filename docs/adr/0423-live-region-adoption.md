<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0423: Live-Region Adoption in the Field Primitives — Shipped

## Status

Accepted

## Date

2026-08-10

## Context

`docs/archive/2026-08-09-live-region-adoption.md` (paired spec
`docs/archive/2026-08-09-live-region-adoption-design.md`) replaced hand-rolled
`{#if message}<p role="alert">…</p>{/if}` markup with an always-mounted
`LiveRegion` in the three shared field primitives and two settings sections.
The design and plan were written on the `ui-ux-review-04` branch before the
OpenSpec cutover and merged as-is, arriving as a late `docs/superpowers/`
addition after the freeze. It drains in the same third batch as ADR-0422.

## Decision Drivers

- **A live region announces a change only if the element already existed when
  the text arrived.** A region created in the same tick as its message is
  routinely missed by screen readers. Ten sites in `client/` built their status
  and error text that way, so the node and the text appeared together and the
  announcement was lost.
- Two UX findings named the defect directly:
  `admin-users-live-region-mounts-with-text` (Med) and
  `coding-mcp-live-region-mounts-with-text` (Low).
- `LiveRegion` (introduced in ADR-0422) already solved this at section level;
  it needed `id` and `class` props to serve the field primitives, whose
  `aria-describedby` points at the error node.

## Decision

Archive the plan and spec as shipped. Scope was deliberately partial: the
primitives plus the two sections carrying open findings, **not** the ~19 other
sections whose section-level status paragraphs keep the old shape. That chosen
inconsistency is made a checked-in fact by the allowlist in
`tests/client/live-region-guard.test.ts` rather than left unwritten.

- `167170716` docs(specs): design for always-mounted live regions in the field primitives
- `606137d6a` docs(plans): implementation plan for live-region adoption
- `d4bf85939` feat(ui): LiveRegion accepts an id and a replacement class (Task 1)
- `7158a076b` fix(ui): Field mounts its error region before the error arrives (Task 2)
- `ad2c6e868` fix(settings): SettingsFieldShell mounts its error region before the error (Task 3)
- `3694868ca` fix(settings): ConfigFieldRow announces a save from a mounted region (Task 4)
- `3c1f47924` fix(admin): AdminUsersSection mounts its live regions before their messages (Task 5)
- `b0feedd4d` test(admin): assert the announced text, not just the region's role (Task 5 fix)
- `3445701a9` fix(settings): CodingMcpSection mounts its live regions before their messages (Task 6)
- `75cff698e` test(client): guard against hand-rolled live regions outside LiveRegion (Task 7)
- `0df70e776` docs(test): record what the live-region guard's pattern does not catch
- `e84fb239f` docs(ux-reviews): close the two live-region findings (Task 8)
- `0132b7c1c` test(settings): assert the ConfigFieldRow error text, not just its node

Two design decisions are load-bearing and easy to undo by accident:

1. **`class` replaces the tone class rather than joining it.** `tone` owns
   `role`/`aria-live` — the accessibility contract — while `class` overrides the
   visual default. Joining them would leave `settings.css`'s global
   `status-error` font-size and margin contested with the field's own.
2. **An empty region is a zero-height grid/flex child that still consumes a full
   `gap`**, and it cannot be `display:none`'d or `visibility:hidden`'d without
   leaving the accessibility tree — the one thing it is mounted for. Each
   primitive therefore *cancels* the gap with a negative margin under a
   `:has()` / `:empty` selector instead of removing the box.

## Consequences

### Positive

- Every section rendering through the three primitives is fixed for free.
- The guard test fails both ways: a new file hand-rolling the markup fails, and
  an allowlist entry that no longer matches fails, so the list shrinks as later
  sub-projects convert sections rather than outliving them.

### Negative

- The guard's pattern catches literal `role="alert"` / `role="status"` /
  `aria-live` only. It misses a dynamic `role={…}` binding (the form
  `LiveRegion.svelte` itself uses) and an `aria-live` arriving through a prop
  spread. Recorded in the guard file's own header comment.
- Separately, ~22 files under `client/` render errors as `class="status-error"`
  with no role at all. They never match the pattern, so they are neither caught
  nor allowlisted — a known, unclosed gap.
- Once a node is unconditionally mounted, any assertion whose strength depended
  on its absence becomes vacuous. Two such assertions were found and fixed
  (`b0feedd4d`, `0132b7c1c`); the class of defect is worth re-checking whenever
  a further section converts.

## Implementation Status

Implemented. `client/shared/ui/LiveRegion.svelte` carries the `id`/`class`
props; the always-mounted region and its gap-cancellation rule are in
`client/shared/ui/Field.svelte`,
`client/settings/components/SettingsFieldShell.svelte`, and
`client/settings/components/ConfigFieldRow.svelte`;
`client/settings/sections/admin/AdminUsersSection.svelte` and
`client/settings/sections/CodingMcpSection.svelte` are converted. Drift is
gated by `tests/client/live-region-guard.test.ts`. Both source findings are
`fixed` in `docs/ux-reviews/AdminUsersSection.md` and
`docs/ux-reviews/CodingMcpSection.md`.

## References

- Plan: `docs/archive/2026-08-09-live-region-adoption.md`
- Spec: `docs/archive/2026-08-09-live-region-adoption-design.md`
- Predecessor: ADR-0422 (introduced `LiveRegion`)
- Drain context: `docs/superpowers/README.md` "Late arrivals from origin/master";
  lane-0-parity convention per ADR-0418 / ADR-0419 / ADR-0421
