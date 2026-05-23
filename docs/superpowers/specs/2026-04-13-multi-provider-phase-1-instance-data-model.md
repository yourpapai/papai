<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Multi-Provider Router — Phase 1: Instance Data Model & Bootstrap

**Date:** 2026-04-13
**Status:** Approved
**Parent:** [`2026-04-13-multi-provider-router-design.md`](./2026-04-13-multi-provider-router-design.md)
**Ships independently:** Yes — DB tables, encryption helper, and env-driven bootstrap can land without changing runtime behavior.

## Summary

Add the DB tables that back every later phase, an AES-256-GCM helper that encrypts instance configs at rest, and a one-shot env-vars-to-DB bootstrap that seeds defaults on a brand-new database. After this phase, the DB is the source of truth for chat and task provider instance configuration; env vars are read only when the relevant instance tables are empty.

## Requirements

- New tables: `platform_instances`, `task_instances`, `context_settings`, `admins`
- Existing tables (`user_config`, `users`, `conversation_history`, memos, recurring tasks, plugin tables) are untouched in shape, only the `users` table gains a `platform_instance_id` column
- Instance config blobs are encrypted at rest with a key derived from `INSTANCE_CONFIG_KEY`
- Bootstrap is idempotent: re-running with the same DB never creates duplicate rows
- Bootstrap is silent when env vars are absent and the DB is empty (the bot logs a warning and stays idle)

## Section 1: Data Model

### `platform_instances`

| Column       | Type        | Description                                             |
| ------------ | ----------- | ------------------------------------------------------- |
| `id`         | TEXT PK     | Unique instance ID (e.g., `telegram-prod`, `mm-team-a`) |
| `type`       | TEXT        | Provider type: `telegram`, `mattermost`, `discord`      |
| `config`     | TEXT (JSON) | AES-256-GCM-encrypted provider-specific config          |
| `status`     | TEXT        | `pending` / `active` / `stopped`                        |
| `created_at` | TEXT        | ISO timestamp                                           |

### `task_instances`

| Column       | Type        | Description                                          |
| ------------ | ----------- | ---------------------------------------------------- |
| `id`         | TEXT PK     | Unique instance ID (e.g., `kaneo-prod`, `yt-team-b`) |
| `type`       | TEXT        | Provider type: `kaneo`, `youtrack`                   |
| `config`     | TEXT (JSON) | AES-256-GCM-encrypted instance config                |
| `status`     | TEXT        | `pending` / `active` / `stopped`                     |
| `created_at` | TEXT        | ISO timestamp                                        |

### `context_settings`

| Column                 | Type    | Description                                                                        |
| ---------------------- | ------- | ---------------------------------------------------------------------------------- |
| `context_id`           | TEXT PK | Storage context ID (userId in DMs, groupId in groups)                              |
| `task_instance_id`     | TEXT    | References `task_instances.id`                                                     |
| `platform_instance_id` | TEXT    | Which chat instance owns outbound delivery for this context (required for routing) |

Indexed on `task_instance_id` and `platform_instance_id` for scheduler/poller scans.

### `admins`

| Column                 | Type | Description                                                               |
| ---------------------- | ---- | ------------------------------------------------------------------------- |
| `user_id`              | TEXT | Platform-scoped user ID                                                   |
| `platform_instance_id` | TEXT | `'__super__'` = super-admin, otherwise = platform admin for that instance |
| `created_at`           | TEXT | ISO timestamp                                                             |

Composite PK: `(user_id, platform_instance_id)`. `'__super__'` is a reserved instance ID.

### `users` schema change

Add a nullable `platform_instance_id` column. Bootstrap populates it for `ADMIN_USER_ID` with the bootstrapped platform instance ID; later phases populate it on every new `/user add` flow.

### What stays unchanged

- `user_config` — keyed by storage `contextId`
- `conversation_history`, `memory_summary`, `memory_facts`, recurring tasks, deferred prompts
- All plugin tables (`plugin_admin_state`, `plugin_context_state`, `plugin_kv`, `plugin_runtime_events`)

