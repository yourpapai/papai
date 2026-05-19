# Phase 1 — Central LLM Credentials, Brainstorm

**Date:** 2026-05-19
**Parent plan:** [`../plans/2026-05-19-central-llm-billing-roadmap.md`](../plans/2026-05-19-central-llm-billing-roadmap.md)
**Parent design:** [`../specs/2026-05-19-central-llm-billing-design.md`](../specs/2026-05-19-central-llm-billing-design.md)

Open exploration before the per-phase design and plan land. Goal: surface
options, name trade-offs, resolve the open questions the roadmap lists for
Phase 1, and check whether any code surface the parent design missed needs
to be added to scope.

## Surface area survey

The roadmap and parent design list ~10 files. A `grep` for `llm_apikey`,
`llm_baseurl`, `small_model`, and `embedding_model` against `src/` finds a
larger consumer set that also reads LLM keys per-user today and needs to
switch to `system_config` lookups, or Phase 1 will break those code paths.

| File                                                     | Today                                                                           | Phase 1 change needed               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| `src/llm-orchestrator-config.ts`                         | `getLlmConfig`, `checkRequiredConfig` read per-user                             | redirect to `system_config`         |
| `src/conversation.ts:59-67`                              | reads `llm_apikey` / `llm_baseurl` / `small_model` per-user                     | redirect to `system_config`         |
| `src/web/distill.ts:37-54`                               | `requireConfigValue` reads `llm_apikey` / `llm_baseurl` / `main_model` per-user | redirect to `system_config`         |
| `src/tools/save-memo.ts:34-36`                           | reads `llm_apikey` / `llm_baseurl` / `embedding_model` per-user                 | redirect to `system_config`         |
| `src/tools/search-memos.ts:90-92`                        | same                                                                            | same                                |
| `src/tools/lookup-group-history.ts:48-56`                | reads `llm_apikey` / `llm_baseurl` / `small_model` per-user                     | same                                |
| `src/deferred-prompts/proactive-llm.ts:68-125`           | local `getLlmConfig` reads per-user                                             | redirect to `system_config`         |
| `src/config-editor/handlers.ts:24-71`                    | exposes LLM keys in editor                                                      | drop the keys                       |
| `src/config-editor/validation.ts:49-60`                  | validates LLM key edits                                                         | drop the cases                      |
| `src/wizard/{steps,save,responses,validation,engine}.ts` | five LLM wizard steps + skip wiring                                             | drop the steps + dependent branches |
| `src/wizard-integration.ts:19`                           | handles `skip_small_model` / `skip_embedding`                                   | drop or guard                       |
| `src/chat/interaction-router.ts:197-251`                 | routes wizard-skip callbacks for LLM steps                                      | drop those branches                 |
| `src/providers/kaneo/provision.ts:229-243`               | `copyAdminLlmConfig` callsites                                                  | delete                              |
| `src/config.ts:13,57-83`                                 | `SENSITIVE_KEYS`, `LLM_COPY_KEYS`, copy/missing helpers                         | delete LLM bits                     |
| `src/types/config.ts:15,30-42,46-56`                     | `LlmConfigKey`, LLM in `CONFIG_KEYS`/`ALL_CONFIG_KEYS`                          | delete                              |
| `src/llm-orchestrator.ts:99-110,139-140`                 | uses `getLlmConfig`, reports per-context missing keys                           | new misconfigured-bot path          |
| `src/db/migrations/005_rename_config_keys.ts:12`         | historical rename; no change                                                    | leave as-is                         |

Net: ~20 files touched in `src/`, plus tests and docs. The parent design's
file-changes table needs to grow to reflect this; the per-phase design
should consolidate the list.

## Open question A — Hard-fail vs soft-fail on missing env at startup

The roadmap recommends hard-fail in Phase 1, soften when Phase 3 lands the
admin form. Two angles to consider:

- **Hard-fail at startup.** Pro: matches existing `REQUIRED_ENV_VARS`
  policy in `src/index.ts:27-46`; an unconfigured bot would not silently
  swallow user messages. Con: rules out the case where the admin starts
  the container, opens the dashboard, and pastes credentials there. But
  there is no dashboard form yet in Phase 1, so this case does not exist.
