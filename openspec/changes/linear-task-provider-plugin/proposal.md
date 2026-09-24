# Linear Task-Provider Plugin

## Goal

Expose Linear as task-tracker type `linear` through a new first-party plugin `plugins/task-provider-linear/`, so an operator can assign a Linear task instance to a context and users create, read, update, list, search, and delete Linear issues via the existing chat task tools. Plugin-only: providers resolve exclusively through the plugin-contributed registry (see `src/providers/AGENTS.md`), so no `src/` edits are required. Precedents: `openspec/changes/github-issues-task-provider/`, `plugins/task-provider-youtrack/` (manifest pattern), `plugins/task-provider-kaneo/` (operations layout).

## Stated assumptions (maintainer may veto on the thread)

- Auth: Linear personal API key sent as `Authorization: <API_KEY>` to `POST https://api.linear.app/graphql` (verified against current Linear developer docs). OAuth2 out of scope. Key is context-scoped, sensitive, encrypted-at-rest, masked in settings, never logged.
- Transport: raw GraphQL + Zod v4 payload validation; no `@linear/sdk` dependency.
- Instance model: one task instance = one Linear team. Instance-scoped required config key `team` (key, name, or UUID; resolved to UUID via the `teams` query, cached in-memory). Team is the papai project, same as repo-for-GitHub.
- Scope: one change shipping the MVP capability set below; broader parity in Non-goals.

## Files to touch (all new, mirroring existing provider plugins)

- `plugins/task-provider-linear/plugin.json`: id `task-provider-linear`, apiVersion 1, main `index.ts`, defaultEnabled false, permissions `provider.task` + `identity`, contributes taskProviderTypes `linear`. providerConfigSchema: `team` (instance, required). providerContextConfigSchema: `apiKey` (context, required, sensitive). providerAllowedHosts `api.linear.app` (SaaS-only, no instance-hosts config). providerConfigValidator `validateConfig`. providerCapabilities: `comments.create`, `comments.delete`, `comments.read`, `comments.update`, `labels.assign`, `labels.create`, `labels.list`, `labels.update`, `projects.list`, `projects.read`, `statuses.list`, `tasks.delete`.
- `index.ts` / `entry-runtime.ts`: YouTrack-style factory with `registerTaskProviderType('linear', ...)`, named re-export of `validateConfig`, `import.meta.require` module-contract pattern, KNOWN GAP global-fetch note.
- `validate-config.ts`: instance config only (ignore merged-in apiKey); `team` non-empty, no whitespace, human-readable reasons.
- `client.ts`: `linearFetch` GraphQL wrapper (fixed endpoint, auth header, JSON body), `LinearApiError` carrying HTTP status plus GraphQL `errors[]`, cursor pagination over `pageInfo.hasNextPage`/`endCursor` with a MAX_PAGES cap bounding LLM context, rate-limit detection via `errors[].extensions.code === 'RATELIMITED'`, pino child logger, provider-request observation boundary (`provider: 'linear'`).
- `classify-error.ts`: 401/GraphQL auth codes → authFailed; RATELIMITED → rateLimited; not-found by target → task/project-not-found; input errors → validationFailed; 5xx → unexpected; network message patterns → network error; idempotent pass-through; non-Error → unexpected. Wraps `AppError` from `papai/plugin-types`.
- `schemas/`: Zod v4 (enums first, nullable/optional conventions, z.infer exports): user, team, workflowState, issueLabel, comment, issue (id, identifier, title, description, priority, dueDate, state, assignee, labels, url, timestamps), relay connection envelope.
- `operations/`: one file per domain, `linear<Entity><Action>` naming, config first, debug-entry/info-success/error logging: `tasks.ts` (issueCreate/Update/Delete, filtered issues list, searchIssues), `comments.ts`, `labels.ts` (list/create/update + issue label add/remove), `projects.ts` (configured team as sole project; foreign id → project-not-found), `statuses.ts` (team workflow states, read-only), `identity.ts` (users search, viewer for getCurrentUser).
- `mappers.ts`: issue → Task/TaskListItem/TaskSearchResult with UUID as stable id, `identifier` (e.g. ENG-123) for display, status = workflow state name, projectId = team id, tolerant of null/absent fields; team → Project.
- `provider.ts`: `LinearProvider implements TaskProvider` (`src/providers/types.ts`): name `linear`, preferredUserIdentifier `id`, identityResolver wired, real due-date support, buildTaskUrl/buildProjectUrl, classifyError, getPromptAddendum.
- `url-builder.ts`, `prompt-addendum.ts`, `due-date.ts`, `constants.ts`: task URL `https://linear.app/issue/{identifier}`; addendum documents team scoping, Markdown descriptions, team-specific workflow states, Linear priority scale, UUID ids with shorthand, search filters; dueDate normalized to Linear date format and back.
- `tests/plugins/task-provider-linear/`: manifest, activation, validate-config, client (auth header, endpoint, pagination cap, RATELIMITED), classify-error matrix, mappers, operations with mocked fetch (`setMockFetch`/`restoreFetch` from `tests/utils/test-helpers.ts`), prompt-addendum, due-date.

## Intended behaviour change

A new task-tracker type `linear` becomes selectable once the plugin is approved/enabled; contexts with a `linear` task instance gain capability-gated task operations (core CRUD ungated; comments/labels/team-projects/workflow-state-listing/delete per the declared set) and no others. Scope model unchanged and spec'd explicitly: the task instance is group-shared across the config-context and sibling threads, live conversation state stays thread-isolated, a null task instance exposes no `linear` operations, existing `tool_prefs` (allow/ask/deny, most-specific-wins) and confirmation flows apply unchanged, guest mode keeps its read-only toolset, and behaviour is identical across Telegram, Mattermost, Discord, and Kontur Talk. Outbound calls go only to `api.linear.app`, carry the API key only as the auth header (never in URLs or logs), and request analytics attribute operations to provider `linear` without message or payload content.

## Capability

New capability `linear-task-provider` (feature-domain granularity): without it Linear users cannot use papai task tools at all; no existing capability covers this tracker type beyond the per-plugin pattern this change extends.

## Verification

1. `bun test tests/plugins/task-provider-linear/` green.
2. `bun run lint`, `bun run typecheck` clean; `bun security` (fetch + credentials + plugin surface).
3. `bun run test` full suite stays green.
4. Coverage gates: new `plugins/` files enter the coverage ratchet (`scripts/coverage/floor.json`) and T0 story-coverage floor (`scripts/story/coverage-floor.json`); adjust via the sanctioned `bun coverage:ratchet` procedure from a green run if tripped.
5. Final task: full `bun test` + typecheck + lint + update affected `docs/architecture/plugins.md` and provider-list mentions in `AGENTS.md` / `src/providers/AGENTS.md`.

## Non-goals

- OAuth2/token-refresh (API key only).
- Cycles as sprints, issue relations, attachments, subscribers/watchers, votes, issue history, saved queries, `tasks.commands`, `tasks.visibility`, `workItems.*`, custom fields.
- Admin mutations: team create/update/delete, workflow-state create/update/delete/reorder, label delete, `members.provision`.
- Linear cross-team projects as a separate papai concept; landing-page provider chip; any `src/`/`client/` production edits; any new runtime dependency.
