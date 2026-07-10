<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3b — Task-Tracker Host Module + `MembershipStorePort` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Tier-1 `src/modules/task-tracker/` trusted module that owns the membership store, sever the kernel's direct imports of the membership feature behind a feature-agnostic `MembershipStorePort`, move `src/providers/membership/**` under the module, and strip the two deferred `providerName: 'kaneo'` literals so the provider name flows from the bound instance.

**Architecture:** Mirrors the coding trusted-module precedent. A new `taskTrackerModule` owns the membership migrations (`060`/`068`, referenced not moved) and, on activation, registers a `MembershipStore` implementation into `membershipStorePort` and wires the `group_member:*` event subscriber. The kernel (`src/index.ts`, `src/llm-orchestrator.ts`) stops importing `providers/membership` and instead calls the port: it injects the chat-provider-backed label resolver via `setUserLabelResolver`, triggers the startup backfill via `runStartupBackfill()`, and the orchestrator backstop calls `ensureMember()`. Per the chosen design, both provisioning paths resolve the display name via the single injected resolver (the per-turn backstop gains resolved names — a small, intentional behavior change). The `'kaneo'` literals are replaced by `provider.name`, which is `'kaneo'` for the kaneo provider (behavior-preserving).

**Tech Stack:** Bun; strict TypeScript (`.js` import extensions); Drizzle ORM over `bun:sqlite`; `p-limit`; `bun:test`.

---

## Context for the implementer (read before starting)

- **Two identically-named things — do not confuse:** `PluginToolRuntimeContext` (plugins) is unrelated. Here we deal with `src/providers/membership/**` (the store) and `src/llm-orchestrator-membership.ts` (a DIFFERENT file: the pure guest-mode gate `shouldBackstopGroupMembership` — it does NOT import the store; leave it entirely alone, it stays in the kernel).
- **The coding module is the working template** (`src/modules/coding/module.ts`, `src/composition/trusted-modules.ts`, `src/composition/load-trusted-modules.ts`, `src/ports/operator-allowlist.ts`). Read them before starting.
- **Architecture guard** (`tests/architecture-guard.test.ts`) scans `src/ports/**` for `/\b(kaneo|youtrack|magi|coding)\b|plugin_acp__/iu`. The new `src/ports/membership-store.ts` MUST contain none of those words (`membership`/`member`/`provider`/`backfill` are fine). Task 4 extends the guard to also assert the two kernel files don't import the feature.
- **`loadTrustedModules` order:** runs ALL modules' migrations first, then registers contributions, then calls each `onActivate()` sequentially — BEFORE `src/index.ts` composes `chatProvider` (line ~95). So the module's `onActivate` may register the store + wire the subscriber, but the label resolver is injected LATER by the kernel (`setUserLabelResolver`), and the subscriber/orchestrator read it lazily through the port. This is why the resolver lives in the port, not baked into the module at load.
- **Behavior-preservation scope:** the ONLY intended behavior change is the unified display-name resolution (per your decision). Everything else — provisioning logic, idempotency, guest gating, event handling — must be identical.
- **Verified shapes:**
  - `MemberOutcome = 'created' | 'exists' | 'skipped' | 'failed'` (`ensure-member.ts`).
  - `BackfillResult = { total; created; exists; skipped; failed }` (`backfill.ts`).
  - `SubscriberHandlers = { ensure(g,c): Promise<MemberOutcome>; markInactive(g,c): Promise<void> }`; `registerMembershipSubscriber(handlers): () => void` (`subscriber.ts`).
  - `TaskProvider.name: string` (`src/providers/types.ts`); kaneo sets `readonly name = 'kaneo'` (`plugins/task-provider-kaneo/provider.ts`).
  - Migrations `060_kaneo_workspace_members` + `068_task_provider_members` are currently in the CORE `MIGRATIONS` array (`src/db/index.ts`), imported at ~lines 73/77, arrayed at ~172/176.

