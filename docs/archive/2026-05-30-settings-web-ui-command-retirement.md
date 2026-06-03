<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Settings Web UI — Command Retirement & Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once the settings web UI is at parity, retire the interactive chat-configuration flows — flip `/config` to a launcher-only command, delete the config-editor / setup-wizard / group-selector-UI / tool-toggle / plugin-toggle / AI-output interaction layers and the message-interception path, and remove the `/setup`, `/plugin`, `/group`/`/groups`, `/user`/`/users`, and `/announce` commands — while keeping all the underlying data/validation/store logic the web layer depends on.

**Architecture:** This is a **deletion-and-rewrite** effort, sequenced as independent PRs that trail UI delivery so the bot is never left without a config path. The removal targets are the **presentation/state-machine** layers only; the data layer (config stores, validators, tool-prefs, MCP, plugin runtime, identity, instance/auth/system-config stores, the extracted announce broadcast, and the group-settings `access.ts`/`target-validation.ts` helpers) stays. Each phase ends green (typecheck + lint + knip + tests). The riskiest change — removing the `bot.ts`/`bot-settings.ts` message-interception path that gates the message queue — is protected by characterization tests written **before** deletion.

**Tech Stack:** Bun, TypeScript (strict, `.js` import specifiers), the `ChatProvider`/`CommandHandler`/`ReplyFn` chat abstraction, `bun test` (server suites) + `bun test:client`, `bun knip` (proves deletions left nothing dangling), oxlint/oxfmt.

---

## Prerequisites & current state (verified against the codebase)

This plan is **spec sequencing step 3 onward**. Steps 1–2 are already done:

- **The web UI is built and merged** (the Access Model, HTTP API, and Client SPA specs — `src/settings/**`, `src/debug/settings*`, `client/settings/**`). This plan assumes that work is on the base branch.
- **`/config` already emits a settings link additively.** `src/commands/config.ts` calls `issueSettingsLink(...)` (`src/settings/issue-link.ts`); on `kind: 'ok'` it replies with the URL, on `rate_limited` it throttles, and on `not_configured` (when `SETTINGS_PUBLIC_BASE_URL` is unset) it **falls back to the legacy in-chat editor**. This plan removes that legacy fallback.
- **`/announce`'s broadcast is already extracted** into `src/commands/announce-broadcast.ts` (`broadcastMessage(chat, platformInstanceId, message)`), already called by both the `/announce` handler (`src/commands/admin.ts`) and the settings admin route (`src/debug/settings/admin/roster-plugins-routes.ts`). No extraction work remains — only deleting the `/announce` _command_.

**Resolved open questions (confirmed with the requester):**

- **OQ-R2 → `/setup` removed outright.** No alias. The wizard (`src/wizard/`) and auto-setup interception are deleted; `/start` points users at `/config`.
- **OQ-R1 → `/plugin` removed fully.** No admin launcher. Plugin approve/reject + per-context enable/disable live only in the UI admin area (already shipped in the SPA).

**`SETTINGS_PUBLIC_BASE_URL` becomes effectively required.** After the legacy fallback is deleted, a deployment with `SETTINGS_PUBLIC_BASE_URL` unset has no in-chat config path — by design (spec D2 hard removal). `/config` must then reply with a clear "settings UI is not configured; ask the administrator to set `SETTINGS_PUBLIC_BASE_URL`" message rather than silently doing nothing. This plan implements that message (Phase 2, Task 2.1).

---

## What must NOT be removed (keep — the web layer depends on these)

Do not delete or weaken any of these while removing their old chat callers:

- `src/config.ts`, `src/config-keys.ts`, **`src/config-editor/validation.ts`** (only `validation.ts` survives in that directory).
- `src/tools/tool-preferences.ts`, `src/tools/tool-metadata.ts`, `src/tools/tools-builder.ts`.
- `src/mcp/user-endpoints.ts`, `src/mcp/types.ts`.
- `src/plugins/store.ts`, `src/plugins/registry.ts`, the plugin runtime, `src/commands/plugin-auth.ts` (used by other code paths — verify before any removal).
- **`src/group-settings/access.ts`, `src/group-settings/target-validation.ts`** (and `state.ts`, `dispatch.ts` — verify remaining callers before touching; the Access Model reuses access helpers).
- All authorization + instance + identity + system-config stores.
- `src/commands/announce-broadcast.ts` (the extracted broadcast).
- `/help`, `/start`, `/context`, `/clear`, `/dashboard` commands.

---

## File Structure — what changes

**Deleted modules** (presentation/state-machine layers):

```text
src/config-editor/callback-data.ts          # KEEP validation.ts; delete the rest
src/config-editor/handlers.ts
src/config-editor/index.ts
src/config-editor/state.ts
src/config-editor/types.ts
src/wizard/                                   # entire directory
src/wizard-integration.ts
src/bot-auto-setup.ts                         # auto-start wizard interception
src/bot-settings.ts                           # the maybeInterceptWizard pipeline
src/chat/config-editor-integration.ts
src/chat/interaction-router-config.ts
src/group-settings/selector.ts                # KEEP access.ts, target-validation.ts, state.ts, dispatch.ts (verify callers)
src/chat/tool-toggle-interaction-handler.ts
src/commands/tool-config-view.ts
src/chat/plugin-interaction-handler.ts
src/ai-output-config-ui.ts
src/chat/ai-output-config-interaction.ts
src/setup/task-instance-selection.ts          # setup-only (verify no other caller)
src/commands/setup.ts
src/commands/plugin.ts
src/commands/plugin-auth.ts                    # ONLY if no surviving caller (verify in Phase 3)
src/commands/group.ts
src/commands/group-authorized-list.ts          # group-command helpers (verify callers)
src/commands/group-user-id.ts
```

**Rewritten modules:**

```text
src/commands/config.ts            # launcher-only (drop the legacy editor + 4 removal-target imports)
src/chat/interaction-router.ts    # remove gsel:/cfg:/wizard_/plg:/tgl: branches → no routes remain
src/chat/interaction-router-support.ts  # drop editor/wizard-session helpers (keep group-target helpers if still used)
src/bot.ts                        # drop maybeInterceptWizard + setup/plugin registration; non-command text → orchestrator
src/commands/admin.ts             # drop /user, /users, /announce; keep broadcastMessage import only if still used elsewhere (it isn't — remove)
src/commands/catalog.ts           # drop setup/group/groups/user/users/announce/plugin entries + union members
src/commands/index.ts             # drop removed register* exports
src/commands/help.ts              # rewrite help text → point at /config; drop removed commands
src/commands/start.ts             # welcome text → /config (drop /setup)
src/llm-orchestrator.ts           # "not fully configured" reply → mention /config path
src/scheduler-instance.ts         # drop cleanupExpiredWizardSessions scheduling
src/debug/state-collector.ts      # drop getWizardSnapshots usage
src/chat/discord/group-settings.ts # drop handleGroupSettingsSelectorCallback usage (verify what remains)
```

**Docs:** `CLAUDE.md`, `src/commands/CLAUDE.md`, `src/chat/CLAUDE.md`, `README.md` (or user docs), `docs/ROADMAP.md`.

---

## Phasing (each phase is its own PR; do them in order)

