<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design — Multi-provider LLM configuration

**Date:** 2026-07-15
**Status:** Approved (design); ready for implementation planning
**Related:** `docs/architecture/environment.md` (central + BYOK LLM creds),
`docs/superpowers/specs/2026-06-26-phase-4a-multi-provider-design.md` (unrelated:
coding-session agent providers, not chat LLM providers).

## 1. Goal

Replace papai's single-provider LLM configuration with a multi-provider scheme
(inspired by OpenCode, adapted to papai's two-tier trust model). A user/admin
can add any number of provider accounts — including several accounts of the
same provider type with different keys — and independently bind the
`main` / `small` / `embedding` roles to specific provider + model pairs.

### Motivation / current state

Today there is exactly one set of credentials, used for all three roles:

- **Central (admin)** — five keys in the `system_config` SQLite table:
  `llm_apikey`, `llm_baseurl`, `main_model`, `small_model`, `embedding_model`.
  Managed via `POST /settings/api/admin/system` (`src/debug/admin-llm.ts`).
- **BYOK (per config-context)** — the `byok_llm_credentials` table holds the
  same five keys, encrypted at rest with AES-256-GCM
  (`src/secret-payload-crypto.ts`, keyed by `INSTANCE_CONFIG_KEY`). Self-serve
  via `PATCH /settings/api/byok`.
- **Resolver** — `resolveEffectiveLlmConfig(configContextId)`
  (`src/llm-config-resolver.ts`) returns one `{ llmApiKey, llmBaseUrl, mainModel,
smallModel, embeddingModel }`; BYOK wins when enabled+complete, hard-errors
  when enabled+incomplete, else central. Consumed by ~13 callsites.
- **Model builder** — `buildChatModel` → `createOpenAICompatible`
  (`@ai-sdk/openai-compatible`). Every provider is treated as OpenAI-compatible.

### Key decisions (locked during brainstorming)

| Decision             | Choice                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| Scope                | Admin registry **+** per-context override (both tiers, like today)      |
| Provider abstraction | OpenAI-compatible only (type = label + baseURL preset)                  |
| Model discovery      | Fetch + validate, **non-blocking** (status informational)               |
| Central config       | **Migrate away** from `system_config` LLM keys (single source of truth) |
| Override granularity | **Per-role** (context overrides main/small/embedding independently)     |
| Storage shape        | **Hybrid:** normalized admin registry + encrypted per-context blob      |

## 2. Scope

**In scope:**

- New admin-owned provider registry + role bindings (normalized tables).
- Generalized per-context provider accounts + per-role overrides (encrypted
  blob; `byok_llm_credentials` schema unchanged, contents versioned).
- Per-role `EffectiveLlmConfig` contract and migration of all ~13 callsites.
- Server-side model discovery (`GET {baseUrl}/models`) with non-blocking
  validation status + cache, manual-entry fallback.
- Settings UI: admin Providers + Models sections; generalized personal BYOK
  section with per-role "Inherit admin".
- Migration of legacy `system_config` LLM keys → one provider bound to all
  roles; reworked env bootstrap; version-tolerant BYOK blob read.

**Out of scope (explicit non-goals):**

- Native SDK adapters (`@ai-sdk/anthropic`, `@ai-sdk/google`). All providers
  remain OpenAI-compatible; "type" is only a UI label + baseURL preset.
- Model blacklist / whitelist filtering (OpenCode has it; deferred — add later
  if needed).
- Coding-session (ACP/magi) provider selection — separate subsystem
  (see `2026-06-26-phase-4a-multi-provider-design.md`).
- Per-user (cross-context) provider accounts. Per-context means per config
  context (DM owner / group), matching today's BYOK scope.

## 3. Data model

### 3.1 Admin registry — new normalized tables

**`llm_providers`** — admin-owned provider accounts (encrypted apiKey):

| column                                                   | notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` TEXT PK                                             | `prov_<nanoid>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `label` TEXT NOT NULL                                    | user label, e.g. "OpenAI work"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `provider_type` TEXT NOT NULL                            | one of `openai` / `anthropic` / `google` / `openrouter` / `ollama` / `groq` / `custom` — a label that presets a default `base_url` in the UI; under the hood always OpenAI-compatible. **Caveat:** the `anthropic` / `google` presets must point at those vendors' **OpenAI-compatible** endpoints (e.g. Anthropic's beta `/v1/openai`), _not_ their native APIs — the native APIs are not OpenAI-compatible and would fail under `createOpenAICompatible`. Users needing provider-native features are served by the separate coding-session subsystem, not this one. |
| `base_url` TEXT NOT NULL                                 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `encrypted_api_key` TEXT NOT NULL                        | AES-256-GCM via existing `secret-payload-crypto` (wrapped `{ apiKey }`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `models_cache` TEXT NULL                                 | JSON array of model ids — **UI-only**; the resolver never reads this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `models_fetched_at` INTEGER NULL                         | epoch ms                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `verification_status` TEXT NOT NULL DEFAULT `unverified` | `verified` / `unverified` / `error`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `verification_error` TEXT NULL                           | short message                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `verification_at` INTEGER NULL                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `created_at` INTEGER NOT NULL                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `updated_at` INTEGER NOT NULL                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `updated_by` TEXT NOT NULL                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**`llm_admin_roles`** — singleton row (the admin role bindings):

| column                                      | notes                       |
| ------------------------------------------- | --------------------------- |
| `id` INTEGER PK `CHECK(id=1)`               | enforces a single row       |
| `main_provider_id` / `main_model`           | NOT NULL (main is required) |
| `small_provider_id` / `small_model`         | NULLABLE → "inherit main"   |
| `embedding_provider_id` / `embedding_model` | NULLABLE → "inherit main"   |
| `updated_at` / `updated_by`                 |                             |

No hard foreign keys (matches papai's hand-written-SQL migration style);
integrity is enforced in app logic (see §7).

### 3.2 Per-context — encrypted JSON blob (generalized BYOK)

The `byok_llm_credentials` **table is unchanged**
(`context_id` PK, `enabled`, `encrypted_config`, `updated_at`, `updated_by`).
Only the **contents** of `encrypted_config` change from five flat keys to a
versioned JSON shape:

```jsonc
{
  "v": 2,
  "providers": [
    {
      "id": "prov_x",
      "label": "my ollama",
      "providerType": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "…",
      "models": ["llama3", "mistral"],
      "modelsFetchedAt": 1720000000000,
      "verification": { "status": "verified" },
    },
  ],
  "roles": {
    "main": { "providerId": "prov_x", "model": "llama3" },
    "small": null,
    "embedding": null,
  },
}
```

The deserializer is **version-tolerant**: an old flat
`{ llm_apikey, llm_baseurl, main_model, small_model, embedding_model }` blob is
read as one synthetic provider bound to all three roles. No schema migration is
required for BYOK; re-saves via the new UI normalize the blob to `{"v":2,…}`.

### 3.3 Resolver contract change (the ripple)

`EffectiveLlmConfig` — the return of `resolveEffectiveLlmConfig`, consumed by
~13 callsites — changes from **one** apiKey/baseUrl for all roles to
**per-role** resolved bundles, because main/small/embedding may now use
different providers:

```ts
type ResolvedRole = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
  readonly source: 'global' | 'byok'
}

type EffectiveLlmConfig = {
  readonly ok: true
  readonly source: 'global' | 'byok' | 'mixed'
  readonly main: ResolvedRole
  readonly small: ResolvedRole // === main when small is unset
  readonly embedding: ResolvedRole // === main when embedding is unset
}
```

Failure shapes (`LlmConfigMissing` / `LlmConfigError`) are preserved with their
existing fields. Every callsite that read `resolved.llmApiKey` /
`resolved.smallModel` updates to `resolved.main.apiKey` /
`resolved.small.model`. The orchestrator's `buildModel` consumes
`resolved.main`.

## 4. Resolution & data flow

### 4.1 Per-role resolution chain

For each role independently (`main`, `small`, `embedding`),
`resolveEffectiveLlmConfig(configContextId)` walks:

1. **Context blob** has that role bound and the referenced `providerId` exists
   in the blob's `providers` → use context provider creds + model.
   `source = 'byok'`.
2. Else **admin** role binding is set for that role → use admin provider creds
   - model. `source = 'global'`.
3. Role is `small` / `embedding` and still unset → **fall back to the resolved
   `main` bundle** (whatever `main` resolved to, including its source).
4. Role is `main` and unset at both tiers → the whole result is
   `{ ok:false, type:'missing' }` (bot cannot serve the turn).

So a context may run e.g. its own Ollama for `main` while inheriting the
admin's OpenAI `embedding`.

### 4.2 Resolver internals

- Decrypts the context blob **once** (cheap; already happens today) and builds
  a `{ providerId → creds }` map + role table.
- Reads the two admin tables (small; cached in-process like today's
  `system_config` cache).
- Returns the three resolved bundles.
- Updates a cache invalidation hook (mirrors `systemConfigCacheForTesting`) so
  admin edits are visible without restart.

### 4.3 Callsite migration

The ~13 callsites become mechanical:
`resolved.llmApiKey` → `resolved.main.apiKey`,
`resolved.llmBaseUrl` → `resolved.main.baseUrl`,
`resolved.mainModel` → `resolved.main.model`,
`resolved.smallModel` → `resolved.small.model`,
`resolved.embeddingModel` → `resolved.embedding.model`.

Known callsites (to be fully enumerated in the plan): `llm-orchestrator.ts`,
`embeddings.ts`, `web/distill.ts`, `tools/compaction/summarizer.ts`,
`tools/lookup-group-history.ts`, `tools/disclosure/embedding-tool-retriever.ts`,
`long-term-memory/runner.ts`, `long-term-memory/capture.ts`,
`long-term-memory/promotion.ts`, `deferred-prompts/proactive-llm.ts`,
`conversation.ts`.

### 4.4 BYOK semantics change (noted behavior change)

Today BYOK has a deliberate safety rule: **enabled + incomplete → hard error,
no silent fallback to central** (`src/llm-config-resolver.ts`, documented in
`environment.md`). Per-role override + graceful fallback supersede it:

- The per-context **`enabled` toggle** remains as the opt-in / admin-audit
  signal that the personal providers section is active.
- **Unbound roles gracefully fall back** to admin (no "incomplete" error). A
  context with BYOK on but nothing bound inherits admin entirely.
- The only hard-error case becomes an **unreadable encrypted blob** (key
  rotation broke it) → the existing "credentials unreadable, re-enter them"
  reply path.

Rationale: per-role override is inherently "override what you want, inherit the
rest," so the all-or-nothing hard-error cannot coexist with it. This is the
documented consequence of the locked decisions (both tiers + per-role
override). `docs/architecture/environment.md` must be updated to reflect it.

## 5. Model discovery & validation

### 5.1 Where it runs

Discovery is **server-side only** (settings route handlers), never in the
browser — avoids CORS and keeps the apiKey off the client. Uses the existing
`fetchWithoutTimeout`.

### 5.2 Triggers (non-blocking)

- On provider **create/update** where `apiKey` or `baseUrl` changed → fire
  `GET {baseUrl}/models` with `Authorization: Bearer <key>`.
- **Manual refresh** button → `POST …/providers/:id/refresh-models` (admin) /
  equivalent context op → re-fetch on demand.
- **Saves always succeed** regardless of fetch outcome.

### 5.3 Outcomes → stored on the provider row/blob

| result                         | `verification_status` | `models_cache` | `verification_error`    |
| ------------------------------ | --------------------- | -------------- | ----------------------- |
| 200, parseable `{data:[{id}]}` | `verified`            | `[ids…]`       | null                    |
| 401 / 403                      | `unverified`          | unchanged      | "authentication failed" |
| network / parse / other        | `error`               | unchanged      | short message           |

The status pill renders next to each provider (`verified` / `unverified` /
`error`).

### 5.4 TTL & staleness

- `models_fetched_at` is recorded on each successful fetch.
- The cache is a **hint, not a gate**: the model dropdown shows cached ids when
  present and **always** allows manual text entry (covers providers with no
  `/models` endpoint, or a model not yet listed).
- A stale indicator (e.g. ">10 min") nudges toward refresh; nothing
  auto-blocks.

### 5.5 Decoupling from serving

The **resolver never reads `models_cache`**. The resolver only needs each
role's chosen `model` string + provider creds. Model lists exist purely to
populate UI dropdowns, so discovery is fully decoupled from the hot serving
path and can fail without affecting turns.

## 6. Settings UI

### 6.1 Admin side (`/settings` → Admin)

The current `AdminSystemSection` (the five-row KV table) is **retired**.
Replaced by two sections:

**A. Admin → Providers**

- List of admin accounts: label, type pill, masked key (`****1234`),
  `base_url`, verification pill, model count.
- "Add provider" → form: type dropdown (presets `base_url` + label), label,
  apiKey (secret), `base_url` (editable). On save → create + verify + fetch
  models.
- Edit / Delete per row. Delete is guarded: if the provider is bound to `main`,
  require reassigning `main` first.
- Per-row "Refresh models" + a manual model-list editor (for endpoint-less
  providers).

**B. Admin → Models**

- Three role blocks (`main` / `small` / `embedding`).
- Each: provider dropdown (admin providers) → model dropdown (that provider's
  cached models, with free-text fallback). Selecting a different provider
  **clears the model** (models differ per provider).
- `small` / `embedding` show an "Inherit main" option (the null state);
  selecting it leaves them unset → resolver falls back to main.

### 6.2 Personal / Advanced side (`ByokSection`, generalized)

Keeps the existing section shell + the "Use my own credentials" toggle, now
driving a richer body when on:

- **My providers** sub-list: same add/edit/delete form as admin, stored in the
  context blob. Verification pill + refresh here too.
- **Role overrides**: three role blocks like admin, but each has an **"Inherit
  admin"** choice vs "use my provider X / model Y". Per-role override
  granularity: a context may bind only `main` from its pool and leave
  `small` / `embedding` inheriting admin.

### 6.3 Routes (server)

- Admin: `GET/POST /settings/api/admin/providers`, `PATCH/DELETE …/:id`,
  `POST …/:id/refresh-models`; `GET/PUT /settings/api/admin/llm-roles`. All
  `requireAdmin` + CSRF, mirroring the existing `system-access-routes.ts`
  pattern.
- Personal: `GET/PATCH /settings/api/byok` extended — `PATCH` accepts a
  discriminated action:
  `{action:'toggle', enabled}` | `{action:'upsert-provider', provider}` |
  `{action:'delete-provider', id}` | `{action:'set-roles', roles}` |
  `{action:'refresh-models', id}`. Same `resolveContextScope('write')` + CSRF
  as today.
- `/settings/api/admin/system` (old LLM KV) is removed. Its non-LLM children
  (users / groups / open-access) remain; they are re-homed onto a renamed
  admin route or stay co-located — finalized during implementation.

### 6.4 Client wiring

Fetchers (`client/settings/fetchers.ts`) + Zod schemas
(`fetcher-schemas.ts`) are extended; MSW handlers + Storybook stories are
updated for the new sections. `SystemKvRow` is reused where useful;
`ByokSection` is evolved in place rather than forked.

## 7. Integrity & error handling

| scenario                                                            | behavior                                                                                                                       |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `main` unresolvable at both tiers (no admin binding)                | `{ ok:false, type:'missing' }` → orchestrator replies "bot not fully configured" (existing path, re-pointed to the new tables) |
| Context blob **unreadable** (key rotation broke it)                 | `{ ok:false, type:'error', source:'byok' }` → existing "BYOK credentials unreadable, re-enter them" reply                      |
| Provider verify fails (401 / network)                               | non-blocking: `verification_status` set, save succeeds, UI shows pill (§5)                                                     |
| Referenced `providerId` missing from its pool (orphan after delete) | that role treated as **unset** → falls through the chain (admin → main); never throws                                          |
| Delete admin provider bound to `main`                               | rejected by app logic until `main` is reassigned; deleting one bound only to small/embedding nulls those bindings              |
| Model fetch during a turn                                           | never happens — discovery is UI-only; serving reads only creds + the model string                                              |

All caught errors use the repo convention
`error instanceof Error ? error.message : String(error)`; secrets are never
logged.

## 8. Migration & env bootstrap

### 8.1 New migration `067_multi_llm_providers.ts`

Creates the normalized admin tables:

```sql
CREATE TABLE llm_providers ( /* columns from §3.1 */ );
CREATE TABLE llm_admin_roles ( id INTEGER PRIMARY KEY CHECK(id=1), /* … */ );
```

Followed by an **in-process data migration** (runs once, inside the migration
transaction, idempotent):

1. Read legacy keys from `system_config`: `llm_apikey`, `llm_baseurl`,
   `main_model`, `small_model`, `embedding_model`.
2. If `llm_apikey` + `llm_baseurl` + `main_model` are present → insert one
   `llm_providers` row (`provider_type='custom'`, that `base_url`, encrypted
   apiKey) and one `llm_admin_roles` singleton: `main` bound to it;
   `small` / `embedding` bound too **iff** those keys existed (else left null
   → inherit main).
3. Delete the five legacy LLM rows from `system_config` (single source of
   truth).

> **The `system_config` table itself persists.** It also stores non-LLM keys
> accessed directly via the drizzle `systemConfig` table (not through
> `system-config.ts`): `notify_token` (`src/notify-token.ts`),
> `stats_anonymity_salt` (`src/stats/hashing.ts`),
> `mattermost_action_signing_secret` (`src/chat/mattermost/action-secret.ts`),
> and plugin admin config keys (`src/plugins/store.ts`). Only the five LLM rows
> migrate out, and only the LLM-typed accessors in `src/system-config.ts`
> (`primeSystemConfigCache`'s env-seeding of the five, `isSystemConfigComplete`,
> `missingSystemConfigKeys`, `maskSystemConfigValue`, `listSystemConfigEntries`,
> the `SystemConfigKey` type) are removed/repointed.

`primeSystemConfigCache` / `isSystemConfigComplete` /
`missingSystemConfigKeys` (used by the orchestrator's "bot misconfigured"
path) are re-pointed at the new admin tables.

### 8.2 BYOK blob — no schema migration

The `byok_llm_credentials` table is unchanged. Only the blob deserializer gains
version tolerance (§3.2): an old flat blob is read as the new shape in memory;
re-saves normalize it. No backfill, no downtime.

### 8.3 Env bootstrap rework (`seedSystemConfigFromEnv`)

Today this seeds the five keys from `LLM_API_KEY` / `LLM_BASE_URL` /
`MAIN_MODEL` / `SMALL_MODEL` / `EMBEDDING_MODEL` on first start. Reworked to
seed the **new** shape when no admin provider exists yet:

- On first start (empty `llm_providers`): if those env vars are set → insert a
  default provider row (`provider_type='custom'`) + bind `main` (+ small /
  embedding if their env vars are present), exactly mirroring what the DB
  migration produces.
- A fresh deploy and a migrated DB converge on the same shape.

### 8.4 No legacy read path

There is no dual-read fallback (single source of truth), so no legacy code path
to maintain. The orchestrator's `resolveLlmForTurn` "bot misconfigured" reply
reads from `llm_admin_roles` (`main` bound + provider exists) instead of the
old `missingSystemConfigKeys`.

## 9. Testing

Follows `tests/CLAUDE.md` — DI-first, `tests/utils/test-helpers.ts`.

- **Resolver** — the matrix: per-role context→admin→main-fallback; mixed
  sources (context main + admin embedding); version-tolerant old-blob read;
  unreadable blob → error; empty-everything → missing.
- **Provider store** — CRUD, apiKey encrypt/decrypt round-trip,
  delete-clears-bindings integrity.
- **Model discovery** — mocked `fetch`: 200 → `verified` + cache; 401 →
  `unverified`; network → `error`; saves always succeed.
- **Migration `067`** — old `system_config` five keys → one provider + role
  singleton (with and without optional small/embedding); idempotent re-run.
- **Routes** — admin provider CRUD + role PUT (auth / admin / CSRF scoping);
  BYOK `PATCH` discriminated actions (context write scope); `system` LLM route
  removal.
- **Env bootstrap** — fresh DB + env vars seeds the new shape; already-populated
  DB is untouched.
- **Client** — Providers list, Models role dropdowns (provider switch clears
  model), BYOK per-role "Inherit admin"; MSW handlers + Storybook stories
  updated.

`bun test` (parallel), `bun run typecheck`, `bun run lint` gate the work per
the write-hook pipeline.

## 10. Suggested implementation order

1. Data model: migration `067`, schemas, provider/role stores (admin +
   version-tolerant BYOK blob).
2. Resolver: new per-role `EffectiveLlmConfig` + resolution chain; migrate all
   callsites.
3. Model discovery: server-side fetch + cache + verification status.
4. Settings routes: admin provider/role CRUD; extended BYOK `PATCH` actions.
5. Settings UI: admin Providers + Models sections; generalized personal BYOK.
6. Migration + env bootstrap rework; remove `system` LLM route; update
   `environment.md`.

Each step is independently testable and lands behind the one contract change
in step 2.
