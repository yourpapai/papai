# Design: GitHub Issues task-provider plugin — session 1

## Context

Two first-party task-provider plugins already exist (`plugins/task-provider-kaneo/`,
`plugins/task-provider-youtrack/`). The plugin loader discovers plugins from the
filesystem, validates each manifest against `pluginManifestSchema` (including the
refinement that `providerAllowedInstanceHostsFromConfig` entries reference
instance-scoped `providerConfigSchema` keys), resolves `providerConfigValidator` as a
named export, and activates a factory that calls
`ctx.registration.registerTaskProviderType(type, createProvider)`. Both existing
providers route their HTTP through a shared observation boundary
(`requireProviderRequestScope` / `observeProviderRequest` from `src/analytics/*`), use
pino child loggers, and normalize results to `src/providers/domain-types.ts`. Motivation
for a GitHub provider is in `proposal.md`; behavior contracts are in
`specs/github-issues-task-provider/spec.md`.

Constraints that shape everything below:

- Plugins may import shared types/errors from `papai/plugin-types` and helpers from
  `../../src/*`, exactly as YouTrack/Kaneo do. No `src/` edits are needed for discovery
  or registration.
- The Write/Edit TDD hook pipeline gates only paths under `src/` and `client/`
  (`docs/architecture/commands.md`), so files under `plugins/` and `tests/` pass
  through unchecked.

## Goals / Non-Goals

**Goals:**

- A drop-in third provider that the loader, settings UI, analytics, and existing task
  tools consume with zero `src/` changes — achieved by copying YouTrack's module
  contract rather than inventing a new one.
- Session-1 surface only: core task CRUD, list/search, configured-repo projects.

