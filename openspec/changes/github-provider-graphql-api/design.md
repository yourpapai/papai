# Design — GitHub task-provider GraphQL API foundation (transport only)

## Context

The GitHub plugin talks REST today through `plugins/task-provider-github/client.ts` (`githubFetch`): it resolves the API base once (`resolveApiBaseUrl` — empty → public default, trailing slashes stripped so GHES sub-path prefixes survive), joins paths onto it, and wraps every call in the provider observation boundary (`requireProviderRequestScope` + `createProviderRequestClock` + `classifyProviderError`, emitting `provider: 'github'` with an operation label derived from the HTTP method). Failures are `GitHubApiError` (status, headers, body), classified in `classify-error.ts` by status code with header precedence for rate limiting (`isRateLimitedError`), and host confinement is declarative: `plugin.json` allows `api.github.com` plus the configured `baseUrl` host (`providerAllowedHosts` / `providerAllowedInstanceHostsFromConfig`).

Nothing in the repo speaks GraphQL (no occurrence of `graphql` in `src/`, `plugins/`, or `client/`). The follow-up change `github-provider-projects` needs Projects V2, which is GraphQL-only. See `proposal.md` for why this lands as standalone transport ahead of that consumer.

Constraints that shape the approach:

- Zero user-visible behavior change (the reason `skip_specs` holds) — no manifest, capability, tool, or config surface may move.
- `client.ts` and its test file stay untouched; the REST path is de-facto stable surface.
- The observation boundary stays content-free (provider, operation, duration, outcome, status class, retryable — never query text, variables, or token).

## Goals / Non-Goals

**Goals:**

- A GraphQL executor with the same guarantees as `githubFetch`: resolved-and-confined endpoint, authenticated POST, metadata-only pino logging, observation-boundary emission, classified errors.
- Independent testability of the GraphQL-specific concerns: GHES endpoint derivation, the `{data, errors}` envelope, and 200-with-`errors` — a failure shape the status-code-driven classifier cannot see.
- A clean seam the `github-provider-projects` follow-up consumes without re-opening transport decisions.

