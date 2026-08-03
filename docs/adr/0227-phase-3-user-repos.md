<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0227: Phase 3 — User-Defined Repositories & Inline Project Spec

## Status

Implemented (with divergence)

## Date

2026-06-25

## Context

Phases 1 (ADR-0221) and 2 (ADR-0222) closed the *identity* gap for ACP coding sessions: the sandboxed agent runs under a per-context LLM key and clones/pushes under the user's own forge token, both supplied per request with no agent or forge credential on the magi host. The remaining gap was *project selection*. Until this change, a coding session could only target a repo that an operator had statically registered in magi's `MAGI_PROJECTS` file (`InMemoryProjectRegistry` / `loadProjects` / `GET /projects`). A user with their own credentials could not self-serve a new repo: every new project required an operator to edit magi config and redeploy.

The 2026-06-25 Phase-3 design (`docs/superpowers/specs/2026-06-25-phase-3-user-repos-design.md`, Plane 3 of the parent user-self-serve-credentials spec) inverts the ownership: **papai becomes the source of truth for each user's repo catalogue**, the acp plugin sends an **inline `projectSpec`** per session, and magi drops its static registry entirely — constructing an **ephemeral project** per request by merging the user's repo basics with operator-provided sandbox defaults, validating it against an operator repo-host allowlist, and persisting the (non-secret) spec with the session so finish/review run from it. The user picks *which repo* and *how autonomous* the agent is; the operator owns the sandbox template (image/agent/egress/provisioning) and the host allowlist.

The design locks five decisions: papai owns the catalogue and magi is stateless about user repos; the catalogue is non-secret (a plain table, not the encrypted vault) keyed on the config context like the Phase-1/2 vault; magi validates the inline spec against `MAGI_ALLOWED_REPO_HOSTS` + HTTPS-only (the SSRF gate); the static `MAGI_PROJECTS` registry is dropped entirely (inline `projectSpec` is the only project source); and geofront is unchanged.

## Decision Drivers

- **Self-serve, no operator step.** A user adds their own repos in the settings UI and starts sessions on them immediately; papai owns the catalogue, magi owns the sandbox template.
- **Catalogue is non-secret.** Repo URLs are not credentials → a plain (unencrypted) table, not the AES-256-GCM vault from Phases 1–2; repo metadata may be persisted and logged where secrets may not.
- **magi stateless about user repos.** The inline `projectSpec` is the only project source; no static registry to fall out of sync, no `GET /projects` to maintain. magi persists the spec with the session so the whole lifecycle (clone → provision → push → PR) runs from it.
- **Operator policy is the safety boundary.** A user cannot choose the image, provisioning, or egress; `MAGI_ALLOWED_REPO_HOSTS` bounds which repos can be cloned/pushed (the SSRF gate on user-supplied URLs); HTTPS-only transport is enforced.
- **Reuse Phase-1/2 infrastructure.** The config-context scope model, the `coding.secrets` permission, the `codingSecrets` facade pattern, and the per-session request channel are extended (`codingRepos` fac), not forked.
- **Minimal `projectSpec`.** papai's spec stays minimal (`name`, `repoUrl`, `baseBranch`, `permissionPreset`); magi owns `forge.kind`/`forge.repo` derivation and all `ProjectConfig` construction.

## Considered Options

### Option A — papai-owned catalogue + inline `projectSpec`; drop magi's static registry (chosen)

papai gains a plain `coding_session_repos` catalogue + CRUD route + `codingRepos` capability + a "Repositories" settings section. The acp plugin's `list_projects` reads the catalogue and `start_session`/`review_pr` resolve a repo name → spec and send it as `projectSpec`. magi drops `InMemoryProjectRegistry`/`loadProjects`/`MAGI_PROJECTS`/`GET /projects`; managers take a `MAGI_PROJECT_DEFAULTS` template + a repo-host policy instead of a registry.

