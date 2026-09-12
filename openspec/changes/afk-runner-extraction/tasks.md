<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Phase A — boundary hardening (inside papai; one runner run per D7 — prune is the run's last task)

- [ ] 1.1 Write the no-upward-imports guard test: `tests/afk-runner/no-upward-imports.test.ts` asserting nothing under `afk-runner/src` or `tests/afk-runner` imports outside `afk-runner/` (relative-up paths forbidden; node:/bare specifiers allowed) — red against the current `review-loop`/`mutation-improve` imports. Verify: `bun test tests/afk-runner/no-upward-imports.test.ts` (fails as expected)
- [ ] 1.2 Copy the 18-file agent-spawn closure (`agent-runner`, `spawn`, `progress-log`, `line-handler`, `backend-select`, `claude-stream`, `event-stream`, `cost`, `run-stats`, `config`, `worktree`, `todo-capture`, `live-format`, `trace-log`, `diff-stats`, `claude-argv`, `agent-command`, `claude-spawn-dir` — the last joined via `agent-runner`'s imports with #432) verbatim into `afk-runner/src/agent-backend/`; copy `mutation-improve/src/diff-guard.ts` alongside; port the closure's existing tests from `tests/review-loop/` (where they exist) with imports rewired — review-loop originals untouched. Verify: `bun test tests/afk-runner tests/review-loop`
- [ ] 1.3 Rewire the 10 src files and 19 test imports from `review-loop/src` to `afk-runner/src/agent-backend`; declare `p-limit` in `afk-runner/package.json`; guard test green. Verify: `bun test tests/afk-runner && bun run typecheck`
- [ ] 1.4 Prune to opencode-only: delete `claude-argv`, `claude-stream`, `backend-select` and the claude-API branches of `agent-command`/`line-handler`; `modelFor` maps roles to opencode model strings; delete the ported claude-path tests; golden fixtures (`tests/afk-runner/fixtures/real/`) stay green. Verify: `bun test tests/afk-runner`
- [ ] 1.5 Full papai gate pass over the changed files, mutation ratchet included. Verify: `bun test && bun run lint && bun run typecheck && bun run test:mutate:changed`
- [x] 1.6 Pre-flight gate (design D6, wait-for-landing): all in-flight branches landed before Phase A — `afk-runner-board-tools` merged, `agent-mcp-live-target` merged whole via PR #432 (84ebb2c26, complete incl. the live smoke — the `opencodeEnv` seam work rides the Phase A copy, `mcp-servers.ts`/`agent-config.ts` travel with the split), `afk-runner-mcp` retired empty. Verify: `git branch --merged origin/master` lists all three — confirmed 2026-09-09
- [x] 1.7 `afk-runner-board-tools` landed before the split — all touched paths (`afk-runner/src/serve/*`, `tests/afk-runner/serve/*`, `docs/architecture/afk-runner.md`, `openspec/changes/afk-runner-board-tool-reports/`) are in D2's filter set and ride the split. Verify: merged into origin/master — confirmed 2026-09-09

## 2. Phase B — repo split (mechanical)

- [ ] 2.1 On a scratch clone, run `git filter-repo` with the design D2 path set and renames (`afk-runner/` → root, `tests/afk-runner/` → `tests/`); push to `yourpapai/afk-runner` (private, created during prep — resolves the design open question; operator-run per D7). Verify: `git -C <new-repo> log --oneline | wc -l` > 0 and tip tree matches source paths
- [ ] 2.2 Post-split validation checklist: tree diff against the source paths (nothing missing/extra), full suite green at tip, `openspec validate` passes in the new repo, the U-ledger doc present under `docs/`. Verify: `bun test` in the new repo + `openspec list --json` in the new repo
- [ ] 2.3 Add `PROVENANCE.md` (extraction source SHA, severance boundary note) and a fresh minimal `openspec/config.yaml` (runner-scoped, not chat-bot-scoped). Verify: `openspec validate` in the new repo

## 3. Phase C — new-repo setup (second runner run per D7, repoRoot = the new repo — its first live-proof)

- [ ] 3.1 Apache-2.0 `LICENSE` + re-header sweep of all copied files (FSL-1.1-MIT only if the operator reverses before first public push). Verify: `grep -rL "Apache-2.0" src/ | wc -l` = 0
- [ ] 3.2 Self-contained toolchain: own `.oxlintrc.json` + `.oxfmtignore` (copied, pruned to the runner tree), package.json scripts without `cd ..`, README (clone-and-run install, `bun run src/cli.ts`, `.afk-runner/config.json` ladder). Verify: `bun run lint && bun run format:check` in the new repo
- [ ] 3.3 CI workflows: test / typecheck / lint on push and PR. Verify: first CI run green on the new repo's tip
- [x] 3.4 Obsolete per D6/#432: the complete `afk-runner-agent-mcp` integration landed in papai via PR #432 — its change artifacts and afk-runner-side code ride the split (all in D2's filter set), the seam work rides the Phase A copy; nothing to re-home. Verify: #432 merged (84ebb2c26) — confirmed 2026-09-09

## 4. Phase C — papai retirement (operator-gated per D7)

- [ ] 4.1 Drain gate: confirm no in-flight runs launched from master checkouts (`afk-runner runs` from a master checkout shows none running); worktree-pinned runs noted and exempt. Verify: operator confirmation recorded in the change notes
- [ ] 4.2 Deletion commit: remove `afk-runner/`, `tests/afk-runner/`, root `package.json` workspace entry + `afk-runner:start`, `.gitignore` `.afk-runner` entry, `scripts/mutation/baseline.json` afk entries + README mention, `.claude/` + `.opencode/` `commands/sdd-auto.md`; tombstones: docs-index pointer to the new repo in `AGENTS.md`/`CLAUDE.md` and a one-line pointer where `docs/architecture/afk-runner.md` stood; `openspec/` untouched (R5 precedent). Verify: `grep -rn "afk-runner" package.json .gitignore scripts/mutation/baseline.json` empty
- [ ] 4.3 Final papai verification and docs pass: full suite, lint, typecheck; update `docs/architecture/` index references so no page points at removed files. Verify: `bun test && bun run lint && bun run typecheck`
