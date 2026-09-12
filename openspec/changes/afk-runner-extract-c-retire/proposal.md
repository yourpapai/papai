<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

The extraction is complete up to papai's copy: Phase A landed (self-contained backend, no-upward-imports guard), Phase B split the history into the live `yourpapai/afk-runner` (private), whose first self-run is merged, and the drain gate (umbrella task 4.1) is confirmed — no in-flight master-launched runs (notes.md, 2026-09-10). Papai's `afk-runner/` is now a frozen twin whose only remaining effect is holding workspace wiring, script aliases, mutation-baseline floors, and docs for code papai no longer owns; per R5 doctrine the retirement lands as one drain-gated deletion commit with recovery = `git revert`.

## What Changes

- **BREAKING** — deletion commit (umbrella task 4.2): remove `afk-runner/` + `tests/afk-runner/`; root `package.json` workspace entry and the `afk-runner:*` script family (`start`, `test`, `typecheck`, `lint`, `format:check`); `.gitignore`'s `.afk-runner` block; `scripts/mutation/baseline.json` afk entries + its two normative README mentions (mapping-table row, gateable-roots sentence); `.claude/` + `.opencode/` `commands/sdd-auto.md` become a tombstone stating the new repo's entry point. The `/sdd:auto` operator surface dies in papai — a deliberate umbrella Non-goal, not an accident to fix.
- Tombstones: docs-index pointer to `yourpapai/afk-runner` in `AGENTS.md`/`CLAUDE.md`, and a one-line pointer where `docs/architecture/afk-runner.md` stood (both `afk-runner*.md` docs become one-line pointer files, per design D2 — retained openspec links keep resolving).
- Verification/docs pass (task 4.3): full suite, lint, typecheck; `docs/architecture/` cross-references (`commands.md`, `sdd-pipeline.md`) updated so no page points at removed files.
- `openspec/` untouched (inherited): `openspec/specs/afk-runner-*` and `sdd-*` stay as historical records; `opencode-agent/src/pricing.ts`'s historical comment stays.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Zero-delta change, opted out via `skip_specs: true`: the runner's specs traveled with the split and papai's copies deliberately remain (R5 precedent, inherited — do not re-litigate), and no spec covers the `/sdd:auto` operator command (`.claude/commands/` is agent documentation, not a governed runtime surface). Inventing a requirement to satisfy validation is prohibited.

## Non-goals

- Any change to `yourpapai/afk-runner` — live and independently gated.
- Pruning papai's `openspec/specs/` or `archive/` dirs.
- Rewiring `/sdd:auto` to invoke the external runner — tombstone pointer only (umbrella proposal Non-goal).
- Touching `opencode-agent/src/pricing.ts` beyond leaving its comment as-is.

## Impact

- Code/packaging: `afk-runner/`, `tests/afk-runner/`, root `package.json`, `.gitignore`, `scripts/mutation/{baseline.json,README.md}`, `.claude/commands/sdd-auto.md`, `.opencode/commands/sdd-auto.md`; `bun.lock` regenerated with the workspace entry.
- Docs: `docs/architecture/afk-runner.md` + `afk-runner-mcp-research.md` replaced by one-line pointer files at the same paths (design D2); `AGENTS.md`/`CLAUDE.md` docs index and `docs/architecture/{commands,sdd-pipeline}.md` references updated.
- Specs: none modified; `openspec/specs/afk-runner-*` and `sdd-*` untouched.
- No platform/task instances affected; no config-context scope impact (per-user / group-shared / thread-isolated all untouched) — developer tooling, workdir-local, no DB, no chat surface.
- Sequencing: launch precondition met (drain gate, 2026-09-10); this run is worktree-pinned and exempt by D4. Rollback: `git revert` of the deletion commit.
