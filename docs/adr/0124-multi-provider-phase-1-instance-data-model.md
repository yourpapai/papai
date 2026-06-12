<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0124: Multi-Provider Router — Phase 1: Instance Data Model & Bootstrap

## Status

Implemented

## Date

2026-04-13 – 2026-05-23

## Context

papai was designed around a single chat provider and a single task provider
initialized from environment variables at startup. There was no DB-backed model
for provider instances, no way to store per-instance configuration securely,
and no path toward running multiple provider instances simultaneously.

The multi-provider router design
(`docs/archive/2026-04-13-multi-provider-phase-1-instance-data-model.md`)
defined a five-phase roadmap. Phase 1 was scoped to land only the data model,
encryption, and bootstrap — intentionally deferring runtime routing (Phases 2–5)
so that the DB tables could ship without changing existing single-instance
behavior.

The implementation plan
(`docs/archive/2026-05-23-multi-provider-phase-1-instance-data-model-plan.md`)
delivered 12 tasks across 11 new files and 3 modified files, verified with
full test coverage before merging.

## Decision Drivers

- **DB as source of truth**: After bootstrap, env vars must not be re-read.
  The DB owns all instance configuration; env vars are a one-shot seed.
- **Encryption at rest**: Provider tokens and API keys stored in the DB must
  never appear in cleartext on disk.
- **Idempotent bootstrap**: Re-running with the same env and DB must be a
  no-op. A non-empty DB signals "already bootstrapped" and env vars are
  ignored.
- **No regression**: Single-instance deployments must work unchanged after
  migration 040. No existing runtime path reads from the new tables yet.
- **Forward compatibility**: The schema must support multi-instance routing
  (Phases 2–5) without a second migration for the same tables.

## Considered Options

### Option A: Env-only configuration (status quo)

Continue reading all provider configuration from environment variables at
every startup. No DB tables, no encryption, no instance model.

- **Pros**: Zero migration risk; no encryption key management.
- **Cons**: Cannot support multiple provider instances; secrets in env are
  exposed to process inspection; no admin UI for configuration.

### Option B: DB-backed instance model with env bootstrap (chosen)

Add four DB tables (`platform_instances`, `task_instances`,
`context_settings`, `admins`), AES-256-GCM encryption for config blobs,
and a one-shot env→DB bootstrap. After migration 040, the DB is the
source of truth; env vars are only consulted when the instance tables are
empty.

- **Pros**: Enables multi-instance routing in later phases; secrets
  encrypted at rest; admin UI can manage instances; existing single-instance
  deployments bootstrap transparently.
- **Cons**: Introduces `INSTANCE_CONFIG_KEY` key-management responsibility;
  lost encryption key means unreadable instance rows (degraded, not fatal).

### Option C: Plaintext config in DB

Store instance configuration as unencrypted JSON in the `config` column.

- **Pros**: Simpler implementation; no key management.
- **Cons**: Provider tokens and API keys would be readable from the SQLite
  file on disk; violates the same security posture as `system_config`
  (which already masks API keys server-side).

### Option D: Per-column secret fields

Split config into individual columns (e.g., `token`, `url`, `api_key`)
with per-column encryption.

- **Pros**: Fine-grained access control; selective masking at the SQL level.
- **Cons**: Schema must change for every new provider type; encryption
  overhead multiplied by column count; rigid and not extensible.

## Decision

**Option B** for the instance data model, with the following subsidiary
decisions:

