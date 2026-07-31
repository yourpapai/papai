<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0287: Multi-Provider LLM Configuration — Backend (Provider Registry, Per-Role Resolution, and Discovery)

## Status

Implemented (with divergence)

## Date

2026-07-15

## Context

Since ADR-0120 and ADR-0185, papai supported exactly **one** set of LLM credentials, shared across the `main` / `small` / `embedding` roles: five flat keys in `system_config` (central) and the same five keys in an encrypted per-context BYOK blob. The resolver (`resolveEffectiveLlmConfig`) returned a single `{ llmApiKey, llmBaseUrl, mainModel, smallModel, embeddingModel }`, consumed by ~13 call sites. Every provider was forced through `createOpenAICompatible` regardless of vendor, and there was no way to run, say, a local Ollama for `main` while keeping the admin OpenAI account for `embedding`, nor to register two accounts of the same vendor with different keys.

The 2026-07-15 design (`docs/superpowers/specs/2026-07-15-multi-llm-providers-design.md`) and backend plan (`docs/superpowers/plans/2026-07-15-multi-llm-providers-backend.md`) replaced the single-cred model with a **multi-provider registry** (admin-owned normalized tables) plus a **generalized per-context override** (an encrypted, versioned blob), with the three roles each independently bound to a specific provider + model pair. Resolution walks each role independently: context → admin → resolved-`main`-fallback. Scope is deliberately **backend-only** ("Plan A"): the data model, resolver, discovery, and the settings **routes** that the follow-up UI plan ("Plan B") consumes. The design's locked choices were: OpenAI-compatible only (provider "type" is a UI label + base-URL preset, not a native SDK), per-role override granularity, hybrid storage (normalized admin registry + encrypted per-context blob), non-blocking model discovery, and migrating central config **away** from the five `system_config` LLM keys to a single source of truth.

## Decision Drivers

- **Per-role provider independence.** `main`, `small`, and `embedding` must each resolve to a distinct `{apiKey, baseUrl, model}`, so a context can mix providers (e.g. local Ollama for chat, admin OpenAI for embeddings).
- **Two-tier override, like today.** Both the admin registry and the per-context BYOK layer exist; BYOK overrides per-role, inheriting the rest from admin (no all-or-nothing).
- **Single source of truth for central config.** The five legacy `system_config` LLM keys migrate into the new normalized tables and are removed; there is no dual-read fallback to maintain.
- **Resolver-contract ripple must not break compilation mid-migration.** A temporary adapter bridges the viral `EffectiveLlmConfig` shape change so ~11 call sites migrate one-by-one while every commit stays green; the adapter is deleted once migration completes.
- **Discovery is non-blocking and decoupled from serving.** `GET {baseUrl}/models` populates a UI-only cache + verification pill; saves always succeed regardless of fetch outcome, and the resolver never reads the model cache.
- **Version-tolerant BYOK blob.** The `byok_llm_credentials` table is unchanged; an old flat blob is read in memory as one synthetic provider bound to all roles, re-normalized on next save — no backfill, no downtime.
- **Fail closed only on truly unreadable secrets.** The old "BYOK enabled + incomplete → hard error" rule is superseded by graceful per-role fallback; the only remaining hard error is an unreadable encrypted blob (key-rotation breakage).
- **OpenAI-compatible only.** Native SDK adapters (`@ai-sdk/anthropic`, `@ai-sdk/google`) are an explicit non-goal; vendor-native features belong to the separate coding-session subsystem (ADR-0237), not this one.

## Considered Options

### Option 1 — Normalized admin registry + generalized encrypted per-context blob; per-role resolver; adapter bridge (chosen)

`llm_providers` + `llm_admin_roles` (singleton) tables for the admin tier; the `byok_llm_credentials` blob gains a versioned `{v:2, providers[], roles}` shape alongside the legacy flat reader. One per-role `resolveLlmConfig` walks context → admin → main. A temporary adapter exposes the new per-role result through the old single-cred shape until call sites migrate, then is deleted.

- **Pros:** single source of truth; per-role independence; graceful per-role fallback; the adapter keeps the tree compilable at every commit; version tolerance avoids a BYOK schema migration.
- **Cons:** the `EffectiveLlmConfig` contract change ripples through ~11 call sites; two new tables + a migration; a transient `legacy:`-prefixed plaintext apiKey sentinel during the migration window.

