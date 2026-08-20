<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Legacy corpus porting procedure

## Why

`migrate-brainstorming-to-openspec` froze `docs/superpowers/` (92 specs, 76
plans, 17 notes, 5 `remaining/` briefs) and deferred porting to "lazily, via
`/opsx:propose`" — one bullet in D5 with no procedure behind it. Meanwhile
`openspec/specs/` is empty, and the strangler has a verified mechanical seam:
`openspec archive` rejects MODIFIED/RENAMED deltas against a capability with
no main spec, so the first change touching a legacy-documented capability
cannot land until that capability is seeded. Without a written procedure,
each adoption/seed/retirement decision gets re-invented ad hoc.

## What Changes

- New runbook `docs/operations/legacy-migration-runbook.md`: the per-item
  procedure for porting the frozen legacy corpus into OpenSpec, one item at a
  time. Four disposition lanes (archive, adopt, seed, retire), triage signals,
  queue inventory, and step-by-step porting maps.
- Triage guidance codified from measured corpus reality: spec `Status:`
  headers and plan checkbox state are unreliable (11 of 12 "pending" specs
  are shipped; 69 of 76 plans never checked boxes); existence of a plan's
  `Create:`/`Modify:` files is the reliable shipped signal.
- Lane 2 (seed) mechanics: direct-write `openspec/specs/<capability>/spec.md`
  as current truth on first touch, `openspec validate --specs --strict`, with
  a `<!-- seeded from ... -->` provenance line.
- Lane 1 (adopt) keeps D5's delete-on-adopt: legacy file removed in the same
  commit as the porting change's artifacts.
- `docs/superpowers/README.md` disposition rules gain a pointer to the
  runbook; `CLAUDE.md` documentation index and
  `docs/architecture/openspec-superpowers-hybrid.md` get reference updates.

## Capabilities

### New Capabilities

None — pure docs/process change. `skip_specs: true` is set in `.openspec.yaml`.

### Modified Capabilities

None. `openspec/specs/` is empty; nothing is modified.

## Non-goals

- No bulk backfill of shipped legacy specs into `openspec/specs/` (D1 of the
  migration change stands; Lane 2 seeds happen lazily, one per first touch).
- No execution of the Lane 0 bulk drain in this change — running
  `plan-adr-workflow` over the ~58–60 verified-shipped plans is a separate
  operational act the runbook prescribes, not performs.
- No retirement of or changes to `scripts/plan-adr-workflow*.ts`.
- No changes to `docs/archive/` or `docs/adr/` content.
- No runtime code (`src/`, `client/`, `plugins/`); no platform/task instance,
  tool-gating, or config-context scope impact (no persisted state keyed by
  any context id); no DB change; no new dependency.
- No migration of `notes/` (17 files) — permanent historical record.

## Impact

- **Docs:** new `docs/operations/legacy-migration-runbook.md`; edits to
  `docs/superpowers/README.md`, `CLAUDE.md` (documentation index),
  `docs/architecture/openspec-superpowers-hybrid.md` (pointer alongside the
  archived migration design).
- **OpenSpec tree:** this change only; no capability specs created.
- **Downstream:** every future legacy adoption or capability seed follows the
  runbook; the archived `migrate-brainstorming-to-openspec` design remains
  the migration rationale.
