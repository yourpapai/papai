<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0242: Follow-up Coding Sessions

## Status

Implemented (with divergence)

## Date

2026-07-01

## Context

Every ACP coding session was one-shot: magi prepares a fresh git worktree branched from `baseBranch` as `acp/<sessionId>`, runs one agent turn, pushes the branch, opens a PR/MR, then tears down the sandbox and deletes the worktree. There was no way to say *"take the PR you just made and keep working on it"* — add changes, address review, or fix a failing build/tests. A user had to start over from `baseBranch`, losing the branch and opening a duplicate PR.

The design (`docs/superpowers/specs/2026-07-01-follow-up-coding-sessions-design.md`) and plan (`docs/superpowers/plans/2026-07-01-follow-up-coding-sessions.md`) wanted a **follow-up**: a new magi session that reuses a prior session's branch, `projectSpec`, and `prUrl`, injects the prior prompt + final answer as context ahead of a new prompt, checks out the *existing* branch instead of branching from `baseBranch`, pushes back to that same branch — **updating the existing PR** rather than opening a new one. The `plugins/acp/` plugin gains a thin chat-scoped history index (`session:<id>` JSON record replacing the legacy `"1"` marker) and a `continue_session` tool that resolves a target (`sessionId` or `prNumber`) to a parent session id and calls the endpoint.

The work spans two repos: **magi** (`~/Projects/yourpapai/magi`) gains the session model, `prepareContinue`, `followUpSession`, the `POST /sessions/:id/follow-up` route, and the PR-reuse guard; **papai** gains the history index, the `continue_session` tool, `list_sessions` enrichment, and the `whoMayUse` gate.

## Decision Drivers

- **magi is the source of truth; the plugin stays thin.** magi already durably persists full session records (branch, `prUrl`, `projectSpec`). The plugin keeps only enough to list history and map PR→session locally; live status/branch is fetched from magi on demand (Approach A — session-centric).
- **Update the PR in place, never open a duplicate.** A follow-up child inherits the parent's `prUrl`; PR creation is skipped when a session already carries one, so the same PR is updated.
- **Check out the existing branch, push back to it.** `prepareContinue` fetches the remote branch ref and `git worktree add`s the existing branch (not `baseBranch`); the existing push path updates it.
- **Re-validate guardrails at follow-up time.** The route re-runs `validateRepoSpec` against the parent's stored `projectSpec`, so a tightened operator policy (agent allowlist, etc.) still applies.
- **Scoped PR→session resolution.** A `prNumber` lookup matches only sessions this chat started (rows with a local `plugin_kv` record), so a chat cannot target another chat's session by guessing a PR number.
- **Forge token required.** A follow-up must push to the existing branch, so it refuses `not_configured` without coding secrets **or** a forge token.
- **Reuse the Phase-5a `whoMayUse` gate.** `continue_session` joins the session-action tool set so non-allowlisted actors (and guests) never see it.

## Considered Options

### Option 1 — Session-centric `POST /sessions/:id/follow-up` (chosen)

magi gains a session-centric endpoint that loads the parent from its own store, creates a child reusing branch/`projectSpec`/`prUrl`, and runs a fresh agent turn on the checked-out existing branch; the plugin funnels every entry point (session id, history pick, PR number) down to a `sessionId`.

- **Pros:** magi stays the single source of truth; the plugin stays thin; the stored `projectSpec` is re-validated server-side at follow-up time; branch/PR inheritance is centralized.
- **Cons:** requires a magi schema migration (`parent_session_id`), a new workspace method, and a new route; arbitrary/non-papai PRs cannot be continued (no forge `getPullRequest` to resolve PR→head branch).

### Option 2 — Agent in-memory session resume

Resume the original agent's in-memory session instead of starting a fresh turn.

- **Pros:** true agent continuity (full conversation state).
- **Cons:** rejected in the design — the sandbox teardown already destroys agent state, so resuming the original agent's in-memory session is out of scope. A follow-up is deliberately a **fresh agent run on the existing branch's code** with prior context injected as text.

### Option 3 — Continue an arbitrary branch/PR name

Let the user name any branch or PR to continue, resolved via the forge.

- **Pros:** most flexible target identification.
- **Cons:** rejected as out of scope — requires a per-forge `getPullRequest` (not yet present in magi) to resolve PR→head branch, and loses the "sessions this chat started" scoping that protects against cross-chat targeting.

## Decision