### Option 2 — Keep one cred set, add a "provider type" label + base-URL preset only

Leave the single-cred resolver and five-key storage intact; add only a UI label and base-URL presets so users can pick "OpenAI" vs "Ollama".

- **Pros:** no contract ripple, no new tables, smallest diff.
- **Cons:** does not satisfy the headline requirement (per-role provider independence; multiple accounts of the same vendor); the single-cred model is the blocker being removed.

### Option 3 — Native SDK adapters per provider type (`@ai-sdk/anthropic`, `@ai-sdk/google`)

Model the provider type as a real adapter selection, routing Anthropic/Google to their native SDKs.

- **Pros:** access to vendor-native features (caching, tool-calling quirks).
- **Cons:** explicitly out of scope per the design — the chat-bot LLM layer is OpenAI-compatible by construction; vendor-native needs are served by the separate coding-session subsystem (ADR-0237). The complexity is unjustified for this layer.

## Decision

The chosen Option 1 shipped across the data model, resolver, discovery, routes, and every call site. What shipped:

1. **Drizzle schema for the admin registry** (`src/db/llm-providers-schema.ts`). `llmProviders` (id, label, providerType, baseUrl, encryptedApiKey, modelsCache, modelsFetchedAt, verification status/error/at, timestamps, updatedBy) and a singleton `llmAdminRoles` (main required; small/embedding nullable → "inherit main"). Exported from `src/db/schema.ts`.
2. **Migration 067 — create tables + migrate legacy keys** (`src/db/migrations/067_multi_llm_providers.ts`). Creates both tables; when `llm_apikey` + `llm_baseurl` + `main_model` are present and nothing is migrated yet, inserts one `custom` provider bound to all three roles (small/embedding iff their keys exist, else null) with a `legacy:`-prefixed plaintext apiKey sentinel, then deletes the five legacy rows from `system_config`. Idempotent. Covered by `tests/db/migrations/067_multi_llm_providers.test.ts`.
3. **Domain types module** (`src/llm-providers/types.ts`). `LlmProviderType` (openai/anthropic/google/openrouter/ollama/groq/custom), `Verification`, `LlmProviderAccount`, `LlmRoleBindings`, the per-role `ResolvedRole`/`EffectiveLlmConfig` (source `global`/`byok`/`mixed`), and the `LlmConfigResult` union (`missing`/`error` preserved).
4. **Admin provider store + role bindings** (`src/llm-providers/store.ts`). CRUD with AES-256-GCM apiKey encrypt/decrypt (via `secret-payload-crypto`, reusing the BYOK/instance-config key path), an in-process cache with `primeLlmAdminCache`/`clearLlmAdminCacheForTesting`, delete that clears small/embedding refs and rejects deleting the `main`-bound provider, and `getAdminRoleBindings`/`setAdminRoleBindings` over the singleton row.
5. **Version-tolerant BYOK blob codec** (`src/byok-llm/blob-codec.ts`). `decodeByokBlob`/`encodeByokBlob`; a v2 blob round-trips, an old flat `{llm_apikey,…}` blob is read as one synthetic provider bound to all roles.
6. **Per-context BYOK multi-provider store ops** (`src/byok-llm/store.ts`). `getByokBundle` (enabled/blob/unreadable/error), `upsertByokProvider`, `deleteByokProvider` (clears role refs), `setByokRoles`, `updateByokProviderVerification`, all writing the v2 blob encrypted at rest.
7. **Per-role resolver** (`src/llm-providers/resolver.ts`). `resolveLlmConfig(configContextId)` walks each role context → admin → resolved-`main`-fallback; returns `error` only on an unreadable blob, `missing` only when `main` is unresolvable at both tiers; aggregates a `mixed` source when roles differ. (Also adds a `resolveAdminLlmConfig` for admin-only/no-context callers — see Divergences.)
8. **Call sites migrated to the per-role shape.** `src/embeddings.ts`, `src/web/distill.ts`, `src/conversation.ts`, `src/llm-orchestrator-resolve-llm.ts`, `src/tools/compaction/summarizer.ts`, `src/tools/lookup-group-history.ts`, `src/tools/disclosure/embedding-tool-retriever.ts`, `src/long-term-memory/{runner,capture,promotion}.ts`, `src/deferred-prompts/proactive-llm-config.ts`, and `src/message-embedding-sweep.ts` all consume `resolveLlmConfig` and read `resolved.{main,small,embedding}.{apiKey,baseUrl,model}`.
9. **Adapter bridge removed; legacy single-cred resolver deleted.** `src/llm-config-resolver.ts` and its test are gone (no importer remains); `resolveEffectiveLlmConfig` no longer exists. `src/system-config.ts` was removed entirely (its non-LLM keys are accessed directly via the drizzle `systemConfig` table).
10. **Model discovery** (`src/llm-providers/discovery.ts`). `fetchProviderModels(baseUrl, apiKey)` → 200/parseable = `verified` + model ids; 401/403 = `unverified` ("authentication failed"); network/parse/other = `error`. Fully decoupled from serving.
11. **Env bootstrap rework** (`src/llm-providers/env-bootstrap.ts`). `seedDefaultLlmProviderFromEnv` seeds one default `custom` provider + `main` (and small/embedding when their env vars are present) on first start when no admin binding exists; called from startup alongside `primeLlmAdminCache`.
12. **Admin provider/role routes** (`src/debug/settings/admin/llm-providers-routes.ts`; registered in `src/debug/settings-api-router.ts`). `GET/POST /settings/api/admin/providers`, `PATCH/DELETE …/:id`, `POST …/:id/refresh-models`, and `GET/PUT /settings/api/admin/llm-roles` — all `requireAdmin` + CSRF, with non-blocking background verification on create/update and masked apiKey responses.
13. **BYOK PATCH extended with multi-provider actions** (`src/debug/settings/byok-routes.ts`). `{action:'upsert-provider'|'delete-provider'|'set-roles'|'refresh-models'}` dispatch to the new store ops, plus a `rejectLegacyValuesAgainstV2Blob` 409 guard so a legacy flat `{values}` save cannot clobber a v2 multi-provider blob.
14. **Orchestrator misconfigured check re-pointed** (`src/llm-orchestrator-resolve-llm.ts`). The "bot not fully configured" path now keys off `getAdminRoleBindings()` rather than the removed `missingSystemConfigKeys`.
15. **Docs updated** (`docs/architecture/environment.md`). Central creds described as `llm_providers` + `llm_admin_roles`, env-seeded on first start; BYOK described as per-role override with graceful fallback (the "hard-errors when enabled && !complete" sentence removed).