- **Soft-fail with misconfigured reply.** Pro: matches the parent design
  D3 which describes a runtime reply path. Con: in Phase 1 the only way
  to recover is to restart with env set, so the reply is essentially a
  worse error message than logging at startup and exiting.

**Recommendation:** keep the parent design's misconfigured reply path
(rare safety net, costs little) **and** add a startup check that warns
loudly if `system_config` is empty after env-seeding. Do not hard-fail —
the parent design D3 already specified a runtime reply, and Phase 3 will
add the dashboard form that lets the admin recover without a restart, so
the runtime path is the long-term shape and we shouldn't pave over it
twice.

Open subquestion: should the runtime reply DM the admin? The parent
design says yes ("bot admin gets a DM"). Adding a DM path inside the
orchestrator's misconfigured branch is small and ships in Phase 1.

## Open question B — Remove `copyAdminLlmConfig` immediately or defer?

The roadmap recommends immediate removal. Reasons:

- The only callers are in `src/providers/kaneo/provision.ts` and both
  guard on `isMissingLlmConfig`. Once Phase 1 removes the LLM key set
  from per-user config entirely, `isMissingLlmConfig` always returns
  `true`, so the callsites do nothing useful even if left in place. Dead
  code on the hot path is worse than removed code.
- Both `isMissingLlmConfig` and `LLM_COPY_KEYS` are dead once
  `copyAdminLlmConfig` is removed.

**Recommendation:** remove all three in Phase 1.

## Open question C — Which env vars are required vs optional

The parent design lists five env vars (`LLM_API_KEY`, `LLM_BASE_URL`,
`MAIN_MODEL`, `SMALL_MODEL`, `EMBEDDING_MODEL`). Only three are needed for
the chat hot path (`llm_apikey`, `llm_baseurl`, `main_model`); the other
two are used by ancillary surfaces:

- `small_model` is consumed by `src/conversation.ts` (summarization),
  `src/deferred-prompts/proactive-llm.ts`, `src/tools/lookup-group-history.ts`,
  `src/web/distill.ts`. Today, if it is missing each callsite falls back
  to `main_model` or skips the optimization.
- `embedding_model` is consumed by `src/tools/save-memo.ts` and
  `src/tools/search-memos.ts` (memo semantic search). Today, if missing
  the memo search degrades to keyword-only.

**Recommendation:** make `LLM_API_KEY`, `LLM_BASE_URL`, `MAIN_MODEL`
"required at startup once seeding has run" (i.e. orchestrator's
misconfigured check). `SMALL_MODEL` and `EMBEDDING_MODEL` stay optional;
callsites continue to fall back as today. This preserves a useful
degraded mode and keeps the env contract small.

## Open question D — How does `system_config` get cached on the hot path?

Per-user config has a write-through cache (`src/cache.ts` →
`getCachedConfig` / `setCachedConfig`) so `getLlmConfig` does not hit
SQLite on every message. `system_config` is read on every LLM call too;
it should not hit the DB each time either.

Two options:

- **Reuse the same cache** with a reserved context id like
  `__system__`. Pro: zero new infrastructure. Con: muddles the per-user
  abstraction; risks colliding with a future real user named
  `__system__` (impossible for Telegram numeric ids, but the type is
  `string`).
- **Dedicated cache in `src/system-config.ts`.** Pro: clean separation,
  easy to invalidate when admin updates a key. Con: a second copy of
  the cache pattern.

**Recommendation:** dedicated cache module-local to `src/system-config.ts`.
A `Map<string,string>` populated once on startup from the DB plus
`setSystemConfig` writes-through to both DB and cache. Phase 3 adds the
dashboard form; for now there is no concurrent writer to worry about.

## Open question E — Backup of `user_config` LLM rows before destructive migration 036

The roadmap rollback section flags this:

> the per-user keys users previously typed are gone. Mitigate by exporting
> `user_config` rows to a backup file before migration 036 runs.

Options:

- **Inline in the migration.** Write a sibling file (e.g. `papai.db.backup-036-<timestamp>.jsonl`) before the `DELETE`. Pro: automatic. Con: migrations have no concept of a filesystem write target today; this introduces a new responsibility.
- **Manual export, documented in the migration's docstring.** The admin
  runs a `bun` one-off before deploying the new version. Pro: matches the
  existing migration philosophy. Con: easy to skip.