**Non-Goals** (design-level, on top of the proposal's session split):

- Migrating provider clients to `ctx.providerRuntime` fetch (known gap #15) — this
  plugin mirrors YouTrack's global-fetch stance and keeps the gap comment.
- Any retry/backoff loop for rate-limited responses — classification only this session.
- Multi-repo task instances: one instance = one repository, non-negotiable this session.

## Decisions

### 1. REST v3 via global fetch; no new dependency

`fetch` + Zod cover every need (CRUD, search, pagination). Rejected alternatives:

- **GraphQL v4 API** — no search-with-qualifiers equivalent as simple as
  `GET /search/issues`, needs a query document layer, and its cursor pagination is more
  machinery than the `page`/`per_page` model.
- **octokit/rest.js** — a new dependency whose own error types and pagination
  abstractions would have to be unwrapped to feed the normalized classification and
  observation boundary anyway; the thin `githubFetch` wrapper is smaller than the
  integration.

Zod remains the validation stack (project convention, already v4).

### 2. Mirror YouTrack's module contract exactly

`index.ts` default-exports a factory whose `activate` registers type `github`;
`entry-runtime.ts` builds the provider through the `import.meta.require`
module-contract-check pattern (verify the module exports the provider class before
constructing). Why: a failed contract check produces a clear activation-time error
instead of a deep cast failure, and keeping the shape identical to YouTrack means the
loader and its tests treat the third provider uniformly. `validateConfig` is re-exported
from `index.ts` as the named export the manifest's `providerConfigValidator` names.

### 3. Task id = stringified issue `number`

The normalized `Task.id` is the issue `number` as a string, used consistently across
create/read/update/list/search and URL building. Rationale: within one instance the repo
is fixed, so `number` is unambiguous and stable; it is what users see in URLs, chat, and
search qualifiers, so ids round-trip through human conversation. Alternative rejected:
the numeric issue `id` — globally unique but opaque, and it breaks the "paste an issue
number" workflow. `Task.number` carries the same value for display.

### 4. Pagination by incrementing `page` until a short/empty page

`per_page: 100`, loop `page` until a page returns fewer than `per_page` items (or
empty), aggregating results. Link-header parsing was considered and rejected: it needs a
parser for behavior the page counter already produces, and GitHub documents both. Search
honors the normalized `limit`/`offset` the same way over its own pagination.

### 5. Pull requests are excluded from task listings and search

GitHub's issue list and search endpoints return pull requests too, but a PR is not a
task. Two exclusion points, matched to what each endpoint can express:

- **Search**: the client pins `is:issue` into the query alongside `repo:{o}/{r}` —
  exclusion at the source, so limits and pagination are not skewed by PRs. Users cannot
  remove it (it encodes what a task *is*), while their other qualifiers pass through.
- **List**: the REST list endpoint has no such filter, so the schema marks
  `pull_request` optional and items carrying it are dropped before mapping.

### 6. Rate-limit classification takes precedence over the 401/403 auth mapping

GitHub overloads 403 for both authorization failure and rate limiting, so the
classifier inspects headers first: 429, 403 with `x-ratelimit-remaining: 0`, or any
response bearing `Retry-After` / `x-ratelimit-reset` classifies as `rateLimited`; only
then do plain 401/403 fall to `authFailed`. `GitHubApiError` carries statusCode,
headers, and body precisely so this ordering is decidable downstream of the client.

### 7. Status mapping is a two-way, reason-folding mapping

Normalized open/closed maps onto `state`; setting closed sends
`{ state: 'closed', state_reason: 'completed' }`. Plain and canonical status text are
accepted on input. On output, `state_reason` folds into status text
(`closed (not_planned)` vs `closed`) so the not-planned distinction survives
round-trips without a new normalized status field. Close is a status update through the
same `updateTask` path — no separate capability, matching the advertised set.

### 8. Web URL derivation from the API base URL

`api.github.com` → `https://github.com`; any other host (GHES) → the baseUrl's
**origin**, stripping an `/api/v3` suffix path. Origin is correct for the dominant
GHES layout (`https://ghes.example.com/api/v3` → `https://ghes.example.com`);
subpath-hosted GHES is an accepted imprecision (see Open Questions) because API
operations are unaffected — only the clickable URL would be wrong.

### 9. Host confinement by construction, plus manifest declarations

`githubFetch` resolves the base once (validated `baseUrl` or the default) and only ever
joins paths onto it, so the client cannot address another host even though it uses
global fetch. The manifest additionally declares `providerAllowedHosts:
["api.github.com"]` and `providerAllowedInstanceHostsFromConfig: ["baseUrl"]` so the
provider-runtime host checks apply the moment gap #15 is closed. The token travels only
in the `Authorization: Bearer` header — never in a URL or log line.

### 10. Observation boundary and logging reuse

Every outbound request wraps in `observeProviderRequest` with `provider: 'github'`
inside a `requireProviderRequestScope` guard, with a pino child logger: debug on entry
with params, info on success with ids/counts, error on caught exceptions. Credentials
and issue bodies stay out of logs — ids, numbers, and counts only. No existing analytics
module needed changes; this is the same seam Kaneo and YouTrack already use.

## Risks / Trade-offs

- [Search API has aggressive secondary rate limits (~30 req/min)] → surfaced as
  `rateLimited` per the spec; the prompt addendum steers the agent toward qualifiers
  over repeated probes. No auto-retry this session (Non-Goal).
- [List-to-exhaustion can be slow on huge repositories] → `per_page: 100` minimizes
  round trips; accepted cost of the "all pages" contract; a cap can be added later
  without changing the mapping.
- [403 ambiguity misclassified] → header-precedence rule pinned by a dedicated test
  matrix (429, 403+remaining:0, Retry-After, plain 403).
- [Label shape drift between list and single-issue endpoints] → one Zod schema accepts
  both string and object forms; mappers never assume either.
- [Global fetch (gap #15) means no centralized host enforcement yet] → confinement is
  by construction (decision 9) and declarations are in place for the future runtime.
- [New plugin file mass trips coverage ratchets] → seed `scripts/coverage/floor.json`
  and the story floor from a green run via the sanctioned ratchet procedure, as the
  proposal's verification notes.

## Migration Plan

None required. The plugin is a new directory, `defaultEnabled: false`, no DB schema
change, no migration, no `src/` edit; existing Kaneo/YouTrack instances are untouched.
Rollback = disable the plugin (or delete the directory); no persisted `github` state
exists outside ordinary task-instance/context-config rows, which the existing encrypted
config facade already owns.

## Scope model impact

No new persisted state and no new scope keys. The repository binding lives in the
existing encrypted **task-instance** config (instance scope); the PAT lives in the
existing encrypted **context-scoped** provider config (`providerContextConfigSchema`,
`sensitive: true`) resolved per config-context — group-shared across a group's threads,
like all task instances. Nothing is keyed by storage-context id, platform instance, or
user. Behavior is identical across Telegram, Mattermost, Discord, and Kontur Talk by
construction: the provider sits behind the platform-neutral task tools.

## Capability / tool_prefs impact

No new tool surface: the plugin registers a task-provider type, so the existing task
tools, their capability gating, and per-context `tool_prefs` (allow/ask/deny,
most-specific-wins) apply unchanged — including the `ask` confirmation flow. The only
gating delta is advertisement: capabilities are exactly `projects.list` and
`projects.read`, so capability-gated optional operations (deletion, comments, labels,
attachments, sprints, time tracking) are not offered for `github` instances — task
deletion doubly so, since GitHub's REST API cannot delete issues.

## New modules

All under `plugins/task-provider-github/`: `plugin.json`, `index.ts`, `entry-runtime.ts`
(loader contract — no existing module can be reused; each plugin must own its
activation), `validate-config.ts` (instance-scope validation), `client.ts` (REST
wrapper; no shared HTTP client module exists across providers — Kaneo and YouTrack each
own one, and the GitHub header/pagination/rate-limit shapes differ), `classify-error.ts`
(normalized classification), `schemas/` (Zod API shapes), `operations/tasks.ts` +
`operations/projects.ts` (endpoint operations), `mappers.ts`, `provider.ts`
(`TaskProvider` implementation), `url-builder.ts`, `prompt-addendum.ts`, `due-date.ts`
(no-ops), `constants.ts`. The split mirrors YouTrack's layout one-to-one so review and
tests map across providers.

## Hook and TDD interaction

The Write/Edit TDD hook gates only `src/` and `client/`, so none of the new files are
enforced red-green; test-first order is a discipline `tasks.md` imposes instead, and
each task names the command that proves it (`bun test tests/plugins/task-provider-github/…`).
The new suite mirrors `tests/plugins/task-provider-youtrack/` file-for-file, using
`setMockFetch`/`restoreFetch` and `mockLogger()` from the existing helpers. Files under
`src/` are untouched, so the auto-reindex plugin and codeindex flow are not in play.

## Open Questions

- GHES subpath installs (e.g. `https://host/gh/api/v3`): origin-based web-root
derivation yields a wrong clickable URL there. Deferrable — API operations are
unaffected; fix would be a config-level `webUrl` override in a later session.
- Whether list should eventually gain a server-side cap for very large repositories;
current contract is exhaustive pagination. Deferrable without spec change (an
implementation-level cap discussion).
