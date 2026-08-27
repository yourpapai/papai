# Tasks — GitHub task-provider GraphQL API foundation (transport only)

design.md carries no Open Questions; nothing to resolve before build. Order follows design Decision 10 (test-first).

## 1. Constants and endpoint resolution (test-first)

- [x] 1.1 Scaffold `tests/plugins/task-provider-github/graphql-client.test.ts` (tracked-logger `mock.module` + delayed `await import`, `setMockFetch`/`restoreFetch`, GraphQL-specific local capture/envelope helpers — design Decision 10) with failing `resolveGraphqlEndpoint` derivation-table tests: empty baseUrl, explicit `https://api.github.com`, GHES `/api/v3` suffix (incl. sub-path prefix), GHES bare origin, trailing slashes. Confirm the expected failure: `bun test tests/plugins/task-provider-github/graphql-client.test.ts`
- [x] 1.2 Add the failing `GITHUB_DEFAULT_GRAPHQL_URL` assertion to `tests/plugins/task-provider-github/constants.test.ts`, then add the constant (`'https://api.github.com/graphql'`) to `plugins/task-provider-github/constants.ts`. Verify: `bun test tests/plugins/task-provider-github/constants.test.ts`
- [x] 1.3 Implement `resolveGraphqlEndpoint(baseUrl)` in new `plugins/task-provider-github/graphql-client.ts`, composed on `resolveApiBaseUrl`'s output per design Decision 2. Verify: `bun test tests/plugins/task-provider-github/graphql-client.test.ts`

## 2. GraphQL executor (test-first)

- [x] 2.1 Add failing `githubGraphql` tests to `tests/plugins/task-provider-github/graphql-client.test.ts`: request shape (derived URL, POST, `Authorization: Bearer` + `Content-Type: application/json` only, JSON body `{query, variables}`), token/query/variables never in captured logs, non-2xx → `GitHubApiError`, 200-with-`errors[]` → `GitHubGraphqlError` (first message + effective type `extensions.type ?? type` + full array), `data` passthrough, malformed envelope → `validationFailed`-classifiable error, boundary emission via actor-scope recorder (provider `github`, operation label + `'read'` default and explicit override, outcome, duration). Confirm the expected failure: `bun test tests/plugins/task-provider-github/graphql-client.test.ts`
- [ ] 2.2 Implement `githubGraphql(config, query, variables, operation = 'read')`, exported `GitHubGraphqlError`, Zod envelope schema (loose `data`, strict `errors[].message`), and the observation wiring from the `src/analytics` primitives per design Decisions 3–8. Verify: `bun test tests/plugins/task-provider-github/graphql-client.test.ts`

## 3. Error classification (test-first)

- [ ] 3.1 Add the failing GraphQL typing table to `tests/plugins/task-provider-github/classify-error.test.ts`: `FORBIDDEN`/`INSUFFICIENT_SCOPES` → `authFailed`; `NOT_FOUND` with/without `ClassificationContext` → `taskNotFound`/`projectNotFound`; `RATE_LIMITED` → `rateLimited`; untyped → `validationFailed` with the upstream message; `GitHubClassifiedError` passthrough unchanged. Confirm the expected failure: `bun test tests/plugins/task-provider-github/classify-error.test.ts`
- [ ] 3.2 Extend `classifyGitHubError` in `plugins/task-provider-github/classify-error.ts` with the `GitHubGraphqlError` branch (after passthrough, before `GitHubApiError`) per design Decision 5. Verify: `bun test tests/plugins/task-provider-github/classify-error.test.ts`

## 4. Config and documentation

- [ ] 4.1 Add the scoped knip ignore `'plugins/task-provider-github/graphql-client.ts': ['exports']` with an inline comment naming `github-provider-projects` as the production consumer (mirrors the `labels.ts` precedent; knip.config.ts guardrail). Verify: `bun run knip`
- [ ] 4.2 Add the developer-facing "GraphQL API support" section to `plugins/task-provider-github/README.md`: endpoint derivation table, the Projects follow-up as first consumer, and the note that later GraphQL surfaces (Projects V2) require the classic-PAT `project` scope / fine-grained Projects read-write (the foundation needs no scope beyond today's). Verify: `bun run format:check`

## 5. Full verification

- [ ] 5.1 Run the plugin suite and static gates, fixing anything surfaced: `bun test tests/plugins/task-provider-github/` then `bun run typecheck` then `bun run lint`
- [ ] 5.2 Full-suite and release gates per the proposal's Verification section — `bun run test`, `bun run check:full` (includes `knip`, `duplicates`, license headers), `bun security` over the new outbound request shape (query + variables in a POST body, no token in logs) — and confirm no `docs/architecture/*.md` page is affected (transport-internal and plugin-local; the README from 4.2 is the doc surface), updating any that is. Final gate: `bun security`