- **Phase 0 — Parity gate.** Prove the UI covers every removed capability (spec §"Parity gate"). Authorizes everything after.
- **Phase 1 — Characterize the interception path.** Lock down normal-message handling with tests _before_ any deletion (spec risk: "Cover with tests before deleting").
- **Phase 2 — Flip `/config` to launcher-only** and delete the config-editor, wizard, selector-UI, tool/plugin/ai-output interaction handlers, the interaction-router branches, and the interception path (spec step 3).
- **Phase 3 — Remove management commands** `/setup`, `/plugin`, `/group`/`/groups`, `/user`/`/users`, `/announce` (spec step 4).
- **Phase 4 — Cleanup** dead modules, prune registrations + menu catalog, update `/help`/`/start`/"not configured", run knip to prove completeness, update docs (spec step 5).

Within a phase, **delete the test file together with the module it covers**, and run `bun knip` + `bun typecheck` as the completeness check after each deletion task.

---

# Phase 0 — Parity gate (authorizes all removal)

Hard removal is authorized only when the UI demonstrably covers every capability the removed flow offered. This phase records that proof. It changes no production code; it adds one focused automated parity test and a documented checklist.

### Task 0.1: Run the existing suites and record the parity checklist

**Files:**

- Create: `docs/superpowers/plans/2026-05-30-command-retirement-parity-gate.md` (the signed-off checklist artifact)

- [ ] **Step 1: Run the full suites and capture results**

Run: `bun test` then `bun test:client`
Expected: both green. Record the pass counts.

- [ ] **Step 2: Map each parity-gate item to the test(s) that prove it**

Create `docs/superpowers/plans/2026-05-30-command-retirement-parity-gate.md` with this table, filling the "Covered by" column from the existing Part A/B suites (these files already exist):

