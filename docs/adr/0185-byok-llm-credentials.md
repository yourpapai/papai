<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0185: BYOK LLM Credentials

## Status

Implemented

## Date

2026-06-08

## Context

ADR-0120 moved papai away from unrestricted per-user BYOK. Global LLM credentials now live in `system_config`, are seeded from environment variables, and are managed through the settings admin System section. Migration `036_drop_user_llm_config` removed old LLM keys from `user_config` because unrestricted per-user visibility created a security boundary problem. Since then, every context has shared the same global LLM provider, with no way for an individual user or managed group to route their conversations through their own OpenAI-compatible endpoint.

The 2026-06-08 design (`docs/superpowers/specs/2026-06-08-byok-llm-credentials-design.md`) reintroduced BYOK as a context-scoped credential layer, gated by a bot admin and stored encrypted at rest. BYOK applies to all LLM calls made for an enabled config context: foreground chat replies, proactive/deferred prompt generation, conversation trimming, web distillation, embeddings, and group-history lookup. A disabled or unenabled context keeps using global `system_config` unchanged.

The existing instance config encryption path in `src/instances/encryption.ts` already used AES-256-GCM with `INSTANCE_CONFIG_KEY` (explicit hex, passphrase-derived, or host-local fallback). BYOK credential storage reuses that key-resolution pattern so secret handling stays consistent with platform/task instance credentials, and so `INSTANCE_CONFIG_KEY` rotation affects both stores uniformly.

## Decision Drivers

- **Admin-gated enablement**: only bot-admin-approved contexts may override global LLM credentials, avoiding the old unrestricted per-user problem.
- **No silent fallback to global**: an enabled-but-incomplete BYOK context must block its LLM call with setup guidance, never spend global credentials — fail closed.
- **Single resolver for all LLM paths**: the main orchestrator and every helper (trimming, deferred prompts, distillation, embeddings, group-history lookup) must route through one resolver rather than each reading `system_config` directly.
- **Reuse existing encryption**: BYOK secrets use the same `INSTANCE_CONFIG_KEY` AES-256-GCM path as instance configs, not a new key or vault integration.
- **Never reveal stored API keys**: settings responses mask sensitive values; admin summaries carry no decrypted secrets.
- **Non-BYOK compatibility**: disabled/unenabled contexts keep byte-identical global behavior.

## Considered Options

### 1. Dedicated encrypted BYOK table (chosen)

Store enablement, encrypted credential payload, and status metadata in a dedicated `byok_llm_credentials` table keyed by config context ID.

- **Pros**: keeps BYOK separate from generic `user_config` preferences; avoids reintroducing the old unrestricted per-user LLM config problem; gives admins a clear list of BYOK-enabled contexts; makes encryption and masking rules explicit.
- **Cons**: requires a migration and a dedicated store module.

### 2. Existing `user_config` dynamic fields

Add BYOK fields to the existing scoped settings field system and gate visibility with an admin flag.

- **Pros**: smaller backend and UI change; reuses existing sensitive-field masking behavior.
- **Cons**: `user_config` is generic application state, not a credential vault; it currently stores values plainly; future code could accidentally treat BYOK keys like normal context preferences.

### 3. Admin-managed provider presets

Let admins configure allowed base URLs and model IDs, while enabled users/groups only enter an API key.

- **Pros**: stronger operational control; smaller credential surface for context managers.
- **Cons**: does not satisfy the requirement that BYOK fields mirror global settings; prevents users/groups from selecting their own OpenAI-compatible endpoint and model IDs.

## Decision

Seven coordinated changes implement the architecture:

### 1. `byok_llm_credentials` table (migration 052)

`src/db/migrations/052_byok_llm_credentials.ts` creates a table keyed by `context_id` (PRIMARY KEY) with `enabled` (boolean, default false), `encrypted_config` (nullable TEXT), `updated_at`, and `updated_by`. An index on `updated_at` supports admin summary ordering. A Drizzle schema lives in `src/db/byok-llm-schema.ts` and is re-exported from `src/db/schema.ts`.

### 2. Shared secret-payload crypto

