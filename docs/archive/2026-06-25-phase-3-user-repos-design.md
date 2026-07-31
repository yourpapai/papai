<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 — User-Defined Repositories — Design

**Date:** 2026-06-25
**Status:** Draft (detailed spec; spawns a plan)
**Parent:** `docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md`
**Builds on:** Phases 1 (`…phase-1-agent-credential-vault-design.md`) and 2 (`…phase-2-forge-identity-design.md`)

## Scope

Let a user add **their own repositories** in the settings web UI and start coding
sessions on them — with **no operator step** to register a project in magi's
static `MAGI_PROJECTS` file. papai becomes the source of truth for each user's
repo catalogue; the acp plugin sends an **inline project spec** per session; magi
constructs an **ephemeral project** by merging the user's repo basics with
operator-provided sandbox defaults, validates it against operator policy, and
persists the (non-secret) spec with the session so finish/review can use it.

**Boundary (out of Phase 3):**

- **Single agent / provider / forge kind** still (claude-code-acp, Anthropic,
  GitHub). The per-repo **agent picker**, multi-vendor providers, self-hosted
  forge + instance URL, and **derived egress** are **Phase 4**.
- Egress stays operator-default (the agent only reaches its model host; git
  clone/push run on the **magi host**, not in the sandbox, so the repo host needs
  no sandbox egress entry).
- Rich admin guardrails (who-may-use, allowed-image policy beyond the host
  allowlist) are **Phase 5**; Phase 3 ships the minimal operator policy needed for
  safety (a repo-host allowlist).

## What the user controls vs. what the operator controls

| Field                                                                                                           | Owner                                           |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `name`, `repoUrl`, `baseBranch`, `permissionPreset`                                                             | **user** (per-repo, settings UI)                |
| `workspaceImage`, `agentEntrypoint`, `provisioning`, `egressAllowlistDomains`, `forge.kind`, `forge.apiBaseUrl` | **operator** (magi defaults — sandbox/security) |
| `forge.repo`                                                                                                    | **derived** by magi from `repoUrl`              |
| forge token, agent key                                                                                          | **user** (Phases 2/1 vault, unchanged)          |

The user picks **which repo** and **how autonomous** the agent is; the operator
owns the **sandbox template** (image/agent/egress/provisioning) and the **host
allowlist**. This is the security boundary: a user can point a session at any
allowed-host repo, but cannot change the image, egress, or provisioning.

## Decisions locked (consistent with Phases 1–2)

1. **papai owns the repo catalogue; magi is stateless about user repos.** magi
   constructs the ephemeral `ProjectConfig` per request from the inline spec +
   operator defaults; it persists the **non-secret** spec with the session so
   finish/review resolve it without the registry. (Secrets/tokens remain
   request-only and unpersisted, per Phases 1–2.)
2. **Repo catalogue is non-secret → a plain table**, not the encrypted vault.
   Keyed on the config-context (`getConfigContextIdFromStorageContextId`) like the
   vault — per-user in DM, group-shared in group.
3. **Operator policy gate:** magi validates the inline spec against a host
   allowlist (`MAGI_ALLOWED_REPO_HOSTS`) and the HTTPS-only transport rule
   (Phase 2). A spec outside policy is rejected (`400`), never run.
4. **The static `MAGI_PROJECTS` registry is dropped entirely** — the inline
   `projectSpec` is the **only** project source. `InMemoryProjectRegistry` /
   `loadProjects` / the `MAGI_PROJECTS` env and the `GET /projects` route are
   removed; `POST /sessions` and `/reviews` **require** a `projectSpec`.
   `list_projects` reads the **papai catalogue**.
5. **geofront unchanged.**

## Design — papai

### 1. Repo catalogue (new plain table)

`coding_session_repos` (migration):

```
coding_session_repos(
  context_id        TEXT NOT NULL,   -- config-context id
  repo_id           TEXT NOT NULL,   -- stable id (uuid)
  name              TEXT NOT NULL,   -- unique per context; the label start_session uses
  repo_url          TEXT NOT NULL,   -- https only
  base_branch       TEXT NOT NULL,
  permission_preset TEXT NOT NULL,   -- 'autonomous' | 'cautious' | 'readonly'
  updated_at        INTEGER NOT NULL,
  updated_by        TEXT NOT NULL,
  PRIMARY KEY (context_id, repo_id),
  UNIQUE (context_id, name)
)
```

Store module `src/coding-repos/{types,store}.ts`: `listRepos(contextId)`,
`getRepoByName(contextId, name)`, `upsertRepo(contextId, repo, updatedBy)`,
`deleteRepo(contextId, repoId, updatedBy)`. Plain (unencrypted) — repo URLs are
not secrets. Validate `repo_url` is `https://` and `permission_preset` is one of
the three presets at the store/route boundary.

### 2. Settings route + section

