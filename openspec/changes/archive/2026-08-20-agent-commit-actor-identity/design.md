## Context

See proposal.md — Why. Today's identity is static (`opencode-agent/src/config.ts:166` defaults `opencode-agent[bot]`). That identity fans out via `deps.ts:184` (`createGit`) and `review-runner.ts:103` (`commitAuthor`) into `git-commit.ts:213` (`git -c user.name/email commit`). `identity.ts:27` already knows the runtime service account (`github-actions[bot]`) for *reading* `AGENT_STATE`, but commits don't use it. `TriggerEvent` (`trigger-events.ts:25`) carries `senderLogin` for human kinds (`issue`, `pull-request`) and none for machine kinds (`ci`, `pr-merged`). The design must braid (a) housekeeping, (c) verification, (d) per-run actor without breaking the `AGENT_COMMIT_*` operator override or `AGENT_SELF_LOGIN` ladder.

This change is `opencode-agent/`-only. Papai runtime scope model (`docs/architecture/behaviors.md`, `src/chat/context-scope.ts` — storage context = thread-isolated, config context = group-shared, user = identity/quota) is not touched; no DB, no `tool_prefs`, no provider plugin.

## Goals / Non-Goals

**Goals:** per-run actor author with service fallback, author/committer split so blame ≠ pusher, correct noreply with id, static default → `github-actions[bot]`, review-loop parity, precedence `explicit > actor > service`.

**Non-Goals:** GPG/SSH signing, changing `selfLogin`, issue-opener pinning, `Co-authored-by` generation for every opener, push-credential changes. See proposal.md — Non-goals (design boundary: those are separate proposals if needed).

## Decisions

**D1 — Default flips to `github-actions[bot]`.**
- Why: it is the token's real identity; its noreply `41898282+github-actions[bot]@users.noreply.github.com` verifies on GitHub (green Verified badge) and matches `release.yml`/`behavior-audit.yml`. `opencode-agent[bot]` has no account.
- Alternative rejected: keep `opencode-agent[bot]` and document override — leaves (a) and (c) unsolved by default.
- Change: `config.ts:166-167` fallbacks; docs in `agent-pipeline.yml` `vars.AGENT_COMMIT_*` comments.

**D2 — Actor resolver `resolveCommitIdentity(trigger, config, github)` (new `src/commit-identity.ts`).**
- Why: centralizes `explicit override → actor → service` and keeps `deps.ts` wiring thin. Mirrors `resolveSelfLogin` ladder in `identity.ts:59`.
- Logic:
  1. If `config.commitAuthorName` *and* `commitAuthorEmail` both explicitly set via env (both non-default), return them verbatim (operator pin, no lookup).
  2. Else if `trigger.kind ∈ {issue, pull-request}`: `login = trigger.senderLogin`, fetch `GET /users/:login` → `{id, login}` via new `GitHubApi.getUser(login)`. On success: `name=login`, `email=<id>+<login>@users.noreply.github.com`. On 404/any failure or empty login: fall through.
  3. Else fallback: `name=github-actions[bot]`, `email=41898282+github-actions[bot]@users.noreply.github.com` (or explicit `AGENT_COMMIT_*` defaults if set individually — see D3).