---

## File Structure

- Create: `src/modules/task-tracker/module.ts`, `src/modules/task-tracker/membership-store.ts` (adapter), `src/ports/membership-store.ts` (port)
- Move: `src/providers/membership/{ensure-member,subscriber,backfill,index}.ts` → `src/modules/task-tracker/membership/` (Task 4)
- Modify: `src/composition/trusted-modules.ts`, `src/db/index.ts`, `src/index.ts`, `src/llm-orchestrator.ts`, `src/providers/membership/ensure-member.ts` (literals), `tests/db/migration-registration.test.ts`, `tests/composition/trusted-modules.test.ts`, `tests/architecture-guard.test.ts`
- Move tests: `tests/providers/membership/**` → `tests/modules/task-tracker/membership/**` (Task 4)

---

## Task 1: Task-tracker module shell + migration ownership move

**Files:**

- Create: `src/modules/task-tracker/module.ts`, `tests/modules/task-tracker/module.test.ts`
- Modify: `src/composition/trusted-modules.ts`, `src/db/index.ts`, `tests/composition/trusted-modules.test.ts`, `tests/db/migration-registration.test.ts`

- [ ] **Step 1: Write `tests/modules/task-tracker/module.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { taskTrackerModule } from '../../../src/modules/task-tracker/module.js'

describe('task-tracker module', () => {
  test('id is "task-tracker"', () => {
    expect(taskTrackerModule.id).toBe('task-tracker')
  })

  test('owns the membership-store migrations (060, 068), in ascending order', () => {
    expect(taskTrackerModule.migrations?.map((m) => m.id)).toEqual([
      '060_kaneo_workspace_members',
      '068_task_provider_members',
    ])
  })
})
```

- [ ] **Step 2: Run it → FAIL** (`bun test tests/modules/task-tracker/module.test.ts`) — module missing.

- [ ] **Step 3: Create `src/modules/task-tracker/module.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { migration060KaneoWorkspaceMembers } from '../../db/migrations/060_kaneo_workspace_members.js'
import { migration068TaskProviderMembers } from '../../db/migrations/068_task_provider_members.js'
import type { TrustedModule } from '../../ports/module.js'

/**
 * The task-tracker trusted module. It owns the host-side membership store (`task_provider_members`)
 * via `migrations`. Later tasks in this phase add an `onActivate` that registers the membership
 * provisioning behavior into `membershipStorePort` and wires the group-member event subscriber, so
 * the kernel never imports the membership feature directly.
 */
export const taskTrackerModule: TrustedModule = {
  id: 'task-tracker',
  migrations: [migration060KaneoWorkspaceMembers, migration068TaskProviderMembers],
}
```

- [ ] **Step 4: Register in `src/composition/trusted-modules.ts`**

Add the import and append to the array:

```ts
import { codingModule } from '../modules/coding/module.js'
import { taskTrackerModule } from '../modules/task-tracker/module.js'
import type { TrustedModule } from '../ports/module.js'

export const TRUSTED_MODULES: readonly TrustedModule[] = [codingModule, taskTrackerModule]
```

- [ ] **Step 5: Remove `060`/`068` from the core `MIGRATIONS` array in `src/db/index.ts`**

Delete the two imports (`migration060KaneoWorkspaceMembers`, `migration068TaskProviderMembers`) and their two entries in the `MIGRATIONS` array. (They now run via the task-tracker module's `migrations` through `applyModuleMigrations`, exactly like the coding module's `061/064/066/067`.) Confirm nothing else in `src/db/index.ts` references those two symbols.

- [ ] **Step 6: Update `tests/composition/trusted-modules.test.ts`**

It currently asserts `TRUSTED_MODULES` has length 1 and contains `codingModule`. Update to length **2** and `toContain(taskTrackerModule)` as well (add the import). Keep the `codingModule` assertion.

