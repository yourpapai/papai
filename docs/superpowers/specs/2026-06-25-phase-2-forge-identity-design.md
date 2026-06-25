<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 2 — Per-User Forge Identity (token + git transport) — Design

**Date:** 2026-06-25
**Status:** Draft (detailed spec; spawns a plan)
**Parent:** `docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md`
**Builds on:** `docs/superpowers/specs/2026-06-25-phase-1-agent-credential-vault-design.md`

## Scope

Let a user (or group admin) store **their own code-host token** in the settings
web UI, and have ACP coding sessions **clone, push, and open the PR/MR under that
identity** — with **no forge token on the magi host**. This is Plane 3 of the
parent spec.

Phase 1 already shipped the keystone this reuses: the encrypted
`coding_session_credentials` vault (now namespace-generic after the A1 review
fix), the `codingSecrets` plugin capability, the per-session request channel, and
the no-fallback / no-persist / no-log discipline.

**Boundary (out of Phase 2):**

- Repos remain operator-defined in magi's `MAGI_PROJECTS` registry until
  **Phase 3**. Phase 2 changes only _who authenticates_ git/forge, not _which
  repos exist_. The project's `forge.kind` / `forge.apiBaseUrl` / `forge.repo`
  stay operator-defined.
- Single forge per project; self-hosted-GitLab/typed-connections are **Phase 4**.
- Token-based transport assumes an **HTTPS** `repoUrl`. SSH `repoUrl`s
  (host-key auth) are not the user-self-serve path and are out of scope.

## Decisions locked (consistent with Phase 1)

1. **No operator/env forge token, no fallback.** magi stops reading
   `process.env[project.forge.tokenEnv]`. The token is **request-sourced only**;
   absent → the operation fails with a clear error. (`forge.tokenEnv` becomes
   vestigial in Phase 2 — kept in the config type, no longer read.)
2. **Token never persisted, never logged.** It rides each request (start /
   finish / review), is held only in memory, and is passed to git via the child
   **environment** (an askpass helper) — never in argv, never in a remote URL,
   never written to `.git/config`.
3. **Scope = config-context, like Phase 1.** The `forge` token is keyed on
   `getConfigContextIdFromStorageContextId(storageContextId)` (per-user in DM,
   group-shared in group), resolved by the same plugin capability.
4. **Required at finish/review, optional at start.** `finish_session` and
   `review_pr` **pre-flight refuse** when no forge token is configured (push / PR
   / review API definitively need it). `start_session` includes the token when
   present (needed to clone a private repo) but does not hard-refuse without it
   (a public-repo exploration is valid). magi's git layer is the backstop:
   a private clone/push without a token fails with a clear git error.
5. **geofront unchanged.** Clone/fetch/push run on the **magi host** (in the
   worktree), not inside the sandbox — geofront is not involved in git transport.

## Design — papai

### 1. Vault — add the `forge` namespace

No new table. Extend the generalized `coding_session_credentials` vault
(`src/coding-credentials/types.ts`) — the store already dispatches on
`namespace` (`FIELDS_BY_NAMESPACE` / `REQUIRED_BY_NAMESPACE`, completed in the
Phase-1 A1 review fix):

- `CODING_NAMESPACES = ['agent-provider', 'forge'] as const`
- `FORGE_FIELDS = ['forge_token'] as const`; `REQUIRED_FORGE_FIELDS = ['forge_token']`
- register both in `FIELDS_BY_NAMESPACE` / `REQUIRED_BY_NAMESPACE`.

`store.ts` needs **no logic change** — it is already namespace-parameterized.

### 2. Settings route — generalize over namespace

Phase 1's `src/debug/settings/coding-credentials-routes.ts` hardcodes
`NAMESPACE = 'agent-provider'` and `CODING_FIELDS`. Generalize:

- Accept a `namespace` query param (`?namespace=agent-provider|forge`), validated
  against `CODING_NAMESPACES` (reject unknown → 400).
- Drive the field list from a per-namespace registry
  (`FIELDS_META_BY_NAMESPACE`: agent-provider → `[provider_api_key,
provider_base_url]`, forge → `[forge_token]`, each with `{label, required,
sensitive}`).
- GET/PATCH semantics, masking, scope auth (`resolveContextScope`), and CSRF are
  otherwise unchanged. This refactor keeps the agent-provider behavior identical
  (regression-tested) and adds forge for free. Phase 4 reuses the same registry.

### 3. Settings UI — "Code host" section

`client/settings/sections/CodeHostSection.svelte` (or parameterize
`CodingCredentialsSection` by namespace + a section title): one masked
**Forge token** field, same Save / Replace / masked-state patterns as the AI
provider section, **no enable toggle**. Section id `code-host`. Wire into
`SettingsApp.svelte` (Advanced group, after the AI provider section;
`ADVANCED_IDS` + sidebar item "Code host"). Fetchers gain a `namespace` arg
(`fetchCodingCredentials(contextId, namespace)` / `patchCodingCredentials({
contextId, namespace, values })`).

