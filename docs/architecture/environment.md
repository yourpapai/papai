<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Required Environment Variables

> Referenced from `CLAUDE.md`. Startup, credential, bootstrap, and runtime env configuration.

**Required at startup:** `ADMIN_USER_ID` — stored as the initial authorized `platform_user_id`, so it must match the user ID string the active adapter sees (numeric for Telegram; the platform user ID string, not a display name, for Mattermost/Discord/Kontur Talk).

**Central LLM credentials** live in the admin-owned `system_config` SQLite table, seeded once from env on first start and read from the DB after. If any of the three required entries is missing at runtime, the bot logs `WARN` and replies "the bot is not fully configured" until set via env+restart or the settings admin "System" section (`POST /settings/api/admin/system`):

- `LLM_API_KEY` → `llm_apikey`, `LLM_BASE_URL` → `llm_baseurl`, `MAIN_MODEL` → `main_model`
- `SMALL_MODEL` — optional; callsites fall back to `main_model`
- `EMBEDDING_MODEL` — optional; memo semantic search degrades to keyword-only

**BYOK LLM credentials (self-serve, per config-context):** a context may override the central creds with its own, stored encrypted in `byok_llm_credentials` (keyed by config-context id — per-user for DMs, group-shared for groups; the `enabled` boolean is the opt-in flag, `encryptedConfig` holds the 5 keys above). Opt-in is **self-serve via a toggle** in the settings-UI **BYOK LLM** section ("Personal"/Advanced), authorized by the standard context-write scope — DM owner for personal contexts, group admins for groups (`resolveContextScope(...,'write',...)`). The route is `PATCH /settings/api/byok` accepting a discriminated `{action:'enable'|'disable'}` (toggle) or `{values}` (credential save; rejected while disabled); both schemas are strict so an ambiguous body 422s. `resolveEffectiveLlmConfig` (`src/llm-config-resolver.ts`) picks BYOK when `enabled && complete`, **hard-errors** when `enabled && !complete` (no silent fallback to central), else uses central creds; disabling preserves stored credentials for re-enable. The admin **BYOK LLM** section (`/admin`) is a **read-only** audit overview — `GET /settings/api/admin/byok` only; there is no admin enable/disable gate (`PATCH` → 405). Store: `src/byok-llm/store.ts`.

**`INSTANCE_CONFIG_KEY`** — 32-byte AES-256-GCM key (64 hex chars) encrypting `platform_instances.config` and `task_instances.config` at rest. Non-hex values are treated as passphrases (scrypt-derived). When unset, a host-local fallback key is used and a one-shot `WARN` logs at startup; **production must set this explicitly**.

**First-run env bootstrap (only when the instance tables are empty):**

- `CHAT_PROVIDER` (`telegram`|`mattermost`|`discord`|`kontur-talk`), plus provider creds: Telegram `TELEGRAM_BOT_TOKEN`; Mattermost `MATTERMOST_URL`+`MATTERMOST_BOT_TOKEN`; Discord `DISCORD_BOT_TOKEN`; Kontur Talk `KONTUR_TALK_JWT_TOKEN`.
- After bootstrap, platform selection comes from `context_settings`, base config from `platform_instances`, per-context creds from `user_config`.
- **Task instances are not env-bootstrapped.** Create them in the settings admin "Instances" section (`/settings/api/admin/task-instances`), then approve `task-provider-kaneo`/`task-provider-youtrack` in the settings UI admin Plugins area (super admin) after deploying. Removed bootstrap vars: `TASK_PROVIDER`, `YOUTRACK_URL`, and the Kaneo URLs below.

**`SETTINGS_PUBLIC_BASE_URL`** — **required** external base URL (e.g. `https://bot.example.com`); builds single-use settings links. The settings session cookie adds `Secure` only when the request is HTTPS (`X-Forwarded-Proto: https` behind a proxy, else the request URL scheme) — over plain HTTP it is omitted so the browser keeps the cookie. Unset → `/config` refuses; no in-chat fallback.

**Optional runtime flags:** `DEBUG_SERVER`, `DEBUG_HOSTNAME`, `DEBUG_PORT`, `LOG_LEVEL`. `KANEO_CLIENT_URL`/`KANEO_INTERNAL_URL` are no longer bootstrap vars but are still read at runtime by the Kaneo provisioning route (`src/debug/settings/provision-routes.ts`); `KANEO_INTERNAL_URL` also carries internal bot-to-Kaneo traffic.

**`NOTIFY_TOKEN`** — optional bearer token guarding the proactive-notify endpoint (`POST /api/notify`, `src/debug/notify-route.ts`). Lazily seeded once into the `notify_token` `system_config` key on first read (`src/notify-token.ts`), then cached for the process lifetime, so **rotating it requires a restart**. When unset, `/api/notify` returns `503`. Consumed by an external ACP control service to push coding-session milestones into chat.

**File attachments (S3-compatible):** required to receive/persist/attach files. `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (required); `S3_ENDPOINT` (required for non-AWS: MinIO/R2/B2), `S3_REGION`, `S3_PREFIX`, `S3_FORCE_PATH_STYLE=true` for MinIO (optional).

**Dashboard (`DEBUG_SERVER=true`):** the dashboard requires a session cookie minted via the bot — DM `/dashboard` for a one-time sign-in link. `DASHBOARD_BASE_URL` (default `SETTINGS_PUBLIC_BASE_URL`, else `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}`), `DASHBOARD_SESSION_TTL_SECONDS` (default `28800`), `DASHBOARD_CLAIM_TTL_SECONDS` (default `300`). See `docs/deployment/dashboard-access.md`.

**`MAGI_TRANSCRIPT_BASE_URL`** — **not** a papai env var. It configures the external **magi** control service with papai's public origin, which magi uses to build the `transcriptUrl` it mints and returns per coding session (see `docs/architecture/coding-sessions.md` § Transcript viewer). papai's `/t/*` viewer routes need **no** new env var of their own — the proxy reads magi's base URL and bearer token from the acp plugin's admin config (`magi_base_url`/`magi_token` via `getPluginAdminConfig`), the same config already used for outbound ACP calls.

**Per-user runtime config keys** (managed in the settings UI): `timezone`; `mcp_endpoints` (JSON array of external MCP endpoints `{ id, url (https only), label?, headers?, enabled, toolFilter? }`, registered in `src/config-keys.ts`); Kaneo `plugin:task-provider-kaneo:provider:{credential,workspaceId}`; YouTrack `plugin:task-provider-youtrack:provider:token`; AI output visibility `ai_tool_visibility` / `ai_reasoning_visibility` (`on`/`off`, default `off`) and `ai_output_detail_level` (`sanitized`/`raw`, default `sanitized`) — surfaced as enum `ConfigField`s (`kind: 'ai-output'`) in the settings UI "AI output" section, read by `getAiOutputSettings` (`src/ai-output-settings.ts`).