- [ ] **Step 7: Update `tests/db/migration-registration.test.ts`**

This suite currently asserts `068_task_provider_members` is the last CORE migration and that `068` is included in core `MIGRATIONS`. Update it to assert `060_kaneo_workspace_members` and `068_task_provider_members` are NOT in core `MIGRATIONS` (mirroring how the coding migrations `061/064/066/067` are asserted absent), and fix the "last core migration" assertion to whatever is now last (likely `065_coding_identity` — verify by reading the array). Keep the core-vs-module split meaningfully guarded.

- [ ] **Step 8: Verify**

Run: `bun test tests/modules/task-tracker/module.test.ts tests/composition/ tests/db/migration-registration.test.ts` → PASS.
Run: `bun test tests/db/` → green (membership table still created — now via the module migration pass in `setupTestDb`).
Run: `bun run typecheck` + `bun run knip` → clean.

- [ ] **Step 9: Commit**

```bash
git add src/modules/task-tracker/module.ts tests/modules/task-tracker/module.test.ts \
  src/composition/trusted-modules.ts src/db/index.ts tests/composition/trusted-modules.test.ts \
  tests/db/migration-registration.test.ts
git commit -m "feat(task-tracker): module shell owning the membership-store migrations (060/068)"
```

---

## Task 2: Strip the `'kaneo'` literals (thread `provider.name`)

Behavior-preserving: `provider.name` is `'kaneo'` for the kaneo provider. File stays in `src/providers/membership/` for now.

**Files:**

- Modify: `src/providers/membership/ensure-member.ts`

- [ ] **Step 1: Confirm the characterization suite is green** — `bun test tests/providers/membership/ensure-member.test.ts` → PASS (baseline).

- [ ] **Step 2: Thread `providerName` into `writeMemberRow`**

Add a `providerName: string` parameter to `writeMemberRow` and use it for both the insert value and the (unchanged) conflict target:

```ts
function writeMemberRow(
  groupContextId: string,
  chatUserId: string,
  providerName: string,
  providerUserId: string,
  login: string,
  status: 'active' | 'failed',
  encryptedPassword: string | null,
): void {
  const db = defaultGetDrizzleDb()
  const now = new Date().toISOString()
  db.insert(taskProviderMembers)
    .values({
      groupContextId,
      chatUserId,
      providerName,
      providerUserId,
      login,
      status,
      encryptedPassword,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [taskProviderMembers.groupContextId, taskProviderMembers.chatUserId, taskProviderMembers.providerName],
      set: { providerUserId, login, status, encryptedPassword, createdAt: now },
    })
    .run()
}
```

In `provisionAndPersist`, pass `provider.name` at both call sites (success + failure):

```ts
writeMemberRow(
  groupContextId,
  chatUserId,
  provider.name,
  providerUserId,
  login,
  'active',
  encryptInstanceConfig({ password }),
)
// ...and in the catch:
writeMemberRow(groupContextId, chatUserId, provider.name, '', '', 'failed', null)
```

- [ ] **Step 3: Thread `providerName` into the cross-group credential lookup**

Add a `providerName: string` parameter to `findStoredCredentialsAcrossGroups` and `resolveExistingOpts`, replacing the `'kaneo'` literal:

```ts
function findStoredCredentialsAcrossGroups(
  chatUserId: string,
  providerName: string,
): { providerUserId: string; login: string; encryptedPassword: string } | null {
  // ...unchanged body, except:
  //   eq(taskProviderMembers.providerName, providerName)   // was 'kaneo'
}

function resolveExistingOpts(
  chatUserId: string,
  providerName: string,
  decryptPassword: ((enc: string) => string) | undefined,
): ExistingOpts | undefined {
  const stored = findStoredCredentialsAcrossGroups(chatUserId, providerName)
  // ...rest unchanged
}
```

In `ensureWorkspaceMember`, pass `provider.name` at the `resolveExistingOpts` call site (the `provider` is already resolved above it):