| Topic                | Decision                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tables               | `platform_instances`, `task_instances`, `context_settings`, `admins`. Migration `040_platform_instances`.                                                    |
| `users` change       | Add nullable `platform_instance_id` column. Bootstrap backfills `ADMIN_USER_ID`.                                                                             |
| Encryption algorithm | AES-256-GCM, 12-byte random IV, 16-byte auth tag. On-disk: `base64(IV ‖ TAG ‖ CIPHERTEXT)`.                                                                  |
| Key resolution       | `INSTANCE_CONFIG_KEY` env var: 64-hex chars used verbatim; non-hex strings SHA-256-hashed; unset → derived host-local fallback + one-shot `WARN`.            |
| Config type          | `Record<string, string>` serialized as JSON. Opaque to the schema; provider-specific keys live inside the encrypted blob.                                    |
| Masking              | `maskConfig()` replaces values whose keys match `/token\|key\|secret\|password\|cookie/iu` with `***`. Used by the dashboard API (Phase 4).                  |
| Bootstrap            | Idempotent: reads row counts first; non-zero → `already-bootstrapped`. Empty DB + complete env → seeds `<type>-default` instances + two admin rows.          |
| Partial env          | Missing required vars → `partial-env` result with the list of missing names. No rows inserted.                                                               |
| Empty env + empty DB | Returns `no-env`. Bot starts idle, logs a warning.                                                                                                           |
| Unreadable rows      | Decryption failure does not abort startup. Unreadable encrypted rows are reported in an `unreadable` array and skipped with warnings (graceful degradation). |
| Deferred             | `ChatRouter` multi-startup (Phase 3), `TaskProviderResolver` (Phase 2), dashboard surfaces (Phase 4), plugin re-evaluation (Phase 5).                        |

## Consequences

### Positive

- The DB is the single source of truth for provider configuration after first
  boot, enabling multi-instance routing without env-var sprawl.
- Secrets are encrypted at rest with AES-256-GCM; tamper detection is
  built-in (auth tag mismatch throws on decrypt).
- Bootstrap is transparent for existing deployments: env vars seed the DB
  once, then are never consulted again.
- The `admins` table with the `__super__` sentinel enables platform-scoped
  admin checks without a separate super-admin flag column.
- `maskConfig()` prevents secrets from leaving the process boundary in
  cleartext, ready for Phase 4 dashboard routes.

### Negative

- `INSTANCE_CONFIG_KEY` is a new required-attention env var for production;
  losing the key renders all instance config rows unreadable (the bot degrades
  gracefully but cannot decrypt credentials).
- The encrypted blob is opaque to SQL queries — cannot index or filter on
  config contents.
- Adding a new provider type requires updating `InstanceConfig` construction
  in bootstrap and the provider registry in later phases.

### Risks

- If `INSTANCE_CONFIG_KEY` is changed after bootstrap, all existing instance
  rows become unreadable. Mitigation: document key-rotation as a manual
  re-encryption operation; log a one-shot warning when the fallback key is
  in use.
- The `no-env` state allows the bot to start with zero instances, which means
  all incoming messages get "not configured" replies. Mitigation: the admin
  dashboard (Phase 4) will allow instance creation without env vars.

## Implementation Notes

Key modules (`src/instances/`):

| File                | Role                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `types.ts`          | `InstanceConfig`, `PlatformInstance`, `TaskInstance`, `ContextSettings`, `AdminRecord`, `BootstrapResult` |
| `encryption.ts`     | `resolveInstanceConfigKey`, `encryptInstanceConfig`, `decryptInstanceConfig`, `maskConfig`                |
| `platform-store.ts` | CRUD for `platform_instances` with transparent encrypt/decrypt                                            |
| `task-store.ts`     | CRUD for `task_instances` with transparent encrypt/decrypt                                                |
| `context-store.ts`  | Upsert and indexed queries on `context_settings`                                                          |
| `admin-store.ts`    | `addAdmin`, `removeAdmin`, `isAdmin` (super-admin union), `listAdminsForPlatform`                         |
| `bootstrap.ts`      | `bootstrapInstancesFromEnv` — one-shot env→DB seed with idempotency guard                                 |

Database: migration `040_platform_instances` creates the four tables, two
indexes on `context_settings`, and adds `users.platform_instance_id`.

Schema: `src/db/instance-schema.ts` declares Drizzle table objects;
re-exported from `src/db/schema.ts`.

Startup wiring: `src/index.ts` calls `bootstrapInstancesFromEnv()` after
`initDb()` and `seedSystemConfigFromEnv()`.

## Related Decisions

- ADR-0123: Trusted-Local Plugin System — plugin capability evaluation
  will need to resolve per-context task instances (Phase 5).
- ADR-0009: Multi-Provider Task Tracker Support — the provider type model
  that `task_instances.type` enumerates.
- ADR-0014: Multi-Chat Provider Abstraction — the chat provider model that
  `platform_instances.type` enumerates.