- `src/debug/settings/coding-repos-routes.ts` — `GET`/`POST`/`DELETE`
  `/settings/api/coding-repos`, authorized by the existing
  `resolveContextScope(principal, action, contextId)` + `requireCsrf` on writes.
  `GET` lists the context's repos; `POST` upserts (validates https + preset);
  `DELETE` removes by `repo_id`. Register in `settings-api-router.ts`.
- `client/settings/sections/ReposSection.svelte` — a list + add/edit/delete form
  (name, repo URL, base branch, permission-preset select). Not a credential
  section (no masking). Section id `repos`, label "Repositories"; wire into
  `SettingsApp.svelte` (Advanced group, after "Code host"). Fetchers +
  Zod schemas in `client/settings/{fetchers,fetcher-schemas}.ts`.

### 3. Plugin capability — `codingRepos`

New host facade `codingRepos` on `PluginToolRuntimeContext`
(`src/plugins/runtime-types.ts` + `tool-runtime.ts`), gated by the existing
`coding.secrets` permission (the acp plugin already declares it):

```ts
codingRepos: {
  list(): { name: string; baseBranch: string }[]      // for list_projects
  get(name: string): RepoSpec | null                  // for start_session/review_pr
}
```

`RepoSpec = { name, repoUrl, baseBranch, permissionPreset }`. Resolves at the
config-context, reads the catalogue. (Factor the shared `configContextOf` helper
from `resolve-agent-secrets.ts`, already extracted in Phase 2.)

### 4. acp plugin (`plugins/acp/tools.ts`)

- Extend the local `RuntimeContext` with `codingRepos`.
- `list_projects`: return `runtimeContext.codingRepos.list()` (the user's
  catalogue) instead of `GET /projects`. (`list_agents` stays as-is for now.)
- `start_session(project, prompt)`: treat `project` as the **repo name**; resolve
  via `codingRepos.get(project)`; if `null` → `{ error: 'not_found', message:
'No repository named "<x>". Add it in settings → Repositories.' }`. Send the
  resolved spec to magi as `projectSpec` (alongside the existing `secrets`,
  `forgeToken`). Keep the agent-key + (start-lenient) forge handling from
  Phases 1–2.
- `review_pr(project, prNumber)`: same name→spec resolution; send `projectSpec`.
- `finish_session`: **unchanged** beyond Phase 2 — magi persists the spec at
  start, so finish needs no project spec.

## Design — magi (separate repo)

### 5. Inline project spec + operator defaults

- Add `ProjectSpec` (`src/project/config.ts`): `{ name, repoUrl, baseBranch,
permissionPreset }`.
- Operator defaults: a new `MAGI_PROJECT_DEFAULTS` (a JSON config file) supplying
  the sandbox template — `workspaceImage`,
  `agentEntrypoint`, `provisioning`, `egressAllowlistDomains`, `forge.kind`,
  `forge.apiBaseUrl`. A pure `buildEphemeralProject(spec, defaults)` merges them
  into a full `ProjectConfig`, deriving `forge.repo` from `repoUrl`
  (github: `owner/name` from the URL path).
- **Validation** `validateRepoSpec(spec, policy)`: `repoUrl` must be `https://`
  and its host ∈ `MAGI_ALLOWED_REPO_HOSTS` (operator list; default = the
  `forge.apiBaseUrl` host); `permissionPreset` ∈ the three presets. Reject → the
  router returns `400`.

### 6. Request channel + session persistence (single path — no registry)

- `StartSessionInput.projectSpec` / `StartReviewInput.projectSpec` (**required**).
  The router (`handleStart`/`handleReview`) parses `body['projectSpec']`, validates
  it, and forwards it; a missing or invalid spec → `400`.
- `SessionManager` / `ReviewManager` **no longer take a project registry** — their
  constructors take the `MAGI_PROJECT_DEFAULTS` + the host policy instead.
  `startSession` / `startReview` always `buildEphemeralProject(spec, defaults)` to
  get the run's `ProjectConfig`.
- **Persist the spec with the session.** Add a `project_spec` JSON column to the
  `sessions` table (migration); `store.create` stores it. This is **non-secret**
  repo metadata — consistent with the no-secret-persistence rule (forge token /
  agent key are still never stored).
- `resolveProjectFor(session)` returns
  `buildEphemeralProject(session.projectSpec, defaults)`. It **replaces every**
  `this.projects.get(...)` call site in `session/manager.ts` (start + finish +
  teardown) and `review/manager.ts`, so the whole lifecycle (clone → provision →
  push → PR) runs from the persisted spec.
- **Remove** the magi `GET /projects` route (no registry to list — `list_projects`
  uses the papai catalogue). `GET /agents` returns the single default agent from
  `MAGI_PROJECT_DEFAULTS` (or is removed). The CLI one-shot modes (`runStart` /
  `runReview` in `main.ts`) build an ephemeral project from `MAGI_PROJECT_DEFAULTS`
  - a `repoUrl` argument (the dev/test path), replacing their registry lookup.

## Security / data

- Repo URLs are **not secrets** — stored plaintext in papai and persisted with
  the magi session by design. Forge token + agent key remain request-only and
  unpersisted (Phases 1–2).