```ts
const existingOpts = resolveExistingOpts(
  chatUserId,
  provider.name,
  deps.decryptPassword === undefined ? undefined : (enc: string): string => deps.decryptPassword!(enc),
)
```

- [ ] **Step 4: Confirm no `'kaneo'` literal remains in `ensure-member.ts`**

Run: `rg -n "'kaneo'" src/providers/membership/ensure-member.ts` → ZERO hits. (`markMemberInactive` intentionally does NOT filter by provider — leave it.)

- [ ] **Step 5: Verify — the characterization suite must pass UNCHANGED**

Run: `bun test tests/providers/membership/ensure-member.test.ts` → PASS. The existing tests use a fake provider with `name: 'kaneo'` and assert `providerName: 'kaneo'` in the row, so behavior is identical. Run `bun run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/providers/membership/ensure-member.ts
git commit -m "refactor(membership): derive provider_name from the bound provider (drop 'kaneo' literals)"
```

---

## Task 3: `MembershipStorePort` + adapter + invert the kernel wiring

The atomic inversion: introduce the port + the module's store adapter + `onActivate` wiring, and remove the kernel's direct membership imports/wiring in the same commit (so the subscriber/backfill are never double-registered).

**Files:**

- Create: `src/ports/membership-store.ts`, `tests/ports/membership-store.test.ts`, `src/modules/task-tracker/membership-store.ts`, `tests/modules/task-tracker/membership-store.test.ts`
- Modify: `src/modules/task-tracker/module.ts` (add `onActivate`), `src/index.ts`, `src/llm-orchestrator.ts`

- [ ] **Step 1: Write `tests/ports/membership-store.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createMembershipStorePort, type MembershipStore } from '../../src/ports/membership-store.js'

const EMPTY_BACKFILL = { total: 0, created: 0, exists: 0, skipped: 0, failed: 0 }

describe('MembershipStorePort', () => {
  test('no-ops safely when no store is registered', async () => {
    const port = createMembershipStorePort()
    expect(await port.ensureMember('g', 'u')).toBe('skipped')
    expect(() => port.markMemberInactive('g', 'u')).not.toThrow()
    expect(await port.runStartupBackfill()).toEqual(EMPTY_BACKFILL)
  })

  test('delegates to the registered store and injects the current label resolver', async () => {
    const port = createMembershipStorePort()
    const seen: Array<string | null> = []
    const store: MembershipStore = {
      ensureMember: async (_g, _c, _opts, resolveUserLabel) => {
        seen.push(await resolveUserLabel('u', 'g', 'pi'))
        return 'created'
      },
      markMemberInactive: () => {},
      runStartupBackfill: async (resolveUserLabel) => {
        seen.push(await resolveUserLabel('u', 'g', 'pi'))
        return EMPTY_BACKFILL
      },
    }
    port.register(store)
    // default resolver yields null
    expect(await port.ensureMember('g', 'u')).toBe('created')
    port.setUserLabelResolver(() => Promise.resolve('Alice'))
    await port.ensureMember('g', 'u')
    await port.runStartupBackfill()
    expect(seen).toEqual([null, 'Alice', 'Alice'])
  })
})
```

Run → FAIL (port missing).

- [ ] **Step 2: Create `src/ports/membership-store.ts` (feature-agnostic)**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Outcome of a member-provisioning attempt. */
export type MemberProvisionOutcome = 'created' | 'exists' | 'skipped' | 'failed'

/** Best-effort resolver for a user's human display label in a group context. */
export type UserLabelResolver = (
  userId: string,
  groupContextId: string,
  platformInstanceId: string,
) => Promise<string | null>

/** Aggregate result of a one-shot startup backfill. */
export type MembershipBackfillResult = {
  total: number
  created: number
  exists: number
  skipped: number
  failed: number
}

