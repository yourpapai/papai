# Design: GitHub Issues task-provider plugin — session 2: comments + labels

## Context

Session 1 (`openspec/changes/github-issues-task-provider/`) delivered the plugin skeleton: `client.ts` (`githubFetch` / `githubPaginate` with the observation boundary and rate-limit shape detection), `classify-error.ts` (status → `AppError` with task/project context), `operations/tasks.ts` + `operations/projects.ts`, `mappers.ts`, Zod `schemas/`, and a `provider.ts` advertising exactly `projects.list` / `projects.read`. The core `TaskProvider` interface (`src/providers/types.ts`) already declares the optional comment and label methods this session implements; no `src/` file changes. Motivation is in `proposal.md`; behavior contracts in `specs/github-comments-labels/spec.md`.

Constraints that shape the design:

- The Write/Edit TDD hook pipeline gates only `src/` and `client/` (`docs/architecture/commands.md`) — files under `plugins/` and `tests/` pass through unchecked, so test-first order is a `tasks.md` discipline, not a hook guarantee.
- Provider conventions (`src/providers/AGENTS.md`): one operations file per domain, `[provider][Entity][Action]` naming, config-first parameters, Zod validation, normalized domain types, classify-by-status with entity context preserved.

## Goals / Non-Goals

**Goals:**

- Implement the optional comment and label methods by composing the session-1 client, classifier, and mapper seams — zero new infrastructure, zero `src/` edits.
- Declare the nine new capabilities identically in `plugin.json` and `GITHUB_CAPABILITIES` so manifest validation, tool gating, and the provider instance cannot drift.