```markdown
# Command Retirement — Parity Gate Verification (2026-05-30)

| #   | Capability (removed flow)                                                            | UI equivalent                                                   | Covered by                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Every `getConfigFieldsForContext` field editable (personal + group)                  | `/settings/api/config` GET/PATCH                                | `tests/debug/settings/config-routes.test.ts` + new `tests/debug/settings/config-parity.test.ts` (Task 0.2)                                                                                                                      |
| 2   | Tool toggles: domain + per-tool                                                      | `/settings/api/tools` + `/tools/toggle`                         | `tests/debug/settings/tools-routes.test.ts`, `tests/client/settings/sections/ToolsSection.test.ts`                                                                                                                              |
| 3   | MCP add/edit/remove/enable + tool filters                                            | `/settings/api/mcp`                                             | `tests/debug/settings/mcp-routes.test.ts`, `tests/client/settings/sections/McpSection.test.ts`                                                                                                                                  |
| 4   | Plugin per-context enable/disable + config; admin approve/reject                     | `/settings/api/plugins*`, `/settings/api/admin/plugin-approval` | `tests/debug/settings/plugins-routes.test.ts`, `tests/debug/settings/admin/roster-plugins-routes.test.ts`, `tests/client/settings/sections/PluginsSection.test.ts`, `.../admin/AdminPluginsApprovalSection.test.ts`             |
| 5   | Group members; group auth; users; admin roster; system LLM; instances CRUD; announce | `/settings/api/group/*`, `/settings/api/admin/*`                | `tests/debug/settings/group-routes.test.ts`, `.../admin/instances-routes.test.ts`, `.../admin/system-access-routes.test.ts`, `.../admin/roster-plugins-routes.test.ts` + the matching `tests/client/settings/...` section tests |
| 6   | Identity link/clear                                                                  | `/settings/api/identity`                                        | `tests/debug/settings/identity-routes.test.ts`, `tests/client/settings/sections/IdentitySection.test.ts`                                                                                                                        |
| 7   | Kaneo group auto-provision                                                           | `/settings/api/provision/kaneo`                                 | `tests/debug/settings/provision-routes.test.ts`, `tests/client/settings/sections/TaskProviderSection.test.ts`                                                                                                                   |
| 8   | Authorization parity (same principals can/can't do the same things)                  | `requireScope` + admin guards                                   | `tests/settings/scope-guard.test.ts`, `tests/debug/settings/admin/admin-guard.test.ts` + new `tests/debug/settings/config-parity.test.ts` (Task 0.2)                                                                            |

All rows must be ✅ before Phase 2. Manually exercise any row whose automated coverage you find thin and note the result here.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-30-command-retirement-parity-gate.md
git commit -m "docs(retirement): parity-gate verification checklist"
```

### Task 0.2: Automated config-field + authorization parity test

This pins the two cross-cutting guarantees (gate items 1 and 8): every config field the chat editor exposed is editable through the settings API, and an out-of-scope principal is rejected.

**Files:**

- Test: `tests/debug/settings/config-parity.test.ts`

- [ ] **Step 1: Read the existing config-routes test to reuse its harness**

Run: `sed -n '1,60p' tests/debug/settings/config-routes.test.ts`
Note the helpers it uses to build an authenticated settings request (session creation, CSRF header, `handleConfigRoutes`) and a personal `contextId`. Reuse exactly that harness — do not invent a new one.

- [ ] **Step 2: Write the parity test**

`tests/debug/settings/config-parity.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getConfigFieldsForContext } from '../../../src/config-keys.js'
import { handleConfigRoutes } from '../../../src/debug/settings/config-routes.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
// NOTE: import the SAME authenticated-request + personal-context helpers that
// tests/debug/settings/config-routes.test.ts uses (Step 1). Named here as
// `buildAuthedGet` / `personalContextId` — rename to match that file's actual helpers.
import { buildAuthedGet, personalContextId } from './config-routes.test-helpers.js'

describe('config parity gate', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('every config field is present in the settings API GET response', async () => {
    const contextId = personalContextId()
    const res = await handleConfigRoutes(
      buildAuthedGet(contextId),
      new URL(`https://x/settings/api/config?contextId=${encodeURIComponent(contextId)}`),
    )
    const body = (await res.json()) as { fields: Array<{ key: string; storageKey: string }> }
    const exposedKeys = new Set(body.fields.map((f) => f.storageKey))
    for (const field of getConfigFieldsForContext(contextId)) {
      expect(exposedKeys.has(field.storageKey)).toBe(true)
    }
  })

  test('an unauthenticated request is rejected (authorization parity)', async () => {
    const res = await handleConfigRoutes(
      new Request('https://x/settings/api/config?contextId=anything'),
      new URL('https://x/settings/api/config?contextId=anything'),
    )
    expect(res.status).toBe(401)
  })
})
```

> If `config-routes.test.ts` defines its auth helpers inline rather than in a shared `config-routes.test-helpers.ts`, extract the minimal `buildAuthedGet`/`personalContextId` into a small shared `tests/debug/settings/config-routes.test-helpers.ts` first (move, don't duplicate) and import it from both files.

- [ ] **Step 3: Run it**

Run: `bun test tests/debug/settings/config-parity.test.ts`
Expected: PASS (both tests).

- [ ] **Step 4: Commit**

```bash
git add tests/debug/settings/config-parity.test.ts tests/debug/settings/config-routes.test-helpers.ts 2>/dev/null; git add tests/debug/settings/
git commit -m "test(retirement): config-field + authorization parity gate"
```

---

# Phase 1 — Characterize the interception path before deleting it

The `bot.ts` → `bot-settings.ts:maybeInterceptWizard` pipeline is a hard gate: when it returns `true`, the message never reaches `enqueueMessage`/the orchestrator. The spec flags this as entangled with the queue. Before deleting it (Phase 2), pin the behavior that must survive: **a normal authorized message reaches the orchestrator queue.**

### Task 1.1: Characterization test for normal-message → orchestrator

**Files:**

- Test: `tests/bot-interception-characterization.test.ts`

- [ ] **Step 1: Read `tests/bot.test.ts` for the existing harness**

Run: `grep -n "enqueueMessage\|processMessage\|onIncomingMessage\|setupBot\|BotDeps\|not be intercepted" tests/bot.test.ts | head -40`
Identify how `tests/bot.test.ts` constructs a bot with injectable `BotDeps` (it injects `processMessage` and/or `enqueueMessage`) and drives an incoming message. Reuse that exact harness.

- [ ] **Step 2: Write characterization tests**

`tests/bot-interception-characterization.test.ts` — assert the queue path for normal traffic (these must hold both before and after Phase 2):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { mockLogger, setupTestDb } from './utils/test-helpers.js'
// Reuse the SAME bot harness tests/bot.test.ts uses (Step 1): a helper that wires
// setupBot with an injectable enqueueMessage spy and feeds an IncomingMessage.
// Named here as `runIncoming` + `makeAuthorizedDm` — rename to match bot.test.ts.
import { makeAuthorizedDm, runIncoming } from './bot.test-harness.js'

describe('bot interception characterization', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('a normal authorized DM message is enqueued to the orchestrator', async () => {
    const enqueue = mock(() => undefined)
    await runIncoming(makeAuthorizedDm('create a task please'), { enqueueMessage: enqueue })
    expect(enqueue).toHaveBeenCalledTimes(1)
  })

  test('a command message (/help) is NOT enqueued (handled by the command router)', async () => {
    const enqueue = mock(() => undefined)
    await runIncoming(makeAuthorizedDm('/help'), { enqueueMessage: enqueue })
    expect(enqueue).not.toHaveBeenCalled()
  })
})
```

> If `tests/bot.test.ts` has no extractable harness, build a minimal one inline in this file using `setupBot` (from `src/bot.ts`) + a fake `ChatProvider` that captures the registered `onMessage` handler, then call that handler with a constructed `IncomingMessage`. Keep it in this test file; do not modify `src/bot.ts` for testability beyond the already-present `BotDeps.enqueueMessage` injection seam.

- [ ] **Step 3: Run them (they must pass against the CURRENT code)**

Run: `bun test tests/bot-interception-characterization.test.ts`
Expected: PASS. These tests encode the invariant that survives Phase 2. (After Phase 2 they must still pass unchanged — that is the safety proof.)

- [ ] **Step 4: Commit**

```bash
git add tests/bot-interception-characterization.test.ts tests/bot.test-harness.ts 2>/dev/null; git add tests/
git commit -m "test(retirement): characterize normal-message orchestrator path before interception removal"
```

---

# Phase 2 — Launcher-only `/config` + remove the interaction & interception layers

**Dependency ordering note (important):** `src/wizard/` and `src/group-settings/selector.ts` are also imported by `src/commands/setup.ts`, which is not removed until Phase 3. So Phase 2 removes everything that wires those modules into the _interaction/interception_ path and updates the non-command callers (`scheduler-instance.ts`, `debug/state-collector.ts`, `discord/group-settings.ts`), leaving `wizard/` and `selector.ts` referenced **only by `setup.ts`**. They are physically deleted in Phase 3. After every task: `bun typecheck` must pass, and the Phase 1 characterization tests must still pass.

### Task 2.1: Rewrite `/config` to launcher-only

**Files:**

- Modify (rewrite): `src/commands/config.ts`
- Test: `tests/commands/config.test.ts`

- [ ] **Step 1: Update the test to the launcher-only contract**

Open `tests/commands/config.test.ts`. Remove every test that exercises the legacy in-chat flow (`renderConfigForTarget`, `replyWithConfigSelection`, field buttons, plugin/tool buttons, AI-output section, the group-settings selector). Keep/add these behaviors and add the missing `not_configured` case:

```ts
// keep: group redirect (admin) + admin-only message (non-admin) in group context
// keep: link.kind === 'ok' replies with the URL + single-use warning
// keep: link.kind === 'rate_limited' replies with a throttle message
// add:  link.kind === 'not_configured' replies with the "ask the administrator to set SETTINGS_PUBLIC_BASE_URL" message
```

Concretely, add this test (mirror the file's existing harness for building `msg`/`reply`/`auth` and for stubbing `issueSettingsLink`; the existing tests already stub it for the `ok`/`rate_limited` cases):

```ts
test('replies with a not-configured message when SETTINGS_PUBLIC_BASE_URL is unset', async () => {
  // Arrange the issueSettingsLink stub to return { kind: 'not_configured' }
  // (the file already has a seam for this — reuse it; otherwise delete SETTINGS_PUBLIC_BASE_URL from process.env in this test).
  const { reply, sent } = makeReply()
  await runConfig(makeAuthorizedDm(''), reply)
  expect(sent.text).toContain('SETTINGS_PUBLIC_BASE_URL')
})
```

- [ ] **Step 2: Run the test to verify the new case fails**

Run: `bun test tests/commands/config.test.ts`
Expected: FAIL on the not-configured case (the current code falls back to the legacy flow instead of replying with the env-var message).

- [ ] **Step 3: Rewrite `src/commands/config.ts`**

Replace the entire file with the launcher-only version (drops the legacy editor, the `ai-output-config-ui`, `config-editor`, `group-settings/selector`, tool-prefs, and plugin-registry imports):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, CommandHandler } from '../chat/types.js'
import { logger } from '../logger.js'
import { issueSettingsLink } from '../settings/issue-link.js'

const log = logger.child({ scope: 'commands:config' })

const GROUP_CONFIG_REDIRECT =
  'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.'
const GROUP_CONFIG_ADMIN_ONLY =
  'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.'
const NOT_CONFIGURED =
  'The settings UI is not configured on this deployment. Ask the administrator to set SETTINGS_PUBLIC_BASE_URL.'

export function registerConfigCommand(chat: ChatProvider): void {
  const handler: CommandHandler = async (msg, reply, auth) => {
    if (!auth.allowed) return

    if (msg.contextType === 'group') {
      await reply.text(auth.isGroupAdmin ? GROUP_CONFIG_REDIRECT : GROUP_CONFIG_ADMIN_ONLY)
      return
    }

    const link = issueSettingsLink({ platformInstanceId: msg.platformInstanceId, platformUserId: msg.user.id })
    if (link.kind === 'ok') {
      log.info({ userId: msg.user.id }, '/config issued settings link')
      await reply.formatted(
        `🔧 Open your settings: ${link.url}\n\n⚠️ This link is single-use and expires in 10 minutes. Do not share it.`,
      )
      return
    }
    if (link.kind === 'rate_limited') {
      const minutes = Math.max(1, Math.ceil(link.retryAfterSec / 60))
      await reply.text(`Too many settings links requested. Please try again in ${minutes} minute(s).`)
      return
    }

    log.warn({ userId: msg.user.id }, '/config requested but settings UI is not configured')
    await reply.text(NOT_CONFIGURED)
  }

  chat.registerCommand('config', handler)
}
```

> Note: `registerConfigCommand` previously accepted a vestigial `..._rest` param. `src/bot.ts` calls it as `registerConfigCommand(observedChat)`, so the simplified single-arg signature is compatible. If `tests/commands/config.test.ts` calls it with extra args, drop those args in the test.

- [ ] **Step 4: Run typecheck + the test**

Run: `bun typecheck && bun test tests/commands/config.test.ts`
Expected: typecheck clean; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/config.ts tests/commands/config.test.ts
git commit -m "feat(retirement): /config is launcher-only (drop legacy in-chat editor)"
```

### Task 2.2: Empty the interaction router (remove all config-flow branches)

Every branch in `routeInteraction` (`gsel:`, `cfg:`, `wizard_`, `plg:`, `tgl:`) is a removed config flow. After removal, no callback prefixes remain (the web UI uses HTTP, not chat callbacks), so the router becomes an auth-check that matches nothing.

**Files:**

- Modify (rewrite): `src/chat/interaction-router.ts`
- Test: `tests/chat/interaction-router.test.ts`

- [ ] **Step 1: Rewrite the test to the empty-router contract**

Replace `tests/chat/interaction-router.test.ts` with a minimal suite (the old branch-routing tests cover deleted behavior):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { routeInteraction } from '../../src/chat/interaction-router.js'
import type { AuthorizationResult, IncomingInteraction, ReplyFn } from '../../src/chat/types.js'

const auth = (allowed: boolean): AuthorizationResult =>
  ({ allowed, isBotAdmin: false, isGroupAdmin: false, storageContextId: 'tg:u1' }) as AuthorizationResult

const interaction = (callbackData: string): IncomingInteraction =>
  ({
    user: { id: 'u1' },
    callbackData,
    contextType: 'dm',
    platformInstanceId: 'tg',
  }) as unknown as IncomingInteraction

const makeReply = (): { reply: ReplyFn; texts: string[] } => {
  const texts: string[] = []
  const reply = {
    text: (t: string) => {
      texts.push(t)
      return Promise.resolve()
    },
    formatted: () => Promise.resolve(),
    typing: () => Promise.resolve(),
    buttons: () => Promise.resolve(),
  } as unknown as ReplyFn
  return { reply, texts }
}

describe('routeInteraction (post-retirement)', () => {
  test('rejects an unauthorized interaction', async () => {
    const { reply, texts } = makeReply()
    const handled = await routeInteraction(interaction('anything'), reply, auth(false))
    expect(handled).toBe(true)
    expect(texts[0]).toContain('not authorized')
  })

  test('matches no route for any callback and returns false', async () => {
    const { reply } = makeReply()
    for (const data of ['cfg:edit:x', 'gsel:foo', 'wizard_confirm', 'plg:enable:p', 'tgl:dom:x', 'whatever']) {
      expect(await routeInteraction(interaction(data), reply, auth(true))).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test tests/chat/interaction-router.test.ts`
Expected: FAIL (current router still routes those prefixes / imports modules being deleted).

- [ ] **Step 3: Rewrite `src/chat/interaction-router.ts`**

Replace the entire file with the reduced router (no branch imports, no handler functions):

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'

import type { AuthorizationResult, IncomingInteraction, ReplyFn } from './types.js'

const log = logger.child({ scope: 'chat:interaction-router' })

/**
 * Interactive chat callbacks were retired with the move to the settings web UI.
 * No callback prefixes are produced anymore; this router authorizes the actor and
 * otherwise matches nothing. Kept as the single interaction entry point so adapters
 * that still emit interaction events have a safe sink.
 */