/**
 * The provisioning behavior a trusted module registers. The port injects the current label
 * resolver into each call so the module needs no late-bound kernel object at load time.
 */
export interface MembershipStore {
  ensureMember(
    groupContextId: string,
    chatUserId: string,
    opts: { username?: string | null },
    resolveUserLabel: UserLabelResolver,
  ): Promise<MemberProvisionOutcome>
  markMemberInactive(groupContextId: string, chatUserId: string): void
  runStartupBackfill(resolveUserLabel: UserLabelResolver): Promise<MembershipBackfillResult>
}

/**
 * Lets the kernel provision task-tracker members without importing the feature that owns the
 * store. A trusted module registers the store at load; the kernel injects a label resolver once
 * its chat provider is composed, and consults `ensureMember`/`markMemberInactive`/`runStartupBackfill`.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module, provider, or feature names here.
 */
export interface MembershipStorePort {
  register(store: MembershipStore): void
  setUserLabelResolver(resolver: UserLabelResolver): void
  ensureMember(
    groupContextId: string,
    chatUserId: string,
    opts?: { username?: string | null },
  ): Promise<MemberProvisionOutcome>
  markMemberInactive(groupContextId: string, chatUserId: string): void
  runStartupBackfill(): Promise<MembershipBackfillResult>
}

const noopResolver: UserLabelResolver = () => Promise.resolve(null)
const emptyBackfill: MembershipBackfillResult = { total: 0, created: 0, exists: 0, skipped: 0, failed: 0 }

/** Create an isolated port (used by tests and, as a singleton, by the runtime). */
export function createMembershipStorePort(): MembershipStorePort {
  let store: MembershipStore | null = null
  let resolver: UserLabelResolver = noopResolver
  return {
    register: (s) => {
      store = s
    },
    setUserLabelResolver: (r) => {
      resolver = r
    },
    ensureMember: (groupContextId, chatUserId, opts) =>
      store === null
        ? Promise.resolve('skipped')
        : store.ensureMember(groupContextId, chatUserId, opts ?? {}, resolver),
    markMemberInactive: (groupContextId, chatUserId) => {
      if (store !== null) store.markMemberInactive(groupContextId, chatUserId)
    },
    runStartupBackfill: () => (store === null ? Promise.resolve(emptyBackfill) : store.runStartupBackfill(resolver)),
  }
}

/** Process-wide singleton: the task-tracker module registers here; the kernel consults it. */
export const membershipStorePort: MembershipStorePort = createMembershipStorePort()
```

Run the port test → PASS. Run `bun test tests/architecture-guard.test.ts` → PASS (confirm no banned words leaked into the port).

- [ ] **Step 3: Write `tests/modules/task-tracker/membership-store.test.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { taskProviderMembershipStore } from '../../../src/modules/task-tracker/membership-store.js'

describe('taskProviderMembershipStore', () => {
  test('implements the MembershipStore surface', () => {
    expect(typeof taskProviderMembershipStore.ensureMember).toBe('function')
    expect(typeof taskProviderMembershipStore.markMemberInactive).toBe('function')
    expect(typeof taskProviderMembershipStore.runStartupBackfill).toBe('function')
  })
})
```

> The deep behavior of `ensureMember`/backfill is already covered by the ported `ensure-member`/`backfill` suites; this test just pins the adapter shape. If the implementer prefers a behavioral test, it may inject a fake resolver and assert delegation, but that duplicates the underlying suites — the shape check is sufficient.

Run → FAIL (adapter missing).

- [ ] **Step 4: Create `src/modules/task-tracker/membership-store.ts` (adapter)**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MembershipStore, UserLabelResolver } from '../../ports/membership-store.js'
import { runMembershipBackfill } from '../../providers/membership/backfill.js'
import {
  defaultMembershipDeps,
  ensureWorkspaceMember,
  markMemberInactive,
} from '../../providers/membership/ensure-member.js'

/** The task-tracker adapter binding the membership store implementation to the port. */
export const taskProviderMembershipStore: MembershipStore = {
  ensureMember: (groupContextId, chatUserId, opts, resolveUserLabel: UserLabelResolver) =>
    ensureWorkspaceMember(groupContextId, chatUserId, { ...defaultMembershipDeps, resolveUserLabel }, opts),
  markMemberInactive: (groupContextId, chatUserId) => {
    markMemberInactive(groupContextId, chatUserId)
  },
  runStartupBackfill: (resolveUserLabel: UserLabelResolver) =>
    runMembershipBackfill({
      ensure: (groupContextId, chatUserId) =>
        ensureWorkspaceMember(groupContextId, chatUserId, { ...defaultMembershipDeps, resolveUserLabel }),
    }),
}
```

