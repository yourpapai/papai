<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Migrate brainstorming → OpenSpec

## Why

papai's planning pipeline runs on `obra/superpowers` skills: `brainstorming`
produces single-file design docs under `docs/superpowers/specs/`,
`writing-plans` turns them into plan docs, `executing-plans` /
`subagent-driven-development` run them. These docs go stale, carry no
machine-readable state, and leave no living spec tree. OpenSpec is already
scaffolded (`openspec/config.yaml`, `openspec-*` skills, `opsx` commands) per
`docs/architecture/openspec-superpowers-hybrid.md`, but every entry point
still routes to the old flow. This change performs the migration itself, as
the first dogfood change on the new workflow.

## What Changes

- Rewire `CLAUDE.md` "Pi Workflow" section into a routing table: code-behavior
  work enters via `/opsx:explore` / `/opsx:propose`; `brainstorming` keeps
  non-code creative work only.
- Retarget repo-local custom skills (`.claude/skills/` + identical
  `.agents/skills/` copies): `syncing-plan-with-code` syncs
  `openspec/changes/<name>/` artifacts instead of `docs/superpowers/plans/`;
  `designing-new-provider` routes through explore → propose instead of
  brainstorming → writing-plans.
- Freeze `docs/superpowers/` as legacy reference (strangler: no backfill).
  `openspec/specs/` starts empty and accretes from future changes.
- Update `mutation-improve` dev tooling: diff-guard `ALLOWED_PREFIXES` and
  prompt-template spec/plan paths move from `docs/superpowers/` to
  `openspec/changes/`.
- Update `tests/CLAUDE.md` and `docs/superpowers/e2e-planning-workflow.md`
  pointer language where they send authors to the old artifact homes.
- Freeze `scripts/plan-adr-workflow*.ts` as legacy-only tooling: it keeps
  processing the frozen corpus, while new work archives through OpenSpec and
  ADRs are written manually via the architecture-decision-records skill.
- Move the `scripts/tool-surface-benchmark.ts` default output path out of
  `docs/superpowers/plans/` (today it writes new files into the legacy tree).
- Note in `review-loop/CLAUDE.md` that `--plan` takes a change's `tasks.md`;
  review-loop is plan-path-agnostic and needs no code change.
- Replace §4 of `docs/architecture/openspec-superpowers-hybrid.md` with a
  pointer to this change's `design.md` (the operational migration guide).

## Capabilities

### New Capabilities

None — pure dev-workflow/docs/tooling change; no papai runtime behavior
changes. `skip_specs: true` is set in `.openspec.yaml`.

### Modified Capabilities

None. `openspec/specs/` is empty; no existing capability specs are touched.

## Non-goals

- No backfill of the legacy corpus (92 specs, 76 plans, 17 notes) into
  `openspec/specs/`; ADRs and `docs/archive/` remain the historical record.
- No porting of in-flight legacy work (`docs/superpowers/remaining/`, recent
  pending designs); items are ported lazily via `/opsx:propose` when adopted.
- No changes to papai runtime code (`src/`, `client/`, `plugins/`); no effect
  on platform instances, task instances, or the config-context scope model.
- No edits to global `~/.claude/skills/` (superpowers stays vanilla for other
  projects); overrides are scoped to this repo.
- No separate `openspec/` trees for `review-loop/` or `mutation-improve/`;
  they share the repo-root tree.
- No `review-loop` code changes and no retirement of the `plan-adr-workflow`
  script family (it stays usable against the legacy corpus).
- No schema fork and no expanded-profile decision; revisit after 2–3 changes.

## Impact

- **Docs/instructions:** `CLAUDE.md`, `tests/CLAUDE.md`,
  `mutation-improve/CLAUDE.md`, `review-loop/CLAUDE.md`,
  `docs/architecture/openspec-superpowers-hybrid.md` (§4 superseded),
  `docs/superpowers/e2e-planning-workflow.md`.
- **Repo skills:** `syncing-plan-with-code`, `designing-new-provider` in
  `.claude/skills/` and `.agents/skills/`.
- **Dev tooling:** `mutation-improve/src/diff-guard.ts`,
  `mutation-improve/src/prompt-templates.ts` (workspace-local, verified by
  `bun test` within `mutation-improve/`); `scripts/tool-surface-benchmark.ts`
  default output path (+ its test); legacy-only header note on
  `scripts/plan-adr-workflow.ts`.
- **OpenSpec tree:** this change is the first entry under
  `openspec/changes/`; `openspec/specs/` intentionally stays empty.