The AES-256-GCM encode/decode logic and `INSTANCE_CONFIG_KEY` resolution are extracted from `src/instances/encryption.ts` into `src/secret-payload-crypto.ts` (`encryptSecretPayload`/`decryptSecretPayload`) and `src/instances/config-key.ts` (`resolveInstanceConfigKey`/`resolveInstanceConfigKeyInfo`). Instance config encryption becomes a thin wrapper over the shared helper, preserving its public API. BYOK store uses the same helper, so key-derivation behavior is not duplicated.

### 3. BYOK store (`src/byok-llm/store.ts`)

Owns enable/disable per config context, encrypted payload write/read, completeness checks against required keys (`llm_apikey`, `llm_baseurl`, `main_model`), masked snapshots for settings responses, and admin summaries. Optional model fields (`small_model`, `embedding_model`) fall back to BYOK `main_model`, never to global optional models. Disabling preserves the encrypted payload for re-enable.

### 4. Effective LLM config resolver (`src/llm-config-resolver.ts`)

`resolveEffectiveLlmConfig(configContextId)` is the single runtime path for choosing LLM credentials. It returns a discriminated result: `ok` with `source: 'global'|'byok'` and the five resolved fields; `missing` with the missing required keys; or `error` for unreadable encrypted payloads. BYOK disabled → global; BYOK enabled + complete → BYOK; BYOK enabled + incomplete → `missing` (no global fallback).

### 5. Orchestrator + helper integration

`src/llm-orchestrator.ts` resolves BYOK-aware config for normal turns and replies with setup guidance when BYOK is incomplete. Helper paths — `src/conversation.ts` (trimming), `src/deferred-prompts/proactive-llm.ts`, `src/web/distill.ts`, `src/embeddings.ts`, `src/tools/lookup-group-history.ts` — each thread a `configContextId` and call the resolver instead of reading `system_config` directly.

### 6. Settings API routes

`src/debug/settings/byok-routes.ts` exposes BYOK fields for the active context via `GET /settings/api/byok` and credential save via `PATCH /settings/api/byok`. `src/debug/settings/admin/byok-routes.ts` exposes admin status and enable/disable via `/settings/api/admin/byok`. Both enforce settings session auth, CSRF on writes, and `resolveContextScope` authorization. Sensitive values use replacement-only editing; the existing masked value is skipped on save.

### 7. Settings UI sections

`client/settings/sections/ByokSection.svelte` renders the context credential form (appears only when enabled, masks the API key, offers replace-not-reveal editing). `client/settings/sections/admin/AdminByokSection.svelte` renders the admin enablement/status table. Both are wired into `client/settings/SettingsApp.svelte`.

## Consequences

### Positive

- An approved context can route all its LLM calls through its own OpenAI-compatible provider, including helper paths (trimming, distillation, embeddings) that previously read `system_config` directly.
- No silent fallback to global credentials when BYOK is enabled — an incomplete context blocks cleanly with setup guidance, so global API keys are never spent on a BYOK-intended turn.
- BYOK credentials are encrypted at rest with the same key material as instance configs; API keys are never returned in plaintext after save.
- Non-BYOK contexts keep byte-identical global behavior; the resolver returns global config when BYOK is disabled.
- A single resolver replaces scattered `system_config` reads, making the credential-selection path auditable.

### Negative

- Every context-bound LLM caller must thread a `configContextId`; callers that previously lacked one received it as a new parameter, expanding signatures across `conversation.ts`, `proactive-llm.ts`, `distill.ts`, `embeddings.ts`, and `lookup-group-history.ts`.
- `INSTANCE_CONFIG_KEY` rotation now affects BYOK credentials in addition to instance configs; a key change without re-encrypting BYOK rows makes them unreadable (the resolver returns `error` and the context blocks).
- Admin-gated enablement required a bot admin to act per context, adding operational overhead for each new BYOK user/group.

### Risks

- An unreadable encrypted BYOK payload (e.g., after a key rotation) blocks the context's LLM calls with a configuration error rather than degrading to global; this is intentional (fail closed) but requires operator awareness.
- Optional model fallback is context-local: missing `small_model`/`embedding_model` fall back to BYOK `main_model`, not to the global optional models, which may surprise an operator expecting the global small/embedding model to fill in.