> The import path `../../providers/membership/...` is temporary — Task 4 relocates that code under the module and updates this one import. `MemberOutcome` (returned by `ensureWorkspaceMember`) is structurally identical to the port's `MemberProvisionOutcome`, so it assigns cleanly. `BackfillResult` matches `MembershipBackfillResult` field-for-field.

Run the adapter test → PASS.

- [ ] **Step 5: Add `onActivate` to `src/modules/task-tracker/module.ts`**

```ts
import { registerMembershipSubscriber } from '../../providers/membership/subscriber.js'
import { membershipStorePort } from '../../ports/membership-store.js'
import { taskProviderMembershipStore } from './membership-store.js'
// ...existing migration imports + TrustedModule import...

export const taskTrackerModule: TrustedModule = {
  id: 'task-tracker',
  migrations: [migration060KaneoWorkspaceMembers, migration068TaskProviderMembers],
  onActivate(): void {
    membershipStorePort.register(taskProviderMembershipStore)
    // Route group-member events through the port so provisioning uses the injected label resolver.
    registerMembershipSubscriber({
      ensure: (groupContextId, chatUserId) => membershipStorePort.ensureMember(groupContextId, chatUserId),
      markInactive: (groupContextId, chatUserId) => {
        membershipStorePort.markMemberInactive(groupContextId, chatUserId)
        return Promise.resolve()
      },
    })
  },
}
```

Update the module test (`tests/modules/task-tracker/module.test.ts`) to also assert `typeof taskTrackerModule.onActivate === 'function'`.

- [ ] **Step 6: Invert `src/index.ts`**

- Remove the `./providers/membership/index.js` import block (the `defaultMembershipDeps, ensureWorkspaceMember, markMemberInactive, registerMembershipSubscriber, runMembershipBackfill` import).
- Add `import { membershipStorePort } from './ports/membership-store.js'`.
- Delete the manual `const membershipDeps = {...}`, `registerMembershipSubscriber({...})`, and `void runMembershipBackfill({...})` block. Replace with — placed AFTER `chatProvider` is composed:

```ts
membershipStorePort.setUserLabelResolver((userId, groupContextId, platformInstanceId) =>
  chatProvider.resolveUserLabel(userId, { contextId: groupContextId, contextType: 'group', platformInstanceId }),
)
void membershipStorePort
  .runStartupBackfill()
  .then((result) => {
    log.info(result, 'Startup membership backfill finished')
  })
  .catch((err: unknown) => {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Startup membership backfill failed')
  })
```

The subscriber wiring is now owned by the module's `onActivate` (already run inside `loadTrustedModules()` earlier in startup), so `index.ts` no longer registers it.

- [ ] **Step 7: Invert `src/llm-orchestrator.ts`**

- Remove `import { ensureWorkspaceMember } from './providers/membership/index.js'`.
- Add `import { membershipStorePort } from './ports/membership-store.js'`.
- Change `maybeEnsureGroupMembership` to call the port:

```ts
const maybeEnsureGroupMembership = (configId: string, chatUserId: string, username: string | null): void => {
  membershipStorePort.ensureMember(configId, chatUserId, { username }).catch((err: unknown) => {
    log.warn(
      { chatUserId, error: err instanceof Error ? err.message : String(err) },
      'Backstop ensureWorkspaceMember failed',
    )
  })
}
```

Leave the `shouldBackstopGroupMembership` gate (from `llm-orchestrator-membership.ts`) untouched.

- [ ] **Step 8: Verify the kernel no longer imports the feature**

Run: `rg -n "providers/membership" src/index.ts src/llm-orchestrator.ts` → ZERO hits.
Run: `bun run typecheck` → clean. `bun run knip` → clean.

- [ ] **Step 9: Full suite + guard + gate**

Run: `bun test` — full suite green (report counts). Pay attention to any orchestrator/startup integration test that depended on the direct `ensureWorkspaceMember` import; if one fails because the store isn't registered in that test's setup, assess whether it needs `loadTrustedModules()` (or a direct `membershipStorePort.register(...)`) in its setup, or whether it should call the module code directly — report each.
Run: `bun test tests/architecture-guard.test.ts` → PASS.
Run: `bun check:full` → 12/12.

- [ ] **Step 10: Commit**

```bash
git add src/ports/membership-store.ts tests/ports/membership-store.test.ts \
  src/modules/task-tracker/membership-store.ts tests/modules/task-tracker/membership-store.test.ts \
  src/modules/task-tracker/module.ts tests/modules/task-tracker/module.test.ts \
  src/index.ts src/llm-orchestrator.ts
git commit -m "feat(task-tracker): MembershipStorePort — invert kernel membership wiring through the module"
```

---

## Task 4: Relocate membership code under the module + guard the boundary

Pure relocation now that only the module adapter imports `providers/membership`.

**Files:**

- Move: `src/providers/membership/{ensure-member,subscriber,backfill,index}.ts` → `src/modules/task-tracker/membership/`
- Move: `tests/providers/membership/**` → `tests/modules/task-tracker/membership/**`
- Modify: `src/modules/task-tracker/membership-store.ts` + `src/modules/task-tracker/module.ts` (import paths), `tests/architecture-guard.test.ts`

- [ ] **Step 1: Confirm the ONLY importers of `providers/membership` are the module adapter + module**

Run: `rg -n "providers/membership" src` → hits ONLY in `src/modules/task-tracker/membership-store.ts` and `src/modules/task-tracker/module.ts` (the `subscriber.js` import). If anything else in `src/` still imports it, STOP — Task 3 was incomplete.

- [ ] **Step 2: Move the four source files**

```bash
git mv src/providers/membership/ensure-member.ts src/modules/task-tracker/membership/ensure-member.ts
git mv src/providers/membership/subscriber.ts   src/modules/task-tracker/membership/subscriber.ts
git mv src/providers/membership/backfill.ts      src/modules/task-tracker/membership/backfill.ts
git mv src/providers/membership/index.ts         src/modules/task-tracker/membership/index.ts
```

Then fix the RELATIVE imports inside the moved files: they now sit one level deeper (`src/modules/task-tracker/membership/` vs `src/providers/membership/`), so `../../db/...`, `../../identity/...`, `../../instances/...`, `../../debug/...`, `../../logger.js` become `../../../db/...`, `../../../identity/...`, etc. The `../resolver.js` and `../types.js` imports in `ensure-member.ts` pointed at `src/providers/` siblings — they become `../../../providers/resolver.js` and `../../../providers/types.js`. Update every relative import in all four files; run `bun run typecheck` to catch any missed path.

- [ ] **Step 3: Update the adapter + module import paths**

In `src/modules/task-tracker/membership-store.ts`: `../../providers/membership/backfill.js` → `./membership/backfill.js`, `../../providers/membership/ensure-member.js` → `./membership/ensure-member.js`.
In `src/modules/task-tracker/module.ts`: `../../providers/membership/subscriber.js` → `./membership/subscriber.js`.