- **Pros:** self-serve repos with no operator step; magi has one project source (the inline spec) instead of two; the SSRF allowlist is a fail-safe-narrow gate (default = the configured forge host); reuses the Phase-1/2 scope model + request channel; the non-secret catalogue needs no crypto.
- **Cons:** a cross-repo contract (papai sends `projectSpec`; magi validates/persists it) that must ship together and stay in sync; an operator must widen `MAGI_ALLOWED_REPO_HOSTS` for any non-default forge host.

### Option B — Keep magi's static registry; papai writes through to it

papai CRUD proxies into magi's `MAGI_PROJECTS`/a new magi catalogue endpoint; sessions still resolve projects by name from the registry.

- **Pros:** magi keeps a single project source; no inline-spec validation path.
- **Cons:** couples papai to magi's project model; magi must grow a writable catalogue API + authz; the registry can still fall out of sync with papai; fails the "magi stateless about user repos" driver and the design's locked decision #4. Rejected.

### Option C — Per-repo full `ProjectConfig` in papai (user picks image/egress too)

Store the entire sandbox template per repo in papai and send it wholesale.

- **Pros:** maximal user flexibility; papai becomes the only config surface.
- **Cons:** lets a user choose the image/provisioning/egress — exactly the security boundary the design draws (the user picks *which repo* and *how autonomous*; the operator owns the sandbox template). Rejected; the operator-template/user-repo split is the safety model.

## Decision

The papai-side changes (the subject of this ADR) ship a plain catalogue, a CRUD route, a `codingRepos` plugin capability, an inline-`projectSpec` acp plugin, and a settings section. The magi-side changes (ephemeral `buildEphemeralProject`/`validateRepoSpec`, the `project_spec` column, the registry removal) land in the magi repo against the same design and are referenced as the cross-repo contract, confirmed indirectly by `docs/architecture/coding-stack-overview.md` (`validateRepoSpec`, `MAGI_ALLOWED_REPO_HOSTS`, persisted `projectSpec`) and `docs/architecture/behaviors.md` (registry removed, inline spec sole source).

### 1. Plain per-config-context catalogue

New table `coding_session_repos(context_id, repo_id, name, repo_url, base_branch, permission_preset, additional_egress_domains, updated_at, updated_by)`, PK `(context_id, repo_id)`, `UNIQUE (context_id, name)` (migration `064_coding_session_repos`; the `additional_egress_domains` column is added later by `066_coding_repos_egress` — see Divergence). The store (`src/coding-repos/store.ts`) is **plain — no `secret-payload-crypto`**: `listRepos`, `getRepoByName`, `upsertRepo` (upsert-by-name via a pre-select + `onConflictDoUpdate` on `(context_id, repo_id)`), `deleteRepo`. `assertValid` enforces `https://` repo URLs and the three presets (`autonomous`/`cautious`/`readonly`).

### 2. CRUD settings route

`GET`/`POST`/`DELETE` on `/settings/api/coding-repos` (`src/debug/settings/coding-repos-routes.ts`), registered in `settings-api-router.ts`. Authorization reuses the existing `resolveContextScope` (personal = DM owner; group = group admins + bot admins) and `requireCsrf` on writes. `POST` validates via a strict Zod schema (`PostBodySchema`, https + preset enum) → 422 on violation; the store's `assertValid` is the second gate. `GET` returns the context's repos; `DELETE ?repoId=` removes one.

### 3. `codingRepos` plugin capability

A new `codingRepos` facade on `PluginToolRuntimeContext` (`src/plugins/runtime-types.ts`), `coding.secrets`-permission-gated exactly like `buildCodingSecretsFacade`. `buildCodingReposFacade` (`src/plugins/coding-secrets-facade.ts`) resolves at the config context via the shared `configContextOf` helper (per-user in DM, group-shared in a group): `list()` → `{ name, baseBranch }[]` for `list_projects`; `get(name)` → `CodingRepoEntry | null` for `start_session`. Wired into `buildPluginToolRuntimeContext` alongside `codingSecrets`.

### 4. acp plugin: `list_projects` from catalogue + inline `projectSpec`