### 4. Plugin capability — `resolveForgeToken`

Extend the host facade (`PluginToolRuntimeContext['codingSecrets']`,
`src/plugins/tool-runtime.ts`) with `resolveForgeToken(): string | null`:
resolve at the config-context, read the `forge` vault, return `forge_token` or
`null`. Gated by the same `coding.secrets` permission. (Reuses
`resolve-agent-secrets.ts`'s config-context resolution — factor a shared
`configContextOf(storageContextId)` helper.)

### 5. acp plugin (`plugins/acp/tools.ts`)

- Extend the local `RuntimeContext` type: `codingSecrets` gains
  `resolveForgeToken(): string | null`.
- `start_session`: include `forgeToken` in the POST body **when non-null**
  (optional; for private clone). Keep the existing agent-key pre-flight.
- `finish_session`: **pre-flight** — if `resolveForgeToken()` is `null`, return
  `{ error: 'not_configured', message: 'Connect a code host in settings →
Coding sessions before pushing or opening a PR.' }`; else include `forgeToken`
  in the `/sessions/:id/finish` body.
- `review_pr`: same pre-flight refusal + include `forgeToken` in `/reviews`.

## Design — magi (separate repo)

### 6. Request channel

Add an optional `forgeToken: string` to the inputs and parse it in the router
(reusing the `asString` helper; never log it):

- `StartSessionInput.forgeToken?` ← `handleStart` (`POST /sessions`).
- `StartReviewInput.forgeToken?` ← `handleReview` (`POST /reviews`).
- `FinishSessionInput.forgeToken?` ← the finish branch of `handleSessionScoped`
  (`POST /sessions/:id/finish`).

### 7. Forge API — per-session token, no env

Replace `EnvForgeProvider` (`src/forge/provider.ts`):

- `ForgeProvider.forProject(project: ProjectConfig, token: string): Forge` —
  construct `GitHubForge`/`GitLabForge` with the **request** token. Throw a clear
  error when `token` is empty (no `process.env[tokenEnv]` read).
- Managers pass the request token: `session/manager.ts` `finishSession` →
  `this.forges.forProject(project, input.forgeToken)` before
  `forge.createPullRequest(...)`; `review/manager.ts` `runReview` →
  `this.forges.forProject(project, input.forgeToken)` before
  `forge.getPullRequest` / `forge.createReview`.

### 8. Git transport — token via askpass (the core new mechanism)

- `runGit(args, cwd, opts?: { token?: string; forgeKind?: ForgeKind })`
  (`src/git/git.ts`): when `token` is set, spawn git with an augmented `env`:
  `GIT_ASKPASS=<askpass asset path>`, `GIT_TERMINAL_PROMPT='0'`,
  `MAGI_GIT_USERNAME=<derived>`, `MAGI_GIT_TOKEN=<token>`. The token lives **only**
  in the child env. Without a token, behavior is identical to today.
- **Askpass asset** `src/git/assets/git-askpass.sh` (shipped like
  `provisioning/assets/magi-init.sh`, resolved via `fileURLToPath(new
URL(...))`): reads `MAGI_GIT_USERNAME`/`MAGI_GIT_TOKEN` from env and echoes the
  username for a `Username` prompt, the token for a `Password` prompt. Must be
  `chmod +x` / invoked via `sh`.
- **Username per forge kind:** github → `x-access-token`, gitlab → `oauth2`
  (both accept any username with a valid PAT as the password; these are the
  conventional values).
- `GitWorkspaceManager` (`src/workspace/git-workspace.ts`) threads the token to
  the **network** git calls only:
  - `prepare(id, project, token?)` → `ensureMirror` clone + `remote update`.
  - `prepareReview(id, project, fetchRef, token?)` → mirror + `fetch`.
  - `finish(prepared, message, token?)` → `push`.
    Local git ops (`worktree add`, `config user.*`, `add`, `commit`, `status`) need
    no token. The remote URL stays `https://host/owner/repo.git` (no token
    embedded). Pass `project.forge.kind` so `runGit` can derive the username.
- Managers thread the token: `runLifecycle` →
  `workspace.prepare(id, project, input.forgeToken)`; `finishSession` →
  `workspace.finish(prepared, input.message, input.forgeToken)`; `runReview` →
  `workspace.prepareReview(id, project, pr.fetchRef, input.forgeToken)`.

## Security

- At rest: token encrypted in papai's vault (AES-256-GCM, `INSTANCE_CONFIG_KEY`).
- In flight: request body over the existing `magi_token`-authed, loopback hop
  (TLS in production).
