<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 1 — Central LLM Credentials — Design Refinement

**Date:** 2026-05-19
**Status:** Draft, refining parent spec for Phase 1 scope
**Parent design:** [`2026-05-19-central-llm-billing-design.md`](./2026-05-19-central-llm-billing-design.md)
**Roadmap:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Brainstorm:** [`../notes/2026-05-19-phase-1-central-llm-credentials-brainstorm.md`](../notes/2026-05-19-phase-1-central-llm-credentials-brainstorm.md)
**Branch:** `claude/phase-1-llm-billing-Udxbx`

## Purpose of this document

The parent design covers all three phases (credentials, usage telemetry,
dashboard). This file narrows its decisions to the Phase 1 slice and
records the choices the brainstorm raised. Where this file and the parent
disagree, this file wins for Phase 1 only.

## Phase 1 in one paragraph

Move the five LLM config keys (`llm_apikey`, `llm_baseurl`, `main_model`,
`small_model`, `embedding_model`) out of per-user `user_config` and into
a new admin-owned `system_config` table. Seed the table from env vars at
startup. Read it via a new `src/system-config.ts` module with a
module-local cache. Drop the LLM steps from the setup wizard, the LLM
keys from the per-user config editor, the now-dead
`copyAdminLlmConfig` / `isMissingLlmConfig` / `LLM_COPY_KEYS` helpers,
and the per-user LLM-key reads scattered across the orchestrator,
conversation summarizer, web distillation, memo tools, group-history
tool, deferred prompts, and provisioning. Replace the per-context
"missing keys, complete /setup" reply with a single "bot misconfigured,
admin notified" runtime reply that fires only when `system_config` is
incomplete. Migration 034 creates the new table and optionally seeds it;
migration 036 deletes the five keys from `user_config` after writing a
JSONL backup beside the SQLite file.

## Decisions for Phase 1

### D1. New `system_config` table — same shape as parent design

```sql
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL  -- platform_user_id of bot admin, or 'env' for env-seeded
);
```

`updated_by` accepts the literal string `'env'` for env-seeded rows so
the audit trail distinguishes env bootstrap from a (future Phase 3)
dashboard write. The column is `NOT NULL` so the test for migration 034
can assert the audit column is populated for every seeded row.

### D2. Env-seeding policy

On startup, `src/index.ts` calls `seedSystemConfigFromEnv()` once,
immediately after `initDb()`. The helper:

1. Reads `LLM_API_KEY`, `LLM_BASE_URL`, `MAIN_MODEL`, `SMALL_MODEL`,
   `EMBEDDING_MODEL` from `process.env`.
2. For each (env var, config key) pair, if the env var is set and the
   row is missing from `system_config`, insert it with `updated_by='env'`
   and `updated_at=Date.now()`.
3. If a row already exists, leave it alone — the DB is the source of
   truth once seeded.
4. Logs (at INFO) the number of keys seeded and the keys present.

After seeding, the cache in `src/system-config.ts` is populated. Order
matters: `seedSystemConfigFromEnv()` runs first, then
`primeSystemConfigCache()`.

### D3. `src/system-config.ts` — module shape

```ts
export type SystemConfigKey = 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model'

export const SYSTEM_CONFIG_KEYS: readonly SystemConfigKey[]

export function getSystemConfig(key: SystemConfigKey): string | null
export function setSystemConfig(key: SystemConfigKey, value: string, updatedBy: string): void
export function seedSystemConfigFromEnv(): void
export function primeSystemConfigCache(): void
export function isSystemConfigComplete(): boolean // true if the three required keys are set
```

- `getSystemConfig` reads from a module-local `Map<SystemConfigKey,string>`;
  returns `null` if not present.
- `setSystemConfig` writes through to both DB and cache.
- `primeSystemConfigCache` loads all rows into the cache in one query.
- `isSystemConfigComplete` checks the three required keys
  (`llm_apikey`, `llm_baseurl`, `main_model`). `small_model` and
  `embedding_model` are optional.

