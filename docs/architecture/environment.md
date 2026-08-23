<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Required Environment Variables

> Referenced from `CLAUDE.md`. Startup, credential, bootstrap, and runtime env configuration.

**Required at startup:** `ADMIN_USER_ID` — stored as the initial authorized `platform_user_id`, so it must match the user ID string the active adapter sees (numeric for Telegram; the platform user ID string, not a display name, for Mattermost/Discord/Kontur Talk).

**Central LLM credentials** live in the admin-owned `llm_providers` + `llm_admin_roles` SQLite tables, seeded once from env on first start and managed via the settings admin "Providers" and "LLM Roles" sections (`/settings/api/admin/providers`, `/settings/api/admin/llm-roles`). On first start, if no admin role binding exists and all three required env vars are present, a default provider is created and bound to `main` (and `small`/`embedding` if their env vars are present); otherwise the bot logs `WARN` and replies "the bot is not fully configured" until a provider is configured:

- `LLM_API_KEY`, `LLM_BASE_URL`, `MAIN_MODEL` — required for env-seeded bootstrap
- `SMALL_MODEL` — optional; callsites fall back to `main_model`
- `EMBEDDING_MODEL` — optional; memo semantic search degrades to keyword-only

**BYOK LLM credentials (self-serve, per config-context):** a context may override the central creds with its own, stored encrypted in `byok_llm_credentials` (keyed by config-context id — per-user for DMs, group-shared for groups; the `enabled` boolean is the opt-in flag, `encryptedConfig` holds provider + role bindings). Opt-in is **self-serve via a toggle** in the settings-UI **BYOK LLM** section ("Personal"/Advanced), authorized by the standard context-write scope — DM owner for personal contexts, group admins for groups (`resolveContextScope(...,'write',...)`). The route is `PATCH /settings/api/byok` accepting a discriminated `{action:'enable'|'disable'}` (toggle) or `{values}` (credential save; rejected while disabled); both schemas are strict so an ambiguous body 422s. `resolveLlmConfig` (`src/llm-providers/resolver.ts`) picks BYOK per-role when a BYOK provider+model is configured for that role, **gracefully falls back** to the admin (central) provider+model when BYOK is enabled but a role is unbound, and uses central creds when BYOK is disabled; disabling preserves stored credentials for re-enable. The admin **BYOK LLM** section (`/admin`) is a **read-only** audit overview — `GET /settings/api/admin/byok` only; there is no admin enable/disable gate (`PATCH` → 405). Store: `src/byok-llm/store.ts`.

**`INSTANCE_CONFIG_KEY`** — 32-byte AES-256-GCM key (64 hex chars) encrypting `platform_instances.config` and `task_instances.config` at rest. Non-hex values are treated as passphrases (scrypt-derived). When unset, a host-local fallback key is used and a one-shot `WARN` logs at startup; **production must set this explicitly**.

**First-run env bootstrap (only when the instance tables are empty):**

- `CHAT_PROVIDER` (`telegram`|`mattermost`|`discord`|`kontur-talk`), plus provider creds: Telegram `TELEGRAM_BOT_TOKEN`; Mattermost `MATTERMOST_URL`+`MATTERMOST_BOT_TOKEN`; Discord `DISCORD_BOT_TOKEN`; Kontur Talk `KONTUR_TALK_JWT_TOKEN`.
- After bootstrap, platform selection comes from `context_settings`, base config from `platform_instances`, per-context creds from `user_config`.
- **Task instances are not env-bootstrapped.** Create them in the settings admin "Instances" section (`/settings/api/admin/task-instances`), then approve `task-provider-kaneo`/`task-provider-youtrack`/`task-provider-github` in the settings UI admin Plugins area (super admin) after deploying. Removed bootstrap vars: `TASK_PROVIDER`, `YOUTRACK_URL`, and the Kaneo URLs below.

**`SETTINGS_PUBLIC_BASE_URL`** — **required** external base URL (e.g. `https://bot.example.com`); builds single-use settings links. The settings session cookie adds `Secure` only when the request is HTTPS (`X-Forwarded-Proto: https` behind a proxy, else the request URL scheme) — over plain HTTP it is omitted so the browser keeps the cookie. Unset → `/config` refuses; no in-chat fallback. It also gates **exposing a plugin as an MCP server**: `listEnabledInternalMcpServers` (`src/coding-credentials/mcp-plugin-servers.ts`) derives each `/mcp/plugin/<id>` upstream URL from it and returns no servers at all when it's unset. When magi is the coding-session sandbox, the operator must also admit papai's public-origin host in magi's geofront egress ceiling (`[egress.policy.ceiling]` in `org.toml`) — same requirement as any other external MCP upstream (see `docs/architecture/coding-sessions.md`).