export function routeInteraction(
  interaction: IncomingInteraction,
  reply: ReplyFn,
  auth: AuthorizationResult,
): Promise<boolean> {
  if (!auth.allowed) {
    return reply.text('You are not authorized to use this bot.').then(() => true)
  }
  log.debug({ callbackData: interaction.callbackData }, 'No route matched for interaction callback')
  return Promise.resolve(false)
}
```

> This drops the `InteractionRouteDeps`/`InteractionRouteHandlers` exports and the `...rest` deps param. Verify no other file imports `InteractionRouteDeps` (it was a test seam): `grep -rn "InteractionRouteDeps\|InteractionRouteHandlers" src tests`. Update `src/bot.ts`'s `routeInteraction(...)` call if it passed deps (it calls `routeInteraction(interaction, reply, auth)` already — no change needed).

- [ ] **Step 4: Typecheck — expect errors pointing at now-orphaned modules**

Run: `bun typecheck`
Expected: errors ONLY from files that will be deleted later in this phase (the old handler modules are no longer imported, which is fine) — but `interaction-router.ts` itself must compile. If typecheck flags a _surviving_ file importing a router export you removed, fix that caller. Do not proceed until `interaction-router.ts` and all surviving files compile.

- [ ] **Step 5: Run the router test**

Run: `bun test tests/chat/interaction-router.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/chat/interaction-router.ts tests/chat/interaction-router.test.ts
git commit -m "refactor(retirement): interaction router has no config-flow routes"
```

### Task 2.3: Remove the message-interception path from `bot.ts`

**Files:**

- Modify: `src/bot.ts` (imports + `registerCommands` + `onIncomingMessage`)
- Test: `tests/bot-interception-characterization.test.ts` (must still pass, unchanged)

- [ ] **Step 1: Edit `src/bot.ts` — drop the interception block in `onIncomingMessage`**

In `onIncomingMessage` (around lines 228–240), delete the `sourceChat`/`maybeInterceptWizard` block so the function flows straight to staging + `handleMessage`:

```ts
if (auth.allowed) recordGroupObservation(chat, msg)
tryStageGroupCandidates(chat, msg, auth.storageContextId)
await handleMessage(chat, msg, tracked.reply, auth, deps)
if (!willQueueAuthorizedMessage(msg, auth))
  emitReplyCompletedIfNeeded(tracked, msg.user.id, auth.storageContextId, start)
```

- [ ] **Step 2: Edit `src/bot.ts` — drop now-unused imports + registrations**

- Remove `import { autoStartWizardIfNeeded } from './bot-auto-setup.js'`
- Remove `import { maybeInterceptWizard } from './bot-settings.js'`
- Remove `registerSetupCommand` and `registerPluginCommand` from the `./commands/index.js` import list AND from `registerCommands()` (lines 114 + 120).
- If `supportsInteractiveButtons` (from `./chat/capabilities.js`) and `resolveSourceChatProvider` (from `./chat/source-instance.js`) are now unused in `bot.ts`, remove those imports too. Check with `grep -n "supportsInteractiveButtons\|resolveSourceChatProvider" src/bot.ts` after the edit.

> `registerSetupCommand`/`registerPluginCommand` still exist in `src/commands/index.js` at this point (their command files are deleted in Phase 3). Removing them from the _import + call list_ here is fine; Phase 3 deletes the modules + the index exports.

- [ ] **Step 3: Typecheck + characterization tests**

Run: `bun typecheck && bun test tests/bot-interception-characterization.test.ts tests/bot.test.ts`
Expected: typecheck clean (modulo orphaned-but-not-yet-deleted modules — those are deleted in 2.4–2.8); the characterization tests PASS unchanged (the orchestrator path is preserved). Some `tests/bot.test.ts` cases that asserted _interception_ behavior will now fail — delete those specific cases (e.g. "intercepted by wizard" expectations), keeping the normal-message and command cases.

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "refactor(retirement): non-command text goes straight to the orchestrator (remove interception)"
```

### Task 2.4: Delete the interception modules (`bot-settings.ts`, `bot-auto-setup.ts`)

**Files:**

- Delete: `src/bot-settings.ts`, `src/bot-auto-setup.ts`
- Delete: `tests/bot-settings.test.ts`, `tests/bot-auto-setup.test.ts`

- [ ] **Step 1: Confirm no surviving importer**

Run: `grep -rn "bot-settings\|bot-auto-setup\|maybeInterceptWizard\|autoStartWizardIfNeeded" src tests`
Expected: matches only inside the files being deleted (and the now-removed `bot.ts` imports from 2.3). If a surviving `src/` file imports them, stop and reassess.

- [ ] **Step 2: Delete the files**

```bash
git rm src/bot-settings.ts src/bot-auto-setup.ts tests/bot-settings.test.ts tests/bot-auto-setup.test.ts
```