The chosen Option 1 shipped in full across both repos. What shipped:

1. **magi session model.** `Session.parentSessionId` (`src/session/state.ts:36`), persisted via an additive `parent_session_id` column (`src/session/store.ts:21,37,144,158`), plus `FollowUpSessionInput` and the `CONTINUABLE` set (`waiting_input`/`done`/`failed`/`cancelled`) (`src/session/state.ts:136-152`).
2. **magi prior-context injection.** `buildFollowUpPrompt(parent, newPrompt)` emits a length-capped prompt with branch/PR, prior task, prior outcome, and new task (`src/session/helpers.ts:24-35`).
3. **magi workspace `prepareContinue`.** Checks out the existing branch (fetch + `worktree add`), pushing back to the same branch on finish (`src/workspace/workspace.ts:26`, `src/workspace/git-workspace.ts:162-187`).
4. **magi PR-reuse guard.** A session carrying a non-null inherited `prUrl` skips `openPullRequest` and only pushes, so no duplicate PR is opened.
5. **magi `followUpSession`.** Validates the parent shape, then creates a child reusing the parent's branch/`projectSpec`/`prUrl` and launches the continuation (`src/session/manager.ts:130-137`).
6. **magi route.** `POST /sessions/:id/follow-up` — auth, rate-limit by the parent's `contextId`, `validateRepoSpec` re-check, `202 { id, status, parentSessionId }` (`src/server/router.ts:151-152,213-248`).
7. **papai history index.** `session:<id>` is now a JSON `SessionRecord` (`project`, `title`, `createdAt`, optional `parentSessionId`/`prNumber`/`prUrl`/`status`); the legacy `"1"` marker is tolerated (`plugins/acp/history.ts`).
8. **papai `continue_session` tool.** Resolves `sessionId` or `prNumber` (+ optional `project`, scoped to this chat's sessions), refuses `not_configured` without secrets/forge token, calls the follow-up endpoint, and records the child inheriting the parent's `prNumber`/`prUrl` (`plugins/acp/continue-tool.ts`).
9. **papai recording + `list_sessions` enrichment.** `start_session`/`review_pr` write rich records; `list_sessions` merges local `title`/`parentSessionId`/`prNumber` into magi rows and opportunistically refreshes the local record (`plugins/acp/session-records.ts`, `plugins/acp/session-tools.ts`).
10. **papai `whoMayUse` gate.** `plugin_acp__continue_session` is in `ACP_SESSION_ACTION_TOOLS` (`src/llm-orchestrator-tools.ts:40-46`).
11. **Docs.** The feature, endpoint, history record, guardrails, and documented limitations are covered in `docs/architecture/coding-sessions.md:96-104`.

## Consequences

### Positive

- A user can iterate on a prior session's branch/PR ("fix the failing tests", "address review") and the same PR updates in place — no lost branch, no duplicate PR.
- magi remains the single source of truth for branch/PR/`projectSpec`; the plugin index stays thin and chat-scoped.
- Operator guardrails tightened after the parent session started still apply at follow-up time (`validateRepoSpec` re-check).
- PR-number resolution is scoped to sessions this chat started, so cross-chat targeting by guessing a PR number is impossible.
- Chained follow-ups work: `parentSessionId` forms a chain and `prUrl` is inherited transitively, so every link updates the same PR.

### Negative

- **The codebase has evolved well beyond the plan on both sides.** magi's lifecycle was extracted into dedicated modules and a resume/crash-detection sibling feature, multi-repo support, MCP-token relay, idempotency keys, and PR-description updates layered on top; the papai tool grew an MCP gate, transcript/share-token fields, and an extracted `session-records` module — see Implementation Notes.
- **Merged/closed PRs are not detected.** magi has no `getPullRequest`; continuing a session whose PR was already merged/closed pushes to a branch with no open PR to update (documented limitation).
- **`buildFollowUpPrompt` now clips the new prompt too**, so an over-long follow-up prompt is truncated to 4000 chars (the plan clipped only the prior task/outcome).

### Risks

- **Branch pruned on remote** (PR merged + branch deleted) → `prepareContinue`'s fetch fails → the session fails with a clear message (documented).
- **Concurrent follow-ups on one branch** → mirror update before checkout; last push wins; a non-fast-forward push surfaces as a failed session (documented).
- **Plugin `history.ts` narrowed its `KvStore`** — the plan's `listRecords`/`delete`/`list` were removed; the structural type now requires only `get`/`set`. Behavior is preserved (`list_sessions` uses `runtimeContext.kv.list` from the runtime's own wider structural type), but the module's exported surface is smaller than the plan specified.

