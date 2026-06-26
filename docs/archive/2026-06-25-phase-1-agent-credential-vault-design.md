<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 1 — Agent-Credential Vault + Per-Session Secret Channel — Design

**Date:** 2026-06-25
**Status:** Draft (detailed spec; spawns a plan)
**Parent:** `docs/superpowers/specs/2026-06-25-user-self-serve-coding-credentials-design.md`

## Scope

Let a user (or group admin) store **their own AI-provider API key** in the
settings web UI and have ACP coding sessions run the sandboxed agent with **that
key** — with **no credential ever set on the magi host**. This is Plane 2 of the
parent spec.

**Boundary (explicitly out of Phase 1):**

- Forge token + git transport identity stays operator-provisioned on the magi
  host until **Phase 2**. Phase 1 delivers _agent authentication_; the
  push/PR step of `finish_session` is unchanged.
- Repos are still operator-defined in magi's `MAGI_PROJECTS` registry until
  **Phase 3**.
- Single provider only: **Anthropic** via `claude-code-acp`. The multi-vendor
  provider picker and the general provider→env mapping are **Phase 4**.

## Decisions locked (from review)

1. **No central/global fallback.** Unlike chat BYOK (which falls back to
   `system_config`), there is **no operator-provided agent key**. If the
   session's context has no complete credentials, the session is refused. As a
   result there is **no `enabled` toggle** — "configured/complete" is the only
   state that matters (the byok toggle exists solely to switch to central; we
   have no central).
2. **magi takes the agent key from the request only — never `process.env`** for
   the agent credential, and **throws if a required secret is missing**. papai
   pre-flights and refuses in chat; magi's throw is the defense-in-depth backstop.
3. **Config-context scope, like byok_llm.** The vault is keyed on
   `getConfigContextIdFromStorageContextId(storageContextId)` — per-user in a DM,
   group-shared in a group. No cross-user identity resolution.
4. **papai owns the provider→env-name mapping.** Phase 1 hardcodes
   `anthropic → ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_BASE_URL`). magi stays
   ignorant of provider semantics; it stages request secrets by name.
5. **Minimal settings section.** One section, one masked API-key field (+ optional
   base URL). Reuses the `ByokSection` field/mask/state patterns minus the toggle.

## Design — papai

### 1. Data model + migration

New table (generalized vault; Phase 1 uses only the `agent-provider` namespace —
Phase 2 adds `forge`):

```
coding_session_credentials(
  context_id        TEXT NOT NULL,   -- config-context id
  namespace         TEXT NOT NULL,   -- 'agent-provider' (Phase 1)
  encrypted_config  TEXT NOT NULL,   -- AES-256-GCM blob of Record<string,string>
  updated_at        INTEGER NOT NULL,
  updated_by        TEXT NOT NULL,
  PRIMARY KEY (context_id, namespace)
)
```

No `enabled` column (decision 1). New Drizzle schema
`src/db/coding-credentials-schema.ts` + migration
`src/db/migrations/0NN_coding_session_credentials.ts`.

### 2. Store module — `src/coding-credentials/`

Mirrors `src/byok-llm/` minus the toggle, reusing
`encryptSecretPayload` / `decryptSecretPayload` from `src/secret-payload-crypto.ts`.

- `types.ts`:
  - `AGENT_PROVIDER_FIELDS = ['provider_api_key', 'provider_base_url'] as const`
  - `REQUIRED_AGENT_PROVIDER_FIELDS = ['provider_api_key'] as const`
  - `CodingCredentialState = { configured: boolean; complete: boolean; missing: readonly RequiredField[] } & Partial<{ unreadable: true; error: string }>`
- `store.ts`:
  - `getCodingCredentialState(contextId, namespace): CodingCredentialState`
  - `getCodingCredentials(contextId, namespace): Record<string,string> | null` (decrypted)
  - `updateCodingCredentials(contextId, namespace, fields, updatedBy)` (merge + re-encrypt; empty string clears a field)
  - `clearCodingCredentials(contextId, namespace, updatedBy)`

State machine = the byok `complete` / `missing` / `unreadable` logic, sans
`enabled`.

### 3. Plugin capability — `codingSecrets`

A new **first-party-only** capability gated by a new plugin permission so the
acp plugin can resolve the acting context's vault at tool time.

- **Permission:** add `'coding.secrets'` to `PLUGIN_PERMISSIONS`
  (`src/plugins/types.ts`). The acp manifest declares it.
- **Facade type** (`PluginToolRuntimeContext` in `src/plugins/types.ts`):
  ```ts
  codingSecrets: { resolve(): Record<string, string> | null }
  ```
  `resolve()` returns the **env-name-keyed** secret map ready for the magi
  request, or `null` when the context has no complete agent-provider credentials.
