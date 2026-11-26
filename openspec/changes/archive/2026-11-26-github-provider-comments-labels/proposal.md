# GitHub Issues task-provider plugin — session 2: comments + labels

## Goal

Extend the existing `plugins/task-provider-github/` plugin (session 1: task CRUD + project listing) with comment CRUD and label management (repo-level and issue-level), wired to the optional `TaskProvider` comment/label methods and gated by newly declared capabilities. Session 3 surfaces (identity/history/count) and every `src/` core file are out of scope.

## Capabilities

- `github-comments-labels` — the `github` provider type gains comment read/create/update/delete and label list/create/update/delete/assign (repo- and issue-level) over GitHub REST v3.

## Requirements

- Listing, creating, updating, and deleting issue comments works against `GET/POST /repos/{o}/{r}/issues/{n}/comments` and `PATCH/DELETE /repos/{o}/{r}/issues/comments/{id}` (update/delete use the comments collection, not the issue path).
- Repo-level label management works against `GET/POST /repos/{o}/{r}/labels` and `PATCH/DELETE /repos/{o}/{r}/labels/{name}` with the name URL-encoded in the path.
- Issue-level label management works: get (`GET /issues/{n}/labels`), replace-full-set (`PUT /issues/{n}/labels`), add (`POST /issues/{n}/labels`), remove one (`DELETE /issues/{n}/labels/{name}`, name URL-encoded), clear all (`DELETE /issues/{n}/labels`).
- `plugin.json` `providerCapabilities` (and `GITHUB_CAPABILITIES` in `constants.ts`, kept in sync) grow by exactly: `comments.read`, `comments.create`, `comments.update`, `comments.delete`, `labels.list`, `labels.create`, `labels.update`, `labels.delete`, `labels.assign` (11 total with session 1's two).
- Errors classify through the existing `classifyGitHubError` (401/403 → authFailed, 404 → taskNotFound when taskId context is passed, 429/rate-limit-shaped 403 → rateLimited, 400/422 → validationFailed); comment/label ids stay in log metadata and classified-error messages.

## Files to touch

All under `plugins/task-provider-github/` and `tests/plugins/task-provider-github/` (no `src/` changes):

1. **New** `plugins/task-provider-github/schemas/comment.ts` — `GitHubCommentSchema`: `id` int, `body` string, `user` GitHubUserSchema nullable, `created_at`/`updated_at` strings, `html_url`, `issue_url`, `author_association` string; `export type GitHubComment = z.infer<...>`.
2. **New** `plugins/task-provider-github/schemas/label.ts` — `GitHubRepoLabelSchema`: `id` int, `name` string, `color` string matching `/^[0-9a-f]{6}$/`, `description` nullable, `default` boolean. Reuse the existing string-vs-object tolerant `GitHubLabelSchema` (schemas/issue.ts) for issue-level payloads.
3. **New** `plugins/task-provider-github/operations/comments.ts` — `githubListTaskComments(config, taskId, params?)` (paginated via `githubPaginate`, per_page 100, limit/offset applied as fetch-window + slice like `githubSearchTasks`), `githubCreateTaskComment(config, taskId, body)` (POST `{ body }`), `githubUpdateTaskComment(config, params { taskId, commentId, body })` (PATCH comments collection), `githubDeleteTaskComment(config, commentId)` (DELETE → `{ id }`, 204).
4. **New** `plugins/task-provider-github/operations/labels.ts` — repo-level `githubListLabels` (paginated), `githubCreateLabel` (POST `{ name, color?, description? }`), `githubUpdateLabel` (PATCH `/labels/{encodeURIComponent(name)}`), `githubDeleteLabel` (DELETE same); issue-level `githubGetTaskLabels`, `githubSetTaskLabels(config, taskId, names)` (PUT `{ labels: names }`, replaces the full set), `githubAddTaskLabels(config, taskId, names)` (POST `{ labels: names }`), `githubRemoveTaskLabel(config, taskId, name)` (DELETE `/issues/{n}/labels/{encodeURIComponent(name)}`), `githubClearTaskLabels(config, taskId)` (DELETE `/issues/{n}/labels`).
5. `plugins/task-provider-github/mappers.ts` — add comment → normalized `Comment` (`{ id: String(id), body, author: user?.login, createdAt: created_at }`) and label mappers → `Label`/`TaskLabel` (`{ id: String(id), name, color }`; tolerant string form maps `{ id: name, name }` like the existing `mapLabel`).
6. `plugins/task-provider-github/provider.ts` — implement optional methods delegating to the operations: `getComments`, `addComment`, `updateComment`, `removeComment`; `listLabels`, `listTaskLabels`, `getLabelByName` (exact-name filter over `githubListLabels`), `createLabel`, `updateLabel`, `removeLabel`, `addTaskLabel`, `removeTaskLabel`. `getComment` (single fetch) and reactions stay unimplemented — not in this session's operation set. Assumption: `addTaskLabel`/`removeTaskLabel` receive a label id or name — purely numeric values are resolved to a name via one repo-labels lookup (GitHub assignment is name-based), anything else is used as the name directly.
7. `plugins/task-provider-github/constants.ts` + `plugins/task-provider-github/plugin.json` — extend capability set as listed above; nothing else in the manifest changes.
8. `plugins/task-provider-github/README.md` — update the capabilities paragraph (currently states comments/labels are not offered).

## Tests

- **New** `tests/plugins/task-provider-github/schemas/comment.test.ts`, `schemas/label.test.ts` — accept/reject via `schemaValidates` (bad color, wrong types, nullable description).
- **New** `tests/plugins/task-provider-github/operations/comments.test.ts`, `operations/labels.test.ts` — CRUD happy paths with captured method/path/body assertions (following `operations/tasks.test.ts`'s `setMockFetch`/`restoreFetch` + `captureRequests` pattern); 404/401/429 classification into `GitHubClassifiedError` AppError codes; label-name URL-encoding in paths; string-vs-object label payload tolerance; PUT-replaces semantics (body carries the full label-name set); comment update/delete hit `/issues/comments/{id}` not the issue path; 204 delete returns `{ id }`.
- **Update** `tests/plugins/task-provider-github/manifest.test.ts` (exact 11-capability list), `constants.test.ts` (set equality), `provider.test.ts` (capability set at lines 103–104; drop the now-implemented comment/label methods from the forbidden list at lines 161–175; add an endpoint-wiring test covering comment and label methods like the existing task-wiring test).

## Out of scope

- Session 3 surfaces: identity, history, count, and any other optional methods.
- Any `src/` core file (types, capability catalog, tools).
- Comment reactions.

## Verification

```
bun test tests/plugins/task-provider-github/
bun run lint
bun run typecheck
bun run test
```

Done when comment and label CRUD (repo- and issue-level) works against mocked GitHub REST responses, the nine new capabilities are declared in manifest + constants and reflected on the provider, and all four checks pass.
