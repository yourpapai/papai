<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 1 — Central LLM Credentials — Implementation Plan

**Date:** 2026-05-19
**Status:** Draft
**Branch:** `claude/phase-1-llm-billing-Udxbx`
**Per-phase design:** [`../specs/2026-05-19-phase-1-central-llm-credentials-design.md`](../specs/2026-05-19-phase-1-central-llm-credentials-design.md)
**Brainstorm:** [`../notes/2026-05-19-phase-1-central-llm-credentials-brainstorm.md`](../notes/2026-05-19-phase-1-central-llm-credentials-brainstorm.md)

## Sequencing principle

The TDD hook (`CLAUDE.md` "TDD Enforcement") gates every `src/` edit on
a failing test. Each implementation step is therefore split into:

- **T**: write the failing test(s).
- **I**: write the implementation that turns the test(s) green.
- **R**: refactor — only when there's something to refactor.

Steps are ordered so each one leaves the tree green. The plan never
asks for an interim state where `bun test` or `bun typecheck` fails as a
deliverable. Within a step the tree may be red temporarily; between
steps it is green.

## Step 0 — Pre-flight

- Confirm we are on branch `claude/phase-1-llm-billing-Udxbx`.
- `bun test` should pass on the baseline. If not, stop and investigate.
- `bun typecheck` should pass. Same.
- Skim `src/db/migrations/030_attachment_workspace.ts` (closest recent
  example of a non-trivial migration with a side-effect on the
  filesystem) to confirm the migration pattern.
- Skim `tests/db/migrations/` for an existing test to copy structure from.

## Step 1 — Migration 034 (`system_config` table)

**T**: add `tests/db/migrations/034-system-config.test.ts` covering:

- table exists after migration
- primary key on `key`
- `updated_at`, `updated_by` are NOT NULL
- inserting two rows with the same key fails
- running the migration twice is idempotent (`CREATE TABLE IF NOT EXISTS`)

**I**: add `src/db/migrations/034_system_config.ts`:

```sql
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);
```

Register in `src/db/index.ts` (import + push to `MIGRATIONS`).

**R**: none.

**Verify**: `bun test tests/db/migrations/034-system-config.test.ts`.

## Step 2 — `src/system-config.ts` module

**T**: add `tests/system-config.test.ts` covering:

- `getSystemConfig` returns null when key missing
- `setSystemConfig` writes through to DB and cache
- `primeSystemConfigCache` loads existing rows
- `seedSystemConfigFromEnv` inserts missing rows from env, skips
  existing ones, leaves alone keys whose env var is unset
- `isSystemConfigComplete` returns true iff three required keys are
  present
- `seedSystemConfigFromEnv` records `updated_by='env'`

DI shape: the module imports `getDb()` from `src/db/drizzle.ts` (matches
existing pattern). Tests can either reset the in-process cache between
tests or run against a fresh DB; copy the approach `tests/config.test.ts`
uses.

**I**: write `src/system-config.ts`. See design D3 for the public API.
Internals:

- `cache: Map<SystemConfigKey,string>` module-local
- `getSystemConfig(key)` returns `cache.get(key) ?? null`
- `setSystemConfig(key, value, updatedBy)` runs an UPSERT and updates
  cache
- `primeSystemConfigCache()` runs `SELECT key, value FROM system_config`
  and rebuilds the cache from scratch
- `seedSystemConfigFromEnv()` reads the five env vars; for each (env,
  configKey) pair where env is non-empty AND the row is missing in the
  cache (already primed by the caller? or query in this method?
  decision: query DB once at the start of this method so it can run
  before `primeSystemConfigCache` if we want), calls
  `setSystemConfig(key, value, 'env')`
- `isSystemConfigComplete()` returns
  `getSystemConfig('llm_apikey') !== null && getSystemConfig('llm_baseurl') !== null && getSystemConfig('main_model') !== null`
- `missingSystemConfigKeys()` returns the list of missing required keys
  for use in log lines and the admin DM

Wiring policy: `seedSystemConfigFromEnv` calls `primeSystemConfigCache`
at the start to ensure existence checks are not stale. `src/index.ts`
calls `seedSystemConfigFromEnv()` only; the module handles cache
internally.

**R**: rename internal helpers for clarity once green.

**Verify**: `bun test tests/system-config.test.ts && bun typecheck`.

## Step 3 — Wire `seedSystemConfigFromEnv` into startup

**T**: extend or add a startup integration test. The existing project
does not run `src/index.ts` as a test (`src/index.ts` has side effects
on import); instead the unit test covers the helper in isolation as in
Step 2. The startup wiring is verified by manual smoke later. So this
step has no new test — it's a small wiring change.