- Alternative rejected: cache id in `AGENT_STATE` — couples identity to state versioning and hand-edited blocks.
- Alternative rejected: always short `<login>@users.noreply.github.com` — loses Verified association (GitHub's docs require `id+login` for private-email users).

**D3 — Precedence granularity.**
- Explicit `AGENT_COMMIT_NAME` alone overrides only author name; explicit `AGENT_COMMIT_EMAIL` alone overrides only email; both explicit override both. Missing half falls back to actor/service for that half. This lets an operator pin just the email domain for DCO without losing per-actor name.
- Alternative rejected: all-or-nothing pin — forces operator to supply both to pin one.

**D4 — Author vs committer split.**
- `git-commit.ts:213` today `git -c user.name/email commit`. New: `GIT_AUTHOR_NAME/EMAIL` for author, `GIT_COMMITTER_NAME/EMAIL` for committer (via `git -c author.name` is not right — git's `author` is set by env, committer by `user.*`+`-c committer.*`; simplest is pass `-c author.name` is wrong; correct is `env.GIT_AUTHOR_*` + `-c user.name` for committer, or `-c author.name` is not a git var). Implementation choice: set `GIT_AUTHOR_NAME/EMAIL` env + `-c user.name/email` for committer. `author = resolved actor/service`, `committer = service` (`github-actions[bot]`). Preserves `git log`/`blame` for (d) while `git log --format=%cn` shows service for (c) audit and branch-protection bypass lists that key on committer/pusher.
- Alternative rejected: `author=committer=actor` — loses audit that automation pushed; some orgs want committer=bot.
- Alternative rejected: always `author=committer=service` + `Co-authored-by` trailer only — satisfies (a)(c) but not (d)'s direct blame ask. `Co-authored-by` can be follow-up addition, not replacement.

**D5 — Single `getUser` API shape, DI'd.**
- `github.ts:54` gains `getUser(login): Promise<{login:string,id:number}>` backed by `octokit.rest.users.getByUsername`. Injected via `GitHubApi` like other endpoints so tests need no network. Called once per human-triggered job, before first commit. `orchestrator.ts:62` or `deps.assembleDeps` is the call site (assemble-time, before phases run) — one lookup, reused for all commits in the job (N steps in `REVIEW_AND_MUTATE` share the same resolved author).
- Alternative rejected: look up per-commit — N times per job, wasteful.
- Hook: if lookup rejects (404, rate limit, network), log at `warn` and fall back to service without failing the run (feedback-channel rule: best-effort).

**D6 — Review-loop parity.**
- `review-runner.ts:70` `ReviewLoopSettings.commitAuthor` today copies `config.commitAuthor*` statically. After D2, `deps.makeReviewRunner` receives the *resolved* identity (closure over the same resolver result) so loop fixes on `agent/issue-<n>` carry actor. No extra lookup inside the loop's worktree.

## Risks / Trade-offs

- **Extra API call per human job** → Mitigation: one `GET /users/:login` per job, public endpoint, cached per `login` within job; `warn`+fallback on failure. Not on CI/archive jobs.
- **Contribution-graph inflation / CLA surprise** → commits now credit `bob`/`carol` individually; a CLA bot keyed on author will now gate on the human, not the bot. Mitigation: document in `README.md`; precedence lets operator pin `github-actions[bot]` to opt back to service-only.
- **Mid-plan author switch** (`/continue` by different maintainer): later steps' commits switch author. → Mitigation: intentional for (d); noted in docs. Alternative (pin to first actor) would violate (d) and hide who actually continued.
- **Verification without id**: short noreply loses Verified badge. → Mitigation: prefer `id+login`; fallback short only on lookup failure.
- **Local `--event-path` runs** have no token or lookup → fallback service, plus log `debug` that identity is unresolvable.
- **File-length limits** (`max-lines`): new `commit-identity.ts` keeps `deps.ts`/`config.ts` from growing; resolver + tests split.

## Migration Plan

1. Land default flip first (small PR) — proves (a)(c) before actor logic.
2. Add `GitHubApi.getUser`, resolver, `git-commit.ts` author/committer split, `deps` wiring, review-loop wiring. Feature-flagged by new env `AGENT_COMMIT_MODE?=auto` (auto=actor, service=legacy) or simply by presence of actor — prefer auto with fallback so no flag needed; safe because fallback is service.
3. Deploy; existing `vars.AGENT_COMMIT_NAME/EMAIL` set explicitly keep old behavior via D3 precedence — no breaking change.
4. Rollback: revert defaults or set `vars.AGENT_COMMIT_NAME/EMAIL` to `opencode-agent[bot]`; no state migration needed (`AGENT_STATE` untouched, no `STATE_VERSION` bump).
5. Docs: `opencode-agent/README.md` config table, `agent-pipeline.yml` var comments.

## Open Questions

- Should `Co-authored-by` be emitted alongside author split for opener credit, or is author alone sufficient for the org's changelog? Defer to follow-up; spec covers author/committer contract now.
- Exact `committer` email when `AGENT_COMMIT_EMAIL` pin partially set — treat as pin for committer only? Resolved in D3; edge can be tuned in `specs`.