- On the magi host: token only in process **environment** of the git child
  (never argv/URL/`.git/config`); never written to `SessionStore`; never logged
  (audit every `logger.*` in the touched files). The askpass script must not echo
  the token except to git's password prompt.
- Masked in the settings-UI GET response (`maskSensitiveValue`).

## Out of scope (Phase 2)

- User-defined repos / inline project specs (Phase 3).
- Typed/self-hosted forge connections + instance URL + derived egress (Phase 4).
- Removing the now-vestigial `forge.tokenEnv` from the config type (left in place;
  Phase 3/4 may restructure project config).
- SSH `repoUrl` transport.

## Testing

**papai**

- `tests/coding-credentials/store.test.ts` — extend for the `forge` namespace
  (round-trip, missing-required, namespace isolation from `agent-provider`).
- `tests/debug/settings/coding-credentials-routes.test.ts` — `?namespace=forge`
  GET/PATCH; unknown namespace → 400; agent-provider path unchanged (regression).
- `tests/plugins/coding-secrets-facade.test.ts` — `resolveForgeToken` returns the
  token / null; permission-gated.
- `tests/plugins/acp/*` — `finish_session`/`review_pr` refuse with
  `not_configured` when no forge token; `start_session` includes `forgeToken`
  only when present; finish/review include it.
- Client: forge section renders + saves; fetchers send `namespace`.

**magi**

- `tests/forge/provider.test.ts` — `forProject(project, token)` builds the forge
  with the request token; empty token throws; no `process.env` read.
- `tests/git/git.test.ts` — `runGit` with a token sets `GIT_ASKPASS` +
  `MAGI_GIT_TOKEN` in the child env and **not** in argv; askpass script echoes
  username/token by prompt; token absent → no auth env.
- `tests/workspace/git-workspace.test.ts` — clone/fetch/push receive the token;
  local ops do not; remote URL never contains the token.
- `tests/session/manager.test.ts`, `tests/review/manager.test.ts`,
  `tests/server/router.test.ts` — `forgeToken` threaded from request →
  forge + workspace; not persisted to the store; not logged.

## Files touched

**papai**

| File                                                         | Change                                                |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `src/coding-credentials/types.ts`                            | add `forge` namespace + fields to the registries      |
| `src/debug/settings/coding-credentials-routes.ts`            | generalize over `namespace` + field registry          |
| `src/plugins/tool-runtime.ts` (+ `resolve-agent-secrets.ts`) | `resolveForgeToken` + shared config-context helper    |
| `src/plugins/runtime-types.ts`                               | extend `codingSecrets` facade type                    |
| `plugins/acp/tools.ts`                                       | forge-token pre-flight + inject (start/finish/review) |
| `client/settings/{fetcher-schemas,fetchers}.ts`              | namespace arg + forge response                        |
| `client/settings/sections/CodeHostSection.svelte`            | new section                                           |
| `client/settings/SettingsApp.svelte`                         | wire section + sidebar                                |
| tests above                                                  | coverage                                              |
| `CLAUDE.md`                                                  | document the forge namespace + transport              |

**magi**

| File                                  | Change                                                          |
| ------------------------------------- | --------------------------------------------------------------- |
| `src/git/git.ts`                      | `runGit` token/askpass env injection                            |
| `src/git/assets/git-askpass.sh`       | new askpass helper asset                                        |
| `src/forge/provider.ts`               | `forProject(project, token)`, drop env read                     |
| `src/workspace/git-workspace.ts`      | thread token to clone/fetch/push                                |
| `src/session/state.ts` / `manager.ts` | `StartSessionInput`/`FinishSessionInput.forgeToken` + threading |
| `src/review/manager.ts`               | `StartReviewInput.forgeToken` + threading                       |
| `src/server/router.ts`                | parse `forgeToken` on start/finish/review                       |
| tests above                           | coverage                                                        |

## Resolved decisions (confirmed)

- **Username convention — per forge kind.** `x-access-token` (GitHub) /
  `oauth2` (GitLab), derived from `forge.kind`. Robust for non-PAT token types
  (App/CI tokens) and Phase-4 self-hosted forges; trivial cost since `forge.kind`
  is already threaded.
- **Start-time refusal — lenient.** `start_session` includes the forge token when
  configured but does not refuse without it (public-repo exploration stays
  possible); a private clone without a token fails at the git layer with a clear
  error. `finish_session` / `review_pr` remain hard pre-flight refusals.
- **Askpass packaging — shipped `.sh` asset.** A committed, exec-bit
  (`0755`, defensively `chmod`-ed at startup) `src/git/assets/git-askpass.sh`
  resolved via `import.meta.url`, mirroring `magi-init.sh`. The script is
  token-free (reads the token from the child env), so a static asset has no
  security downside over a per-call temp script and avoids temp-file lifecycle.