**Non-Goals** (design-level, on top of the proposal's scope):

- No retry/backoff for rate-limited label/comment mutations — classification only.
- No prompt-addendum change: capability advertisement already drives which comment and label tools are offered; the addendum's limitation text stays task-focused.
- No provider wiring for full-set replace (`setTaskLabels`) or clear-all (`clearTaskLabels`): `TaskProvider` declares no such methods. The operations exist (GitHub's PUT/DELETE-all endpoints) and stay unwired until a later session adds a surface that needs them.

## Decisions

### 1. New domains as new operations modules over the existing client

`schemas/comment.ts`, `schemas/label.ts`, `operations/comments.ts`, `operations/labels.ts` follow the session-1 layout one-to-one. Every request goes through the existing `githubFetch` (bearer token, observation boundary, host confinement by construction) and every list through `githubPaginate` (`per_page: 100`, short-page termination). Rejected: extending `operations/tasks.ts` — the per-domain file convention exists precisely for this split, and Kaneo/YouTrack already have `operations/comments.ts` / `operations/labels.ts` to mirror.

### 2. Comment update/delete address the comments collection, not the issue

`PATCH`/`DELETE /repos/{o}/{r}/issues/comments/{id}` — GitHub's per-issue comments path supports only list/create, and update/delete are collection-addressed. The provider's `updateComment`/`removeComment` params carry `taskId` solely as classification context (so a 404 lands on `taskNotFound`), never in the URL. Comment id = the stringified numeric comment id; delete synthesizes `{ id: commentId }` locally because GitHub answers 204 with no body (the client already returns `undefined` for 204).

### 3. Comment listing reuses the search-windowing pattern

`githubListTaskComments` paginates with `maxItems = offset + limit` (defaults: offset 0, limit unbounded) and slices `[offset, offset + limit)` — the same fetch-window-then-slice shape as `githubSearchTasks`. No GitHub endpoint accepts a comment offset, so windowing client-side is the only option; bounding the fetch by `maxItems` keeps it from paginating to exhaustion when a small window is requested.

### 4. Repo labels are name-addressed; one shared id-or-name resolver

GitHub's label endpoints address labels by name (`PATCH`/`DELETE /repos/{o}/{r}/labels/{name}`, `encodeURIComponent`d). The `TaskProvider` methods pass `labelId`, which for GitHub can be the numeric id string or the name. A single helper `resolveLabelName(config, ref)` is used by every repo-label-addressed call (`updateLabel`, `removeLabel`, `addTaskLabel`, `removeTaskLabel`): a purely numeric reference triggers **one** `githubListLabels` pass resolved by numeric id; anything else is used as the name with no lookup; an unresolved numeric reference falls through as the name. One resolver instead of per-method logic keeps the ambiguity policy testable in one place. Rejected: resolving via search — labels have no search endpoint; rejected: always looking up — doubles list traffic for the common name-reference case.

### 5. Issue-label set semantics split by verb

Add (`POST /issues/{n}/labels`, body `{ labels: names }`) is incremental; replace (`PUT`, same body shape) is full-set — the request body carries the complete desired set, so an omitted label is removed. The operations layer implements both plus remove-one (`DELETE /issues/{n}/labels/{name}`, URL-encoded) and clear-all (`DELETE /issues/{n}/labels`) so the whole GitHub surface is covered and pinned by tests; the provider wires only `addTaskLabel` / `removeTaskLabel` (the interface's only assignment methods, single label each → one-element `names` array).

### 6. Schemas: strict for repo labels, tolerant for issue payloads

`GitHubRepoLabelSchema` (new) is strict — `color` matches `/^[0-9a-f]{6}$/`, `description` nullable — because repo-label endpoints return one canonical shape. Issue-level label payloads keep the session-1 union (`GitHubLabelSchema`: string or object) since GitHub genuinely varies there; reusing it beats re-deriving tolerance. `GitHubCommentSchema` follows the session-1 field style (`user` nullable, timestamps as strings) with the fields the normalized `Comment` needs plus `html_url`, `issue_url`, `author_association` carried for completeness.

### 7. Mappers extend `mappers.ts`, reusing the string-label convention

`mapCommentToComment` (`{ id: String(id), body, author: user?.login, createdAt }`, author absent when `user` is null) and repo-label/issue-label mappers (`{ id: String(id), name, color }`; string form maps `{ id: name, name }` exactly like the existing `mapLabel`). Keeping them in `mappers.ts` alongside `mapLabel` means the two label-mapping behaviors stay adjacent and share the tolerance test surface.

### 8. Capability growth is exactly nine, declared twice, pinned by tests

`GITHUB_CAPABILITIES` and `plugin.json` `providerCapabilities` both grow by `comments.read/create/update/delete` + `labels.list/create/update/delete/assign` (11 total). `manifest.test.ts` asserts the exact list (not a superset) so a future typo'd capability fails loudly, and `constants.test.ts` asserts set equality between the two declarations — the drift risk of declaring in two places is closed by a test rather than by codegen.

### 9. Errors reuse `classifyGitHubError` with per-call context

Task-scoped calls (comments, issue labels) pass `{ taskId }`; repo-scoped calls (repo label CRUD, listing) pass `{ projectId: config.repo }` — matching session 1's rule that 404 with task context is `taskNotFound`, otherwise `projectNotFound`. Rate-limit precedence over the 401/403 mapping, 400/422 → `validationFailed`, and network-shape detection all come from the existing classifier unchanged. Comment ids and label names travel in classified messages and log metadata; the token never does.

## Risks / Trade-offs

- [Numeric reference ambiguity: a label *named* `123` vs the label *with id* `123`] → resolution prefers the id match; an unmatched numeric falls through as a name, so the name-shaped path still works. Pinned by a test with both shapes; worst case is a wrong-label assignment when both exist — surfaced to the user in the tool result.
- [Replace-vs-add confusion silently drops labels] → PUT body is asserted by a dedicated test to carry the full label-name set, and the operations layer keeps the two verbs as separate functions with distinct names.
- [`getLabelByName` and numeric resolution list every repo label] → one paginated pass per call, `per_page: 100`; accepted for typical label counts, rate-limit classification covers the pathological case. A `GET /labels/{name}` single-fetch exists upstream but returns 404 for both missing-label and missing-repo, which would corrupt the not-found classification split — the listing pass preserves it.
- [URL-unsafe label names (`/`, `?`, `%`, `#`, unicode) break paths] → every name is `encodeURIComponent`ed into the path; tested with a name containing path-unsafe characters on update, delete, and remove-one.
- [Secondary rate limits on rapid label mutations] → no auto-retry this session (Non-Goal); failures classify as `rateLimited` and surface to the agent.
- [Two declaration sites for capabilities] → closed by the set-equality and exact-list tests (decision 8).

## Migration Plan

None required. No DB schema change, no migration, no `src/` edit, no new persisted state. The capability set widening is additive: `github` instances gain comment/label tools on next provider construction; contexts with `tool_prefs` deny/ask on those tools keep their pre-existing resolution. Rollback = disable the plugin or revert the directory; nothing persisted by this session survives outside ordinary task-instance rows.

## Scope model impact

No new persisted state and no new scope keys. Comments and labels are fetched statelessly per tool call against the same encrypted **task-instance** config (`repo`, `baseUrl`) and **context-scoped** token session 1 defined — group-shared across a group's threads, never keyed by storage-context id, platform instance, or user. Platform parity is by construction: the provider sits behind the platform-neutral task tools.

## Capability / tool_prefs impact

No new tool surface: the change widens the advertised capability set of an existing provider type, so the existing comment/label task tools, their capability gating, and per-context `tool_prefs` (allow/ask/deny, most-specific-wins — including the `ask` confirmation flow) apply unchanged. `getComment` (single fetch) and comment reactions stay unimplemented and their capabilities unadvertised, so those tools remain absent for `github` instances. Guest mode is untouched: the hardcoded read-only guest toolset gains no comment or label write operation. A context with a null task instance exposes nothing, as before.

## New modules

Under `plugins/task-provider-github/`: `schemas/comment.ts` + `schemas/label.ts` (Zod shapes — no existing schema covers comments; issue.ts's label union covers only the issue payload form, so a strict repo-label schema is new), `operations/comments.ts` + `operations/labels.ts` (endpoint operations over the existing `client.ts` / `classify-error.ts`). `mappers.ts`, `provider.ts`, `constants.ts`, `plugin.json`, `README.md` are edits. No module outside the plugin changes; no new dependency — fetch, Zod, and the session-1 client cover every need.

## Hook and TDD interaction

The Write/Edit TDD hook gates only `src/` and `client/`, so none of the new files are enforced red-green; `tasks.md` imposes the test-first order instead, each task naming its proving command. New suites follow the existing `tests/plugins/task-provider-github/operations/tasks.test.ts` pattern: `setMockFetch`/`restoreFetch` + `captureRequests` for method/path/body assertions, `schemaValidates` for the new schemas. `manifest.test.ts`, `constants.test.ts`, and `provider.test.ts` are updated in the same task as the declaration change so the exact-11 pin never observes a mismatched intermediate state.
