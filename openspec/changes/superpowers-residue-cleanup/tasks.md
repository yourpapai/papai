<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Superpowers residue cleanup

All outputs are Markdown/docs moves; the Write/Edit TDD hook pipeline does
not gate docs (design.md D5).

## 1. Retire the dead extension

- [x] 1.1 Delete `docs/superpowers/extensions/compact-tools.ts` (pi runtime
      removed in `ec6cd43df`; nothing loads it).
      Verify: `grep -rn "compact-tools" --include="*.ts" --include="*.json" src/ plugins/ .opencode/ tests/` returns nothing

## 2. Move the living docs

- [x] 2.1 `git mv` the workflow doc to `docs/operations/e2e-planning-workflow.md` and the template to `docs/operations/templates/e2e-test-plan-template.md`; rewrite the Realism Tiers section header per design.md D2 (workflow table becomes canonical; archived spec demoted to historical); fix the in-doc "Starting Point" template path.
      Verify: `grep -n "superpowers" docs/operations/e2e-planning-workflow.md` returns nothing
- [x] 2.2 Update `tests/CLAUDE.md:133` (workflow/template location) and
      remove the living-docs carve-out from `docs/superpowers/README.md`.
      Verify: `grep -rn "superpowers/e2e-planning-workflow\|superpowers/templates" --include="*.md" .` returns nothing outside `docs/archive/` and `docs/adr/`

## 3. ADR annotation

- [x] 3.1 Add a Status note to `docs/adr/0324-tier-aware-scenario-catalog-ledger.md`:
      tier canon inverted to `docs/operations/e2e-planning-workflow.md`
      (this change), matching the 0313/0316 annotation convention.
      Verify: `grep -n "Partially superseded\|canon" docs/adr/0324-*.md`

## 4. Latent-item triage (report-only, design.md D4)

- [ ] 4.1 Code-check `notes/llm-rate-limiting-and-plans.md` (billing/plans
      side) and `specs/2026-05-23-chat-provider-as-plugin-design.md` per
      the migration runbook's triage signals; record findings as a comment
      on this change's PR / commit message. No deletions or adoptions here.
      Verify: findings recorded

## 5. Gate

- [ ] 5.1 `openspec validate superpowers-residue-cleanup --strict`,
      `bun run lint`, `bun run format:check`.
      Verify: all pass