**I**: in `src/index.ts`, immediately after `initDb()` returns
successfully, call `seedSystemConfigFromEnv()`. Log the count of
seeded keys at INFO.

**R**: none.

**Verify**: `bun typecheck`. (No test failures because this code is not
exercised by the test runner.)

## Step 4 — Switch orchestrator to `system_config`

This is the hot path. The chunk is large; split into two sub-steps.

### Step 4a — Read path

**T**: extend `tests/llm-orchestrator-config.test.ts`:

- `getLlmConfig()` (no arg) reads from `system_config`
- when any required key is missing, `getLlmConfig` throws
- `checkRequiredProviderConfig(contextId, deps)` returns only provider
  keys, no LLM keys

**I**: rewrite `src/llm-orchestrator-config.ts`:

- drop the LLM keys from `readConfig`'s union
- delete the LLM key check from `checkRequiredConfig`
- rename to `checkRequiredProviderConfig`
- `getLlmConfig` ignores `contextId`, reads from `getSystemConfig`

Update `src/llm-orchestrator.ts` to:

- call `getLlmConfig()` (no arg)
- call `checkRequiredProviderConfig` for the per-user provider check

**R**: none — type signatures already reflect the change.

**Verify**: `bun test tests/llm-orchestrator-config.test.ts && bun test tests/llm-orchestrator.test.ts && bun typecheck`. Some other tests may still fail until consumer rewrites in step 5 land; those failures are expected and not a problem at this intermediate point. We do **not** push or merge here, so the temporary red is local.

Note for the TDD hook: if the orchestrator edit fails the hook because
unrelated tests are now red, sequence the consumer rewrites in step 5
_before_ the orchestrator edit becomes the last write. Practically: do
all edits in a single conceptual pass, then run `bun test` once across
the whole change set.

### Step 4b — Misconfigured-bot reply path

**T**: extend the orchestrator test:

- when `isSystemConfigComplete()` is false, `processMessage` replies
  with the misconfigured string and does not call the LLM
- admin DM is sent exactly once per process lifetime

**I**: in `src/llm-orchestrator.ts`, before the existing per-context
config check, add:

```ts
if (!isSystemConfigComplete()) {
  await replyWithMisconfigured(reply, deps, contextId)
  return
}
```

Where `replyWithMisconfigured`:

- sends the user-facing reply
- calls a module-local `notifyAdminOnce(deps)` that posts a DM to
  `ADMIN_USER_ID` listing the missing keys; guarded by a `let notified`
  flag

`ADMIN_USER_ID` is already wired through `src/index.ts` via
`setupBot(chatProvider, adminUserId, botDeps)`. The orchestrator does
not currently take `adminUserId`; thread it through `LlmOrchestratorDeps`
or read it from `process.env['ADMIN_USER_ID']` once at module load.
Preferred: thread through deps to keep the module pure (matches the DI
style elsewhere).

**R**: none.

**Verify**: orchestrator suite passes.

## Step 5 — Consumer rewrites (per-user → system_config)

For each consumer file, the pattern is identical:

1. Add or update a test that exercises the call with `system_config`
   seeded.
2. Replace `getConfig(userId, 'llm_…')` / `getCachedConfig(userId, 'llm_…')`
   with `getSystemConfig('…')` from `src/system-config.ts`.
3. Preserve `small_model ?? mainModel` and `embedding_model ?? null`
   fallback semantics.

Files, in order (smallest blast radius first to keep intermediate
states sane):

### 5a — `src/web/distill.ts`

**T**: `tests/web/distill.test.ts` — set `system_config` instead of
`user_config` in the fixture; assert the OpenAI client is constructed
with the seeded values.

**I**: rewrite `requireConfigValue` to `requireSystemConfigValue` (or
inline). Drop the `storageContextId` parameter for the LLM lookups; keep
it for any non-LLM lookups (none currently in this file).

### 5b — `src/conversation.ts`

**T**: `tests/conversation.test.ts` — seed `system_config`; the
summarizer call uses the seeded small_model and falls back to main
when small is null.

**I**: replace the three `getCachedConfig(userId, 'llm_apikey' | 'llm_baseurl' | 'small_model')` calls. Keep the `small_model ?? mainModel` fallback.

### 5c — `src/tools/save-memo.ts`, `src/tools/search-memos.ts`

**T**: extend the existing memo tool tests — embedding model from
`system_config`. When `embedding_model` is null, the memo write/search
does not attempt to embed (existing fallback semantics preserved).

**I**: replace the three reads in each file with `getSystemConfig`.

### 5d — `src/tools/lookup-group-history.ts`

**T**: existing test (if any) — seed `system_config`.

**I**: replace the four reads.

### 5e — `src/deferred-prompts/proactive-llm.ts`

