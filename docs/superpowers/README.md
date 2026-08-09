<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# docs/superpowers/ — frozen legacy tree

This tree is **frozen**. It is the historical record of papai's pre-OpenSpec
planning pipeline (`brainstorming` → `writing-plans` → `executing-plans`):
92 design specs, 76 plans, 17 notes, and the `remaining/` briefs. Planning
now runs on OpenSpec: new work enters via `/opsx:explore` / `/opsx:propose`
and lives under `openspec/changes/<name>/`. There is no backfill — see the
`migrate-brainstorming-to-openspec` change for the migration design.

## Disposition rules

The step-by-step porting procedure (triage signals, lane definitions, queue
inventory) lives in
[`docs/operations/legacy-migration-runbook.md`](../operations/legacy-migration-runbook.md).
Summary:

- **Adopting a `remaining/` brief or a pending design** → `/opsx:propose` a
  change and port its content into `proposal.md` / `design.md` / `tasks.md`;
  then delete the stale legacy file in the same commit (runbook Lane 1).
- **Referencing shipped behavior** → read the ADRs in `docs/adr/` and the
  archived design+plan pairs in `docs/archive/`; read `specs/` here only as
  historical detail. Shipped plans drain to `docs/archive/` via
  `scripts/plan-adr-workflow.ts` (runbook Lane 0); a change that modifies a
  legacy-documented capability seeds its spec first (runbook Lane 2).
- **No new files** under this tree, with one carve-out:
  `remaining/` briefs written by `scripts/plan-adr-workflow.ts`, which is
  frozen as legacy-only tooling for processing this residual corpus.

The e2e planning workflow and test-plan template moved out of this tree to
`docs/operations/` (they are living operational docs, not legacy planning
artifacts).