## Related Decisions

- ADR-0120: Central LLM Credentials, Usage Telemetry, Billing Dashboard, Tool-Call Rows, and Anonymous DB-Wide Statistics — the global `system_config` LLM credential model that BYOK overrides; migration `036_drop_user_llm_config` that removed the old unrestricted per-user BYOK.
- ADR-0136: Settings Web UI Access Model — the `resolveContextScope` authorization and settings session model the BYOK routes reuse.
- ADR-0137: Settings Web UI HTTP API — the settings API router pattern and `settings-api-router.ts` dispatch.
- ADR-0219: BYOK Self-Serve Toggle — evolved the admin-gated enablement model described here to self-serve via the context-write scope; the context route gained a discriminated `{action:'enable'|'disable'}` toggle and the admin route became read-only.

## Implementation Notes

Key files confirmed present:

- `src/db/migrations/052_byok_llm_credentials.ts` — `migration052ByokLlmCredentials` (creates `byok_llm_credentials` + `idx_byok_llm_credentials_updated_at`).
- `src/db/byok-llm-schema.ts` — Drizzle `byokLlmCredentials` table; re-exported from `src/db/schema.ts`.
- `src/instances/config-key.ts` — `resolveInstanceConfigKey`/`resolveInstanceConfigKeyInfo` (explicit/passphrase/host-fallback).
- `src/secret-payload-crypto.ts` — `encryptSecretPayload`/`decryptSecretPayload` (AES-256-GCM, shared with `src/instances/encryption.ts`).
- `src/byok-llm/types.ts` — `BYOK_LLM_KEYS`, `REQUIRED_BYOK_LLM_KEYS`, `ByokCredentialState` (with `unreadable`/`error` metadata).
- `src/byok-llm/store.ts` — `enableByokForContext`/`disableByokForContext`/`updateByokLlmConfig`/`getByokLlmConfig`/`getByokCredentialState`/`listByokAdminSummaries`.
- `src/llm-config-resolver.ts` — `resolveEffectiveLlmConfig` (global/byok/missing/error).
- `src/debug/settings/byok-routes.ts` — context BYOK `GET`/`PATCH` (self-serve toggle + credential save).
- `src/debug/settings/admin/byok-routes.ts` — admin BYOK `GET` (read-only).
- `client/settings/sections/ByokSection.svelte` / `client/settings/sections/admin/AdminByokSection.svelte` — UI sections.

Divergences from the plan (resolved during execution):

- **Self-serve toggle (ADR-0219).** The plan specified admin-gated enablement: the admin route accepted `PATCH {contextId, enabled}` and the context route accepted only `{values}` (rejected before admin enablement). The shipped code inverts this — the context route `PATCH /settings/api/byok` accepts a strict discriminated union `{action:'enable'|'disable'}` (self-serve toggle, authorized by `resolveContextScope(...,'write',...)`) or `{values}` (credential save, rejected while disabled); the admin route is read-only (`GET` only, `PATCH` → 405). This matches the current AGENTS.md BYOK description.
- **Unreadable-payload handling.** The plan's `ByokCredentialState` was `{enabled, complete, missing}`; the shipped type adds `ByokUnreadablePayloadMetadata` (`unreadable: true`, `error: string`). The store's `decryptConfig` catches decryption failures and returns an `unreadable` result rather than throwing; the resolver surfaces this as `{ok:false, type:'error', source:'byok'}`.
- **Store merge semantics.** The shipped `mergeConfigUpdate` clears a key when an empty string is submitted (sets it `undefined`), and `cleanConfig` filters over `BYOK_LLM_KEYS` rather than arbitrary `Object.entries`; the plan's `cleanConfig` trimmed and kept all entries.
- **Migration column.** The plan specified `context_id TEXT PRIMARY KEY`; the shipped migration uses `context_id TEXT NOT NULL PRIMARY KEY` (NOT NULL is implied by PRIMARY KEY in SQLite; no behavioral difference).
