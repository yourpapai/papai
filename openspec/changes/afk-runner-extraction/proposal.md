<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

afk-runner is already a generic engine — `repoRoot` is config, XState-as-reducer kernel is DI-pure, opencode is the agent plane — but its packaging is welded to papai: a bun workspace member borrowing the host toolchain, with a 2,886-line runtime reach into `review-loop/src/` for the one `runAgent` call. The reuse/publish goal requires a standalone repo carrying full decision lineage; the extraction forces the last deferred boundary (agent backend ownership) that C1's "copies, never imports" doctrine deliberately left as an import while papai was the host.

## What Changes

Three phases, each independently landable:

- **Phase A — boundary hardening (inside papai)**: copy the 18-file agent-spawn closure (`review-loop/src/agent-runner.ts` + transitive deps, 2,886 lines — `claude-spawn-dir` joined with #432) into `afk-runner/src/agent-backend/`; rewire 10 src + 19 test imports; declare `p-limit` in afk-runner's package.json; add a no-upward-imports guard test; then prune the backend to opencode-only (claude-API branches deleted) — **BREAKING** for a config naming a claude-API model directly (none exists; default model is `opencode` everywhere). Executed by the runner itself (design D7), prune-last.
- **Phase B — repo split (mechanical)**: `git filter-repo` on a scratch clone producing a new standalone clone-and-run repo carrying `afk-runner/` (renamed to root), `tests/afk-runner/` → `tests/`, both `docs/architecture/afk-runner*.md`, the `sdd-runner/` ancestor path, and the afk/sdd openspec changes + spec dirs — 105 code commits with their 71 openspec-interleaved artifacts. Operator-run (D7); pushed to `yourpapai/afk-runner` (private).
- **Phase C — setup + retirement**: new repo gets Apache-2.0 license (sole-authorship verified: 110/110 commits one author; FSL-1.1-MIT recorded as the operator-reversible alternative), CI, self-contained lint/format/test — delivered by a second runner run in the new repo, its first live-proof (D7); papai gets a drain-gated deletion commit (workspace entry, `afk-runner:start`, `/sdd:auto` tombstone, `scripts/mutation/baseline.json` entries, `.gitignore`, docs index). papai's openspec tree stays untouched — R5 precedent left `openspec/specs/sdd-runner-*` in place after retirement.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The runner's behavior is unchanged — it moves. No papai spec covers the `/sdd:auto` operator surface (`.claude/commands/` is documentation), and the `afk-runner-*` specs describe the runner, which behaves identically post-extraction; per R5 precedent they remain as historical records. `skip_specs: true` is set.

## Non-goals

- MCP integration for stage agents (issue #403 follow-up) — not this change's work: delivered in papai before extraction (PR #432) and travels with the split; the server catalogue naturally lives in the new repo.
- npm publishing / `bin` packaging — clone-and-run shape only.
- papai adopting the external runner as a client (rewiring `/sdd:auto` to invoke it) — the command is allowed to break; a tombstone pointer suffices.
- Pruning papai's `openspec/specs/afk-runner-*` / `sdd-*` dirs.
- Transferring the Stryker mutation ratchet — floors are papai-history artifacts; the new repo drops the ratchet and may re-baseline later.
- Carrying write-hook TDD pipeline config — new repo gets plain CI first; hooks can be ported later.

## Impact

- Code: `afk-runner/src/` (+ new `agent-backend/`), `tests/afk-runner/`, `review-loop/src/` unchanged (copy, not move — direction is one-way).
- papai packaging: root `package.json` (workspace entry, `afk-runner:start`), `scripts/mutation/baseline.json`, `.gitignore`, `.claude/commands/sdd-auto.md` + `.opencode/commands/sdd-auto.md`, `AGENTS.md`/`CLAUDE.md` docs index.
- Docs: `docs/architecture/afk-runner.md` (living U-ledger — moves to the new repo with a tombstone pointer in papai) and `afk-runner-mcp-research.md`.
- No platform/task instance involvement; no config-context scope impact.
- Live runs: Phase C's papai deletion is drain-gated on in-flight master-launched runs parking; worktree-pinned runs are unaffected. Rollback = `git revert` (R5 doctrine).
- In-flight branches (design D6, wait-for-landing — complete): `afk-runner-board-tools` (board tool reports; merged — every path in the Phase B filter set, rides the split), `agent-mcp-live-target` (the whole `afk-runner-agent-mcp` change, merged via PR #432 — seam work rides the Phase A copy, afk-runner-side modules travel with the split), `afk-runner-mcp` (empty placeholder, retired). Nothing frozen, nothing to re-home.
