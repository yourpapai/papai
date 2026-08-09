<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Migrate brainstorming → OpenSpec

## 1. Rewire the entry point

- [x] 1.1 Replace the "Pi Workflow" section in `CLAUDE.md` (AGENTS.md is a
      symlink to it) with the routing table from design.md D4: code-behavior work
      routes to `/opsx:explore` / `/opsx:propose`, brainstorming keeps non-code
      creative work only, all other superpowers skill references stay. Verify:
      `grep -n "opsx" CLAUDE.md` shows the routing table and
      `grep -n "obra/superpowers" CLAUDE.md` no longer gates all creative work.

## 2. Retarget repo-local skills (both copies per skill, same commit)

- [x] 2.1 Rewrite `syncing-plan-with-code` in `.claude/skills/` and
      `.agents/skills/` identically: plan paths become
      `openspec/changes/<name>/` artifacts, drift sync goes through
      `/opsx:update`, follow-up plans become follow-up changes. Verify:
      `diff .claude/skills/syncing-plan-with-code/SKILL.md .agents/skills/syncing-plan-with-code/SKILL.md`
      is empty and `grep -n "docs/superpowers/plans" .claude/skills/syncing-plan-with-code/SKILL.md`
      returns nothing.
- [x] 2.2 Rewrite `designing-new-provider` in `.claude/skills/` and
      `.agents/skills/` identically: the brainstorming step becomes
      `/opsx:explore`, and spec/plan outputs become a proposed change's
      `proposal.md` / `design.md` / `tasks.md`. Verify:
      `diff .claude/skills/designing-new-provider/SKILL.md .agents/skills/designing-new-provider/SKILL.md`
      is empty and `grep -n "brainstorming" .claude/skills/designing-new-provider/SKILL.md`
      returns nothing.

## 3. Retarget mutation-improve (test-first, workspace rules)

- [x] 3.1 Write failing tests in `tests/mutation-improve/`: diff-guard allows
      `openspec/changes/` and rejects `docs/superpowers/`; prompt templates emit
      spec/plan paths under `openspec/changes/<change-name>/`. Run
      `bun test tests/mutation-improve` and watch the new cases fail.
- [x] 3.2 Implement: `ALLOWED_PREFIXES` in `mutation-improve/src/diff-guard.ts`
      becomes `['tests/', 'openspec/changes/']`; `prompt-templates.ts` specPath /
      planPath point into `openspec/changes/`. Run
      `bun test tests/mutation-improve` until green, then
      `cd mutation-improve && bun run typecheck`.
- [x] 3.3 Update the gate description in `mutation-improve/CLAUDE.md` to name
      `openspec/changes/` instead of `docs/superpowers/`. Verify:
      `grep -n "docs/superpowers" mutation-improve/CLAUDE.md` returns nothing.

## 4. Retarget legacy-coupled scripts, note review-loop usage

- [x] 4.1 Move the `tool-surface-benchmark` default output test-first: update
      the expectation in `tests/scripts/tool-surface-benchmark.test.ts` to
      `docs/research/tool-surface-benchmark-results.md`, run
      `bun test tests/scripts/tool-surface-benchmark.test.ts` and watch it
      fail, then change `DEFAULT_OUTPUT_PATH` in
      `scripts/tool-surface-benchmark.ts` and rerun until green.
- [x] 4.2 Header-mark `scripts/plan-adr-workflow.ts` as legacy-only tooling:
      it processes the frozen `docs/superpowers/` corpus only; new work
      archives through OpenSpec and ADRs are written manually via the
      architecture-decision-records skill (design.md D10). Verify:
      `grep -n "legacy" scripts/plan-adr-workflow.ts` matches.
- [x] 4.3 Add a usage note to `review-loop/CLAUDE.md`: `--plan` points at the
      change's `openspec/changes/<name>/tasks.md` (no code change, D12).
      Verify: `grep -n "openspec/changes" review-loop/CLAUDE.md` matches.

## 5. Retarget e2e planning pointers

- [x] 5.1 Update `tests/CLAUDE.md` so the e2e coverage references send authors
      to `openspec/changes/` artifacts for new work. Verify:
      `grep -n "docs/superpowers" tests/CLAUDE.md` returns nothing.
- [x] 5.2 Update `docs/superpowers/e2e-planning-workflow.md` and
      `docs/superpowers/templates/e2e-test-plan-template.md` so new e2e plans land
      in `openspec/changes/<name>/` instead of `docs/superpowers/plans/`. Verify:
      `grep -rn "docs/superpowers/plans" docs/superpowers/e2e-planning-workflow.md docs/superpowers/templates/`
      returns nothing.

## 6. Freeze the legacy tree and supersede the draft guide

- [x] 6.1 Add `docs/superpowers/README.md` marking the tree frozen, with the
      D5 disposition rules (adopt → `/opsx:propose` and port; shipped truth →
      ADRs/`docs/archive/`; no new files except e2e workflow maintenance and
      the plan-adr-workflow `remaining/` carve-out from D10).
      Verify: file exists and `grep -n "frozen" docs/superpowers/README.md`
      matches.
- [x] 6.2 Replace §4 ("Migration guide: brainstorming → OpenSpec") of
      `docs/architecture/openspec-superpowers-hybrid.md` with a pointer to this
      change's `design.md`. Verify: `grep -n "migrate-brainstorming-to-openspec"
docs/architecture/openspec-superpowers-hybrid.md` matches.

## 7. Sweep and full verification

- [x] 7.1 Sweep instruction surfaces and tooling for stale references:
      `grep -rn "docs/superpowers" CLAUDE.md tests/CLAUDE.md mutation-improve/CLAUDE.md review-loop/CLAUDE.md .claude/skills .agents/skills scripts package.json`
      and `grep -rn "brainstorming\|writing-plans" CLAUDE.md .claude/skills .agents/skills`
      — resolve every hit as retargeted, banner-covered legacy (including
      `tsconfig.json`'s `docs/superpowers/extensions` exclude and code/test
      comments citing legacy spec paths), or a deliberate historical
      reference. Verify: each remaining hit is intentional.
- [x] 7.2 Final gate: run full `bun test`, `bun run typecheck`, `bun run lint`
      from the repo root; confirm the docs index in `CLAUDE.md` and any affected
      `docs/architecture/*.md` pages reflect the new workflow
      (`openspec-superpowers-hybrid.md` §4 pointer from 6.2; no other
      architecture pages describe the planning pipeline). Verify: all three
      commands exit clean.
