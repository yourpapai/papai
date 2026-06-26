<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 4b — Typed Forge Connections + Self-Hosted GitLab — Design

**Date:** 2026-06-26
**Status:** Draft (detailed spec; spawns a plan)
**Parent decomposition:** `docs/superpowers/specs/2026-06-26-phase-4-decomposition-design.md`
**Builds on:** Phases 1–3, 4a

## Scope

Let a user connect a **typed** code host — GitHub / GitHub Enterprise / GitLab
SaaS / GitLab self-hosted — entering an **instance URL** for the enterprise/
self-hosted variants, so clone / push / open-MR work against their own host. The
forge kind + API base URL stop being operator defaults and become per-user.

**Boundary (out of 4b — 4c):** the **sandbox egress** (so the agent can reach the
forge host if it runs git itself) is **derived egress = 4c**. 4b covers the
**host-side** forge surface (clone/push/API on the magi host) and its allowlist
gate; the sandbox egress stays at its 4a value until 4c.

## Decisions locked

1. **The operator allowlist is the SSRF gate — no auto-allow of user instance
   hosts.** A user-supplied forge instance URL means a user-supplied **host** that
   magi will clone/push/API against. Auto-allowing the connection's host would let
   a user point magi at any internal host (SSRF). So a connection's host (and the
   repo URL's host) **must be in the operator's `MAGI_ALLOWED_REPO_HOSTS`** (Phase
   3's list). Self-hosted GitLab works when the operator adds the company host.
   This is the sharper restatement of the Phase-3 #2 decision and where Phase 5's
   guardrail UI will plug in.
2. **papai owns `kind → apiBaseUrl` derivation; magi's API host is always either a
   fixed well-known SaaS host or the validated instance host** (never an arbitrary
   user string for SaaS):
   | connection kind | magi `forge.kind` | `apiBaseUrl` |
   | --------------- | ----------------- | ------------ |
   | `github` (SaaS) | `github` | `https://api.github.com` (fixed) |
   | `github-enterprise` | `github` | `<instanceUrl>/api/v3` |
   | `gitlab` (SaaS) | `gitlab` | `https://gitlab.com/api/v4` (fixed) |
   | `gitlab-self-hosted` | `gitlab` | `<instanceUrl>/api/v4` |
3. **One forge connection per config-context** (per-user in DM, group in group),
   in the existing `forge` vault. The repo's host must match the connection's host
   (the repo lives on the connected forge). Multiple simultaneous connections are
   a future feature.
4. **`deriveForgeRepo` is unchanged** — its Phase-3 implementation already strips
   host/`.git` and returns the full path, which is correct for GitLab
   group/subgroup paths.

## Design — papai

### 1. Forge vault — typed connection

Extend the `forge` namespace field registry (`src/coding-credentials/types.ts`) —
JSON blob, **no migration**:

- `FORGE_FIELDS = ['kind', 'instance_url', 'forge_token']`
- `REQUIRED_FORGE_FIELDS = ['kind', 'forge_token']` (`instance_url` required only
  for `github-enterprise` / `gitlab-self-hosted` — enforced in the route).
- `FORGE_KINDS = ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted']`.
- `deriveApiBaseUrl(kind, instanceUrl)` (papai-owned) per the table in decision 2;
  `forgeMagiKind(kind)` → `'github' | 'gitlab'`. `instanceUrl` must be https.

### 2. "Code host" section + route

- The route's `agent-provider`-style select metadata (added in 4a) is reused: the
  `forge` namespace gets a `kind` **select** field, an `instance_url` text field
  (the client shows it only for enterprise/self-hosted kinds), and the masked
  `forge_token`. PATCH validates: `kind ∈ FORGE_KINDS`; `instance_url` present +
  https for enterprise/self-hosted; the derived host is well-formed.
- **Per-connection Test (optional in 4b):** a `POST /settings/api/coding-credentials`
  `action: 'test'` (or a sibling route) that validates the token against the
  derived `apiBaseUrl` via the existing safe-fetch (a cheap authenticated call,
  e.g. GitHub `/user` / GitLab `/user`). Reports ok / unauthorized / unreachable.
  If the safe-fetch's public-IP guard blocks an internal self-hosted host, Test
  degrades to a shape-only check — note this.

### 3. `codingSecrets` facade + acp

- Add `resolveForge(storageContextId): { kind: 'github'|'gitlab'; apiBaseUrl: string } | null`
  to the facade (`resolve-agent-secrets.ts` reads the `forge` vault, applies
  `forgeMagiKind` + `deriveApiBaseUrl`). `resolveForgeToken` is unchanged
  (Phase 2). A legacy `forge` vault (only `forge_token`, no `kind`) defaults to
  `github` SaaS (back-compat).
- The acp plugin (`plugins/acp/session-tools.ts`) includes the resolved forge in
  the projectSpec: `projectSpec.forge = { kind, apiBaseUrl }`. `forgeToken` is
  still sent separately (the secret, Phase 2).

## Design — magi

### 4. `projectSpec.forge` drives the ephemeral project

- `ProjectSpec` gains `forge?: { kind: ForgeKind; apiBaseUrl: string }`.
  `buildEphemeralProject` uses `spec.forge` (falling back to `defaults.forge` when
  absent, for back-compat) for `forge.kind`/`apiBaseUrl`; `forge.repo` from
  `deriveForgeRepo(repoUrl, kind)`. `MAGI_PROJECT_DEFAULTS.forge` becomes the
  fallback only.
- `GitLabForge`/`GitHubForge` already take an `apiBaseUrl` (self-hosted supported)
  — no forge-layer change. The Phase-2 askpass git transport already works against
  any HTTPS host; `usernameFor(kind)` is github→`x-access-token`, gitlab→`oauth2`.

### 5. Host validation — the SSRF gate (`validateRepoSpec`)

- `validateRepoSpec` already requires `repoUrl` host ∈ `policy.allowedHosts`
  (Phase 3). 4b additionally requires the **forge `apiBaseUrl` host** ∈
  `allowedHosts ∪ {well-known SaaS API hosts: api.github.com, gitlab.com}` — so a
  self-hosted instance host must be operator-allowlisted, while the fixed SaaS API
  hosts are trusted. Reject → `400`.
- Optionally assert the repoUrl host and the (self-hosted) instance host match,
  catching a misconfigured cross-host spec early.

## Security

- **SSRF is the headline:** every host magi touches (git clone/push = repoUrl
  host; forge API = apiBaseUrl host) is bounded by the operator allowlist, except
  the two fixed well-known SaaS API hosts. A user cannot make magi reach an
  un-allowlisted host. Self-hosted requires an explicit operator allowlist entry.
- Token handling unchanged (Phase 2): request-scoped, env-only into git via
  askpass, never persisted/logged.
- `kind`/`instance_url`/`apiBaseUrl` are non-secret config.

## Out of scope (4b)

- Derived **sandbox** egress (4c) — the agent's egress allowlist is unchanged here.
- Multiple simultaneous forge connections per context.
- A full forge-connection management UI beyond the single typed connection.

## Testing

**papai**

- `types.test.ts` — `FORGE_KINDS`, `deriveApiBaseUrl` per kind, `forgeMagiKind`.
- `coding-credentials-routes.test.ts` — forge `kind` select; `instance_url`
  required for enterprise/self-hosted (422 if missing/non-https); legacy
  token-only vault still valid.
- `resolve-agent-secrets.test.ts` / facade — `resolveForge` returns
  `{kind, apiBaseUrl}` per connection; legacy → github SaaS.
- `plugins/acp/*` — `projectSpec.forge` included.
- Client — Code host section shows `instance_url` only for enterprise/self-hosted.

**magi**

- `project/*` — `validateRepoSpec` admits `forge`; rejects a non-allowlisted
  forge/repo host (SSRF), admits well-known SaaS API hosts; `buildEphemeralProject`
  uses `spec.forge` with `deriveForgeRepo` for a GitLab subgroup path; falls back
  to defaults when `forge` absent.
- `server/router.test.ts` — `/sessions`/`/reviews` carry `projectSpec.forge`;
  disallowed forge host → 400.

## Files touched

**papai:** `src/coding-credentials/{types,resolve-agent-secrets}.ts`,
`src/debug/settings/coding-credentials-routes.ts`, `src/plugins/{runtime-types,tool-runtime}.ts`,
`plugins/acp/session-tools.ts`, `client/settings/sections/CodeHostSection.svelte`
(+ schema), `CLAUDE.md`, tests. (Optional Test route + client action.)

**magi:** `src/project/config.ts` (`ProjectSpec.forge`, `validateRepoSpec` host
checks, `buildEphemeralProject`), `src/server/router.ts` (validate forge host),
tests.

## Open questions

- **Allowlist model (the SSRF decision):** operator must allowlist each forge host
  (assumed — safe; self-hosted requires an explicit entry) vs. auto-allow the
  connection host bounded by an operator wildcard ceiling (e.g. `*.corp.com`).
  The 4c spec + Phase 5 guardrails will revisit the ceiling shape.
- **Test depth:** ship a real authenticated API call (assumed — best UX; degrades
  to shape-only when the safe-fetch guard blocks an internal host) vs. shape-only
  validation vs. defer Test entirely to a later phase.
- **`apiBaseUrl` host validation:** validate it against `allowlist ∪ {SaaS API
hosts}` (assumed) vs. require the operator to also list the SaaS API hosts
  explicitly (stricter, more operator setup).
