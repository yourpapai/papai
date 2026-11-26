# GitHub task-provider plugin — GraphQL API foundation (transport only)

## Maintainer direction this spec implements

Agreed: sequencing is right. Instead of landing Projects V2 with an embedded GraphQL client in one change, this change adds **GraphQL API support as standalone transport infrastructure** for `plugins/task-provider-github/`, and Projects V2 moves to the follow-up change `github-provider-projects` (already captured on `agent/issue-371`; it should be re-scoped to consume this foundation and drop its embedded-client sections). Rationale, grounded in this repo's conventions:

- Matches "smallest thing that works" and the plugin's own session pattern (session 1 core → session 2 comments/labels → session 3 identity/history/count).
- The transport has independently testable concerns the REST path never exercised: GHES GraphQL endpoint derivation, the `{data, errors}` envelope, and **200-with-`errors`** — a failure shape the current `classifyApiError` (status-code driven) cannot see.
- Repo precedent explicitly supports seam-first landing: `knip.config.ts` already documents modules whose "later tasks … consume their exports" (context-vault seam, `knip.config.ts:102-104`), and `client.ts` files are exempt from unused-export checks because they sit behind dynamic bridges (`knip.config.ts:169-171`).
- Each change is independently revertible; the Projects review then focuses on Projects semantics, not plumbing.

Known cost, accepted deliberately: the transport ships with no production caller until the follow-up lands — so the follow-up should be queued immediately, and knip gets one scoped, commented ignore line (see Files).

## Goal

Give the GitHub task-provider plugin a GraphQL transport alongside the existing REST client (`plugins/task-provider-github/client.ts`): endpoint resolution (public + GHES), an authenticated POST `{query, variables}` executor with the same observation boundary (`provider: 'github'`), pino logging, Zod envelope validation, and error classification covering both HTTP failures and GraphQL `errors[]` typing. **Zero user-visible behavior change**: no capability, trait, tool, config-key, or manifest changes.

## Files to touch

Plugin + one config line; no `src/` changes.

- **New** `plugins/task-provider-github/graphql-client.ts`
  - `resolveGraphqlEndpoint(baseUrl)`: derived from `resolveApiBaseUrl`'s result — public default → `https://api.github.com/graphql`; GHES REST base ending in `/api/v3` → same origin with `/api/graphql`; GHES origin with no `/api/v3` path → append `/api/graphql`. Trailing-slash normalization mirrors the REST helper. Host confinement holds by construction (same host as the already-allowed REST base; `plugin.json` hosts untouched).
  - `githubGraphql(config, query, variables, operation)`: POST JSON `{query, variables}` with `Authorization: Bearer` (same token), explicit `operation` label for the observation boundary (single endpoint serves reads and writes, so the REST method→operation mapping does not apply; default `'read'`); `log.debug` on request setup, `log.error` on failure — never logging the token. Non-2xx → existing `GitHubApiError` (classified by the untouched HTTP path). 200-with-`errors` → new `GitHubGraphqlError` carrying the first error's `message` plus `extensions.type` (and the full `errors` array for context).
  - Zod schema validating the response envelope (`{data?, errors?}`; `errors[].message` required, `errors[].type`/`extensions` optional) — envelope-shape violations surface as `validationFailed`, not parse crashes.
- **Modified** `plugins/task-provider-github/classify-error.ts`: classify `GitHubGraphqlError` — `FORBIDDEN`/`INSUFFICIENT_SCOPES` → `authFailed` (scope-miss degrades loudly while REST CRUD keeps working), `NOT_FOUND` → `taskNotFound`/`projectNotFound` by the existing `ClassificationContext`, `RATE_LIMITED` → `rateLimited`, otherwise `validationFailed` with the upstream message. `GitHubClassifiedError` passthrough unchanged.
- **Modified** `plugins/task-provider-github/constants.ts`: add `GITHUB_DEFAULT_GRAPHQL_URL = 'https://api.github.com/graphql'`. `GITHUB_CAPABILITIES`/`GITHUB_TRAITS` unchanged (13 capabilities, no traits).
- **Modified** `knip.config.ts`: one scoped line `'plugins/task-provider-github/graphql-client.ts': ['exports']` with a comment citing the `github-provider-projects` follow-up as the production consumer — mirroring the `client.ts` dynamic-bridge and `labels.ts` scoped-ignore precedent. Remove the line when the follow-up lands.
- **Modified** `plugins/task-provider-github/README.md`: developer-facing "GraphQL API support" section — endpoint derivation rules, the Projects follow-up as the first consumer, and a note that GraphQL surfaces added later (Projects V2) will require the classic-PAT `project` scope / fine-grained Projects read-write (the foundation itself needs no scope beyond today's).
- **Untouched**: `plugin.json` (manifest, capabilities, allowed hosts), `provider.ts` wiring, `prompt-addendum.ts` (no new tools → nothing for the LLM), `operations/*`, `schemas/*`.

Tests, following the existing `setMockFetch`/`captureRequests` DI pattern:
- **New** `tests/plugins/task-provider-github/graphql-client.test.ts`: endpoint derivation table (public default, GHES `/api/v3` suffix, GHES bare origin, trailing slashes); request shape assertions (URL, method, `Authorization` header absent token leakage into logs, JSON body `{query, variables}`); envelope validation (data passthrough, malformed envelope → validationFailed); HTTP non-2xx → `GitHubApiError` path; 200-with-`errors` → `GitHubGraphqlError`; observation-boundary emission (provider `github`, outcome, duration) via the mocked request scope.
- **Modified** `tests/plugins/task-provider-github/classify-error.test.ts`: GraphQL typing table (FORBIDDEN, INSUFFICIENT_SCOPES, NOT_FOUND with/without context, RATE_LIMITED, untyped → validationFailed).
- **Modified** `tests/plugins/task-provider-github/constants.test.ts`: the new constant.

## Intended behavior change

None observable. A `github`-type task instance behaves identically (same 13 capabilities, same tools, same config keys); the plugin internally gains a tested GraphQL transport that the `github-provider-projects` follow-up will consume. This is the reason for `skipSpecs`.

## Capabilities

None — skip_specs proposed because this is internal transport infrastructure with no change to any externally observable requirement: no capability, tool, trait, config, or manifest surface changes. The capability-bearing change (Projects V2 boards, statuses, project-scoped tasks, `custom-fields` trait) is the follow-up `github-provider-projects`.

## Verification

`bun test tests/plugins/task-provider-github/` → `bun run typecheck` → `bun run lint` → `bun run knip` (proves the scoped ignore is sufficient and nothing else went dead) → full `bun test` + `bun check:full`; `bun security` over the new outbound request shape (query text + variables in a POST body, no token in logs).

## Scope model / instances

Affects only `github`-type task instances, and in this change not even them observably. No new persisted state, scope keys, or DB migration; config keys unchanged (`repo`, `baseUrl` instance-scoped; `token` context-scoped, group-shared as today).

## Non-goals

- Projects V2 in any form — boards, Status field, `addProjectV2ItemById`, capability/trait additions: follow-up change `github-provider-projects` (re-scoped to build on this transport).
- Cursor pagination helper — lands with the first consumer (`projectV2.items`) in the follow-up, not speculatively here.
- Any `src/` GraphQL client — GitHub-specific endpoint derivation and error typing keep it plugin-local.
- Sub-issues/dependencies, iterations, milestones, org-level projects, reactions — declined in the prior proposal's research; unchanged.