- **Builder** (`buildPluginToolRuntimeContext`, `src/plugins/tool-runtime.ts:191`):
  add `codingSecrets: buildCodingSecretsFacade(runtime.storageContextId, permissions.has('coding.secrets'))`.
  Without the permission, `resolve` denies (consistent with the other facades).
- **Resolution + mapping (papai owns it):**
  ```
  configCtx = getConfigContextIdFromStorageContextId(storageContextId)
  creds = getCodingCredentials(configCtx, 'agent-provider')   // {provider_api_key, provider_base_url?}
  if creds?.provider_api_key missing → return null
  return { ANTHROPIC_API_KEY: creds.provider_api_key,
           ...(creds.provider_base_url ? { ANTHROPIC_BASE_URL: creds.provider_base_url } : {}) }
  ```
  Values never touch `kv`, logs, or chat. The `anthropic → ANTHROPIC_*` mapping
  is the only provider mapping in Phase 1.

### 4. acp plugin changes (`plugins/acp/`)

- `plugin.json`: add `"coding.secrets"` to `permissions`.
- `tools.ts`: extend `RuntimeContext` with
  `codingSecrets: { resolve(): Record<string,string> | null }`.
- `startSessionTool.execute`: **pre-flight** —
  ```ts
  const secrets = runtimeContext.codingSecrets.resolve()
  if (secrets === null)
    return {
      error: 'not_configured',
      message: 'Set up your AI provider key in settings → Coding Sessions before starting a session.',
    }
  // include `secrets` in the POST /sessions body
  ```
  `review_pr` (`POST /reviews`) gets the same pre-flight + `secrets` injection,
  since reviews also launch a sandboxed agent.

### 5. Settings route — `src/debug/settings/coding-credentials-routes.ts`

`GET` / `PATCH` on `/settings/api/coding-credentials`, registered in
`src/debug/settings-api-router.ts` (user-plane, before admin checks per the
existing order). Authorize with the **existing**
`resolveContextScope(principal, action, rawContextId)` (personal = DM owner;
group = `manageableGroups`, i.e. group admins + bot admins) and `requireCsrf` on
`PATCH`.

- `GET` → `{ contextId, namespace: 'agent-provider', state, hasBaseUrl }`
  (never returns secret values; masked presence only).
- `PATCH { contextId?, values: { provider_api_key?, provider_base_url? } }` →
  `updateCodingCredentials`; empty string clears a field; a `clear: true` shape
  calls `clearCodingCredentials`.

No admin route in Phase 1 (the read-only admin audit overview is deferred).

### 6. Client — `client/settings/sections/CodingCredentialsSection.svelte`

- Props: `contextId`. Loads state via a new `fetchCodingCredentials(contextId)`;
  saves via `patchCodingCredentials(...)` (both in `client/settings/fetchers.ts`,
  schemas in `fetcher-schemas.ts`).
- Renders a masked **Anthropic API key** field (required) + optional **Base URL**,
  with Save / Clear and the byok-style "Not configured" / "Missing required
  fields" / "stored credentials unreadable" states. **No enable toggle.**
- Register in `client/settings/SettingsApp.svelte` under a new **Coding Sessions**
  group (or Advanced), section id `coding-credentials`, rendered for all
  authenticated users with `contextId={ctx}` (authorization enforced server-side).

## Design — magi (separate repo)

### 7. Request channel

- `POST /sessions` (`src/server/router.ts` `handleStart`): accept optional
  `secrets: Record<string,string>` (validate: object of string→string; reject
  non-string values). Thread to `SessionManager.startSession({..., secrets})`.
  Same for `POST /reviews` → `ReviewManager.startReview`.
- **Never** persist `secrets` to `SessionStore`; **never** log the map. Add an
  explicit redaction note/test at the start path.

### 8. Provisioning — request-sourced secrets, no host fallback

- Add a `SecretSource` variant (`src/runtime/geofront/provisioning/plan.ts` →
  `project/config.ts`): `{ request: string; targetEnv: string; required?: boolean }`.
- `stageSecrets` (`secret-stager.ts`) receives the per-session `secrets` map.
  For a `request` source: `value = secrets[source.request]`; if `undefined` and
  `required !== false` → **throw** `provisioning secret not provided: <name>`
  (decision 2). Stage as an env-secret (`magi-init` exports it). No `process.env`
  read for the agent key.
- **claude preset** (`presets.ts`): replace the host `~/.claude` / Keychain
  `secretTargets` with
  `[{ request: 'ANTHROPIC_API_KEY', targetEnv: 'ANTHROPIC_API_KEY', required: true },
{ request: 'ANTHROPIC_BASE_URL', targetEnv: 'ANTHROPIC_BASE_URL', required: false }]`.
  Default egress already adds `api.anthropic.com`.
- `AgentRuntime.provision` signature gains the `secrets` map (threaded from
  `startSession` → `GeofrontRuntime.provision` → `resolvePlan`/`stageSecrets`).
  The stub runtime ignores it.