**Non-Goals (design-level, beyond the proposal's scope statement):**

- No partial-success tolerance: a 200 whose envelope carries any `errors[]` entry fails the whole call, even when `data` is present.
- No retry/backoff (REST has none either — parity), no cursor pagination helper (lands with the first consumer), no query-document builder or GraphQL DSL.
- No widening of the analytics `StatusClass` enum for GraphQL-level failures (Decision 7).
- No request-time host admission enforcement — the manifest-declared-hosts KNOWN GAP #15 status quo is unchanged; confinement remains by construction.

## Decisions

### 1. Plugin-local module, hand-rolled POST, no new dependency

New `plugins/task-provider-github/graphql-client.ts` beside `client.ts`: plain `fetch` POST with a JSON `{query, variables}` body and a Zod-validated envelope.

- No existing module covers the need — verified: zero GraphQL usage anywhere in the repo. The closest, REST `client.ts`, cannot express it: the GHES GraphQL endpoint is not a path join onto the REST base (`…/api/v3` → `…/api/graphql`), and `githubFetch` derives the observation operation from the HTTP method, so POST would mislabel every GraphQL read as `create`.
- No GraphQL client library (`graphql`, `graphql-request`, urql): documents are static strings authored in the follow-up, so there is no query building, AST, or caching to buy — one POST shape, one envelope to validate. Zod v4 (already a dependency) covers validation; the AI SDK's GraphQL utilities are LLM-provider-oriented and would be the wrong layer.
- Not in `src/`: GitHub-specific endpoint derivation and error typing have no second consumer; the REST precedent is plugin-local too.

### 2. Endpoint derivation composed on `resolveApiBaseUrl`'s output

`resolveGraphqlEndpoint(baseUrl)` runs the existing REST base resolution first, then maps its result — no re-parsing of raw config, trailing-slash normalization inherited:

| Resolved REST base | GraphQL endpoint |
| ------------------------------------------------------------------------ | ----------------------------------------------- |
| `https://api.github.com` (public default; also when set explicitly) | `https://api.github.com/graphql` (new constant `GITHUB_DEFAULT_GRAPHQL_URL`) |
| GHES `…/api/v3` (any sub-path prefix, e.g. `https://corp.example.com/gh/api/v3`) | same origin + `/api/graphql` (the `/api/v3` suffix is replaced) |
| anything else (GHES bare origin) | base + `/api/graphql` |

Alternatives rejected: a separate `graphqlUrl` config key (new config surface = observable change, plus a second key to misconfigure); runtime probing of candidate endpoints (an extra request and a new failure mode for zero benefit).

Host confinement holds by construction: the derived endpoint's host is always the host of the already-declared REST base, so `plugin.json` hosts stay untouched.

### 3. Own observed executor; `client.ts` stays untouched

`githubGraphql` re-implements the thin boundary wiring (~20 lines) from the same `src/analytics` primitives `client.ts` uses (`requireProviderRequestScope`, `createProviderRequestClock`, `classifyProviderError` / `classifyStatusClass`), imports the already-exported `GitHubApiError` for the non-2xx path, and diverges after the 2xx check: parse → validate envelope → throw on `errors[]` → return `data`.

Rejected: exporting `executeObservedRequest` / `observeBoundary` from `client.ts` — it modifies a file this change scoped out, and the REST helper's shape (204 handling, unconditional `response.json()`, REST error-message format) does not fit the envelope-validation flow. Also rejected: a shared plugin-local observe module — a third new file for ~20 lines that knip would flag identically. `bun run duplicates` (jscpd) scans `tests/` only, so this bounded production-side repetition is not a gate concern.

### 4. Explicit `operation` parameter, default `'read'`

One endpoint serves reads and writes, so the REST method→operation mapping does not apply. Callers pass the operation (typed as the boundary's operation union) explicitly; the `'read'` default keeps read-shaped follow-up calls terse. A write call that forgets the label observes as `read` — the same class of miscategorization the REST mapping produces for free; accepted until the first write consumer pins its labels in tests.

### 5. Two error classes, split by transport layer

- HTTP non-2xx → existing `GitHubApiError` (status, headers, body), classified by the untouched `classifyApiError` path — including `isRateLimitedError` header detection, which still works because GraphQL-over-HTTP failures carry the same 429/403 + `x-ratelimit-*` header shapes.
- HTTP 200 with `errors[]` → new `GitHubGraphqlError` carrying the first error's `message`, the effective type (`extensions.type` ?? top-level `type`, else undefined), and the full `errors` array for context.

Rejected: reusing `GitHubApiError` with a synthetic status — it would conflate HTTP truth with GraphQL-level failure and pollute `classifyProviderError`'s status reflection.

Classification extension in `classify-error.ts` — branch order is `GitHubClassifiedError` passthrough → `GitHubGraphqlError` → `GitHubApiError` → generic:

| Effective type | AppError |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `FORBIDDEN`, `INSUFFICIENT_SCOPES` | `authFailed` (scope-miss degrades loudly while REST CRUD keeps working) |
| `NOT_FOUND` | `taskNotFound(context.taskId)` / `projectNotFound(context.projectId ?? 'unknown')` — same context contract as the 404 branch |
| `RATE_LIMITED` | `rateLimited` |
| untyped / anything else | `validationFailed('unknown', upstream message)` |

### 6. Zod envelope: loose `data`, strict `errors`

`{ data?: unknown, errors?: { message: string, type?, extensions? }[] }`. `data` stays `unknown` because payload validation belongs to the caller's schema (Projects V2 shapes in the follow-up); the transport owns only the envelope. A response that fails envelope validation throws `GitHubGraphqlError` with a message naming the violation and no type — routing to the default `validationFailed` branch instead of a parse crash (a bare `Error` would land in `systemError.unexpected`, wrong for a shape violation).

### 7. Observation truthfulness for GraphQL-level failures

A 200-with-`errors` call observes as `outcome: 'failure'` with `statusClass: 'other'`, `retryable: null` — `classifyProviderError` has no status to reflect and the `StatusClass` enum is closed. Mapping GraphQL types onto HTTP-ish classes at the boundary (e.g. `RATE_LIMITED` → `'4xx'`/retryable) was rejected: it would duplicate the type mapping `classify-error.ts` owns and falsify the HTTP record. Widening the enum is an analytics-surface change with no consumer today.

### 8. Logging and header parity

`log.debug({ operation, hasVariables }, 'GitHub GraphQL request')` on setup, `log.error` with status/error name on failure — mirroring `client.ts`'s metadata-only discipline. Query text, variables, and the token are never logged; the tests assert token absence in captured log output. Request headers are `Authorization: Bearer …` + `Content-Type: application/json` only — `X-GitHub-Api-Version` is REST versioning and meaningless on the GraphQL endpoint.

### 9. knip: one scoped, commented ignore

`'plugins/task-provider-github/graphql-client.ts': ['exports']` with a comment naming `github-provider-projects` as the production consumer, mirroring the `labels.ts` scoped-ignore precedent (the knip.config.ts guardrail requires the inline justification + linked follow-up). The line is removed when the follow-up lands; `bun run knip` in verification proves the ignore is sufficient and nothing else went dead.

### 10. Test approach and TDD hook order

The Write/Edit TDD pipeline gates `plugins/task-provider-github/graphql-client.ts` (impl under `plugins/`); the covering test it expects is `tests/plugins/task-provider-github/graphql-client.test.ts`. Order of work, test-first:

1. `tests/plugins/task-provider-github/graphql-client.test.ts` — fails first (module missing). Local suite pattern from `client.test.ts`: `mock.module` of `src/logger.js` with the tracked logger, delayed `await import` of the module, `setMockFetch`/`restoreFetch` DI, GraphQL-specific local capture + envelope-builder helpers (hand-rolled rather than copied from the REST harness — jscpd's 29-line/50-token clone threshold gates `tests/`), actor-scope recorder for boundary assertions. Covers: the derivation table, request shape (URL, POST, headers, `{query, variables}` body), token-absent-from-logs, envelope data passthrough, malformed envelope → `validationFailed`, non-2xx → `GitHubApiError`, 200-with-`errors` → `GitHubGraphqlError`, boundary emission (provider `github`, operation label, outcome, duration).
2. `classify-error.test.ts` additions — the GraphQL typing table (fails first).
3. `constants.test.ts` — the new constant.
4. Then `graphql-client.ts`, `classify-error.ts`, `constants.ts` to green.

Table-driven derivation/classification tests are deliberate mutant killers: `test:mutate:changed` measures the new and modified files on the PR.

## Scope model, capabilities, storage

- **Capability / tool-prefs gating**: no new tool surface. `githubGraphql` is transport-internal and never exposed as a tool; `GITHUB_CAPABILITIES` (13) and `GITHUB_TRAITS` (empty) are unchanged and `plugin.json` is untouched, so `tool_prefs` resolution sees exactly the same tool names as before.
- **Scope model**: no new persisted state of any kind. Existing keys keep their scopes — `repo` and `baseUrl` are instance-scoped (task instance), `token` is context-scoped (config-context, group-shared, encrypted). The GraphQL endpoint is derived per call from `baseUrl`; no storage-context, platform-instance, or user id keys anything new.
- **DB**: no schema change → no drizzle migration, no backfill.
- **Dependencies**: none added (Decision 1).

## Risks / Trade-offs

- [Transport ships with no production caller until `github-provider-projects` lands] → scoped + commented knip ignore naming the consumer (Decision 9); each change stays independently revertible; the follow-up is queued immediately per the maintainer direction.
- [GraphQL-level failures observe as `statusClass: 'other'`, `retryable: null`] → deliberate truthfulness (Decision 7); user-facing classification still maps `RATE_LIMITED` → `rateLimited`; revisit with a consumer if analytics needs the distinction.
- [Endpoint derivation is convention, not discovery — a reverse-proxied GHES whose REST path does not end `/api/v3` derives base + `/api/graphql`] → rules documented in the README derivation table; operator fixup is the existing `baseUrl` config, same as REST misconfiguration today; no runtime probing by design.
- [`data` + `errors` both present still fails the call] → all-or-nothing semantics keep the follow-up's error handling simple; GitHub rarely returns partial data for the planned operations; relaxing later is additive.
- [Forgotten `operation` label on a future write call observes as `read`] → accepted (Decision 4); write consumers arrive in the follow-up and pin their labels in the same tests.

## Migration Plan

Pure addition with zero runtime reach: no feature flag needed because nothing calls the transport in production until the follow-up. Deploy anytime; rollback is reverting the commit — no state, schema, or config to unwind. Removing the knip ignore line belongs to the follow-up's checklist, not this change's.