## Consequences

### Positive

- A context may bind only `main` from its own provider pool and inherit admin for `small`/`embedding`, or run its own Ollama for chat while keeping the admin OpenAI account for embeddings — per-role independence that the old single-cred model could not express.
- Central LLM config has a single source of truth (the new tables); the five legacy `system_config` LLM keys and their typed accessors are gone, so there is no dual-read path to drift.
- BYOK's all-or-nothing hard error is replaced by graceful per-role fallback; the only remaining hard error is an unreadable encrypted blob, matching the locked design consequence.
- Existing BYOK blobs and existing central configs migrate automatically (067 for central; in-memory normalization for BYOK) with no downtime and no BYOK schema change.
- Discovery is structurally decoupled from serving: a failed `/models` fetch never blocks a turn and only affects the UI pill + dropdown.
- The tree stayed compilable at every commit of the migration via the temporary adapter, which was then deleted rather than left to rot.

### Negative

- The `EffectiveLlmConfig` contract change rippled through ~11 call sites; each now reads `resolved.<role>.<field>` instead of flat `resolved.llmApiKey`/`mainModel`.
- Two new tables + migration 067 carry a transient `legacy:`-prefixed plaintext apiKey sentinel for already-stored central creds (acceptable: the value already lived plaintext-adjacent in `system_config`; it is re-encrypted on first admin write).
- `INSTANCE_CONFIG_KEY` rotation now also affects the central provider registry's `encrypted_api_key` column (in addition to BYOK and instance configs).
- The settings **UI** for the new registry/roles/generalized BYOK is not in this plan — the routes built here are the contract the companion UI plan consumes (ADR-0288). Until that lands, the registry is manageable only via the API.

### Risks

