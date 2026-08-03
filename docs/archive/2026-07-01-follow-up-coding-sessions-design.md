<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Follow-up coding sessions — design

## Problem

Today every ACP coding session is one-shot: magi prepares a fresh git worktree branched from
`baseBranch` as `acp/<sessionId>`, runs the agent turn once, pushes the branch, opens a PR/MR, then
**tears down the sandbox and deletes the worktree**. There is no way to say _"take the PR you just
made and keep working on it"_ — add changes, address review, or fix a failing build/tests. Users must
start over from `baseBranch`, losing the branch and opening a duplicate PR.

We want **follow-up requests**: continue from an existing session's branch/PR with a new prompt, so the
same PR updates in place.

## Decisions (from brainstorming)

- **Agent continuity:** a follow-up is a **fresh agent run on the existing branch's code**, with the
  prior prompt + final answer injected as context. The sandbox teardown already destroys agent state,
  so resuming the original agent's in-memory session is out of scope.
- **Target identification:** the user can point at a **prior session** (implicit "last", explicit
  session id, or picked from a listed history) and at a **PR/MR number**. Continuing an arbitrary
  branch name is out of scope.
- **History ownership:** magi already durably persists full session records (branch, `prUrl`,
  `projectSpec`). The plugin keeps only a **thin, chat-scoped index** — enough to list history and map
  PR→session locally; live status/branch is still fetched from magi on demand.
- **"Fix build/tests":** the follow-up sandbox has the branch checked out, so the **agent runs the
  build/tests itself** and fixes what fails. Auto-fetching CI/check status is a documented future
  extension, not built now.
- **Mechanism (Approach A — session-centric):** a new `POST /sessions/:id/follow-up` endpoint. magi
  reuses branch/`projectSpec`/prior-context from its own store; the plugin funnels every entry point
  (session id, history pick, PR number) down to a `sessionId`. This keeps magi the source of truth,
  keeps the plugin thin, and re-validates the spec server-side.

## Architecture & data flow

A follow-up is a **new magi session that reuses a prior session's branch and PR**.

1. User: _"continue the PR you made and fix the failing tests"_ (or names a session id / PR number).
2. Plugin resolves the target to a `sessionId` via its thin index, resolves the user's coding secrets
   and forge token, and calls `POST /sessions/:id/follow-up`.
3. magi loads the parent session from SQLite, creates a **child session** that checks out the parent's
   branch (not `baseBranch`), injects the parent's prompt + final answer as context ahead of the new
   prompt, runs a fresh agent turn, and **pushes to the same branch — updating the existing PR** rather
   than opening a new one.
4. magi's milestone notifier posts progress/completion back to the chat (unchanged path).
5. Plugin records the child session in its index, linked to the same PR.

## magi changes

### Session model (`src/session/state.ts`, `src/session/store.ts`)

- Add `parentSessionId: string | null` to `Session` and a `parent_session_id` column, added with an
  additive `ALTER TABLE` migration (same pattern as the existing `last_message` column backfill).
- New input type:

  ```ts
  export interface FollowUpSessionInput {
    parentSessionId: string
    prompt: string
    secrets?: Record<string, string>
    forgeToken?: string
  }
  ```

### Manager (`src/session/manager.ts`)

- `followUpSession(parentId, input): Session`:
  - Load the parent. Refuse if it is missing, has `branch === null`, or is still active
    (`queued` / `preparing` / `running` / `finishing`). Continuable states: `done`, `failed`,
    `waiting_input`, and `cancelled` when a branch exists.
  - Create a **child session** inheriting `contextId`, `projectSpec`, `branch`, and `prUrl` from the
    parent; set `parentSessionId`.
  - `runLifecycle` uses `prepareContinue` (below) instead of `prepare`.
  - The turn prompt is `buildFollowUpPrompt(parent, input.prompt)` (see below).