- `list_projects` (`listProjectsTool`, `plugins/acp/tools.ts`) returns `runtimeContext.codingRepos.list()` — **not** a magi `GET /projects` call (that route is removed magi-side).
- `start_session(project, prompt[, prNumber])` (`plugins/acp/session-tools.ts`) treats `project` as the **repo name**; resolves via `codingRepos.get(project)`; if `null` → `{ error: 'not_found', message: 'No repository named "<project>". Add it in settings → Repositories.' }` **without calling magi**. On a hit, it builds a `projectSpec` (`buildSessionProjectSpec`) and sends it in the `POST /sessions` body alongside the Phase-1/2 `secrets`/`forgeToken`.

### 5. "Repositories" settings section

`client/settings/sections/ReposSection.svelte` (section id `repos`, label "Repositories") — a list with per-row Delete + an add form (name, https repo URL, base branch, permission-preset select). **No masking** (not a credential section). Fetchers `fetchRepos`/`addRepo`/`deleteRepo` in `client/settings/repos-fetchers.ts`; `ReposResponseSchema` in `fetcher-schemas-repos.ts`. Wired into `SettingsApp.svelte`: imported, `'repos'` in `ADVANCED_IDS`, sidebar item "Repositories" right after "Code host", rendered after `<CodeHostSection>`.

### Cross-repo contract (magi)

magi parses `projectSpec` on `POST /sessions` (and `/reviews`/follow-up), validates it via `validateRepoSpec` against `MAGI_ALLOWED_REPO_HOSTS` (fail-closed: empty/unset refuses to serve; SaaS `api.github.com`/`gitlab.com` always admitted for the forge-API check but the repo clone host is never exempt), and persists the non-secret spec in a `project_spec` column so finish/review/follow-up re-derive the project without a registry. `buildEphemeralProject(spec, defaults)` merges the spec with `MAGI_PROJECT_DEFAULTS` (operator sandbox template) and derives `forge.repo` from `repoUrl`. `InMemoryProjectRegistry`/`loadProjects`/`MAGI_PROJECTS`/`GET /projects` are removed; managers take `defaults` + policy instead of a registry. Verified indirectly via `docs/architecture/coding-stack-overview.md` and `docs/architecture/behaviors.md`.

## Consequences

### Positive

- A user adds their own repos in the settings UI and starts sessions on them with no operator step; papai owns the catalogue, magi owns the sandbox template.
- magi has a single project source (the inline `projectSpec`) instead of two; no static registry to fall out of sync, no `GET /projects` to maintain.
- The SSRF allowlist (`MAGI_ALLOWED_REPO_HOSTS`, defaulting fail-safe-narrow) is the gate on user-supplied URLs; HTTPS-only transport is enforced; a spec outside policy is rejected (`400`), never run.
- The non-secret catalogue needs no crypto and no masking; repo metadata is persisted with the session and may be logged at `debug`, where `secrets`/`forgeToken` remain unpersisted/unlogged (Phases 1–2).
- The config-context scope model and `coding.secrets` permission are reused; `codingRepos` slots in alongside `codingSecrets` with no new permission surface.

### Negative

- **Cross-repo contract.** papai sends `projectSpec` and magi validates/persists it; a rename or shape change on either side breaks start/finish/review/follow-up. The contract is small but must be tracked alongside Phase 1's `secrets` and Phase 2's `forgeToken`.
- **Operator must widen the allowlist for non-default hosts.** A repo on a host not in `MAGI_ALLOWED_REPO_HOSTS` is rejected at magi intake; the failure surfaces after papai's pre-flight, not in chat.
- **Per-repo egress beyond the spec's scope.** The catalogue grew an `additionalEgressDomains` column the Phase-3 spec explicitly scoped out — see Divergence. It is additive (operator policy still bounds the ceiling) but it is surface the plan did not call for.

### Risks

- **SSRF gate is only as good as the allowlist.** `MAGI_ALLOWED_REPO_HOSTS` is the single gate on which hosts a user can point a session at; a too-broad operator list weakens the boundary. The fail-closed default (empty = refuse) mitigates misconfiguration.
- **`projectSpec` carries operator-relevant fields enriched by later phases** (`agent`, `forge`, `providerHost`, `model`, `mcp`). A papai/magi disagreement on the validated subset could let an unvalidated field reach the launch layer — magi's later router-agent-reconciliation (deriving the launch agent from the validated `projectSpec.agent`, not the unvalidated top-level `body.agent`) is the backstop, documented in `docs/architecture/coding-sessions.md`.