- [ ] **Step 3: Typecheck**

Run: `bun typecheck`
Expected: clean except for the still-orphaned config-editor/wizard/handler modules deleted in 2.5–2.8. (`bot-settings`/`bot-auto-setup` removal itself must not break any surviving file.)

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(retirement): delete message-interception modules"
```

---

### Task 2.5: Delete the tool/plugin/AI-output interaction handlers

**Files:**

- Delete: `src/chat/tool-toggle-interaction-handler.ts`, `src/commands/tool-config-view.ts`, `src/chat/plugin-interaction-handler.ts`, `src/ai-output-config-ui.ts`, `src/chat/ai-output-config-interaction.ts`
- Delete their tests (find with the grep below).

- [ ] **Step 1: Confirm orphan status**

Run:

```bash
grep -rn "tool-toggle-interaction-handler\|tool-config-view\|plugin-interaction-handler\|ai-output-config-ui\|ai-output-config-interaction\|handleToolToggleInteraction\|handlePluginInteraction\|handleAiOutputConfigInteraction\|buildAiOutputConfigSection\|parseAiOutputCallbackData" src tests
```

Expected: matches only inside these five modules and their own test files. (`config.ts` dropped `buildAiOutputConfigSection` in 2.1; `interaction-router.ts` dropped the handlers in 2.2.) If a surviving `src/` file matches, stop and reassess — `tool-config-view.ts` helpers in particular must not be used by any surviving tool code (the web tools route uses `src/tools/*`, not this view module).

- [ ] **Step 2: Delete the modules + their tests**

```bash
git rm src/chat/tool-toggle-interaction-handler.ts src/commands/tool-config-view.ts \
       src/chat/plugin-interaction-handler.ts src/ai-output-config-ui.ts \
       src/chat/ai-output-config-interaction.ts
# delete the matching test files reported by Step 1, e.g.:
git rm tests/chat/tool-toggle-interaction-handler.test.ts tests/commands/tool-config-view.test.ts \
       tests/chat/plugin-interaction-handler.test.ts tests/ai-output-config-ui.test.ts \
       tests/chat/ai-output-config-interaction.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Typecheck + tests**

Run: `bun typecheck && bun test tests/chat/ tests/commands/`
Expected: clean (modulo config-editor/wizard modules deleted in 2.6/2.7). No surviving file should reference the deleted handlers.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(retirement): delete tool/plugin/ai-output interaction handlers"
```

### Task 2.6: Delete the config-editor presentation + its integration/support modules (KEEP `validation.ts`)

**Files:**

- Delete: `src/config-editor/callback-data.ts`, `src/config-editor/handlers.ts`, `src/config-editor/index.ts`, `src/config-editor/state.ts`, `src/config-editor/types.ts`
- Keep: `src/config-editor/validation.ts`
- Delete: `src/chat/config-editor-integration.ts`, `src/chat/interaction-router-config.ts`, `src/chat/interaction-router-support.ts` (if fully orphaned — see Step 1)
- Delete the matching tests.

- [ ] **Step 1: Confirm orphan status and that `validation.ts` survives with its callers intact**

Run:

```bash
grep -rn "config-editor/index\|config-editor/handlers\|config-editor/state\|config-editor/callback-data\|config-editor/types\|config-editor-integration\|interaction-router-config\|interaction-router-support" src tests
echo "--- validation.ts must still be imported by the settings layer ---"
grep -rn "config-editor/validation" src
```

Expected: the first grep matches only the to-be-deleted modules + tests. The second grep shows `src/debug/settings/config-routes.ts` (and possibly others) importing `validateConfigField` from `config-editor/validation.js` — these MUST remain. If `interaction-router-support.ts` still has a _surviving_ importer (e.g. a Discord helper using `getValidatedDmCallbackTargetContextId`), do NOT delete it whole — instead delete only its config-editor/wizard-session helpers (`getEditorSession`/`getWizardSession` usages) and keep the surviving exports. Record which case applies.

- [ ] **Step 2: Delete (full-orphan case)**

```bash
git rm src/config-editor/callback-data.ts src/config-editor/handlers.ts src/config-editor/index.ts \
       src/config-editor/state.ts src/config-editor/types.ts \
       src/chat/config-editor-integration.ts src/chat/interaction-router-config.ts \
       src/chat/interaction-router-support.ts
# matching tests:
git rm tests/config-editor/handlers.test.ts tests/config-editor/handlers-events.test.ts \
       tests/config-editor/index.test.ts tests/config-editor/state.test.ts tests/config-editor/types.test.ts \
       tests/chat/config-editor-integration.test.ts 2>/dev/null || true
# KEEP tests/config-editor/validation.test.ts
```

> If `interaction-router-support.ts` had a surviving caller (Step 1), keep that file and only remove its `getEditorSession`/`getWizardSession` imports + the functions that used them; keep `tests/chat/interaction-router-support.test.ts` trimmed to the surviving exports.

- [ ] **Step 3: Typecheck + the kept validation test**

Run: `bun typecheck && bun test tests/config-editor/validation.test.ts tests/debug/settings/config-routes.test.ts`
Expected: clean; `validateConfigField` still works for the settings layer.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(retirement): delete config-editor presentation (keep validation.ts)"
```

### Task 2.7: Delete `wizard-integration.ts` and drop wizard usage from the non-command callers

This severs the wizard from everything **except** `src/commands/setup.ts` (deleted in Phase 3). `src/wizard/` itself stays until Phase 3.

**Files:**

- Delete: `src/wizard-integration.ts` + `tests/wizard-integration.test.ts`
- Modify: `src/scheduler-instance.ts` (drop `cleanupExpiredWizardSessions` scheduling)
- Modify: `src/debug/state-collector.ts` (drop `getWizardSnapshots` usage)
- Modify: `src/chat/discord/group-settings.ts` (drop `handleGroupSettingsSelectorCallback` usage)

- [ ] **Step 1: Find the exact usages to remove**

Run:

```bash
grep -n "cleanupExpiredWizardSessions\|wizard" src/scheduler-instance.ts
grep -n "getWizardSnapshots\|wizard" src/debug/state-collector.ts
grep -n "handleGroupSettingsSelectorCallback\|selector" src/chat/discord/group-settings.ts
grep -rn "wizard-integration\|handleWizardMessage" src tests
```

- [ ] **Step 2: Remove `cleanupExpiredWizardSessions` from `src/scheduler-instance.ts`**

Delete the import of `cleanupExpiredWizardSessions` (from `./wizard/state.js`) and the scheduled-job registration/call that invokes it. If that was the only body of a periodic callback, remove the now-empty callback wiring too. Run `bun typecheck` to confirm nothing else referenced it.

- [ ] **Step 3: Remove `getWizardSnapshots` from `src/debug/state-collector.ts`**

Delete the import of `getWizardSnapshots` (from `../wizard/state.js`) and the field/section of the collected debug state that used it. If a test (`tests/debug/state-collector*.test.ts`) asserts that field, update it to drop the wizard snapshot expectation.

- [ ] **Step 4: Remove the selector callback from `src/chat/discord/group-settings.ts`**

Inspect what this Discord helper does with `handleGroupSettingsSelectorCallback`. Since group-settings _selection UI_ is retired, remove the import and the branch that dispatched selector callbacks. If the file becomes empty/no-op, delete it and remove its wiring from the Discord adapter (grep `discord/group-settings` to find the importer and drop the call). Update/trim any `tests/chat/discord/group-settings*.test.ts`.

- [ ] **Step 5: Delete `wizard-integration.ts` + its test**

```bash
git rm src/wizard-integration.ts tests/wizard-integration.test.ts
```

- [ ] **Step 6: Typecheck + targeted tests**

Run: `bun typecheck && bun test tests/scheduler-instance.test.ts tests/debug/state-collector.test.ts 2>/dev/null; bun test tests/chat/discord/`
Expected: typecheck clean. `src/wizard/**` now compiles but is imported only by `src/commands/setup.ts`. Do NOT run `bun knip` yet (wizard exports look partially unused until setup.ts is removed in Phase 3).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(retirement): sever wizard/selector from non-command callers"
```

### Task 2.8: Phase 2 green checkpoint

- [ ] **Step 1: Full suites + typecheck + lint**

Run: `bun typecheck && bun lint && bun test && bun test:client`
Expected: all green. The Phase 1 characterization tests pass unchanged. `src/wizard/` and `src/group-settings/selector.ts` remain, imported only by `src/commands/setup.ts`.

- [ ] **Step 2: Commit any fixups**

```bash
git add -A && git commit -m "test(retirement): phase 2 green checkpoint" || true
```

---

# Phase 3 — Remove the management commands

`src/bot.ts` already stopped registering `/setup` and `/plugin` (Task 2.3). This phase deletes the command modules, removes the remaining registrations (`/group`, `/user`/`/users`/`/announce`), and — because `setup.ts` was the last importer — deletes the orphaned `wizard/`, `selector.ts`, and group-command helper modules.

### Task 3.1: Remove `/setup` and delete the now-orphaned wizard + selector + task-instance-selection

**Files:**

- Delete: `src/commands/setup.ts`, `src/wizard/` (whole dir), `src/group-settings/selector.ts`, `src/setup/task-instance-selection.ts`
- Modify: `src/commands/index.ts` (drop `registerSetupCommand` export)
- Delete the matching tests.

- [ ] **Step 1: Confirm `setup.ts` is the last importer of wizard + selector**

Run:

```bash
grep -rn "commands/setup\|registerSetupCommand\|startWizardForAssignedTask" src tests
grep -rn "from '.*wizard/\|from '.*group-settings/selector\|task-instance-selection" src
```

Expected (first): `setup.ts` + `src/commands/index.ts` + tests only (bot.ts dropped it in 2.3). Expected (second): `wizard/` and `selector.ts` imported only by `src/commands/setup.ts` (and `wizard/` internal cross-imports); `task-instance-selection` only by `setup.ts`. If any other surviving `src/` file imports them, stop.

- [ ] **Step 2: Delete the modules + their tests**

```bash
git rm src/commands/setup.ts src/setup/task-instance-selection.ts src/group-settings/selector.ts
git rm -r src/wizard
git rm tests/commands/setup.test.ts tests/group-settings/selector.test.ts
git rm -r tests/wizard 2>/dev/null || true
git rm tests/setup/task-instance-selection.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Remove `registerSetupCommand` from `src/commands/index.ts`**

Delete its `export { registerSetupCommand } from './setup.js'` line (and any re-export). Run `grep -n "registerSetupCommand" src/commands/index.ts` to confirm it's gone.

- [ ] **Step 4: Typecheck**

Run: `bun typecheck`
Expected: clean. `src/group-settings/access.ts`, `target-validation.ts`, `state.ts`, `dispatch.ts` remain (kept per spec).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(retirement): remove /setup; delete wizard + group-settings selector"
```

### Task 3.2: Remove `/plugin`

**Files:**

- Delete: `src/commands/plugin.ts` + `tests/commands/plugin.test.ts`
- Modify: `src/commands/index.ts` (drop `registerPluginCommand` export)
- Conditionally delete: `src/commands/plugin-auth.ts` (only if orphaned)

- [ ] **Step 1: Confirm orphan status of `plugin.ts` and check `plugin-auth.ts`**

Run:

```bash
grep -rn "commands/plugin'\|registerPluginCommand\|runPluginSubcommand" src tests
grep -rn "plugin-auth\|canManageTargetContext\|getTargetContextId\|hasExplicitTargetContext\|replyTargetAuthorizationFailure\|canManageInteractionTargetContext" src tests
```

`registerPluginCommand`: should be `plugin.ts` + `index.ts` + tests only (bot.ts dropped it in 2.3). For `plugin-auth.ts`: note its surviving callers. `canManageInteractionTargetContext` was used by `tool-toggle-interaction-handler.ts` (deleted 2.5). If `plugin-auth.ts` is now imported only by `plugin.ts` (being deleted) and its own test, delete it too; otherwise keep it.

- [ ] **Step 2: Delete `plugin.ts` (+ `plugin-auth.ts` if orphaned) + tests**

```bash
git rm src/commands/plugin.ts tests/commands/plugin.test.ts
# only if Step 1 showed plugin-auth.ts orphaned:
git rm src/commands/plugin-auth.ts tests/commands/plugin-auth.test.ts 2>/dev/null || true
```

- [ ] **Step 3: Remove `registerPluginCommand` from `src/commands/index.ts`**

Delete its export line; confirm with `grep -n registerPluginCommand src/commands/index.ts`.

- [ ] **Step 4: Typecheck + commands tests**

Run: `bun typecheck && bun test tests/commands/`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(retirement): remove /plugin (admin plugin mgmt is UI-only)"
```

### Task 3.3: Remove `/group` and `/groups`

**Files:**

- Delete: `src/commands/group.ts` + `tests/commands/group.test.ts`
- Conditionally delete: `src/commands/group-authorized-list.ts`, `src/commands/group-user-id.ts` (only if orphaned)
- Modify: `src/commands/index.ts` (drop `registerGroupCommand` export); `src/bot.ts` (drop `registerGroupCommand` import + call + the `shouldDeferUnauthorizedDmCommand` `group`/`groups` special-case)

- [ ] **Step 1: Confirm orphan status**

Run:

```bash
grep -rn "registerGroupCommand\|commands/group'" src tests
grep -rn "group-authorized-list\|group-user-id\|extractGroupUserId" src tests
```

`registerGroupCommand`: `group.ts` + `index.ts` + `bot.ts` + tests. For the helpers: if `group-authorized-list.ts`/`group-user-id.ts` are imported only by `group.ts` (deleted) + tests, delete them; otherwise keep. (`extractGroupUserId` may be used by other group flows — verify.)

- [ ] **Step 2: Edit `src/bot.ts`**

- Remove `registerGroupCommand` from the `./commands/index.js` import list and from `registerCommands()`.
- In `shouldDeferUnauthorizedDmCommand`, remove the `group`/`groups` cases. If that leaves the function always returning `false`, delete the function and its single call site in `createObservedCommandHandler` (the `if (shouldDeferUnauthorizedDmCommand(...))` branch), simplifying to always reply-unauthorized. Verify with `bun typecheck`.

- [ ] **Step 3: Delete `group.ts` (+ helpers if orphaned) + tests**

```bash
git rm src/commands/group.ts tests/commands/group.test.ts
# only if Step 1 showed them orphaned:
git rm src/commands/group-authorized-list.ts src/commands/group-user-id.ts 2>/dev/null || true
git rm tests/commands/group-authorized-list.test.ts tests/commands/group-user-id.test.ts 2>/dev/null || true
```

- [ ] **Step 4: Remove `registerGroupCommand` from `src/commands/index.ts`**

- [ ] **Step 5: Typecheck + commands/bot tests**

Run: `bun typecheck && bun test tests/commands/ tests/bot.test.ts`
Expected: clean. Group authorization data (`src/authorized-groups.ts`, `src/groups.ts`) and the unauthorized-group reply text in `bot.ts` remain.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(retirement): remove /group and /groups (membership + auth move to UI)"
```

### Task 3.4: Remove `/user`, `/users`, `/announce` (keep the extracted broadcast)

**Files:**

- Delete: `src/commands/admin.ts` + `tests/commands/admin.test.ts` (if `admin.ts` only contains `registerAdminCommands` for user/users/announce)
- Keep: `src/commands/announce-broadcast.ts` (+ `tests/commands/announce-broadcast.test.ts`) — still used by the settings admin route.
- Modify: `src/commands/index.ts` (drop `registerAdminCommands` export); `src/bot.ts` (drop the import + call)

- [ ] **Step 1: Confirm `admin.ts` scope and that broadcast survives**

Run:

```bash
grep -n "export" src/commands/admin.ts
grep -rn "registerAdminCommands" src tests
grep -rn "announce-broadcast\|broadcastMessage" src tests
```

Confirm `admin.ts` only exports `registerAdminCommands` (the user/users/announce handlers). Confirm `broadcastMessage` is imported by `src/debug/settings/admin/roster-plugins-routes.ts` (must survive). If `admin.ts` exports anything else still used, extract that first; do not delete it blindly.

- [ ] **Step 2: Edit `src/bot.ts`**

Remove `registerAdminCommands` from the `./commands/index.js` import list and from `registerCommands()` (it was called as `registerAdminCommands(observedChat, adminUserId)`). If `adminUserId` becomes unused in `registerCommands` after this and the `/clear` registration still needs it, leave it; otherwise remove the now-unused parameter usage. Verify with `bun typecheck`.

- [ ] **Step 3: Delete `admin.ts` + its test**

```bash
git rm src/commands/admin.ts tests/commands/admin.test.ts
```

- [ ] **Step 4: Remove `registerAdminCommands` from `src/commands/index.ts`**

- [ ] **Step 5: Typecheck + tests (broadcast must still pass)**

Run: `bun typecheck && bun test tests/commands/announce-broadcast.test.ts tests/debug/settings/admin/roster-plugins-routes.test.ts`
Expected: clean; the broadcast + its settings-route caller still work.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(retirement): remove /user, /users, /announce commands (keep broadcast fn)"
```

---

# Phase 4 — Cleanup: menu, help/start text, knip, docs

### Task 4.1: Prune the command-menu catalog

**Files:**

- Modify: `src/commands/catalog.ts`
- Test: `tests/commands/` catalog/index test(s) (find with grep)

- [ ] **Step 1: Find the catalog/registration parity test**

Run: `grep -rln "COMMAND_CATALOG\|listCommandCatalogEntries\|catalog" tests/`
Open the file(s) and note any assertion that the catalog's `registration` values match the actually-registered commands, or that specific command names are present.

- [ ] **Step 2: Edit `src/commands/catalog.ts`**

Reduce `CommandRegistration` to only the surviving registrations and `COMMAND_CATALOG` to only the surviving commands:

```ts
export type CommandRegistration =
  | 'registerClearCommand'
  | 'registerConfigCommand'
  | 'registerContextCommand'
  | 'registerDashboardCommand'
  | 'registerHelpCommand'
  | 'registerStartCommand'
```

Delete the `setup`, `group`, `groups`, `user`, `users`, `announce`, and `plugin` entries from `COMMAND_CATALOG`. Keep `help`, `start`, `config`, `context`, `clear`, `dashboard`. Update the `config` entry's description to reflect the launcher (e.g. `'Open your settings in the web UI'`).

- [ ] **Step 3: Update the catalog/index test(s)**

Adjust any assertions to the new command set (no setup/group/groups/user/users/announce/plugin). If a test asserted the Telegram menu scopes (`all_private_chats`, admin chat scope, group scopes), update the expected command lists.

- [ ] **Step 4: Typecheck + tests**

Run: `bun typecheck && bun test tests/commands/ tests/chat/telegram/ tests/chat/startup.test.ts 2>/dev/null; bun test tests/chat/`
Expected: clean. The published Telegram menu no longer advertises removed commands.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(retirement): prune command menu catalog"
```

### Task 4.2: Update `/help` text

**Files:**

- Modify: `src/commands/help.ts`
- Test: `tests/commands/help.test.ts`

- [ ] **Step 1: Update the test expectations**

In `tests/commands/help.test.ts`, change assertions so DM help mentions `/config` (web settings) and NO LONGER mentions `/setup`, `/user`, `/group`, `/groups`, `/users`, `/announce`; group help no longer mentions `/group adduser`/`deluser`/`users`. Assert the new pointer to `/config` for settings.

- [ ] **Step 2: Run it to verify failure**

Run: `bun test tests/commands/help.test.ts`
Expected: FAIL against the current text.

- [ ] **Step 3: Rewrite the help strings in `src/commands/help.ts`**

```ts
const DM_USER_HELP = [
  'papai — AI assistant for Kaneo task management',
  '',
  'Commands:',
  '/help — Show this message',
  '/config — Open your settings in the web UI (single-use link)',
  '/clear — Clear conversation history and memory',
  '/context — Show current memory context (summary and known entities)',
  '',
  'Any other message is sent to the AI assistant.',
].join('\n')

const DM_ADMIN_HELP = [
  '',
  'Admin commands:',
  "/clear <user_id> — Clear a specific user's history",
  "/clear all — Clear all users' history",
  '/dashboard — Open the operator dashboard (single-use link)',
  '',
  'Authorized users, groups, plugins, and announcements are managed in the web UI — open /config.',
].join('\n')
```

And replace `getGroupHelpText`:

```ts
function getGroupHelpText(isGroupAdmin: boolean): string {
  let text = [
    'papai — AI assistant for Kaneo task management',
    '',
    'Group commands:',
    '/help — Show this message',
    '/context — Show current memory context',
    '/clear — Clear group conversation history',
    '',
    'Mention me with @botname for natural language queries',
  ].join('\n')

  if (isGroupAdmin) {
    text += [
      '',
      'Group settings, membership, and authorization are configured in the web UI.',
      'Open a DM with me and run /config.',
    ].join('\n')
  }

  return text
}
```

- [ ] **Step 4: Run the test**

Run: `bun test tests/commands/help.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/help.ts tests/commands/help.test.ts
git commit -m "docs(retirement): /help points at /config; drops retired commands"
```

### Task 4.3: Update `/start` welcome text

**Files:**

- Modify: `src/commands/start.ts`
- Test: `tests/commands/start.test.ts`

- [ ] **Step 1: Update the test**

In `tests/commands/start.test.ts`, assert the welcome mentions `/config` and NOT `/setup`.

- [ ] **Step 2: Replace the `welcomeMessage` template in `src/commands/start.ts`**

```ts
const welcomeMessage = `👋 **Welcome to papai!**

I'm your task management assistant. I can help you:

📋 **Create and manage tasks** via natural language
🔍 **Search and update** existing tasks
⚙️ **Configure integrations** with your task tracker

**Get Started:**
⚙️ **/config** - Open your settings (API keys, models, integrations) in the web UI
❓ **/help** - Show available commands

