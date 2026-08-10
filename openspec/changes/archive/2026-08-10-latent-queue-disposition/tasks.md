<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tasks: Latent queue disposition

All outputs are Markdown/docs; the Write/Edit TDD hook pipeline does not gate
docs (design.md D5). Each verification is a grep or `openspec validate`/lint
gate.

## 1. Write the two ADRs

- [x] 1.1 Create `docs/adr/0380-defer-chat-provider-as-plugin.md` with the
      standard BUSL-1.1 header, `## Status` = **Deferred**, `## Date`, a
      Context section citing the `superpowers-residue-cleanup` triage and the
      verified current state (blocker cleared, sibling landed), a Decision
      section capturing: do not adopt now; the revisit trigger = after
      `plugin-core-separation` refactor + hermetic E2E harness land,
      re-evaluate whether the resulting architecture supersedes the draft
      (probable) or leaves a focused migration valuable; and an explicit
      warning that the stale `chat-as-plugin` branch (last 2026-06-05,
      3883-file divergence) is unusable as-is — start fresh post-refactor.
      Verify: `grep -n "Deferred\|plugin-core-separation\|chat-as-plugin" docs/adr/0380-*.md`

- [x] 1.2 Create `docs/adr/0381-retire-llm-rate-limiting-and-plans.md` with
      the BUSL-1.1 header, `## Status` = **Retired**, `## Date`, a Context
      section citing the triage and the unshipped state (no `src/quota/`, no
      plan/quota tables), and a Decision section capturing: retire from the
      live queue; the 3-file cluster is archived to `docs/archive/`; when cost
      pressure arrives, start FRESH research rather than resurrecting (2026-05
      grounding is stale enough that a clean redesign is cheaper than porting);
      note the archived location for reference value.
      Verify: `grep -n "Retired\|docs/archive\|fresh" docs/adr/0381-*.md`

## 2. Archive the rate-limit cluster (design.md D2, D4)

- [x] 2.1 `git mv` all three files together into the flat `docs/archive/`
      directory:
      `docs/superpowers/notes/llm-rate-limiting-and-plans.md`,
      `docs/superpowers/notes/llm-rate-limiting-and-plans-phases.md`,
      `docs/superpowers/specs/2026-05-21-llm-rate-limiting-and-plans-design.md`.
      Verify: `ls docs/archive/*llm-rate-limit*` lists all three; `ls docs/superpowers/{notes,specs}/*llm-rate-limit* 2>/dev/null` returns nothing

- [x] 2.2 Rewrite the design spec's five `../notes/<file>.md` references to
      `./<file>.md` (co-located under flattening — see design.md D4), then
      confirm every internal link in the moved cluster resolves and that the
      only external reference (the historical `superpowers-residue-cleanup`
      findings) is left as-is per the not-editing-history policy.
      Verify: `grep -rn "\.\./notes/" docs/archive/*llm-rate-limit*` returns nothing; `grep -rn "llm-rate-limiting-and-plans" docs/ --include="*.md" | grep -v "docs/archive/" | grep -v "openspec/changes/superpowers-residue-cleanup/"` shows only this change's own artifacts (expected)

## 3. Index the ADRs (design.md D5)

- [x] 3.1 Add two rows to the `docs/adr/README.md` index table for ADR-0380
      and ADR-0381 (Date 2026-08-09, Implementation Status = Deferred /
      Retired respectively, Last Commit left as a placeholder to fill at
      land time or the implementing commit).
      Verify: `grep -n "0380\|0381" docs/adr/README.md`

## 4. Gate

- [x] 4.1 `openspec validate latent-queue-disposition --strict`,
      `bun run lint`, `bun run format:check`.
      Verify: all pass