- [ ] **Step 4: Move the tests**

```bash
git mv tests/providers/membership tests/modules/task-tracker/membership
```

Fix the relative imports in each moved test file (they move from `tests/providers/membership/` to `tests/modules/task-tracker/membership/` — one level deeper, so `../../src/...` → `../../../src/...`, and any `../../utils/test-helpers.js` → `../../../utils/test-helpers.js`). Also re-point any import that referenced the OLD `src/providers/membership/...` path to the NEW `src/modules/task-tracker/membership/...` path. Run typecheck to catch misses.

> `tests/llm-orchestrator-membership.test.ts` stays where it is (it tests the kernel guest-gate, not the store — do NOT move it).
> `tests/db/membership-schema.test.ts` stays (it tests `db/schema.ts`, which is core-owned).

- [ ] **Step 5: Extend the architecture guard**

In `tests/architecture-guard.test.ts`, add assertions (mirroring the existing `llm-orchestrator-tools.ts` string checks) that the kernel no longer couples to the membership feature:

```ts
test('src/index.ts does not import the membership feature directly', () => {
  const src = readFileSync('src/index.ts', 'utf8')
  expect(src).not.toContain('providers/membership')
  expect(src).not.toContain('modules/task-tracker')
})

test('src/llm-orchestrator.ts does not import the membership feature directly', () => {
  const src = readFileSync('src/llm-orchestrator.ts', 'utf8')
  expect(src).not.toContain('providers/membership')
  expect(src).not.toContain('modules/task-tracker')
})
```

Match the file's existing import style for `readFileSync`/path handling (read how its current `llm-orchestrator-tools.ts` checks are written and mirror them exactly).

- [ ] **Step 6: Confirm the old dir is gone + no stale refs**

Run: `ls src/providers/membership` → should not exist (all files moved). `rg -n "providers/membership" src tests` → ZERO hits.

- [ ] **Step 7: Full verification**

Run: `bun run typecheck` + `bun run knip` + `bun run lint` + `bun run format:check` → clean.
Run: `bun test` → full suite green.
Run: `bun check:full` → 12/12.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(task-tracker): relocate membership store under the module; guard the kernel boundary"
```

(`git add -A` to capture the git-mv renames + the guard test.) Confirm `git status` shows only the moved files + the adapter/module import edits + the guard test.

---

## Self-Review notes (author)

- **Spec coverage (§6.1/§9.4 `MembershipStorePort` + host module):** the membership store is now owned by a Tier-1 `task-tracker` module behind a feature-agnostic port; the kernel imports neither the feature nor the module. The `'kaneo'` literals are gone (provider name flows from the bound provider).
- **Behavior:** the only intended change is unified display-name resolution (per the chosen decision); all provisioning/idempotency/guest-gating/event handling is identical, verified by the characterization suites porting unchanged.
- **Always-green decomposition:** Task 1 (shell + migration move) and Task 2 (literals) are independently shippable; Task 3 is the atomic inversion (introduce port + module wiring AND remove kernel wiring in one commit, so the subscriber/backfill are never double-registered); Task 4 is a pure relocation once the kernel no longer imports the feature.
- **Port design:** the resolver lives in the port (set late by the kernel) because `loadTrustedModules` runs `onActivate` before `chatProvider` exists; the port no-ops safely when no store is registered (tests/unloaded contexts).
- **Guard:** the new `src/ports/membership-store.ts` is feature-agnostic (guard-scanned); Task 4 extends the guard to fence the two kernel files, realizing the §9 "kernel zero-grep" step for membership.
- **Scope discipline:** does NOT touch `providers/registry.ts`, `tools-builder.ts`, provisioning routes, `kaneoUrl`, the plugins, `db/schema.ts`/`db/membership-schema.ts` (core-owned), or `llm-orchestrator-membership.ts` — those are later sub-phases (3c/3d) or stay core.