- **Skip the backup, since the data is admin-owned anyway.** In a single-tenant
  bot, `user_config.llm_apikey` is almost always a copy of the admin's
  key (`copyAdminLlmConfig` is the primary writer). Backing up copies of
  the admin's own key is busywork.

**Recommendation:** inline backup inside the migration. Bun's SQLite
runs in-process so opening a file alongside the DB is trivial; the
backup file path is derived from `DB_PATH`. The migration logs the
backup file location at INFO. Rollback then re-imports from that file.

Alternative if reviewer pushback: log the row count being dropped at
WARN before deletion, and skip the file backup. Cheaper, slightly less
safe. Phase 1 is reversible by code revert anyway.

## Open question F — `LlmConfigKey` type: remove fully or leave as alias?

The parent design D2 hedges: "`LlmConfigKey` drops to empty / is removed".
Picking one:

- **Remove fully.** Smaller surface, fewer dead types. Any external
  reference becomes a TS error and is caught at compile time.
- **Leave as `type LlmConfigKey = never`.** Preserves the symbol for
  future use (re-introduction of BYOK). Costs a line.

**Recommendation:** remove fully. The Git history is the dead-symbol log.

## Open question G — Should the config-editor still expose `embedding_model` / `small_model`?

Those keys aren't credentials, they're model selections. Three positions:

- **Leave per-user.** Then `embedding_model` / `small_model` remain in
  `user_config` and `getCachedConfig(userId, 'small_model')` still works.
  But the parent design lists _all five_ LLM keys as moving to
  `system_config`, and migration 036 deletes all five from `user_config`.