- **`legacy:` plaintext sentinel.** Until a migrated provider is re-saved, its apiKey sits in `llm_providers.encrypted_api_key` as `legacy:<plaintext>`. The store decrypts it transparently; the window closes on first admin edit, but a deploy that never edits the migrated provider keeps the sentinel.
- **No hard foreign keys.** Per papai's migration style, `llm_admin_roles`/BYOK role bindings reference `llm_providers.id`/blob provider ids without DB-level FKs; integrity is enforced in app logic (delete clears/nulls refs, orphan ids fall through the chain as unset). A path that bypasses the store could orphan a binding.
- **Background verification is fire-and-forget.** A failed/errored verification updates the row asynchronously; a create/update response returns `200` with `verification.status:'unverified'` and the pill only updates after the fetch resolves. A crashed process between save and verify leaves the row `unverified` (safe — saves always succeed), but the UI must tolerate the transient.
- **Discovery wording matches OpenAI-compatible `/models`.** Vendors whose `/models` shape differs (or that lack the endpoint) yield `error`/empty; the UI free-text fallback covers this, but an operator may misread a missing list as "misconfigured."

## Related Decisions

- **ADR-0120** — established central LLM credentials in `system_config` (the five flat keys) and the admin System section. This ADR migrates those five keys out into the normalized registry and removes the `system` LLM KV path.
- **ADR-0185** — introduced the per-context encrypted BYOK layer and the single `resolveEffectiveLlmConfig` resolver this work generalizes (and ultimately replaces) with per-role `resolveLlmConfig`. The BYOK table itself is reused unchanged.
- **ADR-0237** — Phase 4d model selection for the **coding-session** (ACP/magi) subsystem. Its provider-HTTP `/models` discovery + free-text fallback pattern is the precedent this chat-bot-layer discovery mirrors; the two subsystems remain separate (per the design's out-of-scope note).
- **ADR-0230 / Phase 4a multi-provider** — the coding-session agent/provider picker; cited to disambiguate from the earlier multi-*provider* (task-tracker / coding-agent) work, which is unrelated to this chat-bot LLM provider layer.
- **Companion UI (ADR-0288, to be recorded)** — Plan B (`docs/superpowers/plans/2026-07-15-multi-llm-providers-ui.md`) consumes the admin provider/role routes and the extended BYOK PATCH actions built here to render the admin Providers/Models sections and the generalized personal BYOK section.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File | Role | Evidence |
| --- | --- | --- |
| `src/db/llm-providers-schema.ts:8-22` | `llmProviders` table (encrypted apiKey, verification columns, models cache). | `read` confirms. |
| `src/db/llm-providers-schema.ts:26-36` | `llmAdminRoles` singleton (main required; small/embedding nullable). | `read` confirms. |
| `src/db/migrations/067_multi_llm_providers.ts:31-63` | Creates `llm_providers` + `llm_admin_roles`. | `read` confirms. |
| `src/db/migrations/067_multi_llm_providers.ts:65-118` | Migrates legacy five keys → one provider + role singleton (legacy sentinel); deletes the legacy keys. | `read` confirms. |
| `tests/db/migrations/067_multi_llm_providers.test.ts:29-30` | Migration id + table-shape + legacy-migration + idempotence tests. | `read` confirms. |
| `src/llm-providers/types.ts:7-8,39-52` | `LlmProviderType` enum; per-role `ResolvedRole`/`EffectiveLlmConfig` (source `global`/`byok`/`mixed`). | `read` confirms. |
| `src/llm-providers/types.ts:54-68` | `LlmConfigMissing`/`LlmConfigError`/`LlmConfigResult` union (failure shapes preserved). | `read` confirms. |
| `src/llm-providers/store.ts:46-51` | apiKey encrypt/decrypt with `legacy:`-prefix plaintext fallback during the migration window. | `read` confirms. |
| `src/llm-providers/store.ts:79-93` | `primeLlmAdminCache` + `clearLlmAdminCacheForTesting` + lazy `ensureCache`. | `read` confirms. |
| `src/llm-providers/store.ts:105-134` | `createLlmProvider` (encrypts apiKey, primes cache row). | `read` confirms. |
| `src/llm-providers/store.ts:174-191` | `setProviderModels` — manual model-list editor support (beyond the plan's Task 15). | `read` confirms. |
| `src/llm-providers/store.ts:193-209` | `deleteLlmProvider` rejects main-bound delete; nulls small/embedding refs. | `read` confirms. |
| `src/llm-providers/store.ts:229-265` | `getAdminRoleBindings`/`setAdminRoleBindings` over the singleton row. | `read` confirms. |
| `src/byok-llm/blob-codec.ts:21-60` | Version-tolerant `decodeByokBlob` (v2 round-trip + legacy-flat → one-provider v2). | `read` confirms. |
| `src/byok-llm/store.ts:201-219` | `getByokBundle` + `decodeStoredPayload` (blob under a `v2` payload key; unreadable → error). | `read` confirms. |
| `src/byok-llm/store.ts:221-235` | `writeBlob` encrypts the v2 blob at rest via `secret-payload-crypto`. | `read` confirms. |
| `src/byok-llm/store.ts:245-276` | `upsertByokProvider`/`deleteByokProvider`/`setByokRoles`/`updateByokProviderVerification`. | `read` confirms. |
| `src/llm-providers/resolver.ts:60-79` | `resolveLlmConfig` per-role chain (context → admin → main-fallback; mixed aggregation; unreadable → error). | `read` confirms. |
| `src/llm-providers/resolver.ts:84-99` | `resolveAdminLlmConfig` — added admin-only variant (not in the plan). | `read` confirms. |
| `src/llm-providers/discovery.ts:39-59` | `fetchProviderModels` — 200=`verified`+models, 401/403=`unverified`, other/network=`error`. | `read` confirms. |
| `src/llm-providers/env-bootstrap.ts:12-37` | `seedDefaultLlmProviderFromEnv` seeds a default provider + roles on first start. | `read` confirms. |
| `src/runtime/production-deps.ts:55-62` | Startup calls `primeLlmAdminCache()` + `seedDefaultLlmProviderFromEnv()`; warns when no admin binding. | `read` confirms. |
| `src/debug/settings/admin/llm-providers-routes.ts:90-109` | `POST /providers` create + non-blocking background verify. | `read` confirms. |
| `src/debug/settings/admin/llm-providers-routes.ts:111-149` | `PATCH/DELETE …/:id` (409 on main-bound delete); manual `models` list support. | `read` confirms. |
| `src/debug/settings/admin/llm-providers-routes.ts:151-171` | `POST …/:id/refresh-models` — synchronous refresh (awaits fetch, returns updated provider). | `read` confirms. |
| `src/debug/settings/admin/llm-providers-routes.ts:173-206` | `GET/PUT /llm-roles`; router dispatch with `requireAdmin` + CSRF. | `read` confirms. |
| `src/debug/settings-api-router.ts:67-72` | Routes registered for `/providers`, `/providers/*`, `/llm-roles`. | `read` confirms. |
| `src/debug/settings/byok-routes.ts:157-190` | `applyByokAction` — `upsert-provider`/`delete-provider`/`set-roles`/`refresh-models`. | `read` confirms. |
| `src/debug/settings/byok-routes.ts:197-205` | `rejectLegacyValuesAgainstV2Blob` 409 guard (added beyond the plan). | `read` confirms. |
| `src/embeddings.ts:148-167` | Call site migrated: `resolved.embedding.{apiKey,baseUrl,model}`. | `read` confirms. |
| `src/llm-orchestrator-resolve-llm.ts:50` | Orchestrator consumes `resolveLlmConfig`; failure → admin/BYOK reply paths. | `read` confirms. |
| `src/llm-orchestrator-resolve-llm.ts:19-29` | `replyBotMisconfigured` keys off `getAdminRoleBindings()` (not the removed `missingSystemConfigKeys`). | `read` confirms. |
| `src/web/distill.ts:44`, `src/conversation.ts:120`, `src/tools/compaction/summarizer.ts:36`, `src/tools/lookup-group-history.ts:53`, `src/tools/disclosure/embedding-tool-retriever.ts:79`, `src/long-term-memory/runner.ts:72`, `src/long-term-memory/capture.ts:49`, `src/long-term-memory/promotion.ts:61`, `src/deferred-prompts/proactive-llm-config.ts:20`, `src/message-embedding-sweep.ts:36` | Remaining call sites migrated to `resolveLlmConfig` + per-role field reads. | `grep` confirms; no `resolveEffectiveLlmConfig`/`llm-config-resolver` reference remains in `src/`. |
| `src/llm-config-resolver.ts` | Legacy single-cred resolver — **deleted** (Phase 5). | `glob` finds no file. |
| `src/system-config.ts` | LLM-typed accessors module — **deleted entirely** (see Divergences). | `glob` finds no file. |
| `docs/architecture/environment.md:14,20` | Central creds now `llm_providers`+`llm_admin_roles`, env-seeded; BYOK per-role override + graceful fallback. | `grep` confirms. |
| `tests/llm-providers/{store,resolver,discovery,env-bootstrap,types}.test.ts`, `tests/byok-llm/blob-codec.test.ts`, `tests/debug/settings/admin/llm-providers-routes.test.ts` | TDD suites for store/resolver/discovery/env-bootstrap/blob-codec/routes. | `glob` confirms. |

Plan-vs-implementation notes:

- **`src/system-config.ts` was deleted entirely, not just stripped of LLM accessors.** The plan's Task 13 intended to keep the file (table persists for non-LLM keys) and only remove the LLM-typed accessors. Shipped: the whole module is gone; non-LLM keys (`notify_token`, `stats_anonymity_salt`, `mattermost_action_signing_secret`, plugin admin config) are accessed directly via the drizzle `systemConfig` table. Intent (central LLM config leaves `system_config`) is preserved.
- **Startup wiring lives in `src/runtime/production-deps.ts`, not `src/index.ts`.** The plan's Tasks 8/17 edited `src/index.ts` for `primeLlmAdminCache()` + `seedDefaultLlmProviderFromEnv()`. Shipped: both calls (plus a `getAdminRoleBindings() === null` WARN) live in `startDatabase()` in `src/runtime/production-deps.ts:55-62`, which is the current startup composition root. The env-bootstrap helper itself was also extracted into its own `src/llm-providers/env-bootstrap.ts` rather than inlined in `src/index.ts`.
- **The orchestrator's misconfigured-check + `resolveLlmForTurn` were split into a dedicated module.** The plan edited `src/llm-orchestrator.ts` in place. Shipped: `replyBotMisconfigured`/`replyByokConfigProblem`/`resolveLlmForTurn` live in `src/llm-orchestrator-resolve-llm.ts`; intent (re-point to `getAdminRoleBindings()`, consume `resolveLlmConfig`) is preserved verbatim.
- **A new `resolveAdminLlmConfig` export was added.** Not in the plan. Two admin-only/no-context callers — the changelog humanizer (`src/announcements/humanize.ts:33`) and the `/context` command (`src/commands/context.ts:89`) — need the configured central/main LLM with no chat context (hence no BYOK layer); `resolveAdminLlmConfig` (`src/llm-providers/resolver.ts:84-99`) returns an admin-only `LlmConfigResult` with `source` always `global`.
- **Manual model-list editor support shipped.** `setProviderModels` (`store.ts:174-191`) and a `models` array on the admin provider PATCH schema (`llm-providers-routes.ts:34-36,123-130`) allow editing the model cache directly — the spec's §6.1 "manual model-list editor for endpoint-less providers," which the plan's Task 15 did not enumerate, shipped alongside.
- **The admin `refresh-models` route is synchronous, not fire-and-forget.** The plan's Task 15 described only background verification on create/update. Shipped has both: background `verifyInBackground` on create/update (`llm-providers-routes.ts:75-86,106,133`) **and** a `POST …/:id/refresh-models` that awaits `fetchProviderModels` and returns the updated provider (`llm-providers-routes.ts:151-171`) — a better UX for the manual refresh button.
- **The BYOK PATCH gained a legacy-clobber guard.** `rejectLegacyValuesAgainstV2Blob` (`byok-routes.ts:197-205`) returns 409 if a v2 multi-provider blob is active but a legacy flat `{values}` save is attempted — preventing the legacy merge path from overwriting the v2 provider/role config. This integrity guard is beyond the plan.
- **The v2 blob is stored under a `v2` key inside the encrypted payload.** The design's §3.2 showed the `{v:2,…}` shape as the whole blob. Shipped wraps it as `encryptSecretPayload({ v2: JSON.stringify(blob) })` and reads `payload['v2']` (`byok-llm/store.ts:205,222`), so the encrypted envelope is keyed rather than the blob sitting at top level. Behaviorally equivalent; the codec's `decodeByokBlob` still handles the raw shape.
- **UI is deferred (by design).** This plan built the routes only; the admin Providers/Models sections and the generalized personal BYOK section are the companion UI plan (ADR-0288), which consumes the routes built in items 12–13.

The source plan `docs/superpowers/plans/2026-07-15-multi-llm-providers-backend.md` and design `docs/superpowers/specs/2026-07-15-multi-llm-providers-design.md` are archived alongside this ADR to `docs/archive/`.
