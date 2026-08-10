<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Legacy corpus porting procedure

All outputs are Markdown; the Write/Edit TDD hook pipeline does not gate
docs, so test-first ordering does not apply (design.md D5).

## 1. Runbook

- [x] 1.1 Create `docs/operations/legacy-migration-runbook.md` with SPDX
      header; sections: purpose + relationship to the archived
      `migrate-brainstorming-to-openspec` design; corpus map snapshot (dated
      2026-08-07); triage procedure (reliable vs unreliable signals — file
      existence yes, `Status:` headers / checkboxes / git-slug grep no); the four
      lanes with per-lane step lists (Lane 0 archive via `plan-adr-workflow`,
      Lane 1 adopt with the legacy→OpenSpec porting map + drift-check +
      delete-on-adopt, Lane 2 seed with current-truth source order, direct-write,
      `<!-- seeded from ... -->` provenance line, Lane 3 retire); cross-service
      note for items spanning papai + magi; queue inventory (2 pending, 5 briefs,
      ~8 murky) with per-item starter dispositions.
      Verify: `openspec validate legacy-corpus-porting-procedure --strict`

## 2. Pointers

- [x] 2.1 Update `docs/superpowers/README.md` disposition rules: keep the
      three bullets, defer detail to the runbook (link it).
      Verify: `grep -n "legacy-migration-runbook" docs/superpowers/README.md`
- [x] 2.2 Add the runbook row to the `CLAUDE.md` documentation index table.
      Verify: `grep -n "legacy-migration-runbook" CLAUDE.md`
- [x] 2.3 Add a runbook pointer in
      `docs/architecture/openspec-superpowers-hybrid.md` next to the §4 reference
      to the archived migration design.
      Verify: `grep -n "legacy-migration-runbook" docs/architecture/openspec-superpowers-hybrid.md`

## 3. Final gate

- [x] 3.1 Run `openspec validate legacy-corpus-porting-procedure --strict`,
      full `bun test`, `bun run typecheck`, `bun run lint`; confirm no other
      `docs/architecture/*.md` pages need updates.