- **Move all five to `system_config`.** Matches the parent design.
  Per-user overrides for these keys are not a feature today (you can set
  them but only admin's copy matters in practice).
- **Move only the credentials (`llm_apikey`, `llm_baseurl`).** Lets users
  pick a small model. But the wizard step is going away, so there is no
  user-facing way to set it anyway.

**Recommendation:** move all five to `system_config` per the parent
design. The per-user override pattern was never a feature, just a
side-effect of the wizard.

## Open question H — `kaneo_workspace_id` interaction

Group provisioning (`src/providers/kaneo/provision.ts`) currently does
two things on first contact: (1) ensure the group's `kaneo_workspace_id`,
(2) copy admin's LLM keys into the group's `user_config`. Phase 1 removes
step (2). Step (1) stays. The remaining code path is shorter — confirm
no shared state between (1) and (2) gets accidentally removed.

Reading `provision.ts:229-243`, the two are independent. Removing the
`isMissingLlmConfig` / `copyAdminLlmConfig` lines leaves workspace
provisioning intact.

## Open question I — Test fixtures for migration 036

Migration 036 runs `DELETE FROM user_config WHERE key IN (...)`. The test
needs to:

- Insert rows for each of the five LLM keys + one non-LLM key.
- Run the migration.
- Assert LLM rows gone, non-LLM row preserved.
- If we go with the inline backup (Open question E), assert the backup
  file exists and contains the deleted rows.

Standard pattern; no new fixture needed. `tests/db/migrations/` already
has examples.

## Open question J — Migration 035 stays for Phase 2

The parent design's "Migration order" section lists 034, 035, 036 as one
sequence. The roadmap explicitly splits them: 034+036 in Phase 1, 035 in
Phase 2. The roadmap is authoritative on phase boundaries.

**Decision:** Phase 1 ships migrations 034 and 036 only. 035 stays for
Phase 2 even though it leaves a numeric gap in the migration sequence
between phases. The migration framework allows gaps as long as ordering
within a deployment is monotonic, which it is.

Per-phase design needs to reflect this — drop the `llm_usage_events`
schema entry, drop the `src/usage/` module from Phase 1, defer to Phase 2.

## Open question K — `LLM_API_KEY` vs existing per-user `llm_apikey`

The env var name in the parent design is `LLM_API_KEY` (uppercase,
underscored), the config key is `llm_apikey` (lowercase, no underscore).
This mirrors the existing `TELEGRAM_BOT_TOKEN` env / `kaneo_apikey`
config split. No collision, no rename needed.

## Things explicitly NOT to do in Phase 1

- Touch the dashboard. No new routes, no UI. (Phase 3.)
- Add the `llm_usage_events` table or any recorder. (Phase 2.)
- Add a `/admin` DM command. (Phase 3 if ever.)
- Change `TELEGRAM_BOT_TOKEN` / `MATTERMOST_*` / `DISCORD_BOT_TOKEN` /
  task-provider env loading. Out of scope.
- Re-introduce BYOK as a feature flag. Packaging decision deferred.
- Add typed migrations using Drizzle. Migrations stay as plain SQL via
  `Database.run`, matching the existing pattern in `src/db/migrations/`.

## Risks identified by the brainstorm that weren't in the parent doc

1. **Multi-file consumer set.** The parent doc undersells how many files
   read LLM keys today. Easy to miss `src/conversation.ts`, the memo
   tools, and `proactive-llm.ts`. The plan must enumerate them.
2. **Per-user `small_model` / `embedding_model` fallbacks.** Several
   callsites today do `getConfig(userId, 'small_model') ?? mainModel`.
   After Phase 1 those become `getSystemConfig('small_model') ?? mainModel`.
   The fallback semantics are preserved but the read source changes
   everywhere.
3. **Test-first hook policy.** The repo enforces TDD via hooks
   (`CLAUDE.md` "TDD Enforcement"). Each `src/` edit must have a failing
   test first. The plan must sequence test-then-impl, not impl-then-test.
4. **Cache invalidation timing.** If the admin restarts the bot, env-seeding
   re-runs but skips rows already in `system_config`. The cache must be
   populated _after_ seeding, not before, or `system_config.ts` will hand
   out stale data on the first call.
5. **`bun start` calls `initDb()` before any other module loads.** That
   gives a natural place to call a `seedSystemConfigFromEnv()` helper:
   right after `initDb()` returns and before `initializeMessageCache()`.
6. **Sensitive-key masking after the type narrows.** Once `llm_apikey` is
   removed from `SENSITIVE_KEYS`, the `maskValue` helper still needs to
   handle the new system_config masking in the dashboard form (Phase 3),
   so we should leave the helper general. A unit test for `maskValue`
   should outlive the refactor without changes.

## Forward-compatibility check

Does the chosen approach in Phase 1 paint Phase 2 or Phase 3 into a
corner? Walk through each:

- **Phase 2 (usage recorder).** Recorder reads no LLM keys; it only
  writes `llm_usage_events`. Phase 1's `system_config` table is
  orthogonal to `llm_usage_events`. No coupling.
- **Phase 3 (dashboard + admin form).** Dashboard reads `system_config`
  via the same `getSystemConfig` API; admin form writes via
  `setSystemConfig` which already needs to exist in Phase 1 for the
  env-seed path. The cache invalidation in Phase 1 will make
  `setSystemConfig` immediately observable to the orchestrator, which
  is the Phase 3 requirement. Good.
- **Phase 4 (tool-call rows).** Independent of credentials.
- **Phase 5 (anonymous stats).** Reads `system_config` count only,
  never the values. No coupling beyond the table existing.

No corners painted.

## Summary of decisions to lift into the per-phase design

1. Misconfigured-bot runtime reply path stays (parent design D3); add a
   loud startup WARN log when `system_config` is empty after seeding.
   No hard-fail on missing env.
2. Remove `copyAdminLlmConfig`, `isMissingLlmConfig`, `LLM_COPY_KEYS`
   immediately in Phase 1.
3. `LLM_API_KEY`, `LLM_BASE_URL`, `MAIN_MODEL` are the required env vars
   for a useful bot. `SMALL_MODEL`, `EMBEDDING_MODEL` stay optional with
   existing fallback semantics preserved.
4. New `src/system-config.ts` module owns a module-local cache, write-through.
5. Migration 036 writes a JSONL backup file alongside the DB before
   deleting rows; rollback path is documented but not automated.
6. `LlmConfigKey` is removed entirely; no `type … = never` alias.
7. All five LLM keys move to `system_config`; per-user overrides are not
   preserved.
8. Migration 035 (`llm_usage_events`) stays for Phase 2; Phase 1 ships
   034 and 036 only. Drizzle schema for `llm_usage_events` also defers.
9. Per-phase design must expand the file-changes table to cover the full
   ~20-file consumer set, not the 10 the parent doc lists.

## Out of brainstorm (carry to plan, not design)

- Sequencing of edits under the TDD hook.
- Exact test names and file locations.
- Whether to run `bun check:verbose` after each module or only at the
  end.
- PR splitting strategy if the diff is too large for one review.
