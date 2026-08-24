# Tasks: GitHub Issues task-provider plugin — session 2: comments + labels

Test-first throughout (the TDD hook does not gate `plugins/`/`tests/`, so this list
imposes the order): each group writes the failing suite before the implementation it
pins. Reference: `specs/github-comments-labels/spec.md` (what), `design.md` (how).

## 1. Schemas

- [x] 1.1 Write failing `tests/plugins/task-provider-github/schemas/comment.test.ts` pinning `GitHubCommentSchema`: accepts a full comment payload (`id` int, `body` string, `user` nullable, `created_at`/`updated_at` strings, `html_url`, `issue_url`, `author_association`); rejects wrong types and a non-nullable-shaped `user` — verify with `bun test tests/plugins/task-provider-github/schemas/comment.test.ts`
- [x] 1.2 Write failing `tests/plugins/task-provider-github/schemas/label.test.ts` pinning `GitHubRepoLabelSchema`: accepts canonical repo-label payload; rejects bad `color` (not `/^[0-9a-f]{6}$/`), non-int `id`, missing-nullable `description` handling — verify with `bun test tests/plugins/task-provider-github/schemas/label.test.ts`
- [x] 1.3 Implement `plugins/task-provider-github/schemas/comment.ts` (`GitHubCommentSchema` + inferred type) and `schemas/label.ts` (`GitHubRepoLabelSchema` + inferred type, reusing `GitHubLabelSchema` from `schemas/issue.ts` for issue-level payloads) until both suites pass — verify with `bun test tests/plugins/task-provider-github/schemas/`

## 2. Mappers

- [x] 2.1 Write failing cases in `tests/plugins/task-provider-github/mappers.test.ts`: comment → normalized `Comment` (`id: String(id)`, `body`, `author: user?.login` absent when user null, `createdAt`); repo label → `Label` (`{ id: String(id), name, color }`); string-form issue label → `{ id: name, name }` — verify with `bun test tests/plugins/task-provider-github/mappers.test.ts`
- [x] 2.2 Add the comment and label mappers to `plugins/task-provider-github/mappers.ts` until the mapper suite passes — verify with `bun test tests/plugins/task-provider-github/mappers.test.ts`

## 3. Comment operations

- [ ] 3.1 Write failing `tests/plugins/task-provider-github/operations/comments.test.ts` (following `operations/tasks.test.ts`'s `setMockFetch`/`restoreFetch` + `captureRequests` pattern): list hits `GET /repos/{o}/{r}/issues/{n}/comments` with windowing (`maxItems = offset + limit`, slice `[offset, offset+limit)`, multi-page); create hits `POST` with `{ body }`; update hits `PATCH /repos/{o}/{r}/issues/comments/{id}` (not the issue path); delete hits `DELETE` on the comments collection and returns `{ id }` on 204; 404 with task context → `taskNotFound`, 401 → `authFailed`, 429 → `rateLimited` via `GitHubClassifiedError` AppError codes — verify with `bun test tests/plugins/task-provider-github/operations/comments.test.ts`
- [ ] 3.2 Implement `plugins/task-provider-github/operations/comments.ts` (`githubListTaskComments`, `githubCreateTaskComment`, `githubUpdateTaskComment`, `githubDeleteTaskComment`) over `githubFetch`/`githubPaginate` with `{ taskId }` / `{ projectId: repo }` classification context until the suite passes — verify with `bun test tests/plugins/task-provider-github/operations/comments.test.ts`

## 4. Label operations

- [ ] 4.1 Write failing `tests/plugins/task-provider-github/operations/labels.test.ts`: repo-level list (paginated `GET /repos/{o}/{r}/labels`), create (`POST` `{ name, color?, description? }`), update (`PATCH /labels/{encodeURIComponent(name)}`), delete (`DELETE` same); issue-level get (`GET /issues/{n}/labels`), replace (`PUT` body carries the full label-name set), add (`POST` incremental), remove one (`DELETE /issues/{n}/labels/{encodeURIComponent(name)}`), clear all (`DELETE /issues/{n}/labels`); string-vs-object payload tolerance; URL-encoding asserted with a path-unsafe name; 404/401/429/422 classifications — verify with `bun test tests/plugins/task-provider-github/operations/labels.test.ts`
- [ ] 4.2 Implement `plugins/task-provider-github/operations/labels.ts` (repo-level `githubListLabels`, `githubCreateLabel`, `githubUpdateLabel`, `githubDeleteLabel`; issue-level `githubGetTaskLabels`, `githubSetTaskLabels`, `githubAddTaskLabels`, `githubRemoveTaskLabel`, `githubClearTaskLabels`) plus the shared `resolveLabelName` helper (one `githubListLabels` pass for purely numeric refs, resolved by numeric id; direct name otherwise; unresolved numeric falls through as name) until the suite passes — verify with `bun test tests/plugins/task-provider-github/operations/labels.test.ts`

## 5. Capability declarations

- [ ] 5.1 Update `tests/plugins/task-provider-github/manifest.test.ts` to pin the exact 11-capability list (no extras/omissions) and `constants.test.ts` to assert set equality between `GITHUB_CAPABILITIES` and the manifest declarations — verify with `bun test tests/plugins/task-provider-github/manifest.test.ts tests/plugins/task-provider-github/constants.test.ts`
- [ ] 5.2 Grow `GITHUB_CAPABILITIES` (`plugins/task-provider-github/constants.ts`) and `providerCapabilities` (`plugin.json`) by exactly `comments.read`, `comments.create`, `comments.update`, `comments.delete`, `labels.list`, `labels.create`, `labels.update`, `labels.delete`, `labels.assign` until both suites pass — verify with `bun test tests/plugins/task-provider-github/manifest.test.ts tests/plugins/task-provider-github/constants.test.ts`

## 6. Provider wiring

- [ ] 6.1 Update `tests/plugins/task-provider-github/provider.test.ts`: capability set at the existing set-assertion (lines ~103–104); drop now-implemented comment/label methods from the forbidden-unimplemented list (lines ~161–175); add an endpoint-wiring test covering `getComments`, `addComment`, `updateComment`, `removeComment`, `listLabels`, `listTaskLabels`, `getLabelByName` (exact-name filter), `createLabel`, `updateLabel`, `removeLabel`, `addTaskLabel`, `removeTaskLabel` — including numeric-ref lookup (≤1 list call) and direct-name paths; keep `getComment` and reactions in the forbidden list — verify with `bun test tests/plugins/task-provider-github/provider.test.ts`
- [ ] 6.2 Implement the methods on `plugins/task-provider-github/provider.ts`, delegating to the operations modules with the resolver from 4.2, until the suite passes — verify with `bun test tests/plugins/task-provider-github/provider.test.ts`

## 7. Docs

- [ ] 7.1 Update `plugins/task-provider-github/README.md`: replace the "comments/labels are not offered" statement with the nine new capabilities; confirm no `docs/architecture/*.md` page references the session-1 capability set (grep for `projects.list` under `docs/`) — verify with `rg -n "comments|labels" plugins/task-provider-github/README.md && rg -n "projects.list" docs/ || true`

## 8. Full verification

- [ ] 8.1 Run the full gate: `bun test` (full suite), `bun run typecheck`, `bun run lint`, and `bun security` — all green before the change is done — verify with `bun test && bun run typecheck && bun run lint && bun security`
