# Design: GitHub Issues task-provider plugin — session 3: identity, history, count + search tuning

## Context

Sessions 1–2 delivered the plugin skeleton: `client.ts` (`githubFetch` / `githubPaginate` with the observation boundary and rate-limit shape detection), `classify-error.ts`, `operations/{tasks,projects,comments,labels}.ts`, `schemas/`, `mappers.ts`, and a `provider.ts` advertising exactly eleven capabilities. Everything this session activates already exists in core: `TaskProvider` declares `identityResolver` (`src/providers/types.ts:94`), `getTaskHistory` (`:274-285`), and `countTasks` (`:288`); the capability strings `activities.read` and `tasks.count` exist (`src/providers/task-capability.ts`); and `src/tools/tools-builder.ts:199,255` gate `get_task_history` / `count_tasks` on capability + method presence, `:214-225` gate the identity tools on `identityResolver` presence + group context. The manifest has declared the `identity` permission since session 1. Motivation is in `proposal.md`; behavior contracts in `specs/github-identity-history-count/spec.md`.

Constraints that shape the design:

- The Write/Edit TDD hook pipeline gates only `src/` and `client/` — files under `plugins/` and `tests/` pass through unchecked, so test-first order is a `tasks.md` discipline, not a hook guarantee.
- Provider conventions (`src/providers/AGENTS.md`): one operations file per domain, `[provider][Entity][Action]` naming, config-first parameters, Zod validation, normalized domain types, classify-by-status with entity context preserved, `.extend()` for schema detail levels.

## Goals / Non-Goals

**Goals:**

- Activate the three pre-existing optional surfaces by composing the existing client, classifier, and mapper seams — zero new infrastructure, zero `src/` edits.
- Make search and count share one qualifier builder so they can never drift apart, and pin the 13-capability set by tests in both declaration sites.