**Quick Tips:**
• Type your requests naturally (e.g., "create task: review PR #123")
• I'll remember our conversation context
• Use "/clear" to reset conversation history

Let's get you set up! 🎯`
```

- [ ] **Step 3: Run the test**

Run: `bun test tests/commands/start.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/commands/start.ts tests/commands/start.test.ts
git commit -m "docs(retirement): /start welcome points at /config"
```

### Task 4.4: Surface the settings path in the "not fully configured" reply

**Files:**

- Modify: `src/llm-orchestrator.ts` (the `replyBotMisconfigured` text, ~line 137)
- Test: the orchestrator test that asserts that reply (find with grep)

- [ ] **Step 1: Find the test asserting the misconfigured reply**

Run: `grep -rn "not fully configured" src tests`

- [ ] **Step 2: Update the reply text**

In `src/llm-orchestrator.ts`, change the misconfigured reply to point at `/config`:

```ts
await reply.text(
  '⚠️ The bot is not fully configured. Ask the administrator to run /config and complete setup in the web UI.',
)
```

- [ ] **Step 3: Update the asserting test, then run it**

Update the expected string in the orchestrator test. Run: `bun test <that test file>`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/llm-orchestrator.ts tests/
git commit -m "docs(retirement): not-configured reply points at /config"
```