**T**: `tests/deferred-prompts/proactive-llm.test.ts` — assert that with
`system_config` set, the prompt fires; with system_config missing
required keys, the prompt is **skipped with a different message**
("skipped: bot misconfigured") and does not refer to `/setup`.

**I**: rewrite the local `getLlmConfig(userId)` to take no userId, read
from `system_config`. Update the early-return error message.

### 5f — `src/providers/kaneo/provision.ts`

**T**: extend `tests/providers/kaneo/provision.test.ts` — after
provisioning, the user has no LLM keys in `user_config`; their `kaneo_workspace_id` is set.

**I**: remove the two `if (… isMissingLlmConfig(contextId)) copyAdminLlmConfig(contextId, adminUserId)` blocks and the import.

### 5g — `src/config.ts`

**T**: `tests/config.test.ts` — `SENSITIVE_KEYS` no longer contains
`llm_apikey`; `copyAdminLlmConfig` / `isMissingLlmConfig` are gone.
`maskValue('kaneo_apikey', x)` still masks.

**I**: remove `'llm_apikey'` from `SENSITIVE_KEYS`; delete
`LLM_COPY_KEYS`, `copyAdminLlmConfig`, `isMissingLlmConfig` (and the
docstring above them).

### 5h — `src/types/config.ts`

**T**: `tests/types/config.test.ts` — `CONFIG_KEYS` and `ALL_CONFIG_KEYS`
no longer contain the five LLM keys.

**I**: delete `LlmConfigKey`. Simplify `getConfigKeysForProvider`:
returns only the provider key + preference keys. Update
`ALL_CONFIG_KEYS` to omit LLM entries. Update the `isConfigKey`
function (unchanged semantically; it just narrows over a smaller set).

### 5i — `src/wizard/*`

**T**: `tests/wizard/steps.test.ts`, `tests/wizard/save.test.ts`,
`tests/wizard/responses.test.ts`, `tests/wizard/validation.test.ts`,
`tests/wizard/engine.test.ts` — drop the LLM cases. Assert the wizard
now has 2 steps for both providers.

**I**:

- `src/wizard/steps.ts`: drop the five LLM `createStep` calls; drop the
  LLM cases from `validateStep`; drop the LLM lines from `formatSummary`.
- `src/wizard/save.ts`: drop `llm_apikey`, `llm_baseurl`, `main_model`,
  `small_model`, `embedding_model` from the labels record; drop the
  `prepareConfig` lines that read those.
- `src/wizard/responses.ts`: drop the `small_model` and
  `embedding_model` branches.
- `src/wizard/validation.ts`: drop the LLM validation entries.
- `src/wizard/engine.ts`: drop the `value === 'same' && key === 'small_model'` branch.

### 5j — `src/wizard-integration.ts` and `src/chat/interaction-router.ts`

**T**: extend `tests/chat/interaction-router.test.ts` — wizard-skip-LLM
buttons no longer route.

**I**: remove the `'skip_small_model'`/`'skip_embedding'` action handling and the matching `interaction-router` branches.

### 5k — `src/config-editor/handlers.ts` and `src/config-editor/validation.ts`

**T**: `tests/config-editor/handlers.test.ts` /
`tests/config-editor/validation.test.ts` — drop LLM keys from
expected key sets and validation cases.

**I**: drop the LLM entries from the labels/icons/keys constants and
the LLM cases from `validateKeyValue`.

## Step 6 — Migration 036 (delete LLM keys from `user_config`)

**T**: `tests/db/migrations/036-drop-user-llm-config.test.ts`:

- seed `user_config` with five LLM rows + one non-LLM row (e.g. `kaneo_apikey`)
- run the migration
- assert LLM rows gone, non-LLM row intact
- assert the JSONL backup file exists, has 5 lines, each line is JSON
  with `user_id`/`key`/`value`/`migration` fields
- when no LLM rows exist, no backup file is written
- failing to write the backup file aborts the migration (rows still
  present after the throw)

**I**: write `src/db/migrations/036_drop_user_llm_config.ts`. See design
D7 for the body. Register in `src/db/index.ts` AFTER migration 034 (no
intermediate 035).

**R**: none.

**Verify**: `bun test tests/db/migrations/036-drop-user-llm-config.test.ts`.

## Step 7 — Full suite + lint + typecheck + security

Run in order:

1. `bun typecheck`
2. `bun lint`
3. `bun test` — main curated suite
4. `bun test:client` — dashboard UI suite (should be unchanged but
   confirm nothing references removed types)
5. `bun format:check`
6. `bun security` — Semgrep

Any failure pauses the plan and we fix forward. Do not skip suites.

## Step 8 — Documentation updates

Update `CLAUDE.md`:

