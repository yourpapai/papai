# Tasks: GitHub provider — session 3: identity, history, count + search tuning

## 1. Schemas

- [x] 1.1 Add failing cases to `tests/plugins/task-provider-github/schemas/event.test.ts`: representative `assigned`/`labeled`/`closed` payloads with nullable `actor`/`label`/`assignee` accepted, malformed rejected (`schemaValidates`), extra GitHub fields stripped. Verify: `bun test tests/plugins/task-provider-github/schemas/event.test.ts` (red — module missing)
- [x] 1.2 Implement `plugins/task-provider-github/schemas/event.ts` (`GitHubIssueEventSchema` + inferred type). Verify: `bun test tests/plugins/task-provider-github/schemas/event.test.ts` (green)
- [x] 1.3 Add failing cases to `tests/plugins/task-provider-github/schemas/user.test.ts` for the named-user extension (optional `name` accepted, absent `name` accepted, extra fields stripped, base `GitHubUserSchema` unchanged). Implement the `.extend({ name: z.string().optional() })` schema in `plugins/task-provider-github/schemas/user.ts`. Verify: `bun test tests/plugins/task-provider-github/schemas/user.test.ts` (red then green)

## 2. Search-qualifier builder (pure)

- [ ] 2.1 Add failing pure-function cases to `tests/plugins/task-provider-github/operations/tasks.test.ts` for `buildGitHubIssueSearchQuery`: `repo:{owner}/{repo} is:issue` always present; `assigneeId` → `assignee:{login}`; `status 'open'` → `is:open` and status starting `closed` → `is:closed`, other status adds nothing; non-empty query → free-text terms + `in:title,body`; empty/absent query → no `in:` clause and no trailing space. Verify: `bun test tests/plugins/task-provider-github/operations/tasks.test.ts` (red)
- [ ] 2.2 Implement `buildGitHubIssueSearchQuery` in `plugins/task-provider-github/operations/tasks.ts` and refactor `githubSearchTasks` to call it; update existing search tests for the added `in:title,body` (assert the built `q` on captured requests). Verify: `bun test tests/plugins/task-provider-github/operations/tasks.test.ts` (green)

## 3. Identity resolver

- [ ] 3.1 Write failing `tests/plugins/task-provider-github/identity-resolver.test.ts` (`setMockFetch`/`restoreFetch` + `captureRequests`): exact-login collaborator match ranks first and issues no `/search/users` request; fuzzy display-name/word match within collaborators; collaborator miss → exactly one `/search/users` fallback with both captured URLs and `permission=push` asserted on the collaborators call; no match anywhere → `[]`; `limit` respected (default 10); upstream failure → classified error rethrown (`error` logged, token never in logs). Verify: `bun test tests/plugins/task-provider-github/identity-resolver.test.ts` (red)
- [ ] 3.2 Implement `plugins/task-provider-github/identity-resolver.ts`: `createGitHubIdentityResolver(config)` with the exported pure matcher (trim + lowercase normalize; exact login > name equality/word match > substring on login or name). Verify: `bun test tests/plugins/task-provider-github/identity-resolver.test.ts` (green)

## 4. Task history (issue events)

- [ ] 4.1 Write failing `tests/plugins/task-provider-github/operations/activities.test.ts`: hits `/repos/{o}/{r}/issues/{n}/events` and follows pagination; per-event mapping (`assigned`→assignee+login, `labeled`/`unlabeled`→label+name added/removed, `closed`→status+`closed`, `reopened`→status+`open`, `commented`→comment); unknown event types dropped; actor-less events carry no author; client-side `author`/`categories`/`start`/`end`/`reverse`/`limit`/`offset` ordering per design (filter → ascending sort → reverse → slice); 404 → task-not-found `AppError` code. Verify: `bun test tests/plugins/task-provider-github/operations/activities.test.ts` (red)
- [ ] 4.2 Implement `plugins/task-provider-github/operations/activities.ts` (`githubListTaskEvents`, map-then-filter pipeline, errors classified with `{ taskId }`). Verify: `bun test tests/plugins/task-provider-github/operations/activities.test.ts` (green)

## 5. Task counting

- [ ] 5.1 Write failing `tests/plugins/task-provider-github/operations/count.test.ts`: `total_count` extracted from a single `GET /search/issues` with `per_page=1` and the built `q` asserted (shares the builder: repo pinned, `is:issue`, `in:title,body` on non-empty query); `projectId` equal to the configured repo succeeds; `projectId` mismatch → project-not-found classified error and no request captured; auth/rate-limit shapes classify per sessions 1–2. Verify: `bun test tests/plugins/task-provider-github/operations/count.test.ts` (red)
- [ ] 5.2 Implement `plugins/task-provider-github/operations/count.ts` (`githubCountTasks`: one-repo guard before any request, `z.object({ total_count: z.number() })`, errors classified with `{ projectId: config.repo }`). Verify: `bun test tests/plugins/task-provider-github/operations/count.test.ts` (green)

## 6. Capabilities and provider wiring

- [ ] 6.1 Update `tests/plugins/task-provider-github/manifest.test.ts` and `constants.test.ts` first: exact 13-capability list (session-1+2 eleven + `activities.read` + `tasks.count`) and manifest/constants set equality. Verify: `bun test tests/plugins/task-provider-github/manifest.test.ts tests/plugins/task-provider-github/constants.test.ts` (red)
- [ ] 6.2 Append `activities.read` and `tasks.count` to `GITHUB_CAPABILITIES` in `plugins/task-provider-github/constants.ts` and to `providerCapabilities` in `plugins/task-provider-github/plugin.json` (nothing else in the manifest changes). Verify: `bun test tests/plugins/task-provider-github/manifest.test.ts tests/plugins/task-provider-github/constants.test.ts` (green)
- [ ] 6.3 Update `tests/plugins/task-provider-github/provider.test.ts` first: drop `getTaskHistory` and `countTasks` from the forbidden-optional-method list (lines 247–250), add wiring assertions for `getTaskHistory` → events endpoint, `countTasks` → search endpoint, and `identityResolver` defined with `searchUsers`. Then wire `plugins/task-provider-github/provider.ts`: `getTaskHistory` → `githubListTaskEvents`, `countTasks` → `githubCountTasks`, `readonly identityResolver = createGitHubIdentityResolver(this.config)` in the constructor. Verify: `bun test tests/plugins/task-provider-github/provider.test.ts` (red then green)

## 7. Docs and full verification

- [ ] 7.1 Update `plugins/task-provider-github/README.md`: capabilities paragraph now states task history, task counting, and identity resolution are offered; issue deletion and attachments remain absent. Review `docs/architecture/*.md` for provider-surface listings that need the two new capabilities (none expected — no `src/` change). Verify: `bun run lint`
- [ ] 7.2 Full gate: `bun run test`, then `bun run typecheck`, `bun run lint`, `bun check:full`. If the new plugin file mass trips the coverage floors (`scripts/coverage/floor.json`, `scripts/story/coverage-floor.json`), raise them from a green full run via `bun coverage:ratchet --update` / `bun coverage:ratchet:stories` and note it here (session-1 task 9.1 precedent)