- **PR reuse guard:** when a session carries a non-null inherited `prUrl`, `autoPublishDirty` (and
  `finishSession`'s `action === 'pr'` path) **skip `openPullRequest`** and only push. The existing PR
  updates in place; no duplicate PR is opened. The child keeps the inherited `prUrl`.

### Workspace (`src/workspace/git-workspace.ts`)

- `prepareContinue(sessionId, project, continueBranch, auth): Promise<PreparedWorkspace>`:
  - `ensureMirror` + `remote update --prune` (picks up any newer commits already on the branch).
  - `git worktree add <worktreePath> <continueBranch>` — check out the **existing** branch rather than
    creating a new one from `baseBranch`.
  - Set `prepared.branch = continueBranch`. `finish` already pushes `HEAD:refs/heads/<branch>`, so the
    push updates the branch in place.

### Router (`src/server/router.ts`)

- `POST /sessions/:id/follow-up` in `handleSessionScoped` (new `action === 'follow-up'`):
  - Read `prompt` / `secrets` / `forgeToken` from the body.
  - Rate-limit by the **parent's** `contextId`.
  - **Re-run `validateRepoSpec` on the parent's stored `projectSpec`** so tightened guardrails
    (agent allowlist, etc.) still apply at follow-up time.
  - Call `manager.followUpSession(...)`; return `{ id, status, parentSessionId }` with 202.

## Plugin changes (`plugins/acp/`)

### Thin history index (`plugin_kv`)

Upgrade the `session:<id>` value from `"1"` to a small JSON record:

```jsonc
{
  "project": "demo",
  "title": "add health check",
  "createdAt": "…",
  "parentSessionId": "…",
  "prNumber": 42,
  "prUrl": "…",
  "status": "done",
}
```

- Written at `start_session` / `review_pr` / `continue_session` time with what is known locally.
- `prUrl` / `prNumber` / `status` are **refreshed opportunistically** from `session_status` whenever
  the plugin lists or continues — pull-based, no new notify wiring. `prNumber` is parsed from `prUrl`
  (GitHub `…/pull/N`, GitLab `…/merge_requests/N`).

### New tool `continue_session`

`continue_session({ sessionId?, prNumber?, project?, prompt })`:

- Resolves the target to a `sessionId`: direct when `sessionId` is given, else `prNumber` + `project`
  looked up in the index.
- Refuses `not_configured` when coding secrets **or** the forge token are missing (a follow-up must
  push to the existing branch).
- Calls `POST /sessions/:id/follow-up` and records the child session in the index, inheriting the
  parent's `prNumber` / `prUrl`.

### `list_sessions` enrichment

Merge the local index metadata (`prNumber`, `prUrl`, `title`, `parentSessionId`) into the returned
rows so _"show my previous sessions"_ (`filter: 'done'`) presents each session with its PR. The prompt
fragment and `/acp` command text are updated to mention continuing a session.

## Prior-context injection

magi's `buildFollowUpPrompt(parent, newPrompt)` produces a length-capped prompt:

```
Continuation of a prior coding session on branch `<branch>` (PR: <prUrl>).
Prior task: <parent.prompt>
Prior outcome: <parent.lastMessage>

New task: <newPrompt>
```

## Guardrails, security & edge cases

- **Host guardrails (Phase 5a):** `plugin_acp__continue_session` joins the `whoMayUse`-gated
  session-action tool set in `applyWhoMayUseFilter` (silently removed for non-allowlisted actors, like
  `start_session`); guests never see it. Secrets / forge / identity resolve through the same
  `codingSecrets` facade, so `forceSharedKey` and the group `coding_identity` policy apply unchanged.
- **Forge token required** — refuse without one; a follow-up cannot avoid pushing.
- **Merged/closed PR** — not detected in the MVP (magi has no `getPullRequest` yet). Continuing a
  merged PR pushes to a branch whose PR is already merged. Documented limitation.
- **Branch pruned on remote** (PR merged + branch deleted) → `prepareContinue`'s fetch fails → the
  session fails with a clear message.
- **Concurrent follow-ups on one branch** → mirror update before checkout; last push wins; a
  non-fast-forward push surfaces as a failed session. Documented.
- **Chained follow-ups** → `parentSessionId` forms a chain; `prUrl` is inherited transitively so every
  link updates the same PR.

## Future extensions (documented, not built)

- Auto-fetch CI / check status and inject failing logs into the follow-up prompt (needs a per-forge
  checks/pipelines API and `getPullRequest`).
- Continuing **arbitrary / non-papai PRs** by number (needs forge `getPullRequest` to resolve
  PR → head branch).

## Testing

- **magi:** `followUpSession` (state guards, branch/`prUrl` inheritance, PR-creation skip when `prUrl`
  is set), `prepareContinue` (checks out the existing branch, pushes the same branch), the follow-up
  route (auth, rate limit, `validateRepoSpec` re-check), and `buildFollowUpPrompt`.
- **plugin:** target resolution (`sessionId` and `prNumber`-via-index), `not_configured` guards, index
  write/refresh, and `list_sessions` merge. Follow `tests/CLAUDE.md` DI patterns; the plugin tools use
  raw JSON-schema `inputSchema` with manual guards.
