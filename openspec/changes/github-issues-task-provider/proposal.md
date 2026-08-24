# GitHub Issues Task-Provider Plugin — Session 1: Scaffold + Core Task CRUD

## Goal

Create `plugins/task-provider-github/`, a new task-provider plugin exposing GitHub Issues (REST v3) as task-tracker type `github`. One task instance = one repository: `repo` (`owner/repo`) in instance config, PAT `token` in context config, `baseUrl` optional (default `https://api.github.com`, GHES supported). This is session 1 of 3: **scaffold + core task CRUD + projects (configured repo only)**. Session 2 (comments/labels) and session 3 (identity/history/count) are out of scope — do not implement them.

Note: the issue references a design spec at `openspec/changes/github-issues-task-provider/` but no such directory exists on this branch; this change creates it. No `src/` edits — plugins are discovered from the filesystem.

## Files to create (all new)

### `plugins/task-provider-github/plugin.json`
Model on `plugins/task-provider-youtrack/plugin.json`:
- `id: "task-provider-github"`, `name: "GitHub"`, `version: "1.0.0"`, `apiVersion: 1`, `main: "index.ts"`, `defaultEnabled: false`.
- `permissions: ["provider.task", "identity"]`; `contributes: { taskProviderTypes: ["github"] }`.
- `providerCapabilities`: exactly `["projects.list", "projects.read"]` this session (later sessions extend).
- `providerConfigSchema` (instance scope): `baseUrl` (label "GitHub API URL", `required: false`, validated when present), `repo` (label "Repository (owner/repo)", `required: true`).
- `providerContextConfigSchema`: `token` (label "GitHub PAT", `required: true`, `sensitive: true`, `scope: "context"`).
- `providerAllowedHosts: ["api.github.com"]`; `providerAllowedInstanceHostsFromConfig: ["baseUrl"]` (must reference an instance-scoped `providerConfigSchema` entry — enforced by `src/plugins/types.ts` manifest refinement).
- `providerConfigValidator: "validateConfig"`.

