## 1. Contract & Fixtures

- [x] 1.1 Add `getUser` contract to `GitHubApi` with a fake that records calls — the DI seam every later unit will use — and cover the new `commit-identity` decision table with a failing test in `tests/opencode-agent/` (actor → human, `ci`/`pr-merged` → service, explicit pin wins, lookup 404 fallback). `bun test tests/opencode-agent/commit-identity.test.ts`
- [x] 1.2 Add fixture for `GET /users/:login` response (`{login,id}`) and noreply email builder (`id+login@users…` vs short `login@…`). `bun test tests/opencode-agent/commit-identity.test.ts`

## 2. Defaults

- [x] 2.1 Flip `config.ts:166-167` defaults to `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com`; update `config-shape.ts` docs and `agent-pipeline.yml` var comments. `bun test tests/opencode-agent/config.test.ts` `bun run typecheck`
- [x] 2.2 Verify no remaining `opencode-agent[bot]` literal outside tests/docs (grep audit). `bun run typecheck`

## 3. Identity Resolver

- [x] 3.1 Implement `opencode-agent/src/commit-identity.ts` — `resolveCommitIdentity(trigger, config, github, log)` with precedence `explicit field > actor (GET /users/:login) > service`, one lookup per job, `warn` on failure. Failing test first. `bun test tests/opencode-agent/commit-identity.test.ts`
- [x] 3.2 Extend `opencode-agent/src/github.ts` with `getUser(login)` via `octokit.rest.users.getByUsername`, wired through `createOctokitApi`; update fakes. `bun test tests/opencode-agent/commit-identity.test.ts` `bun run lint`

## 4. Git Wiring (Author vs Committer)

- [x] 4.1 Split `git-commit.ts:213` commit identity: `author` from resolver, `committer` as service (`GIT_AUTHOR_*` env + `-c user.name/email` for committer); keep `guardStaged`/`salvageAll` using committer provenance for `protected-paths` audit. Failing test first (`git-commit.test.ts` assert on spawned argv/env). `bun test tests/opencode-agent/git-commit.test.ts`
- [x] 4.2 Wire resolver into `deps.ts:assembleDeps` / `createGit` so every `commitAll`/`salvageAll` in the job carries the per-trigger author, not the static config snapshot; ensure `salvageAll` reuses the same job-level resolution. `bun test tests/opencode-agent/deps.test.ts` `bun run typecheck`

## 5. Review-Loop Parity & Archive

- [x] 5.1 Feed the resolved committer/author pair into `review-runner.ts:70` `ReviewLoopSettings.commitAuthor` (via `deps.makeReviewRunner` closure) so worktree fixes on `agent/issue-<n>` match the job's identity. `bun test tests/opencode-agent/review-runner.test.ts`
- [x] 5.2 Cover `ARCHIVE` (`phases/archive.ts` / `pr-merged` trigger) that it uses service fallback (no human actor). `bun test tests/opencode-agent/phases/archive.test.ts`

## 6. Orchestrator & Trigger Coverage

- [x] 6.1 Resolve identity once at job start (`orchestrator.ts` or `runCli`) before the cascade, shared across all phase handlers and persisted across `REVIEW_AND_MUTATE` steps, `CODE_REVIEW`, `CI_FIX`, and `INCOMPLETE` salvage. Failing test first (`orchestrator` / `phases` integration). `bun test tests/opencode-agent/orchestrator.test.ts`
- [x] 6.2 Cover machine-trigger fallback explicitly: `workflow_run` red run and local `--event-path` both resolve to service without network call. `bun test tests/opencode-agent/triggers.test.ts`

## 7. Documentation & Verification

- [x] 7.1 Update `opencode-agent/README.md` (config table for `AGENT_COMMIT_NAME/EMAIL`, new per-run actor behavior, precedence) and `opencode-agent/CLAUDE.md` (commit-identity rule, author vs committer). No verification beyond `bun run lint`.
- [x] 7.2 Run full `bun test`, `bun run typecheck`, `bun run lint`, and if any `docs/architecture/*.md` now stale (it should not — papai scope model untouched), add a note. `bun test` `bun run typecheck` `bun run lint`