- "Required Environment Variables" section: add `LLM_API_KEY`,
  `LLM_BASE_URL`, `MAIN_MODEL` as required-at-startup. Mention
  `SMALL_MODEL`, `EMBEDDING_MODEL` as optional.
- "Common runtime config keys" section: remove the five LLM keys.
- Add a one-line note that LLM credentials are admin-owned and live in
  the `system_config` table (env-bootstrap, no dashboard form yet —
  Phase 3 will add one).

Do not create new doc files in Phase 1.

## Step 9 — Manual smoke (mandatory acceptance)

1. Fresh DB (`rm papai.db*` in a scratch dir).
2. `LLM_API_KEY=… LLM_BASE_URL=… MAIN_MODEL=… ADMIN_USER_ID=… CHAT_PROVIDER=telegram TASK_PROVIDER=kaneo KANEO_CLIENT_URL=… bun start`.
3. Verify startup logs show "seeded 3 keys from env".
4. As `ADMIN_USER_ID` on Telegram, DM the bot.
5. Bot replies with the wizard's first step (task provider key) — not
   an LLM step.
6. Complete the 2-step wizard.
7. Send a real message; bot answers.
8. Stop the bot. Restart without `LLM_API_KEY` set. Verify:
   - boot logs WARN "system_config incomplete: [llm_apikey]"
   - sending a message gets the "bot misconfigured" reply
   - admin gets a DM about the missing key (once per process lifetime)
9. Stop. With a pre-existing user_config DB (mocked or staged), run the
   migration once. Verify the backup file is created and the LLM rows
   are gone.

If any of these fail, stop and re-plan.

## Step 10 — Commit + push

One commit per substep is overkill for review. Group:

- Commit A: migrations 034 + 036 + `src/db/index.ts` registration +
  their tests.
- Commit B: `src/system-config.ts` + its test + wiring in `src/index.ts`.
- Commit C: orchestrator-config + orchestrator + their tests.
- Commit D: consumer rewrites (`src/web/distill.ts`,
  `src/conversation.ts`, memo tools, group-history tool,
  proactive-llm) + tests.
- Commit E: wizard / config-editor / type cleanups + tests.
- Commit F: `src/config.ts` cleanups + `src/providers/kaneo/provision.ts`.
- Commit G: docs.

If a hook fails on a commit, fix the underlying issue and commit again
(no `--amend`, no `--no-verify` — `CLAUDE.md` explicitly forbids both).

Push to `claude/phase-1-llm-billing-Udxbx` with `git push -u origin claude/phase-1-llm-billing-Udxbx`.

## Step 11 — Review

The roadmap calls for security pass + manual smoke + dashboard
walkthrough (n/a for Phase 1).

- Run `/security-review` once the branch is pushed (handled separately
  by the reviewer flow).
- Capture manual smoke notes in the PR description so the reviewer can
  reproduce.

## Risks + mitigations

| Risk                                                                                   | Mitigation                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------- | -------------- | --------------- | ------------------------------------------------------------------------- |
| TDD hook blocks an `src/` edit because the new test was not yet written                | Sequence T → I strictly inside each step; never write `src/foo.ts` before its test                      |
| Intermediate test failures between consumer rewrites                                   | Group the consumer rewrites in step 5 into one batch; run `bun test` only at the end of step 5          |
| Forgotten consumer leaves `getConfig(userId, 'llm_apikey')` lurking                    | `grep -rn "'llm_apikey'\\                                                                               | 'llm_baseurl'\\ | 'main_model'\\ | 'small_model'\\ | 'embedding_model'" src/`after step 5; only`system-config.ts` should match |
| Migration 036 deletes data on a partially-set-up dev DB and the user wanted to keep it | Mitigated by the inline JSONL backup; documented in `CLAUDE.md`                                         |
| Admin DM spam in misconfigured loop                                                    | `let notified = false` guard at module scope                                                            |
| `bun security` flags the misconfigured reply for prompt-injection-adjacent issues      | The reply is static text; flag should not fire. If it does, investigate, do not silence with a comment  |
| Existing tests assert per-user LLM config flow we are removing                         | Expected — they are explicitly listed in Step 5's test list. Update, do not delete unrelated assertions |

## Out-of-plan checklist before Step 10

- [ ] No `eslint-disable`, `oxlint-disable`, `@ts-ignore`, or
      `@ts-nocheck` comments anywhere (hook policy)
- [ ] No re-imports of `copyAdminLlmConfig` / `isMissingLlmConfig` /
      `LLM_COPY_KEYS` (grep)
- [ ] `bun knip` shows no new unused exports
- [ ] `bun duplicates` does not regress
- [ ] `tests/CLAUDE.md` style respected for new tests (DI-first, mock
      reset, etc.)
