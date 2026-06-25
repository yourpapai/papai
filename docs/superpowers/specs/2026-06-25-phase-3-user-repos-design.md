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
4. **The static `MAGI_PROJECTS` registry stays as an optional fallback** for
   operator-defined shared projects (named-project path unchanged); the inline
   path is additive. `list_projects` switches to the **papai catalogue**.
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
- Operator defaults: a new `MAGI_PROJECT_DEFAULTS` (JSON file, like
  `MAGI_PROJECTS`) supplying the sandbox template — `workspaceImage`,
  `agentEntrypoint`, `provisioning`, `egressAllowlistDomains`, `forge.kind`,
  `forge.apiBaseUrl`. A pure `buildEphemeralProject(spec, defaults)` merges them
  into a full `ProjectConfig`, deriving `forge.repo` from `repoUrl`
  (github: `owner/name` from the URL path).
- **Validation** `validateRepoSpec(spec, policy)`: `repoUrl` must be `https://`
  and its host ∈ `MAGI_ALLOWED_REPO_HOSTS` (operator list; default = the
  `forge.apiBaseUrl` host); `permissionPreset` ∈ the three presets. Reject → the
  router returns `400`.

### 6. Request channel + session persistence

- `StartSessionInput.projectSpec?` / `StartReviewInput.projectSpec?`. The router
  (`handleStart`/`handleReview`) parses `body['projectSpec']`, validates it, and
  forwards it.
- `SessionManager.startSession` / `ReviewManager.startReview`: when `projectSpec`
  is present, `buildEphemeralProject` → use that `ProjectConfig` (skip the
  registry lookup); else the existing `this.projects.get(name)` path
  (backward-compatible named projects).
- **Persist the spec with the session.** Add a nullable `project_spec` JSON
  column to the `sessions` table (migration). `store.create` stores it when the
  session came from an inline spec. This is **non-secret** repo metadata —
  consistent with the no-secret-persistence rule (forge token / agent key are
  still never stored).
- A `resolveProjectFor(session)` helper: if the row has a `project_spec`, return
  `buildEphemeralProject(spec, defaults)`; else `this.projects.get(session.project)`.
  Replace the three `this.projects.get(session.project)` call sites in
  `session/manager.ts` (finish + teardown) and `review/manager.ts` with it, so
  finish/push/PR work for ephemeral projects.
- `GET /projects` (magi) keeps returning the static registry (operator shared
  projects); it is no longer the source for `list_projects`.

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
- Removing the static `MAGI_PROJECTS` registry (kept as an operator fallback).

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
  `resolveProjectFor` returns it at finish; named-project path still works.
- `tests/session/store.test.ts` — `project_spec` column round-trips; null for
  named projects.
- `tests/server/router.test.ts` — `/sessions` + `/reviews` accept + validate
  `projectSpec`; disallowed host → 400.

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

| File                                  | Change                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `src/project/config.ts`               | `ProjectSpec`, `buildEphemeralProject`, `validateRepoSpec` |
| `src/main.ts`                         | load `MAGI_PROJECT_DEFAULTS` + `MAGI_ALLOWED_REPO_HOSTS`   |
| `src/session/state.ts` / `manager.ts` | `projectSpec` input; `resolveProjectFor`; ephemeral path   |
| `src/review/manager.ts`               | `projectSpec` input; ephemeral path                        |
| `src/session/store.ts`                | `project_spec` column + round-trip                         |
| `src/server/router.ts`                | parse + validate `projectSpec` on start/review             |

## Open questions

- **Operator defaults mechanism:** a dedicated `MAGI_PROJECT_DEFAULTS` file
  (assumed) vs. designating a "template" entry in the existing `MAGI_PROJECTS`.
  The dedicated file is explicit and avoids overloading the registry.
- **Repo-host allowlist default:** default to the `forge.apiBaseUrl` host
  (assumed — safe, narrow) vs. an explicit always-required `MAGI_ALLOWED_REPO_HOSTS`
  (fail-closed if unset) vs. allow-all (rejected — unsafe). Phase 5 expands this
  into the broader guardrail UI.
- **`forge.repo` derivation:** done in magi from `repoUrl` (assumed) vs. papai
  sending it explicitly. magi-side keeps papai's repo spec minimal and centralizes
  `ProjectConfig` construction.
- **Keep `MAGI_PROJECTS`?** Retained as an optional operator fallback (assumed);
  could be dropped entirely if no shared operator projects are wanted.