## Section 2: Encryption

### Key resolution

- `INSTANCE_CONFIG_KEY` env var holds a 32-byte AES key (64 hex chars). Anything else is hashed with SHA-256 to produce the actual key.
- If the env var is missing, a derived host-local key is used (`SHA-256("papai:instance-config:fallback")`) and a one-shot `WARN` is logged at startup.
- The derived path is supported for development; production deployments must set `INSTANCE_CONFIG_KEY`.

### Format

- Algorithm: AES-256-GCM, 12-byte random IV, 16-byte auth tag
- On-disk encoding: `base64(IV ‖ TAG ‖ CIPHERTEXT)`
- Plaintext: `Record<string, string>` serialized as JSON
- Tamper detection: GCM auth tag mismatch throws a clear error from `decryptInstanceConfig`

### Masking helper

`maskConfig(plain)` masks keys whose names match `/token|key|secret|password|cookie/iu`. Used by the dashboard API in Phase 4 to ensure secrets never leave the process boundary in cleartext.

## Section 3: Bootstrap

### First-run behavior (empty DB)

1. Read `CHAT_PROVIDER`, `TASK_PROVIDER`, `ADMIN_USER_ID`, and provider-specific env vars (`TELEGRAM_BOT_TOKEN` / `MATTERMOST_URL` + `MATTERMOST_BOT_TOKEN` / `DISCORD_BOT_TOKEN`, `KANEO_CLIENT_URL` / `YOUTRACK_URL`)
2. Insert `platform_instances` row `{id: "<type>-default", type, config, status: 'active'}`
3. Insert `task_instances` row `{id: "<type>-default", type, config, status: 'active'}`
4. Insert two `admins` rows for `ADMIN_USER_ID`: super-admin (`__super__`) and platform admin for the bootstrapped platform instance
5. Log `Bootstrapped from environment variables. DB is now the source of truth.`

### Non-empty DB

- Env vars are ignored. The bot loads instances from the DB.
- If env vars are still set, log a one-shot notice that they're being ignored.

### Empty DB + no env vars

- Bootstrap returns `{bootstrapped: false, reason: 'no-env'}`
- The bot is allowed to start but logs `No instances configured. Use the dashboard to add platform and task instances.`
- Incoming messages reply with a "not configured" message until instances exist

### Idempotency

Bootstrap reads `platform_instances` and `task_instances` row counts before doing anything. If either is non-zero, it returns `{bootstrapped: false, reason: 'already-bootstrapped'}`. Existing `user_config` rows are never touched.

## Section 4: Error Handling

- Decryption failure → throw with a clear `Encrypted payload too short` or GCM auth-tag error; never silently fall back
- Missing required env vars during bootstrap → log the list of missing names and abort the bootstrap with `partial-env`
- DB write failures bubble up; bootstrap is wrapped in a transaction so partial writes are impossible

## Section 5: Testing Strategy

- **`tests/db/migrations/040_platform_instances.test.ts`** — schema shape, idempotency, `users.platform_instance_id` add
- **`tests/instances/encryption.test.ts`** — round-trip, IV nondeterminism, tamper detection, derived-key fallback
- **`tests/instances/platform-store.test.ts` / `task-store.test.ts`** — CRUD coverage
- **`tests/instances/context-store.test.ts`** — assignment, listing, indexed queries
- **`tests/instances/admin-store.test.ts`** — super vs platform, `isAdmin` union
- **`tests/instances/bootstrap.test.ts`** — env→DB seeding, idempotency, partial-env, empty-env

## Section 6: Out of Scope (deferred to later phases)

- ChatRouter / multi-chat-instance startup → Phase 3
- TaskProviderResolver → Phase 2
- Dashboard surfaces → Phase 4
- `/setup` / `/config` per-context dynamic keys → Phase 2
- Plugin-capability re-evaluation → Phase 5