## Related Decisions

- **ADR-0221: Phase 1 — Agent-Credential Vault** — the encrypted vault, `codingSecrets` capability, and per-session request channel this ADR extends with the `codingRepos` facade and the inline `projectSpec`.
- **ADR-0222: Phase 2 — Per-User Forge Identity** — the `forgeToken` request field and self-hosted-forge resolution that `start_session`'s pre-flight (`canDeriveForge`) builds on; the immediate predecessor in the same series.
- **ADR-0218: papai-acp Plugin** — the plugin whose `list_projects`/`start_session` tools gain catalogue resolution and inline-`projectSpec` injection.
- **ADR-0185: BYOK LLM Credentials** — the per-config-context scope model (per-user in DM, group-shared in a group) the repo catalogue reuses.
- **ADR-0137: Settings Web UI — HTTP API** — the `resolveContextScope`/`requireCsrf` authorization + CSRF model the `/settings/api/coding-repos` route inherits.

## Implementation Notes

Verified present in the codebase (light confirmation via `grep`/`glob`/`read`, not exhaustive):

| File | Role | Evidence |
| --- | --- | --- |
| `src/db/coding-repos-schema.ts:8` | Drizzle table `codingSessionRepos` (plain, non-encrypted); `UNIQUE (context_id, name)` (`:23`). | `read` confirms. |
| `src/db/migrations/064_coding_session_repos.ts:13` | `CREATE TABLE coding_session_repos` + unique-name index; registered in `src/db/index.ts:183`. | `read` + `grep` confirm. |
| `src/db/migrations/066_coding_repos_egress.ts:14` | Adds `additional_egress_domains` column (post-Phase-3 — see Divergence); registered `src/db/index.ts:185`. | `read` confirms. |
| `src/db/schema.ts:56` | Re-exports `codingSessionRepos`/`CodingSessionRepoRow`. | `grep` confirms. |
| `src/coding-repos/types.ts:6` | `REPO_PRESETS`/`RepoPreset`/`RepoInput`/`RepoRecord` (with optional `additionalEgressDomains`). | `read` confirms. |
| `src/coding-repos/store.ts:71` | `listRepos` (`:71`), `getRepoByName` (`:80`), `upsertRepo` (`:89`, upsert-by-name), `deleteRepo` (`:130`); `assertValid` https+preset gate (`:40`); plain (no crypto). | `read` confirms. |
| `src/debug/settings/coding-repos-routes.ts:69` | `GET`/`POST`/`DELETE` handler; strict Zod `PostBodySchema` (`:19`) → 422; `resolveContextScope` + `requireCsrf`. | `read` confirms. |
| `src/debug/settings-api-router.ts:98` | Route registration (`/settings/api/coding-repos`). | `grep` confirms. |
| `src/plugins/runtime-types.ts:33` | `CodingRepoEntry` type; `:78` `codingRepos` facade on `PluginToolRuntimeContext`. | `read` confirms. |
| `src/plugins/coding-secrets-facade.ts:46` | `buildCodingReposFacade` (`list`/`get`), `coding.secrets`-permission-gated, resolving at `configContextOf(storageContextId)`. | `read` confirms. |
| `src/plugins/tool-runtime.ts:236` | `codingRepos` wired into `buildPluginToolRuntimeContext`. | `grep` confirms. |
| `plugins/acp/tools.ts:181` | `listProjectsTool` reads `runtimeContext.codingRepos.list()` (not magi `/projects`); `:111` `buildProjectSpec`; `:142` `buildSessionProjectSpec` (enriched — see Divergence); `:102` `canDeriveForge`. | `read` confirms. |
| `plugins/acp/session-tools.ts:82` | `start_session` resolves `codingRepos.get(project)` → `not_found` (`:84`) or `projectSpec` in `/sessions` body (`:96`, `:105`). | `read` confirms. |
| `client/settings/sections/ReposSection.svelte:105` | "Repositories" section (id `repos`), list + add form, no masking. | `read` confirms. |
| `client/settings/SettingsApp.svelte:62` | `'repos'` in `ADVANCED_IDS`; `:134` sidebar item; `:249` `<ReposSection>` render (after Code host). | `grep` confirms. |
| `client/settings/repos-fetchers.ts:13` | `fetchRepos`/`addRepo`/`deleteRepo`; `fetcher-schemas-repos.ts:19` `ReposResponseSchema`. | `grep` confirms. |
| `plugins/acp/plugin.json:23` | `permissions` includes `coding.secrets` (gates `codingRepos`). | `grep` confirms. |