- **Operator policy is the safety boundary:** a user cannot choose the image,
  provisioning, or egress; `MAGI_ALLOWED_REPO_HOSTS` bounds which repos can be
  cloned/pushed; HTTPS-only transport (Phase 2) is enforced.
- No new secret-logging surface; `projectSpec` (repo metadata) may be logged at
  `debug`, but the request's `secrets`/`forgeToken` continue to be excluded.

## Out of scope (Phase 3)

- Per-repo agent/provider selection, opencode/codex, self-hosted forge + instance
  URL, derived egress (Phase 4).
- Admin guardrails beyond the repo-host allowlist; group-session identity
  (Phase 5).

## Testing

**papai**

- `tests/coding-repos/store.test.ts` — CRUD; unique name per context; https +
  preset validation; context isolation.
- `tests/debug/settings/coding-repos-routes.test.ts` — GET/POST/DELETE; scope
  auth; CSRF; invalid url/preset → 400/422.
- `tests/plugins/coding-repos-facade.test.ts` — `list`/`get` at the config
  context; permission-gated.
- `tests/plugins/acp/*` — `list_projects` returns the catalogue; `start_session`
  resolves a repo name → `projectSpec` in the magi body; unknown name → `not_found`
  without calling magi.
- Client: repos section renders/add/delete; fetchers.

**magi**

- `tests/project/ephemeral.test.ts` — `buildEphemeralProject` merges defaults +
  derives `forge.repo`; `validateRepoSpec` rejects non-https / disallowed host /
  bad preset.
- `tests/session/manager.test.ts`, `tests/review/manager.test.ts` — inline
  `projectSpec` runs an ephemeral project; the spec is persisted and
  `resolveProjectFor` returns it at finish (clone → provision → push → PR all use
  the persisted spec).
- `tests/session/store.test.ts` — `project_spec` column round-trips.
- `tests/server/router.test.ts` — `/sessions` + `/reviews` require + validate
  `projectSpec`; missing spec → `400`; non-https / disallowed host → `400`.

## Files touched

**papai**

| File                                                                                                    | Change                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/db/coding-repos-schema.ts` + migration                                                             | new catalogue table                                                            |
| `src/coding-repos/{types,store}.ts`                                                                     | catalogue store                                                                |
| `src/debug/settings/coding-repos-routes.ts` + router                                                    | CRUD route                                                                     |
| `src/plugins/{runtime-types,tool-runtime}.ts`                                                           | `codingRepos` facade                                                           |
| `plugins/acp/tools.ts`                                                                                  | `list_projects` from catalogue; `start_session`/`review_pr` send `projectSpec` |
| `client/settings/{fetchers,fetcher-schemas}.ts` + `sections/ReposSection.svelte` + `SettingsApp.svelte` | repos UI                                                                       |
| `CLAUDE.md`                                                                                             | document the repo catalogue                                                    |

**magi**

| File                                  | Change                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/project/config.ts`               | `ProjectSpec`/`ProjectDefaults`, `buildEphemeralProject`, `validateRepoSpec`; **remove** `InMemoryProjectRegistry`/`ProjectRegistry`              |
| `src/main.ts`                         | load `MAGI_PROJECT_DEFAULTS` + `MAGI_ALLOWED_REPO_HOSTS`; **remove** `loadProjects`/`MAGI_PROJECTS`; CLI modes build ephemeral from a repoUrl arg |
| `src/session/state.ts` / `manager.ts` | required `projectSpec` input; `resolveProjectFor`; drop registry; ephemeral-only path                                                             |
| `src/review/manager.ts`               | required `projectSpec` input; drop registry; ephemeral path                                                                                       |
| `src/session/store.ts`                | `project_spec` column + round-trip                                                                                                                |
| `src/server/router.ts`                | require + validate `projectSpec` on start/review; **remove** `GET /projects`                                                                      |

## Resolved decisions (confirmed)

- **Operator defaults mechanism — dedicated `MAGI_PROJECT_DEFAULTS` file.** Models
  the sandbox template as its own shape (no user-supplied `repoUrl`/`forge.repo`/
  `name`), avoiding overloading `ProjectConfig`/the registry.
- **Repo-host allowlist default — the `forge.apiBaseUrl` host.** Fail-safe-narrow:
  only the configured forge's repo host is allowed unless the operator widens
  `MAGI_ALLOWED_REPO_HOSTS`. This is the SSRF gate on user-supplied URLs (allow-all
  rejected). Phase 5 expands it into the guardrail UI.
- **`forge.repo` derivation — magi, from `repoUrl`.** magi owns `forge.kind`
  (operator default) and all `ProjectConfig` construction; papai's spec stays
  minimal (`repoUrl`).
- **Drop `MAGI_PROJECTS` entirely.** No static registry; the inline `projectSpec`
  (persisted with the session) is the only path. `GET /projects` removed; the CLI
  one-shot modes build an ephemeral project from `MAGI_PROJECT_DEFAULTS` + a
  repoUrl arg.