**`MCP_SERVER_SIGNING_SECRET`** — optional; overrides the default signing key for plugin-MCP binding tokens (`src/mcp-server/token.ts`), which otherwise defaults to a domain-separated HMAC of `INSTANCE_CONFIG_KEY`. Set it to rotate plugin-MCP tokens independently of the instance key. Rotating either value invalidates all outstanding plugin-MCP tokens — this is the only revocation mechanism; tokens are otherwise valid for their full 30-day TTL.

**Optional runtime flags:** `DEBUG_SERVER`, `DEBUG_HOSTNAME`, `DEBUG_PORT`, `LOG_LEVEL`. `KANEO_CLIENT_URL`/`KANEO_INTERNAL_URL` are no longer bootstrap vars but are still read at runtime by the Kaneo provisioning route (`src/debug/settings/provision-routes.ts`); `KANEO_INTERNAL_URL` also carries internal bot-to-Kaneo traffic.

**`NOTIFY_TOKEN`** — optional bearer token guarding the proactive-notify endpoint (`POST /api/notify`, `src/debug/notify-route.ts`). Lazily seeded once into the `notify_token` `system_config` key on first read (`src/notify-token.ts`), then cached for the process lifetime, so **rotating it requires a restart**. When unset, `/api/notify` returns `503`. Consumed by an external ACP control service to push coding-session milestones into chat.

**Analytics HMAC keyrings (required only for the pseudonymous longitudinal lane):**

- `ANALYTICS_HMAC_KEYRING` — product-analytics pseudonym keyring. Format: `v1:<64-hex-chars>[;v2:<64-hex-chars>...]`. The active key is always `v1`; additional semicolon-separated versions are retained for rekeying. Keys must be at least 32 bytes (64 hex characters). Example redacted value:
  `ANALYTICS_HMAC_KEYRING=v1:000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
- `ANALYTICS_GOVERNANCE_HMAC_KEYRING` — separate operational keyring for collection-eligibility refs and consent/withdrawal fences. Same format.

Both keyrings are parsed into typed states and are never logged or echoed. Aggregate-local mode (the default shipping tier) needs no HMAC keyring.

**Analytics runtime/governance env** (operator flows in `docs/operations/analytics-runbook.md`):

- `ANALYTICS_KILL_SWITCH` — deployment-level kill switch. When set to `1`/`true`/`on` (trimmed, case-insensitive), `resolveEffectiveLanes` (`src/analytics/governance/policy-store.ts`) forces every lane off regardless of the stored `analytics_policy` row: local mode resolves to `off` and both external lanes disable. Unset or any other value is inactive. No migration or policy write is needed, but a running process re-reads it at each lanes resolution — keep it set for Stage A and reach for it first in incident response (`docs/operations/analytics-incident-runbook.md`).
- `ANALYTICS_SNAPSHOT_DIR` — absolute directory holding published Metabase snapshot files (`<snapshotId>.db`). The rekey CLI's BI coordination requires it; without it the SnapshotConsumerCoordinator stays fail-closed and any coordinator action throws. Snapshot files themselves are built via `scripts/analytics-snapshot.ts --output <abs path>`.
- `ANALYTICS_SNAPSHOT_PATH` — absolute file path of the runtime-served snapshot. The scheduler's hourly snapshot job (`src/analytics/jobs/register-handlers.ts`) stages a fresh curated SQLite at this path and promotes it to published; unset, the job no-ops and no snapshot is ever published (report freshness reads `none`). The deploy workflow writes `/data/analytics-snapshot.db` (inside the `papai-data` volume). Distinct from `ANALYTICS_SNAPSHOT_DIR`: this is the single live file the runtime serves; `…_DIR` is the rekey CLI's per-snapshot-id directory layout.
- `ANALYTICS_BACKFILL_APPROVED_AT_MS` — operator approval timestamp (ms since epoch), required only when `analytics_policy.lawful_basis_mode = 'legitimate_interest'`: the backfill CLI refuses with `approval_required` when it is missing/invalid and otherwise uses it as the policy cutoff. In consent mode the cutoff derives from `policy_effective_at_ms` instead.

**File attachments (S3-compatible):** required to receive/persist/attach files. `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (required); `S3_ENDPOINT` (required for non-AWS: MinIO/R2/B2), `S3_REGION`, `S3_PREFIX`, `S3_FORCE_PATH_STYLE=true` for MinIO (optional).