`setSystemConfig` is exported in Phase 1 even though no caller exists
inside Phase 1 — Phase 3's dashboard form will call it. Exposing it now
lets tests cover the write path and avoids a follow-up Phase 3 change to
the module's public API.

### D4. Required vs optional env vars

Required for the bot to answer a message:

- `LLM_API_KEY` → `system_config.llm_apikey`
- `LLM_BASE_URL` → `system_config.llm_baseurl`
- `MAIN_MODEL` → `system_config.main_model`

Optional, degrades gracefully if absent:

- `SMALL_MODEL` → `system_config.small_model` (callsites fall back to
  `main_model`)
- `EMBEDDING_MODEL` → `system_config.embedding_model` (memo search falls
  back to keyword-only)

The startup log emits one WARN line per missing required key. The
process does not exit. The orchestrator's misconfigured reply path
(D8) handles the runtime case.

### D5. `getLlmConfig` resolution change

`src/llm-orchestrator-config.ts` is rewritten:

```ts
export interface LlmConfig {
  llmApiKey: string
  llmBaseUrl: string
  mainModel: string
}

export const getLlmConfig = (): LlmConfig => {
  const apiKey = getSystemConfig('llm_apikey')
  const baseUrl = getSystemConfig('llm_baseurl')
  const mainModel = getSystemConfig('main_model')
  if (apiKey === null || baseUrl === null || mainModel === null) {
    throw new Error('LLM system_config is incomplete')
  }
  return { llmApiKey: apiKey, llmBaseUrl: baseUrl, mainModel }
}
```

`contextId` is no longer a parameter — the call is global. Callers in
`src/llm-orchestrator.ts` drop the argument. `checkRequiredConfig(contextId, deps)`
still exists but its `llmKeys` array becomes empty; the function returns
only missing provider/workspace keys. Renamed in the same edit to
`checkRequiredProviderConfig` for clarity since LLM is no longer a
per-context concern.

The orchestrator gains a separate `if (!isSystemConfigComplete()) return
botMisconfiguredReply()` check before any tool-loading or LLM-calling
code runs (see D8).

### D6. Consumer rewrite map (the brainstorm's table, formalised)

