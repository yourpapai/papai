# GitHub Issues task-provider plugin — session 3: identity resolver, task history, count + search tuning

## Goal

Finish `plugins/task-provider-github/` (sessions 1–2 delivered task CRUD, project listing, comment CRUD, label management) with: identity resolution for auto-link/assignment, issue-event task history (`getTaskHistory`), task counting via search `total_count` (`countTasks`), and an extracted, pure, unit-testable search-qualifier builder. **No `src/` core edits** — the optional `TaskProvider` surfaces (`src/providers/types.ts:274-288`, `identityResolver` at `src/providers/types.ts:94`) and capability strings (`activities.read`, `tasks.count` in `src/providers/task-capability.ts`) already exist; `src/tools/tools-builder.ts:199,255` gates the tools on capability + method presence, so wiring the provider activates them.

Note: the existing change `github-provider-comments-labels` explicitly declares session-3 surfaces out of scope, and `github-issues-task-provider` (session 1) is complete — this is a new change.

## Requirements

1. **`identity-resolver.ts` (new)** — `createGitHubIdentityResolver(config): UserIdentityResolver` mirroring YouTrack's `createYouTrackIdentityResolver` shape. `searchUsers(query, limit?)` → `Promise<IdentityUser[]>` (`{ id: String(user.id), login, name }`). Flow: fetch repo collaborators first via `GET /repos/{o}/{r}/collaborators?permission=push` (paginated with `githubPaginate`), fuzzy-match query against login and (when present) `name`; only when no collaborator matches, fall back to `GET /search/users?q={query}` (single request, `items`). Matching is a pure, exported function: normalize both sides (trim + lowercase), rank exact-login > name-equality/word match > substring containment on login or name; apply `limit` (default 10). No-match → `[]` (never throws); upstream failures log `error` and rethrow classified via `classifyGitHubError`. `preferredUserIdentifier` stays `'login'` on the provider. The user schema reuses `schemas/user.ts` `GitHubUserSchema`, tolerant of an optional `name` field for display-name matching.
2. **`schemas/event.ts` (new)** — Zod v4 `GitHubIssueEventSchema` for `GET /repos/{o}/{r}/issues/{n}/events` entries: `id` int, `event` string, `created_at` string, `actor` `GitHubUserSchema` nullable, `label` `{ name: string }` nullable, `assignee` `GitHubUserSchema` nullable; `export type GitHubIssueEvent = z.infer<...>`. Extra GitHub fields are stripped by the object parse.
3. **`operations/activities.ts` (new)** — `githubListTaskEvents(config, taskId, params?)` → normalized `Activity[]` (`src/providers/domain-types.ts:228-236`: `{ id, timestamp, author?, category, field?, added?, removed? }`). Fetch via `githubPaginate` over `/repos/{o}/{r}/issues/{n}/events`; map: `assigned` → category `assignee`, added = assignee login; `labeled`/`unlabeled` → `label`, added/removed = label name; `closed` → `status`, added `closed`; `reopened` → `status`, added `open`; `commented` → `comment`. Unknown event types are dropped. id = `String(id)`, timestamp = `created_at`, author = `actor?.login`. `getTaskHistory` params (`categories`, `limit`, `offset`, `reverse`, `start`, `end`, `author`) are applied client-side after mapping (GitHub's events endpoint has no server-side filters): author/category equality filters, `start`/`end` ISO-string compare, `reverse`, then limit/offset slice. Errors classified with `{ taskId }` context (404 → task-not-found).
4. **`operations/count.ts` (new)** — `githubCountTasks(config, { query, projectId? })` → number. If `projectId` is defined and ≠ `config.repo`, reject with `GitHubClassifiedError` + `providerError.projectNotFound` (mirrors `createTask`'s one-repo guard in `provider.ts:77-85`). Otherwise one `GET /search/issues?q={built}&per_page=1`, validate `z.object({ total_count: z.number() })`, return `total_count` (total_count reflects the full count, not the page). Errors classified with `{ projectId: config.repo }`.
5. **Search-qualifier builder in `operations/tasks.ts`** — extract an exported pure function `buildGitHubIssueSearchQuery(input: { repo: string; query?: string; assigneeId?: string; status?: string })` → trimmed `q` string: always `repo:{owner}/{repo} is:issue`; `assigneeId` → `assignee:{login}`; `status === 'open'` → `is:open`, `status` starting with `closed` → `is:closed`; non-empty text query appended as free-text terms followed by `in:title,body`; empty query emits no `in:` clause. `githubSearchTasks` is refactored to call it (its current inline `repo:… is:issue [assignee:…] query` composition at `operations/tasks.ts:192-194` changes only by the added `in:title,body` — a deliberate tuning, tests updated). `githubCountTasks` reuses the same builder so search and count stay consistent.
6. **`provider.ts`** — add `getTaskHistory(taskId, params?)` → `githubListTaskEvents`, `countTasks(params)` → `githubCountTasks`, and `readonly identityResolver` assigned in the constructor via `createGitHubIdentityResolver(this.config)` (YouTrack pattern, `plugins/task-provider-youtrack/provider.ts:92-98`).
7. **`constants.ts` + `plugin.json`** — `GITHUB_CAPABILITIES` and manifest `providerCapabilities` each grow by exactly `activities.read` and `tasks.count` (13 total, appended after the session-1+2 eleven). Nothing else in the manifest changes; `constants.test.ts` set-equality + manifest-sync assertions keep the two in lockstep.
8. **README.md** — update the capabilities paragraph (currently says history "is not offered … remaining surfaces arrive in later sessions") to state task history, task counting, and identity resolution are now offered; issue deletion and attachments remain absent.
9. **Conventions** — pino `debug` at entry with params, `info` on success with identifiers, `error` with `error instanceof Error ? error.message : String(error)`; classified errors carry task/event ids in context; `.js` import extensions; strict TypeScript; no lint-disable/type-ignore comments; follow the plugin's existing SPDX headers and DI-free operation-function style (`config` first).

## Files to touch

New (plugin): `plugins/task-provider-github/identity-resolver.ts`, `schemas/event.ts`, `operations/activities.ts`, `operations/count.ts`.
Modified (plugin): `operations/tasks.ts` (extract + use the builder), `provider.ts` (wire three surfaces), `constants.ts` (+2 capabilities), `plugin.json` (+2 capabilities), `README.md`.
New (tests): `tests/plugins/task-provider-github/identity-resolver.test.ts`, `schemas/event.test.ts`, `operations/activities.test.ts`, `operations/count.test.ts`.
Updated (tests): `operations/tasks.test.ts` (builder qualifier-composition cases: repo+is:issue always, assignee:login, status→is:open/is:closed, text + in:title,body, empty query), `manifest.test.ts` (exact 13-capability list), `constants.test.ts`, `provider.test.ts` (drop `getTaskHistory`/`countTasks` from the forbidden-optional-method list at lines 247–250; add wiring assertions for both methods and `identityResolver`).
No `src/` changes.

## Test approach

All suites use `setMockFetch`/`restoreFetch` + `mockLogger` from `tests/utils/test-helpers.ts` following `operations/tasks.test.ts`'s `captureRequests` pattern (the ambient `NO_ANALYTICS_SCOPE` from `tests/mock-reset.ts` satisfies `requireProviderRequestScope`). Identity resolver: exact-login collaborator match; fuzzy name match; collaborator-miss → `/search/users` fallback (assert both captured URLs and the `permission=push` query param); no match anywhere → `[]`; limit respected. Event schema: representative assigned/labeled/closed payloads with nullable actor/label/assignee accepted, malformed rejected (`schemaValidates`). Activities: endpoint + pagination; per-event-type mapping to who/when/what; client-side author/categories/limit/offset; 404 → task-not-found AppError code. Count: `total_count` extraction; `per_page=1`; built `q` asserted; `projectId` mismatch → project-not-found. Builder: pure-function composition cases listed above. Manifest/constants/provider: exact final capability set and wiring.

## Verification

```
bun test tests/plugins/task-provider-github/
bun run lint
bun run typecheck
bun run test
bun check:full
```
If the new plugin file mass trips the coverage floors (`scripts/coverage/floor.json`, `scripts/story/coverage-floor.json`), raise them from a green full run via the sanctioned `bun coverage:ratchet --update` / `bun coverage:ratchet:stories` procedure and note it in the change (session-1 task 9.1 precedent).

Done when identity resolution, task history (issue events), counting (search `total_count`), and tuned search qualifiers all work against mocked GitHub REST responses and every check passes. After this session the plugin is feature-complete per the design spec.

## Out of scope

Projects-beta GraphQL, sub-issues, `deleteIssue`, label-encoded priority/due dates, comment reactions, single-comment fetch, any `src/` core edit, YouTrack/Kaneo changes.

## Assumptions

- The resolver exposes only `searchUsers` — the sole method core consumes (`src/identity/resolver.ts:74`, `src/tools/set-my-identity.ts:64`); no `getUserByLogin` (nothing calls it for GitHub).
- History uses the stable `/issues/{n}/events` endpoint, not the preview `/timeline`; `commented` is mapped if present but is not guaranteed by that endpoint.
- GitHub simple-user objects carry no display name; fuzzy matching uses login plus optional `name` when the payload provides one.

## Capabilities

- `github-identity-history-count` — the `github` provider type gains identity resolution (chat-user → GitHub login for auto-link/assignment), task history from issue events (`activities.read`), task counting via search `total_count` (`tasks.count`), and a shared, tuned search-qualifier builder (`repo:` + `is:issue` pinned, `assignee:`/status/`in:title,body` mapping).