**Dashboard (`DEBUG_SERVER=true`):** the dashboard requires a session cookie minted via the bot — DM `/dashboard` for a one-time sign-in link. `DASHBOARD_BASE_URL` (default `SETTINGS_PUBLIC_BASE_URL`, else `http://{DEBUG_HOSTNAME}:{DEBUG_PORT}`), `DASHBOARD_SESSION_TTL_SECONDS` (default `28800`), `DASHBOARD_CLAIM_TTL_SECONDS` (default `300`).

**`MAGI_TRANSCRIPT_BASE_URL`** — **not** a papai env var. It configures the external **magi** control service with papai's public origin, which magi uses to build the `transcriptUrl` it mints and returns per coding session (see `docs/architecture/coding-sessions.md` § Transcript viewer). papai's `/t/*` viewer routes need **no** new env var of their own — the proxy reads magi's base URL and bearer token from the acp plugin's admin config (`magi_base_url`/`magi_token` via `getPluginAdminConfig`), the same config already used for outbound ACP calls.

**Per-user runtime config keys** (managed in the settings UI): `timezone`; `language` (`en`|`ru`, default `en` — select field in the Profile section; resolves the locale for all user-facing framework text via `getContextLanguage`, `src/utils/config-language.ts`, and gates the first-interaction language picker; the internal `language_prompted` key is set by the picker but never surfaced as a field); `mcp_endpoints` (JSON array of external MCP endpoints `{ id, url (https only), label?, headers?, enabled, toolFilter? }`, registered in `src/config-keys.ts`); Kaneo `plugin:task-provider-kaneo:provider:{credential,workspaceId}`; YouTrack `plugin:task-provider-youtrack:provider:token`; GitHub `plugin:task-provider-github:provider:token` (PAT, sensitive); AI output visibility `ai_tool_visibility` / `ai_reasoning_visibility` (`on`/`off`, default `off`) and `ai_output_detail_level` (`sanitized`/`raw`, default `sanitized`) — surfaced as enum `ConfigField`s (`kind: 'ai-output'`) in the settings UI "AI output" section, read by `getAiOutputSettings` (`src/ai-output-settings.ts`).

**Story-test harness (developer/CI only, never read by the bot):** `PAPAI_STORY_DEPENDENCY_CACHE_ROOT` (default `~/.cache/papai-story-dependencies`) — root of the sealed, lock-keyed dependency cache bind-mounted into the story sandbox; `PAPAI_STORY_DEPENDENCY_CACHE_KEEP` (positive integer, default `3`; invalid values fall back to `3`) — how many newest cache entries survive the best-effort prune that runs after every successful acquire; `PAPAI_REQUIRE_STORY_SANDBOX=1` — fail closed when the Docker sandbox is unavailable (always on in CI). See `docs/architecture/commands.md` § Hermetic story qualification.

**`PAPAI_MATTERMOST_ACTION_SIGNING_SECRET`** — optional, developer/CI only (never required in production): when set at startup, seeds its value into the `system_config` Mattermost action-signing-secret key via `onConflictDoNothing`, so an already-stored (operator-chosen or previously generated) secret is never overwritten; when unset, the existing lazy random-generate-on-first-use path is unchanged. Lets the T3 platform-adapter lane (`tests/platform/`) pin the container's action-signing secret to a value the fake Mattermost server can sign against. Operators do not need to set this.

**Behavior audit CI secrets** — required only by the nightly GitHub Actions workflow at `.github/workflows/behavior-audit.yml` (runs `bun audit:behavior` on `ubuntu-latest` against an external OpenAI-compatible gateway). Not read at papai runtime. Configure three repository secrets under repo settings → Secrets and variables → Actions:

- `BEHAVIOR_AUDIT_BASE_URL` — gateway base URL (e.g. `https://openrouter.ai/api/v1`); mapped verbatim to the same-named env var.
- `BEHAVIOR_AUDIT_MODEL` — model id (e.g. `anthropic/claude-3.5-haiku`); mapped verbatim to the same-named env var.
- `BEHAVIOR_AUDIT_API_KEY` — gateway API key; the workflow maps it to `OPENAI_API_KEY` (the env var the Vercel AI SDK reads), not to a same-named var.

The preflight step (`scripts/behavior-audit/preflight.ts`) fails the run with a clear message when any of `BEHAVIOR_AUDIT_BASE_URL`, `BEHAVIOR_AUDIT_MODEL`, or `OPENAI_API_KEY` is missing.