Plan-vs-implementation divergences:

- **Per-repo `additionalEgressDomains` shipped, beyond the spec's out-of-scope.** The Phase-3 spec explicitly scoped egress as operator-default ("Egress stays operator-default … out of Phase 3"). The implementation adds an `additionalEgressDomains` column (migration `066`, after the base `064`), surfaces it in the `codingRepos.get()` facade and `buildSessionProjectSpec`, validates it in the store (`isBareHost`, max 20), and exposes a textarea in `ReposSection`. It is additive (the operator's geofront ceiling still bounds it) and consistent with the later per-repo egress design in `docs/architecture/coding-sessions.md`, but it is surface the Phase-3 plan did not call for.
- **`projectSpec` enriched well beyond the Phase-3 minimal shape.** The plan/spec's `projectSpec` was `{ name, repoUrl, baseBranch, permissionPreset }`. The shipped `buildSessionProjectSpec` (`plugins/acp/tools.ts:142`) also carries `agent`, `forge`, `providerHost`, `model`, and `mcp` — fields introduced by later phases (Phase 4 agent/provider picker, Phase 5a model, the MCP-catalog work) layered on top of the Phase-3 catalogue resolution. No Phase-3 requirement is unmet; the minimal fields are all present.
- **`review_pr` tool absent; tool surface evolved.** The plan/spec describe a `review_pr(project, prNumber)` tool that resolves a repo name → `projectSpec` on the `/reviews` body. No such tool exists today: PR review is reached via `start_session(prNumber)` (start on an existing PR) plus `continue_session` (`plugins/acp/continue-tool.ts`) / magi `POST /sessions/:id/follow-up`. The catalogue-resolution path the plan specified for `review_pr` is instead implemented inside `start_session`.
- **acp tool implementations split across files.** The plan said to modify `plugins/acp/tools.ts` + `index.ts`. The session tools (`start`/`list`/`status`/`finish`/`cancel`/`answer_permission`) live in `plugins/acp/session-tools.ts`, with `continue-tool.ts` separate; `tools.ts` retains `list_projects`/`list_agents` + the shared `buildProjectSpec`/`buildSessionProjectSpec`/`canDeriveForge` helpers. Mechanical divergence.
- **Self-hosted forge pre-flight beyond the Phase-3 "single forge kind (GitHub)" boundary.** `start_session` pre-flights non-SaaS repo hosts via `canDeriveForge` (`plugins/acp/tools.ts:102`) and refuses when no forge is configured — landed with Phase 2's self-hosted forge support rather than Phase 3's GitHub-only scope.

All core Phase-3 plan/spec outcomes are present: the plain repo catalogue + store, the CRUD route, the `codingRepos` capability, `list_projects` from the catalogue, inline `projectSpec` on `start_session`, and the "Repositories" settings section; magi's static-registry drop + `validateRepoSpec` SSRF gate + `project_spec` persistence are confirmed indirectly via `docs/architecture/coding-stack-overview.md` and `docs/architecture/behaviors.md`.

The source plan `docs/superpowers/plans/2026-06-25-phase-3-user-repos.md` and design spec `docs/superpowers/specs/2026-06-25-phase-3-user-repos-design.md` are archived alongside this ADR to `docs/archive/`.