### Task 4.5: knip completeness gate + full check

The spec calls for `bun knip` to confirm the deletion left nothing dangling.

- [ ] **Step 1: Run knip**

Run: `bun knip`
Expected: it should pass OR report only genuinely-now-unused exports in modules you intend to keep. Triage every report:

- **Unused exports in a surviving module** that existed only to serve a removed chat flow → delete those exports (and update `knip.jsonc` `ignoreIssues` if a stale ignore now points at a deleted file — remove those stale entries).
- **`src/group-settings/access.ts` / `target-validation.ts` / `state.ts` / `dispatch.ts` flagged as unused files:** the spec says KEEP these (the Access Model reuses them). If knip reports them as fully unused, that means the settings layer does NOT actually import them — surface this as a finding (it contradicts the spec's "kept" assumption) rather than silently deleting; confirm with the requester whether they are dead. Do not auto-delete kept-per-spec modules.
- Remove any `knip.jsonc` `ignoreIssues` entries that reference now-deleted files (e.g. config-editor presentation files), since `treatConfigHintsAsErrors` will flag stale ignores.

- [ ] **Step 2: Run the full check suite**

Run: `bun check:full`
Expected: 12/12 checks pass (lint, typecheck, format:check, license-headers, knip, test, test:client, duplicates, review-loop:\*).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(retirement): knip cleanup + full-check green"
```

### Task 4.6: Update documentation

**Files:**

- Modify: `CLAUDE.md`, `src/commands/CLAUDE.md`, `src/chat/CLAUDE.md`, `README.md` (or the user docs it points to), `docs/ROADMAP.md`

- [ ] **Step 1: `CLAUDE.md` (root)**

Update the command-surface description: the bot's commands are now `/help`, `/start`, `/config` (launcher to the web UI), `/context`, `/clear`, and `/dashboard`. Remove mentions of `/setup`, `/plugin`, `/group`, `/user`, `/announce` as interactive flows. State that all configuration (personal, group, admin, plugins, identity, instances, system LLM, announce) happens in the settings web UI reached via `/config`, and that `SETTINGS_PUBLIC_BASE_URL` is required for `/config` to function. Remove the "interception flow" description (it no longer exists).

- [ ] **Step 2: `src/commands/CLAUDE.md`**

Replace the "Current Command Behavior" + "Interception Flow" sections: the command surface is `/help`, `/start`, `/config`, `/context`, `/clear`, `/dashboard`. `/config` is launcher-only (issues a single-use settings link; replies with a "set SETTINGS_PUBLIC_BASE_URL" message when unconfigured). There is no message interception — non-command text goes straight to the orchestrator. There are no interactive config callbacks.

- [ ] **Step 3: `src/chat/CLAUDE.md`**

Update the interaction-router rule: the router no longer has config-flow callback routes (`gsel:`/`cfg:`/`wizard_`/`plg:`/`tgl:` are retired); `routeInteraction` authorizes the actor and matches nothing.

- [ ] **Step 4: `README.md` / user docs + `docs/ROADMAP.md`**

Update any user-facing command list and onboarding instructions to describe the web-UI flow via `/config`. Mark the command-retirement milestone done in `docs/ROADMAP.md`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md src/commands/CLAUDE.md src/chat/CLAUDE.md README.md docs/ROADMAP.md
git commit -m "docs(retirement): document web-UI-only command surface"
```

---

## Self-Review

**1. Spec coverage:**

- End-state table: `/config` launcher (Task 2.1) ✅; `/setup` removed (3.1) ✅; config-editor removed keeping `validation.ts` (2.6) ✅; wizard removed (3.1) ✅; group-settings selector removed, access/target-validation kept (3.1 + 4.5 note) ✅; tool toggle UI removed (2.5) ✅; plugin toggle UI removed (2.5) ✅; AI-output config UI removed (2.5) ✅; `/plugin` removed (3.2) ✅; `/group`/`/groups` removed (3.3) ✅; `/user`/`/users` removed (3.4) ✅; `/announce` removed, broadcast kept (3.4) ✅; `/help` updated, `/start`/`/context`/`/clear` kept (4.2/4.3) ✅.
- Interaction-router branches removed (2.2) ✅; interception path removed, non-command text → orchestrator (2.3/2.4) ✅.
- "What must NOT be removed" — every kept module is called out in the deletion tasks' grep gates and the "keep" list ✅.
- Parity gate (8 items) → Phase 0 ✅.
- Sequencing (5 steps, each a PR; step 3+ after parity) → Phases mapped 1:1; Phase 0 is the gate ✅.
- Docs & operational impact → Task 4.6; knip → Task 4.5; surface URL in `/start` + not-configured reply → 4.3 + 4.4 ✅.
- Risks: interception/queue coupling → characterization tests Phase 1 + preserved by 2.3 ✅; removing too early → Phase 0 gate + per-phase PRs ✅; accessibility (chat-only users) → documented as accepted per D2 in Prerequisites ✅.

**2. Placeholder scan:** No `TBD`/"handle errors"/"similar to Task N". Rewrite tasks show full code; deletion tasks list exact files + grep gates + verification commands. The two genuinely environment-dependent spots (the exact auth-test helper names in Task 0.2 and the bot harness in Task 1.1) are flagged with a "reuse the existing file's helpers; rename to match" instruction plus a concrete fallback — this is intentional because those helper names live in files the implementer reads in the task's first step.

**3. Type/name consistency:** `registerConfigCommand` simplified to one arg (Task 2.1) and its sole caller `src/bot.ts` already passes one arg. `routeInteraction(interaction, reply, auth)` 3-arg signature (Task 2.2) matches the existing `bot.ts` call. `CommandRegistration` union (Task 4.1) lists exactly the surviving `register*` exports referenced in `src/bot.ts`/`src/commands/index.ts`. `broadcastMessage` is kept and its settings-route caller is re-verified (3.4). `validateConfigField` (kept `validation.ts`) consumed by `config-routes.ts` is re-verified (2.6).

**Cross-phase dependency note (verified):** `wizard/` and `group-settings/selector.ts` are deleted only in Phase 3 (Task 3.1) because `src/commands/setup.ts` is their last importer until then; Phase 2 severs all _other_ references (interaction router, interception, integration modules, scheduler, state-collector, Discord helper) so the Phase 2 checkpoint (2.8) compiles with those two modules still present.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-30-settings-web-ui-command-retirement.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review (spec then quality) between tasks. Well-suited here because each deletion task has a precise grep/typecheck/knip verification gate.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?** (Note: this plan should run only after the Part B web-UI work is merged to the base branch — it deletes the only other config path.)