### 9. Failure surfacing

A missing required secret throws during `provision()`, before `geofront up`. The
session ends `failed`; the existing failure path emits a `failed` milestone via
`POST /api/notify`, so the user sees a clear chat message even though papai's
pre-flight should already have caught the common case.

## Security / redaction

- Secret at rest: papai vault only, AES-256-GCM.
- Secret in flight: magi request body over the existing `magi_token`-authed,
  loopback/firewalled hop; production TLS documented in the deploy guide.
- Secret in sandbox: staged outside the build context, `chmod 600`, `shred`-ed by
  `magi-init` before the agent execs (existing mechanism).
- Redaction assertions (both repos): no secret value in logs, `SessionStore`, or
  chat history. papai's `providerRuntime.httpFetch` must not log bodies.

## Out of scope (Phase 1)

- Forge token / git transport identity (Phase 2).
- User-defined repos (Phase 3).
- Multi-provider, opencode/codex, base-URL-driven egress (Phase 4).
- Admin guardrails, group-session identity policy, admin audit overview (Phase 5
  / deferred).
- Removing magi's other `SecretSource` variants — left in place, simply unused by
  papai-managed projects.

## Testing

**papai**

- `tests/coding-credentials/store.test.ts` — encrypt/decrypt round-trip;
  `complete`/`missing`/`unreadable` states; clear; merge semantics.
- `tests/debug/settings/coding-credentials-routes.test.ts` — `GET`/`PATCH`
  authorized for a writable context; 403 for an unmanageable group / foreign
  personal context; CSRF enforced; secret values never returned by `GET`;
  malformed body → 422.
- `tests/plugins/coding-secrets-facade.test.ts` — `resolve()` returns the mapped
  env secrets at the config-context; `null` when incomplete; denies without the
  `coding.secrets` permission.
- `tests/plugins/acp/*` — `start_session`/`review_pr` refuse with `not_configured`
  when `resolve()` is null; include `secrets` in the request when configured.
- Redaction: a logging spy asserts no secret value is emitted.

**magi**

- `router` test — `/sessions` accepts/validates `secrets`; rejects non-string
  values; `secrets` absent from the stored session and from logs.
- `provisioning` test — request-sourced secret staged into the plan; missing
  required secret throws `provisioning secret not provided`; claude preset
  resolves from the request, not `process.env`.

## Files touched

**papai**

| File                                                       | Change                                           |
| ---------------------------------------------------------- | ------------------------------------------------ |
| `src/db/coding-credentials-schema.ts`                      | new Drizzle schema                               |
| `src/db/migrations/0NN_coding_session_credentials.ts`      | new migration                                    |
| `src/db/index.ts` / `schema.ts`                            | register schema + migration                      |
| `src/coding-credentials/{types,store}.ts`                  | new vault store                                  |
| `src/plugins/types.ts`                                     | add `coding.secrets` perm + `codingSecrets` type |
| `src/plugins/tool-runtime.ts`                              | `buildCodingSecretsFacade` + wire into builder   |
| `src/debug/settings/coding-credentials-routes.ts`          | new user route                                   |
| `src/debug/settings-api-router.ts`                         | register route                                   |
| `plugins/acp/plugin.json`                                  | declare `coding.secrets`                         |
| `plugins/acp/tools.ts`                                     | `RuntimeContext` type + pre-flight + inject      |
| `client/settings/sections/CodingCredentialsSection.svelte` | new section                                      |
| `client/settings/{fetchers,fetcher-schemas}.ts`            | fetchers + schemas                               |
| `client/settings/SettingsApp.svelte`                       | register section + sidebar                       |
| Tests above                                                | coverage                                         |
| `CLAUDE.md`                                                | document the vault + capability                  |

**magi**

| File                                                                | Change                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/server/router.ts`                                              | accept/validate/thread `secrets` (no persist/log)       |
| `src/session/manager.ts` (+ `review/manager.ts`)                    | thread `secrets` to `provision`                         |
| `src/runtime/runtime.ts`                                            | `provision` signature gains `secrets`                   |
| `src/runtime/geofront/geofront-runtime.ts`                          | pass `secrets` to `resolvePlan`/`stageSecrets`          |
| `src/runtime/geofront/provisioning/{plan,secret-stager,presets}.ts` | request `SecretSource`; throw-on-missing; claude preset |
| `src/project/config.ts`                                             | `SecretSource` request variant type                     |
| Tests above                                                         | coverage                                                |

## Open questions

- **Base URL field:** include in Phase 1 (cheap, enables Anthropic-compatible
  proxies) or strip to API-key-only for the leanest cut? Spec assumes _include,
  optional_.
- **`review_pr` parity:** Phase 1 injects secrets into reviews too (recommended,
  since reviews launch an agent). Confirm, or scope Phase 1 to `start_session`
  only.