### `index.ts` / `entry-runtime.ts`
Copy the YouTrack structure exactly (`plugins/task-provider-youtrack/index.ts`, `entry-runtime.ts`): SPDX header; `index.ts` default-exports a factory whose `activate(ctx)` calls `ctx.registration.registerTaskProviderType('github', config => createGitHubProvider(config))`; re-export `validateConfig` as a named export (resolved by the loader from the manifest's `providerConfigValidator`); keep the KNOWN GAP (#15) comment (global fetch, not `ctx.providerRuntime`). `entry-runtime.ts` uses the same `import.meta.require` module-contract-check pattern to build the provider from `config['baseUrl'] ?? ''`, `config['repo'] ?? ''`, `config['token'] ?? ''`.

### `validate-config.ts`
Validate only instance-scoped config (mirror YouTrack's note about resolver-time merged config; ignore the token):
- `repo` must match `owner/repo`: non-empty segments, no whitespace, no leading/trailing slash.
- `baseUrl`, when present, must parse as an http(s) URL; empty/absent is OK (defaults applied at client resolution).
- Return `Promise<{ ok: true } | { ok: false; reason: string }>` with human-readable reasons.

### `client.ts`
REST wrapper `githubFetch(config, path, init?)` plus `GitHubConfig` (`{ baseUrl, repo, token }`):
- Headers: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and `Content-Type: application/json` when a body is sent.
- baseUrl resolution: strip trailing slash, default `https://api.github.com`, join path.
- `GitHubApiError` class carrying statusCode, headers, and body (headers needed for rate-limit classification).
- Pagination helper following GitHub `page`/`per_page` (and/or `Link` header parsing); expose a `listAll`/`paginate` utility consumed by list/search.
- Rate-limit detection: 429, `Retry-After`, or `x-ratelimit-remaining: 0` → throw an error classifiable as `rateLimited` (the `x-ratelimit-*` trio rides on essentially every GitHub response, so the mere presence of `x-ratelimit-reset` is not a signal).
- Mirror YouTrack/Kaneo client conventions: pino logger child scope, `readErrorBody`, and the provider-request observation boundary (`requireProviderRequestScope` / `observeProviderRequest` with `provider: 'github'`) imported from `src/analytics/*` — both existing provider plugins do this.

### `classify-error.ts`
`GitHubClassifiedError extends Error` wrapping an `AppError` from `papai/plugin-types` (`providerError`/`systemError`), with `ClassificationContext` (taskId, projectId, …):
- 401/403 → `authFailed`, **except** rate-limit-shaped 403 (see client) → `rateLimited`.
- 429 → `rateLimited`; 404 → task-not-found when context/path indicates an issue, project-not-found for the repo; 400/422 → `validationFailed`; 5xx → `unexpected`.
- Network patterns in message (`fetch`, `econnrefused`, `enotfound`, network/connect) → `systemError.networkError`.
- Idempotent: already-classified errors pass through; non-Error values stringified → `unexpected`.

### `schemas/` (Zod v4, YouTrack conventions: enums first, `.nullable()` for optional API fields, `.optional()` for absent fields, `export type X = z.infer<typeof XSchema>`)
- `user.ts`: login, id, avatar_url, html_url, type.
- `repo.ts`: id, name, full_name (`owner/repo`), owner (user), html_url, private, description nullable.
- `issue.ts`: id, number, title, body nullable, state `open|closed`, state_reason nullable, user, assignees array, labels array accepting **both** string and object forms (list endpoints return strings, single-issue returns objects), created_at, updated_at, closed_at nullable, html_url, comments count, milestone nullable.

### `operations/tasks.ts`
`githubCreateTask`, `githubGetTask`, `githubUpdateTask`, `githubListTasks`, `githubSearchTasks` (config first, then params; pino debug-on-entry/info-on-success logging):
- `POST /repos/{o}/{r}/issues` (title, body, assignees from assignee login); `priority`/`dueDate`/`startDate` accepted and ignored.
- `GET` / `PATCH /repos/{o}/{r}/issues/{n}` (PATCH maps `status`: `'open'` → `{state:'open'}`, `'closed'` → `{state:'closed', state_reason:'completed'}` — accept plain/canonical status text; title/description/assignee updates; close = status update via updateTask, no separate capability).
- `GET /repos/{o}/{r}/issues?state=&page=&per_page=` for list (map `ListTasksParams.status` to `state`, paginate via helper).
- `GET /search/issues?q=repo:{o}/{r} <query>&page=&per_page=` for search (GitHub search qualifiers), honoring `limit`/`offset`.

### `operations/projects.ts`
`githubListProjects`, `githubGetProject`: `GET /repos/{o}/{r}`; the configured repo is the only project — `listProjects` returns `[configuredRepo]`, `getProject` validates/fetches it; project id = `owner/repo`.

### `mappers.ts`
- issue → `Task`: id (string of issue id or number — pick one and stay consistent), `number`, title, description, status = `state` plus `state_reason` folded into status text (e.g. `closed (not_planned)`), assignee = first assignee login (null when none), url = `html_url`, createdAt/updatedAt, projectId = `owner/repo`, commentsCount, reporter.
- issue → `TaskListItem` / `TaskSearchResult` minimal shapes.
- repo → `Project` (id = full_name, name, description, url = html_url).
- Map to the normalized types from `src/providers/domain-types.ts` (`Task`, `TaskListItem`, `TaskSearchResult`, `Project`).

### `provider.ts`
`GitHubProvider implements TaskProvider` (`src/providers/types.ts`): `name = 'github'`, `capabilities`/`traits` from constants, `preferredUserIdentifier = 'login'`; required methods wired to the operations (`createTask` requires `projectId` = the configured repo id — validate it matches, else projectNotFound); `buildTaskUrl`/`buildProjectUrl` via url-builder; `classifyError`, `getPromptAddendum`, `normalizeDueDateInput`/`formatDueDateOutput`/`normalizeListTaskParams` via due-date no-ops. No optional capability methods beyond `getProject`/`listProjects` this session.

### `url-builder.ts`
Task URL `{web}/owner/repo/issues/{n}`, project URL `{web}/owner/repo`, where `web` is derived from the API baseUrl: host `api.github.com` → `https://github.com`; otherwise (GHES, e.g. `https://ghes.example.com/api/v3`) → the baseUrl origin.

### `prompt-addendum.ts`
Constant documenting: tasks are GitHub issues; status is open/closed only (close reasons completed/not_planned); priority and due dates are not native and are accepted-but-ignored; assignees are GitHub logins; search uses GitHub issue search qualifiers.

### `due-date.ts`
No-op normalizers returning `undefined`/pass-through (`normalize…DueDateInput` → `undefined`, `formatDueDateOutput` → `undefined`, `normalizeListTaskParams` → params unchanged).

### `constants.ts`
`GITHUB_CAPABILITIES` = `new Set(['projects.list', 'projects.read'])`, default baseUrl `https://api.github.com`, empty/default traits.

## Domain mapping / omissions
`status: 'open'|'closed'` maps directly. **Omit** all `statuses.*`, sprints, agiles, workItems, attachments, watchers/votes, visibility, `members.provision`, `queries.saved`, `tasks.commands`, `tasks.delete` (REST cannot delete issues). `priority`/`dueDate` accepted and ignored.

## Tests (`tests/plugins/task-provider-github/`, mirroring `tests/plugins/task-provider-youtrack/`)
`manifest.test.ts` (parses `pluginManifestSchema`; type/permissions/config schemas/hosts/capabilities declared correctly), `activation.test.ts` (factory registers type `github`, builds a `GitHubProvider`), `validate-config.test.ts` (valid/invalid `owner/repo`, bad baseUrl, absent baseUrl OK), `client.test.ts` (auth headers incl. API-version + Accept, baseUrl default/trailing-slash handling, pagination across pages, 429 + 403-with-`x-ratelimit-remaining: 0` + `Retry-After` → rateLimited), `classify-error.test.ts` (status matrix + network patterns + pass-through), `mappers.test.ts` (string-vs-object label forms, null assignee, state_reason folding), `operations/tasks.test.ts` + `operations/projects.test.ts` (mocked fetch via `setMockFetch`/`restoreFetch` from `tests/utils/test-helpers.ts`; assert endpoints, payloads, normalized results, error paths), `prompt-addendum.test.ts`, `due-date.test.ts`. Use `mockLogger()` where provider construction logs. Error extraction convention: `error instanceof Error ? error.message : String(error)`.

## Conventions
Bun runtime; strict TypeScript with `.js` import extensions; Zod v4; pino structured logging (debug entry/params, info success ids, error caught exceptions — never log tokens); never add lint-disable/type-ignore comments; `max-lines` failures mean split the file; plugins import shared types/errors from `papai/plugin-types` and may import `../../src/*` helpers as YouTrack/Kaneo do; SPDX/BUSL header on every file.

## Verification
1. `bun test tests/plugins/task-provider-github/` — new suite green.
2. `bun run lint` and `bun run typecheck` — clean.
3. `bun run test` — full suite stays green.
4. Check coverage gates: new `plugins/` files enter both the in-process coverage ratchet (`scripts/coverage/floor.json`) and the T0 story-coverage floor (`scripts/story/coverage-floor.json`, which seeds story-unimported plugin files as 0%). If either gate trips from the new file mass, adjust the floor from a green run via the sanctioned `bun coverage:ratchet[--:stories]` procedure and note it in the change.

Done when: the plugin registers type `github`, core task CRUD + configured-repo project listing work against mocked GitHub REST responses, errors classify per convention, and all checks pass.