## Related Decisions

- **ADR-0218 (papai ACP Plugin)** — the `plugins/acp/` plugin this feature extends with `continue_session` and the history index.
- **ADR-0228 (ACP Cleanup)** — the ACP plugin consolidation this feature's module structure follows.
- **ADR-0221 (agent-credential vault)** — the `codingSecrets` facade (`resolve`/`resolveForgeToken`/`resolveMcpServers`) that gates `continue_session` exactly as it gates `start_session`.
- The Phase-5a `whoMayUse` operator guardrail (`applyWhoMayUseFilter`) that `continue_session` joins.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`; both the magi and papai sides are present.

| File | Role | Evidence |
| --- | --- | --- |
| `magi/src/session/state.ts:36` | `Session.parentSessionId: string \| null`. | `read` confirms. |
| `magi/src/session/state.ts:136-152` | `FollowUpSessionInput` + `CONTINUABLE` set. | `read` confirms. |
| `magi/src/session/state.ts:156` | `RESUMABLE` set — sibling resume feature layered on top (not in plan). | `read` confirms. |
| `magi/src/session/store.ts:21,37,144,158` | `parentSessionId` on `CreateSessionInput`/`InsertParams`/INSERT/`.run` (additive migration). | `read` confirms. |
| `magi/src/session/store-row.ts:160` | `parentSessionId` row mapping — extracted into its own module (plan had inline `rowToSession`). | `grep` confirms. |
| `magi/src/session/helpers.ts:24-35` | `buildFollowUpPrompt` (clips new prompt too). | `read` confirms. |
| `magi/src/session/helpers.ts:40-53` | `buildResumePrompt` — sibling resume prompt (not in plan). | `read` confirms. |
| `magi/src/workspace/workspace.ts:26` | `prepareContinue` on the `WorkspaceManager` interface. | `grep` confirms. |
| `magi/src/workspace/git-workspace.ts:162-187` | `prepareContinue` impl — fetch + `worktree add` existing branch (now multi-repo via `settleWorktrees`/`effectiveRepos`, +`repos` param). | `read` confirms. |
| `magi/src/session/manager.ts:130-137` | `followUpSession` validates parent, delegates to `runFollowUp`. | `read` confirms. |
| `magi/src/session/continuation.ts:7-8,80-86` | `runFollowUp` — `CONTINUABLE` gate + `idempotencyKey` dedupe (extracted from the plan's monolithic manager). | `grep` confirms. |
| `magi/src/session/lifecycle.ts:112` | `prepareContinue` dispatched with `input.repos` (plan's `runLifecycle` continue-branch threading → extracted lifecycle module). | `grep` confirms. |
| `magi/src/session/auto-publish.ts:44-62` | PR-reuse guard now also updates the PR description / posts a comment (richer than the plan's simple skip). | `grep` confirms. |
| `magi/src/server/router.ts:151-152,213-248` | `POST /sessions/:id/follow-up` → `handleFollowUp`; rate-limit, `validateRepoSpec`, `202`. | `read` confirms. |
| `magi/src/server/router.ts:154-155` | `POST /sessions/:id/resume` sibling route (not in plan). | `read` confirms. |
| `plugins/acp/history.ts:11-21` | `SessionRecord` (+ `shareToken`/`transcriptUrl` beyond the plan). | `read` confirms. |
| `plugins/acp/history.ts:44-77` | `toSessionRecord` extraction; `listRecords`/`delete`/`list` removed from `KvStore`. | `read` confirms. |
| `plugins/acp/continue-tool.ts:95-140` | `continueSessionTool` — `checkAccess` MCP gate, `resolveParentId`/`buildChildRecord` extraction, `capabilityId`, sends `contextId`+`mcpTokens`, `shareFieldsOf` merge. | `read` confirms. |
| `plugins/acp/session-records.ts:11-57` | NEW extracted module: `recordStartedSession` + `enrichSession` (plan inlined these in `session-tools.ts`). | `read` confirms. |
| `plugins/acp/session-tools.ts:108,114-136` | `start_session` calls `recordStartedSession`; `list_sessions` uses `enrichSession` + inline known-set filter. | `read` confirms. |
| `plugins/acp/schemas.ts:62-72` | `continueSessionSchema`. | `read` confirms. |
| `plugins/acp/index.ts:7,128` | imports + registers `continueSessionTool`. | `read` confirms. |
| `plugins/acp/index.ts:92-107` | prompt fragment + `/acp` text mention `continue_session` (and the transcript share link). | `read` confirms. |
| `plugins/acp/tools.ts:63-73,83-98` | `ACP_CAPABILITIES.continue`, `sessionIdOf`, `shareFieldsOf`. | `read` confirms. |
| `src/llm-orchestrator-tools.ts:40-46` | `plugin_acp__continue_session` in `ACP_SESSION_ACTION_TOOLS`. | `read` confirms. |
| `tests/plugins/acp/history.test.ts`, `tests/plugins/acp/continue-session.test.ts` | History index + continue_session tests present. | `glob` confirms. |
| `docs/architecture/coding-sessions.md:96-104` | Feature, endpoint, history record, guardrails, limitations documented. | `grep` confirms. |

Plan-vs-implementation notes:

- **magi's lifecycle/continuation was extracted into dedicated modules.** The plan threaded a `continueBranch` through a monolithic `runLifecycle` in `manager.ts` and inlined `followUpSession`. Shipped splits the lifecycle into `lifecycle.ts` and the continuation launch into `continuation.ts` (`runFollowUp`), with `followUpSession` (`manager.ts:130-137`) a thin validator that delegates. Intent unchanged; structure modularized.
- **magi grew a resume/crash-detection sibling.** The follow-up mechanics were generalized: `RESUMABLE` (`interrupted`), `resumeSession`, `buildResumePrompt`, and `POST /sessions/:id/resume` reuse the `prepareContinue`/child-session path. None of this is in the plan; it is a later feature riding on the same foundation.
- **`FollowUpSessionInput` widened.** Plan: `{ parentSessionId, prompt, secrets?, forgeToken? }`. Shipped (`state.ts:136-144`): adds `contextId?`, `mcpTokens?`, `idempotencyKey?`. The route forwards all of them (`router.ts:235-243`), and the papai tool sends `contextId` + `mcpTokens` (`continue-tool.ts:124-130`). The MCP-token relay and idempotency dedupe are post-plan additions.
- **`prepareContinue` is now multi-repo.** Plan operated on a single `project.repoUrl`. Shipped (`git-workspace.ts:162-187`) takes an optional `repos?: RepoSpec[]` and fans out via `settleWorktrees`/`effectiveRepos` — part of a broader multi-repo support that post-dates the plan.
- **The PR-reuse guard does more than skip PR creation.** Plan's `autoPublishDirty` only skipped `openPullRequest` when `prUrl` was set. Shipped (`auto-publish.ts:44-62` + `pr-description.ts`) also updates the existing PR's description and posts a follow-up comment.
- **`buildFollowUpPrompt` clips the new prompt too.** Plan clipped only the prior task/outcome; shipped clips all three fields (`helpers.ts:33`).
- **papai record/enrichment logic was extracted to `session-records.ts`.** Plan inlined `writeRecord` and the `list_sessions` merge directly in `session-tools.ts`. Shipped moves `recordStartedSession` and `enrichSession` into a new `plugins/acp/session-records.ts` consumed by both `session-tools.ts` and `continue-tool.ts`.
- **`continue_session` grew an MCP gate and transcript/share fields.** Plan checked only secrets + forge token. Shipped's `checkAccess` (`continue-tool.ts:25-45`) additionally fails closed if `resolveMcpServers()` no longer resolves, relays `mcpTokens`, merges `shareToken`/`transcriptUrl` via `shareFieldsOf`, and tags the tool with `capabilityId: ACP_CAPABILITIES.continue`. The prompt fragment was also updated to mention the transcript share link.
- **`history.ts` narrowed its `KvStore` and dropped `listRecords`.** Plan's `KvStore` had `delete`/`list` and exported `listRecords`. Shipped requires only `get`/`set`; `list_sessions` reads `runtimeContext.kv.list` from the runtime's own wider structural type. Behavior preserved, exported surface smaller.
- **`SessionRecord` gained `shareToken`/`transcriptUrl`.** Beyond the plan's fields, to support the transcript-viewer/share feature layered on the ACP plugin.

The source plan `docs/superpowers/plans/2026-07-01-follow-up-coding-sessions.md` and design `docs/superpowers/specs/2026-07-01-follow-up-coding-sessions-design.md` are archived alongside this ADR to `docs/archive/`.