**Non-Goals** (design-level, on top of the proposal's scope):

- No `getUserByLogin` on the resolver: core consumes only `searchUsers` (`src/identity/resolver.ts:74`, `src/tools/set-my-identity.ts:64`). YouTrack's extended resolver shape is not copied where the extra method would be dead code.
- No prompt-addendum change: capability advertisement drives which tools are offered, and the addendum's "attachments and deletion are not supported" line stays true. Only the README's capabilities paragraph is updated.
- No retry/backoff for rate-limited search/count calls — classification only, as in sessions 1–2.
- No count caching and no reconciliation between `total_count` and the 1000-result search-retrieval ceiling (see Risks).

## Decisions

### 1. New surfaces as new modules, mirroring the YouTrack layout

`identity-resolver.ts`, `schemas/event.ts`, `operations/activities.ts`, `operations/count.ts` follow the per-domain convention one-to-one; YouTrack has the same `identity-resolver.ts` / `operations/activities.ts` pair as precedent. No existing GitHub module covers identity, events, or counting, so new modules are justified; every request still goes through the existing `githubFetch` / `githubPaginate` (bearer token, observation boundary, host confinement by construction). Rejected: folding events/count into `operations/tasks.ts` — the per-domain file convention exists for this split, and the two functions have distinct error contexts (`taskId` vs `projectId`).

### 2. Identity resolver: collaborator-first, single-request search fallback

`createGitHubIdentityResolver(config)` returns a `UserIdentityResolver` exposing only `searchUsers(query, limit?)`. The flow: list collaborators via `githubPaginate` over `/repos/{o}/{r}/collaborators` with the `permission=push` filter riding in the paginate query (write-capable users are the only assignable ones worth ranking first); fuzzy-match the query against that list; only on zero collaborator matches issue **one** `GET /search/users?q={query}` request (page sized to the limit) and match its `items`. Ranking is a pure exported function so the tiers are unit-testable without fetch mocks: normalize both sides (trim + lowercase); exact login > name equality or whole-word name match > substring containment on login or name; apply `limit` (default 10). No match → `[]`; upstream failure → log `error` and rethrow classified with `{ projectId: config.repo }` — the resolver fails closed rather than silently returning an empty candidate list, because an empty list would be recorded as "unmatched" by core's auto-link. Rejected: merging both sources and ranking once — the fallback exists precisely because collaborator matching failed, so merging adds noise from users with no repository access.

### 3. Named-user schema extends `GitHubUserSchema`

Collaborator and search-user payloads are the same shape as the existing `GitHubUserSchema` plus an optional `name`. Following the `.extend()` convention, a resolver-facing schema (`GitHubUserSchema.extend({ name: z.string().optional() })` in `schemas/user.ts`) serves both endpoints; `GitHubUserSchema` itself is untouched so session-1 parses (issue user fields) are unaffected. Extra payload fields are stripped by the object parse.

### 4. Event schema is minimal and strip-parsing

`GitHubIssueEventSchema` carries exactly what the mapping needs: `id` int, `event` string, `created_at` string, nullable `actor` and `assignee` (`GitHubUserSchema`), nullable `label` (`{ name: string }`). Zod strips GitHub's other event fields, so payload drift upstream cannot break the parse.

### 5. Activities: map-then-filter pipeline, ordering made explicit

`githubListTaskEvents` paginates `/repos/{o}/{r}/issues/{n}/events`, maps each known event type to the normalized `Activity` shape, drops unknown types, then applies params client-side in a fixed order — author/category equality, `start`/`end` ISO-string compare, deterministic ascending timestamp sort, optional `reverse`, then the `limit`/`offset` slice. Two deliberate choices here:

- **Fetch-all-then-filter, not `maxItems` windowing.** Unlike the comments listing (session 2, decision 3), filters run *before* the slice here, so an `offset+limit` fetch bound would silently under-fill whenever an earlier event is filtered out (author, category, or time window). GitHub's events endpoint has no server-side filters, so correctness requires the full listing; the cost is bounded by events-per-issue, which the endpoint keeps modest.
- **Sort after mapping rather than trusting endpoint order.** One cheap stable sort makes the chronological-default / `reverse` contract hold by construction, immune to ordering drift between `api.github.com` and GHES. `start`/`end` compare ISO strings lexicographically — correct for the uniform `Z`-suffixed UTC form GitHub emits; YouTrack's strict boundary-validation regex is not replicated (the compare degrades gracefully on odd input instead of throwing).

The mapping table is exactly the proposal's six: `assigned` → assignee/added-login, `labeled`/`unlabeled` → label/added-or-removed-name, `closed` → status/added `closed`, `reopened` → status/added `open`, `commented` → comment. `unassigned`, `renamed`, `milestoned` and friends are dropped as unmapped; the `Activity` shape's `removed` field already supports a symmetric `unassigned` mapping if a later session wants it, but adding it now would exceed the specified contract. Errors classify with `{ taskId }` (404 → task-not-found).

### 6. Count: one `per_page=1` search request, `total_count` extracted

`githubCountTasks(config, { query, projectId? })` rejects a defined `projectId` ≠ `config.repo` with a project-not-found classified error before any request — the same one-repo guard as `createTask` (`provider.ts:77-85`) — then issues a single `GET /search/issues?q={built}&per_page=1` through `githubFetch` (not paginate: one page is all that is needed), validates `z.object({ total_count: z.number() })`, and returns `total_count`, which reflects the full match count regardless of page size. Errors classify with `{ projectId: config.repo }`.

### 7. Builder extraction with the `in:title,body` tuning

`buildGitHubIssueSearchQuery({ repo, query?, assigneeId?, status? })` is an exported pure function in `operations/tasks.ts`: always `repo:{owner}/{repo} is:issue`; `assigneeId` → `assignee:{login}`; `status === 'open'` → `is:open`, `status` starting with `closed` → `is:closed`; non-empty text appended then `in:title,body`; empty text emits no `in:` clause (also removing today's trailing-space artifact). `githubSearchTasks` and `githubCountTasks` both call it, so scope and matching fields cannot drift. The `status` input has no caller yet — `searchTasks` params carry no status and count takes only query/project — but it is pinned by dedicated unit tests as the search-side analog of list's `stateOfStatus`, so a future status-filtered search surface gets the mapping for free; the alternative (defer until a caller exists) was rejected because the pure function is the natural home for the mapping either way. The `in:title,body` addition is a deliberate behavior tuning: GitHub's default issue search also matches comments, which made repo-name and comment noise produce false positives; narrowing to title/body makes search and count agree on what "matches" means. Existing search tests are updated accordingly.

### 8. Provider wiring follows the YouTrack constructor pattern

`provider.ts` gains `getTaskHistory` → `githubListTaskEvents`, `countTasks` → `githubCountTasks`, and `readonly identityResolver` assigned in the constructor via `createGitHubIdentityResolver(this.config)` (`plugins/task-provider-youtrack/provider.ts:92-98` pattern). No other provider method changes.

### 9. Capability growth is exactly two, declared twice, pinned by tests

`GITHUB_CAPABILITIES` and `plugin.json` `providerCapabilities` each append `activities.read` and `tasks.count` (13 total, after the session-1+2 eleven). `manifest.test.ts` asserts the exact list and `constants.test.ts` the set equality between the two declarations, both updated in the same task as the declaration change so the pin never observes a mismatched intermediate state.

## Risks / Trade-offs

- [`/search/users` fallback returns users without repository access; assigning such a login later fails upstream 422] → collaborators-first ranking keeps write-capable users ahead; the failure surfaces through the standard validation-failure classification with GitHub's message intact, rather than being masked.
- [Events endpoint does not guarantee `commented` events] → mapped when present, absent otherwise (proposal assumption); comment history stays fully available through the comments listing, so nothing is lost.
- [Client-side filtering fetches every event page before slicing] → correctness requirement (decision 5); bounded by events-per-issue, and rate-limit classification covers the pathological case.
- [`in:title,body` narrows matching from GitHub's default (title+body+comments)] → the intended tuning; a user-visible behavior change pinned by updated tests and noted in the README paragraph.
- [Search API's low separate rate limit (≈30 req/min) is shared by search and count] → no auto-retry (Non-Goal); rate-limited classification distinguishes it from auth failure, as in sessions 1–2.
- [`total_count` is exact beyond the 1000-result retrieval ceiling, so count can exceed what search returns for the same query] → accepted divergence above 1000 results; the spec's search/count-agreement scenario holds within the retrieval ceiling.
- [Lexicographic `start`/`end` compare assumes ISO-8601 uniformity] → GitHub timestamps are uniformly `Z`-suffixed UTC and callers pass ISO strings per the tool contract; malformed bounds degrade to prefix-bounds instead of throwing (deliberate divergence from YouTrack's strict validation).
- [Two declaration sites for capabilities] → closed by the set-equality and exact-list tests (decision 9).

## Migration Plan

None required. No DB schema change, no migration, no `src/` edit, no new persisted state. The capability set widening is additive: `github` instances gain `get_task_history`, `count_tasks`, and (in group contexts) the identity tools on next provider construction; contexts with `tool_prefs` deny/ask on those tools keep their pre-existing resolution. Rollback = disable the plugin or revert the directory.

## Scope model impact

No new persisted state and no new scope keys. All three surfaces are stateless per tool call against the same encrypted **task-instance** config (`repo`, `baseUrl`) and **context-scoped** token sessions 1–2 defined — group-shared across a group's threads, never keyed by storage-context id, platform instance, or user. Identity mappings that core writes on auto-link are pre-existing core storage keyed by core's own context id; the provider only supplies `searchUsers` and stores nothing.

## Capability / tool_prefs impact

No new tool surface is created by this change — it activates three existing core tools for `github` instances by satisfying their gates: `get_task_history` (`activities.read` + method), `count_tasks` (`tasks.count` + method), and `set_my_identity` / `clear_my_identity` (resolver presence + group context + `chatUserId`). Existing per-context `tool_prefs` resolution (allow/ask/deny, most-specific-wins — including the `ask` per-call confirmation flow) applies unchanged; history/count are read-risk tools with no destructive-confirmation semantics of their own. Guest mode is untouched: the hardcoded read-only guest toolset gains nothing from provider wiring, and a context with a null task instance still exposes no `github` operations.

## New modules

Under `plugins/task-provider-github/`: `identity-resolver.ts` (resolver factory + pure matcher — no existing module covers identity), `schemas/event.ts` (event shape — new payload type), `operations/activities.ts` (events → `Activity[]`), `operations/count.ts` (search `total_count` → number). Modified: `schemas/user.ts` (named-user extension), `operations/tasks.ts` (builder extraction), `provider.ts`, `constants.ts`, `plugin.json`, `README.md`. No module outside the plugin changes; no new dependency — fetch, Zod, and the session-1 client cover every need.

## Hook and TDD interaction

The Write/Edit TDD hook gates only `src/` and `client/`, so none of the new files are enforced red-green; `tasks.md` imposes the test-first order instead, each task naming its proving command. Order of work: schemas first (`schemas/event.test.ts`, named-user cases), then the pure builder (composition cases in `operations/tasks.test.ts` — no fetch needed), then the fetch-backed operations (`identity-resolver.test.ts`, `operations/activities.test.ts`, `operations/count.test.ts` with `setMockFetch`/`restoreFetch` + `captureRequests`, following the existing `operations/tasks.test.ts` pattern; the ambient `NO_ANALYTICS_SCOPE` from `tests/mock-reset.ts` satisfies `requireProviderRequestScope`), and the declaration+wiring task last: `constants.ts`/`plugin.json`/`provider.ts` change together with `constants.test.ts`, `manifest.test.ts`, and `provider.test.ts` (dropping `getTaskHistory`/`countTasks` from the forbidden-optional-method list at lines 247–250 and adding wiring assertions for both methods and `identityResolver`).
