## 1. Reconciling push in the git layer

- [x] 1.1 Write failing tests in `tests/opencode-agent/adapters.test.ts` for the reconciling push argv sequence through the fake `CommandRunner`: remote branch ahead of HEAD → `git fetch origin <branch>`, `git merge-base --is-ancestor` (no), `git merge --no-edit origin/<branch>`, then the existing `git push -u origin <branch>`; assert no `--force` anywhere
- [x] 1.2 Write failing tests for the quiet paths: remote tip already an ancestor → fetch + plain push, no merge argv; branch absent on the remote → plain push, no error
- [x] 1.3 Write failing test for the conflict path: merge output containing `CONFLICT` → `git diff --name-only --diff-filter=U` read, `git merge --abort`, and a thrown `GitError` whose message names the conflicted paths; non-conflict merge failure also aborts the merge before throwing
- [x] 1.4 Implement in `opencode-agent/src/git.ts`: extract `reconcile(branch)` (fetch → ancestor check → merge, per design D1–D3), call it from `push()` before the existing push argv, and add `reconcile` to the `Git` interface; update the push argv assertions in `tests/opencode-agent/adapters.test.ts:2555` and `tests/opencode-agent/diff-guard.test.ts:437-438` for the fetch prefix
- [x] 1.5 Verify: `bun test tests/opencode-agent/adapters.test.ts tests/opencode-agent/diff-guard.test.ts`

## 2. Review path ordering

- [x] 2.1 Write failing test (fake `Git` in `tests/opencode-agent/`) asserting `phases/review-push.ts` calls `reconcile(branch)` before `dropUnpushable`'s `changedSince`/`revertPaths`, so protected paths arriving via a reconciling merge are still reverted before the push
- [x] 2.2 Add `reconcile` to the fake `Git` in `tests/opencode-agent/test-helpers.ts` (records the call like `ensureBranch` does); implement the `reconcile` call in `pushIfMoved` in `opencode-agent/src/phases/review-push.ts`
- [x] 2.3 Verify: `bun test tests/opencode-agent/phases.test.ts tests/opencode-agent/orchestrator.test.ts`

## 3. Docs and full checks

- [ ] 3.1 Record the rule in `opencode-agent/CLAUDE.md`: the branch is shared with humans, every push reconciles fetch-first (merge, never rebase/force), conflicts abort-and-name-paths, and `review-push` reconciles before its protected-path revert — citing run 32374999214 / merge `1f7ce71b`
- [ ] 3.2 Run `bun test`, `bun run typecheck`, `bun run lint`, `bun run test:affected`; update `opencode-agent/README.md` or `ROADMAP.md` only if they describe push behavior