| File                                            | Change                                                                                                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/llm-orchestrator-config.ts`                | `getLlmConfig()` reads `system_config`; rename `checkRequiredConfig` → `checkRequiredProviderConfig`; drop `'llm_apikey' \| 'llm_baseurl' \| 'main_model'` from `readConfig` union |
| `src/llm-orchestrator.ts`                       | gain `botMisconfiguredReply` branch; call `getLlmConfig()` w/o args                                                                                                                |
| `src/conversation.ts:55-70`                     | `llm_apikey`/`llm_baseurl`/`small_model` reads switch to `getSystemConfig`                                                                                                         |
| `src/web/distill.ts:37-54`                      | `requireConfigValue` becomes `requireSystemConfigValue`; reads `system_config`                                                                                                     |
| `src/tools/save-memo.ts:34-36`                  | reads `getSystemConfig('llm_apikey'/'llm_baseurl'/'embedding_model')`                                                                                                              |
| `src/tools/search-memos.ts:90-92`               | same                                                                                                                                                                               |
| `src/tools/lookup-group-history.ts:48-56`       | reads `getSystemConfig`                                                                                                                                                            |
| `src/deferred-prompts/proactive-llm.ts:68-125`  | local `getLlmConfig` calls `getSystemConfig`; "Use /setup" message removed in favor of "bot misconfigured"                                                                         |
| `src/config-editor/handlers.ts:24-71`           | drop the five LLM keys from labels, icons, and order                                                                                                                               |
| `src/config-editor/validation.ts:49-60`         | drop the LLM cases                                                                                                                                                                 |
| `src/wizard/steps.ts:34-55`                     | drop five LLM steps; wizard becomes 2 steps                                                                                                                                        |
| `src/wizard/steps.ts:88-110,118-155`            | drop LLM cases from `validateStep` and `formatSummary`                                                                                                                             |
| `src/wizard/save.ts:48-104`                     | drop LLM labels and the LLM block in `prepareConfig`                                                                                                                               |
| `src/wizard/responses.ts:11-14`                 | drop the `small_model` / `embedding_model` skip-button responses                                                                                                                   |
| `src/wizard/validation.ts:130-151`              | drop the LLM validation entries                                                                                                                                                    |
| `src/wizard/engine.ts:45`                       | drop the `'same'` handling for `small_model`                                                                                                                                       |
| `src/wizard-integration.ts:19`                  | drop `'skip_small_model'` / `'skip_embedding'` action handling                                                                                                                     |
| `src/chat/interaction-router.ts:197-251`        | drop the wizard-skip-LLM callback branches                                                                                                                                         |
| `src/providers/kaneo/provision.ts:229-243`      | delete `copyAdminLlmConfig` / `isMissingLlmConfig` callsites; remove import                                                                                                        |
| `src/config.ts:13`                              | remove `llm_apikey` from `SENSITIVE_KEYS`                                                                                                                                          |
| `src/config.ts:57-83`                           | delete `LLM_COPY_KEYS`, `copyAdminLlmConfig`, `isMissingLlmConfig`                                                                                                                 |
| `src/types/config.ts:15,30-42,46-56`            | delete `LlmConfigKey`, remove LLM keys from `CONFIG_KEYS`/`ALL_CONFIG_KEYS`, simplify `getConfigKeysForProvider`                                                                   |
| `src/db/migrations/034_system_config.ts`        | new — create table                                                                                                                                                                 |
| `src/db/migrations/036_drop_user_llm_config.ts` | new — backup + delete                                                                                                                                                              |
| `src/db/index.ts`                               | register migrations 034 and 036                                                                                                                                                    |
| `src/system-config.ts`                          | new module                                                                                                                                                                         |
| `src/index.ts`                                  | call `seedSystemConfigFromEnv()` + `primeSystemConfigCache()` after `initDb()`                                                                                                     |

Note: migration 035 is deferred to Phase 2. The migration sequence in
Phase 1 ends at 034 then jumps to 036.

### D7. Migration 036 — backup-then-delete

```ts
const up = (db: Database): void => {
  const llmKeys = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'] as const
  const rows = db
    .query(`SELECT user_id, key, value FROM user_config WHERE key IN (?,?,?,?,?)`)
    .all(...llmKeys) as Array<{ user_id: string; key: string; value: string }>

  if (rows.length > 0) {
    const dbPath = (db as unknown as { filename: string }).filename
    const backupPath = `${dbPath}.backup-036-${Date.now()}.jsonl`
    const lines = rows.map((r) => JSON.stringify({ ...r, migration: '036' })).join('\n')
    Bun.file(backupPath)
      .writer()
      .write(lines + '\n')
    log.info({ backupPath, rows: rows.length }, 'wrote pre-migration backup')
  }

  db.run(
    `DELETE FROM user_config WHERE key IN ('llm_apikey','llm_baseurl','main_model','small_model','embedding_model')`,
  )
  log.info({ deleted: rows.length }, 'migration 036: removed LLM keys from user_config')
}
```

Edge cases:

- `rows.length === 0`: no backup file written, log only.
- Backup write failure: surface as a thrown migration error. We do not
  want to silently delete data when the backup failed.
- Concurrent processes writing `user_config`: not possible during
  migration; SQLite holds the DB lock.

### D8. Misconfigured-bot runtime reply

Inside `src/llm-orchestrator.ts`, before any LLM call, check:

```ts
if (!isSystemConfigComplete()) {
  log.error({ missing: missingSystemConfigKeys() }, 'system_config is incomplete')
  await reply('⚠️ The bot is not fully configured. The administrator has been notified.')
  await notifyAdminMisconfigured(deps, missingSystemConfigKeys())
  return
}
```

`notifyAdminMisconfigured` sends a DM to `ADMIN_USER_ID` listing the
missing keys, throttled to once per process lifetime (a `let notified = false`
in the module) so a flood of incoming messages does not produce a flood
of admin DMs.

### D9. Wizard reduces to two steps

After the LLM steps are removed, `getWizardSteps('kaneo')` returns:

1. `kaneo_apikey` — required
2. `timezone` — required

For `youtrack`:

1. `youtrack_token` — required
2. `timezone` — required

`formatSummary` is updated to drop the LLM block. The "Use same as main
model" / "Skip embedding" inline-keyboard buttons go away. Any
`interaction-router` callback for those buttons drops its branch.

`tests/wizard/steps.test.ts` needs the LLM-step assertions removed and
replaced with assertions that the wizard now lists exactly two steps.

### D10. Config-editor scope

`src/config-editor/handlers.ts` keeps `kaneo_apikey`, `youtrack_token`,
`timezone` as user-editable keys. The five LLM keys drop out of the
labels/icons maps and the ordered key list. After the change, the
`/config` flow shows only the keys a user can actually own.

### D11. `LlmConfigKey` removal

Removed entirely. The type was only re-exported for the wizard and
config-editor; both lose their LLM references. No alias retained.

### D12. Logging additions

- `src/system-config.ts` logs at INFO when a key is seeded from env;
  at INFO when `setSystemConfig` is called (key only, never value);
  at DEBUG on read with key only.
- `src/index.ts` logs at INFO the count of seeded keys.
- `src/llm-orchestrator.ts` logs at ERROR when `isSystemConfigComplete`
  returns false, with the list of missing keys.
- Never log `value` for `llm_apikey`. The existing `maskValue` helper
  in `src/config.ts` is not used because the value never appears in a
  log call at all.

## Non-goals (Phase 1)

- No `system_config` editing UI. Env vars + DB inserts only.
- No `/admin` DM command.
- No `llm_usage_events` table. (Phase 2.)
- No billing dashboard. (Phase 3.)
- No metrics emission for `system_config` changes (no existing pattern).
- No re-introduction of BYOK as a paid SKU.
- No change to other env var loading: `TELEGRAM_BOT_TOKEN`,
  `MATTERMOST_*`, `DISCORD_BOT_TOKEN`, `KANEO_CLIENT_URL`, S3 vars stay
  exactly as today.

## Acceptance criteria (Phase 1)

1. Fresh container with `LLM_API_KEY`, `LLM_BASE_URL`, `MAIN_MODEL`, plus
   `TASK_PROVIDER`/`ADMIN_USER_ID`/`CHAT_PROVIDER` set: the bot starts,
   the admin runs `/setup`, completes 2 steps (task provider key,
   timezone), DMs the bot, gets an answer.
2. A user with pre-existing `user_config.llm_apikey` rows: migration 036
   deletes them, backup file is written, the user's next message reads
   from `system_config` and gets an answer with no `/setup` interaction.
3. `getSystemConfig('llm_apikey')` returns the env-seeded value on a
   fresh DB.
4. With one of the three required env vars unset, the bot starts, logs a
   WARN at startup, and replies "bot misconfigured" to incoming messages
   until the admin restarts with all three set.
5. `bun typecheck` passes. `bun lint` passes. `bun test` passes (existing
   suites + new ones). `bun security` passes.
6. No references to `LlmConfigKey`, `copyAdminLlmConfig`,
   `isMissingLlmConfig`, or `LLM_COPY_KEYS` remain in the codebase.

## Out of scope, by file

- `src/usage/**` — Phase 2.
- `src/debug/**` and `client/debug/**` — Phase 3.
- `src/db/migrations/035_*` — Phase 2.
- `src/embeddings.ts` if it exists today — to verify in the plan and
  loop in if it reads LLM config (the embedding tools already do; the
  module under that exact name may or may not exist).

## Rollback

1. Code revert: standard. The `system_config` table stays in place; it
   becomes dead data, harmless.
2. User data: restore the JSONL backup file written by migration 036.
   A one-off `bun` script imports it back into `user_config`. Documented
   in the migration's header comment.
3. Wizard / config-editor: code revert restores the LLM steps and the
   five keys. Users would have to re-enter their keys because per-user
   LLM rows would be empty after the rollback (the backup restored them,
   so this is fine).

## Cross-cutting

### Test plan summary (full sequencing lives in the implementation plan)

New test files:

- `tests/db/migrations/034-system-config.test.ts`
- `tests/db/migrations/036-drop-user-llm-config.test.ts`
- `tests/system-config.test.ts`

Updated test files:

- `tests/llm-orchestrator-config.test.ts` — new resolution
- `tests/llm-orchestrator/*.test.ts` — misconfigured-reply branch
- `tests/wizard/steps.test.ts` — two-step wizard
- `tests/wizard/save.test.ts`, `tests/wizard/responses.test.ts`,
  `tests/wizard/validation.test.ts`, `tests/wizard/engine.test.ts` —
  remove LLM cases
- `tests/config.test.ts` — `SENSITIVE_KEYS`, deleted helpers
- `tests/types/config.test.ts` if present — narrower key set
- `tests/providers/kaneo/provision.test.ts` — no admin-copy
- `tests/conversation.test.ts` — small_model from system_config
- `tests/web/distill.test.ts` — config from system_config
- `tests/tools/save-memo.test.ts`, `search-memos.test.ts`,
  `lookup-group-history.test.ts` — config from system_config
- `tests/deferred-prompts/proactive-llm.test.ts` — config from
  system_config; "use /setup" message gone
- `tests/config-editor/handlers.test.ts`, `validation.test.ts` —
  smaller key set
- `tests/chat/interaction-router.test.ts` — missing wizard-skip-LLM
  branches

### Documentation updates

`CLAUDE.md`:

- "Required Environment Variables" gains the three required LLM vars
  and notes `SMALL_MODEL`, `EMBEDDING_MODEL` as optional.
- "Common runtime config keys" removes the five LLM keys (they are no
  longer per-user runtime config).

No other doc files need updates in Phase 1.

### Security review checkpoint

`bun security` after the wizard changes catches:

- New prompt-injection surface from the misconfigured-bot reply (low —
  it is a static string).
- Backup file path injection from `DB_PATH` (resolve via path
  construction, not concatenation with user input — `DB_PATH` is env,
  not user input, so safe).
- Logging of `llm_apikey` (must not happen — covered by the rule in
  D12).

## Decisions vs parent design — diff

| Topic                           | Parent design                    | This document (Phase 1)                                     |
| ------------------------------- | -------------------------------- | ----------------------------------------------------------- |
| Migration list                  | 034, 035, 036                    | 034, 036 only; 035 deferred                                 |
| `getLlmConfig` signature        | Unchanged signature, body change | Signature drops `contextId`                                 |
| Startup behavior on missing env | Implied dashboard recovery       | Boot anyway, runtime reply + admin DM                       |
| `LlmConfigKey` removal          | "drops to empty / is removed"    | Removed entirely                                            |
| Required env vars               | All five listed as moving        | Three required, two optional                                |
| Backup before migration 036     | "Mitigate by exporting"          | Inline JSONL backup in the migration                        |
| `setSystemConfig` exported      | Defined in Phase 3               | Exported in Phase 1; Phase 3 only adds the dashboard caller |
| Consumer files in scope         | ~10 listed                       | ~20, brainstorm full list                                   |
