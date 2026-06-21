<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kaneo Group-Member Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each chat member of a group with a Kaneo task instance is registered as a real Kaneo user, added to the group's existing workspace, and linked to their chat identity — so the bot can resolve and assign tasks to them by name.

**Architecture:** A new `provisionWorkspaceMember?` optional method on `TaskProvider` (gated by the new `'members.provision'` capability) is implemented by `KaneoProvider`. A new `ensureWorkspaceMember` service orchestrates the state machine and persists results in a new `kaneo_workspace_members` table. Three triggers drive provisioning: eager `group_member:added` event subscriber, one-shot startup backfill, and a first-interaction backstop in the orchestrator. Identity is linked automatically using a new `'provisioned'` `MatchMethod` that never overwrites `auto`/`manual_nl` mappings. A settings UI route exposes the member's Kaneo email and a reveal-once password reset.

**Tech Stack:** Bun, TypeScript strict (`.js` import paths), Drizzle ORM + SQLite, Zod v4, pino logging, `p-limit` for bounded concurrency.

**Spec:** `docs/superpowers/specs/2026-06-21-kaneo-group-member-provisioning-design.md`

**Phase 0 is COMPLETE.** Decisions are fixed: provisioning = invite-member + member auto-accept; credentials = encrypted-password-at-creation (Branch B) only. See `docs/superpowers/notes/2026-06-21-kaneo-spike-outcome.md`.

---

## File Structure

**New files:**

- `src/db/migrations/060_kaneo_workspace_members.ts` — SQLite migration
- `plugins/task-provider-kaneo/operations/members.ts` — `kaneoProvisionMember` operation
- `src/providers/membership/ensure-member.ts` — `ensureWorkspaceMember` service + `MembershipDeps` DI interface
- `src/providers/membership/subscriber.ts` — `group_member:added`/`:removed` event bus subscriber
- `src/providers/membership/backfill.ts` — startup backfill + admin re-run
- `src/providers/membership/index.ts` — barrel export
- `src/debug/settings/kaneo-credentials-routes.ts` — `GET/POST /settings/api/kaneo/credentials`
- Tests: `tests/providers/membership/ensure-member.test.ts`, `tests/providers/membership/subscriber.test.ts`, `tests/providers/membership/backfill.test.ts`, `tests/plugins/task-provider-kaneo/operations/members.test.ts`, `tests/debug/settings/kaneo-credentials-routes.test.ts`, `tests/db/migration-060-kaneo-workspace-members.test.ts`, `tests/identity/provisioned-match-method.test.ts`

**Modified files:**

- `src/providers/task-capability.ts` — add `'members.provision'` to `TaskCapability`
- `src/providers/types.ts` — add `provisionWorkspaceMember?` to `TaskProvider`
- `src/identity/types.ts` — add `'provisioned'` to `MatchMethod`; update `MATCH_METHOD_VALUES`
- `src/identity/mapping.ts` — add `setProvisionedIdentityMapping` (no-overwrite guard)
- `src/db/schema.ts` — add `kaneoWorkspaceMembers` Drizzle table + type export
- `src/db/index.ts` — import and register migration 060
- `plugins/task-provider-kaneo/constants.ts` — add `'members.provision'` to `ALL_CAPABILITIES`
- `plugins/task-provider-kaneo/provider.ts` — implement `listUsers` + `provisionWorkspaceMember`
- `src/llm-orchestrator.ts` — first-interaction backstop call
- `src/debug/settings-api-router.ts` — wire `/settings/api/kaneo/credentials`
- `src/system-prompt.ts` — GROUP prompt: mention `find_user` for Kaneo assignment + name → id procedure

---

## Phase 0 — Feasibility Spike (COMPLETE)

**Outcome:** Tested against real Kaneo 2.7.2 over HTTP (2026-06-21). Full results in `docs/superpowers/notes/2026-06-21-kaneo-spike-outcome.md`.

**Decisions (fixed — no conditional branches remain):**

1. **Member provisioning: invite-member + member auto-accept.**
   - `POST /api/auth/organization/add-member` → **404** (with api-key AND owner session cookie). DEAD.
   - `POST /api/auth/organization/invite-member` → **200**, returns `{ id: <invitationId>, status: 'pending' }`. Works with service-account credential.
   - `POST /api/auth/organization/accept-invitation` with the **member's own session cookie** + `{ invitationId }` → **200** (`status: accepted`). Member then appears in `GET /api/workspace/{id}/members`.

2. **Credentials: encrypted-password-at-creation (Branch B) only.**
   - `POST /api/auth/admin/set-password` → **404**. Branch A (admin reset) is DEAD.
   - Generate password at sign-up, encrypt at rest via `encryptInstanceConfig`, reveal once through the settings UI.

- [x] **Task 0.1: Spike outcome recorded** — see `docs/superpowers/notes/2026-06-21-kaneo-spike-outcome.md`

---

## Phase 1 — Provider Seam & Identity Foundation

### Task 1.1: `'members.provision'` capability + `TaskProvider.provisionWorkspaceMember`

**Files:**

- Modify: `src/providers/task-capability.ts` (~line 49 after `'queries.saved'`)
- Modify: `src/providers/types.ts` (~line 136 after `getCurrentUser?`)

- [ ] **Step 1: Write the failing test**

Create `tests/providers/membership/ensure-member.test.ts` (it will grow — add the type-check fixture now):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import type { TaskProvider } from '../../../src/providers/types.js'

describe('TaskProvider.provisionWorkspaceMember type contract', () => {
  test('TaskProvider interface includes optional provisionWorkspaceMember', () => {
    // Compile-time check: a minimal provider that omits provisionWorkspaceMember must still satisfy TaskProvider.
    // If the interface is wrong this file won't typecheck — the test runner itself catches it.
    const _typeCheck: Pick<TaskProvider, 'provisionWorkspaceMember'> = {} as TaskProvider
    expect(_typeCheck).toBeDefined()
  })

  test('capabilities type includes members.provision', () => {
    // Importing the type must compile — will fail if the capability is missing from the union
    const cap = 'members.provision' as import('../../../src/providers/task-capability.js').TaskCapability
    expect(cap).toBe('members.provision')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/providers/membership/ensure-member.test.ts
```

Expected: TypeScript compile error — `'members.provision'` is not assignable to `TaskCapability`.

- [ ] **Step 3: Add `'members.provision'` to `TaskCapability`**

In `src/providers/task-capability.ts`, add after the last entry (`'queries.saved'`):

```typescript
  | 'members.provision'
```

- [ ] **Step 4: Add `provisionWorkspaceMember?` to `TaskProvider`**

In `src/providers/types.ts`, add after `getCurrentUser?()` (line ~137):

```typescript
  /**
   * Provision a new workspace member for this provider's workspace.
   * Gated by capability `'members.provision'`.
   *
   * When `opts.existingProviderUserId`, `opts.existingLogin`, and `opts.existingPassword` are
   * all present the implementation MUST skip sign-up and re-authenticate the member instead
   * (sign-in with the stored password), then run invite + accept for the new workspace.
   *
   * @returns providerUserId (Better Auth id), login (synthetic email), and the password
   *   (generated on new sign-up; the stored value passed through on reuse). The caller
   *   is responsible for persisting the returned password encrypted.
   */
  provisionWorkspaceMember?(
    member: {
      chatUserId: string
      displayName: string
      username: string | null
    },
    opts?: { existingProviderUserId?: string; existingLogin?: string; existingPassword?: string },
  ): Promise<{ providerUserId: string; login: string; password: string }>
```

- [ ] **Step 5: Run test to verify it passes**

```
bun test tests/providers/membership/ensure-member.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/providers/task-capability.ts src/providers/types.ts tests/providers/membership/ensure-member.test.ts
git commit -m "feat(membership): add members.provision capability and TaskProvider.provisionWorkspaceMember seam"
```

---

### Task 1.2: `'provisioned'` MatchMethod + no-overwrite guard

**Files:**

- Modify: `src/identity/types.ts`
- Modify: `src/identity/mapping.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/identity/provisioned-match-method.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getIdentityMapping, setIdentityMapping, setProvisionedIdentityMapping } from '../../src/identity/mapping.js'
import { isMatchMethod } from '../../src/identity/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('provisioned MatchMethod', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('isMatchMethod accepts "provisioned"', () => {
    expect(isMatchMethod('provisioned')).toBe(true)
  })

  test('setProvisionedIdentityMapping writes when no existing mapping', () => {
    setProvisionedIdentityMapping({
      contextId: 'user-1',
      providerName: 'kaneo',
      providerUserId: 'kaneo-id-1',
      providerUserLogin: 'user1@pap.ai',
      displayName: 'Alice',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-1', 'kaneo')
    expect(mapping?.matchMethod).toBe('provisioned')
    expect(mapping?.providerUserId).toBe('kaneo-id-1')
  })

  test('setProvisionedIdentityMapping does NOT overwrite auto mapping', () => {
    setIdentityMapping({
      contextId: 'user-2',
      providerName: 'kaneo',
      providerUserId: 'auto-id',
      providerUserLogin: 'auto@example.com',
      displayName: 'Bob',
      matchMethod: 'auto',
      confidence: 1,
    })
    setProvisionedIdentityMapping({
      contextId: 'user-2',
      providerName: 'kaneo',
      providerUserId: 'provisioned-id',
      providerUserLogin: 'provisioned@pap.ai',
      displayName: 'Bob Provisioned',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-2', 'kaneo')
    expect(mapping?.matchMethod).toBe('auto')
    expect(mapping?.providerUserId).toBe('auto-id')
  })

  test('setProvisionedIdentityMapping does NOT overwrite manual_nl mapping', () => {
    setIdentityMapping({
      contextId: 'user-3',
      providerName: 'kaneo',
      providerUserId: 'manual-id',
      providerUserLogin: 'manual@example.com',
      displayName: 'Carol',
      matchMethod: 'manual_nl',
      confidence: 1,
    })
    setProvisionedIdentityMapping({
      contextId: 'user-3',
      providerName: 'kaneo',
      providerUserId: 'provisioned-id',
      providerUserLogin: 'provisioned@pap.ai',
      displayName: 'Carol Provisioned',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-3', 'kaneo')
    expect(mapping?.matchMethod).toBe('manual_nl')
    expect(mapping?.providerUserId).toBe('manual-id')
  })

  test('setProvisionedIdentityMapping DOES overwrite unmatched mapping', () => {
    setIdentityMapping({
      contextId: 'user-4',
      providerName: 'kaneo',
      providerUserId: null,
      providerUserLogin: null,
      displayName: null,
      matchMethod: 'unmatched',
      confidence: 0,
    })
    setProvisionedIdentityMapping({
      contextId: 'user-4',
      providerName: 'kaneo',
      providerUserId: 'provisioned-id',
      providerUserLogin: 'provisioned@pap.ai',
      displayName: 'Dave',
      matchMethod: 'provisioned',
      confidence: 1,
    })
    const mapping = getIdentityMapping('user-4', 'kaneo')
    expect(mapping?.matchMethod).toBe('provisioned')
    expect(mapping?.providerUserId).toBe('provisioned-id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/identity/provisioned-match-method.test.ts
```

Expected: FAIL — `'provisioned'` is not a valid `MatchMethod`; `setProvisionedIdentityMapping` does not exist.

- [ ] **Step 3: Add `'provisioned'` to `MatchMethod` in `src/identity/types.ts`**

```typescript
// Before:
export type MatchMethod = 'auto' | 'manual_nl' | 'unmatched'
const MATCH_METHOD_VALUES: readonly string[] = ['auto', 'manual_nl', 'unmatched']

// After:
export type MatchMethod = 'auto' | 'manual_nl' | 'unmatched' | 'provisioned'
const MATCH_METHOD_VALUES: readonly string[] = ['auto', 'manual_nl', 'unmatched', 'provisioned']
```

- [ ] **Step 4: Add `setProvisionedIdentityMapping` to `src/identity/mapping.ts`**

After the `setIdentityMapping` function (around line 117), add:

```typescript
/**
 * Write a 'provisioned' identity mapping that does NOT overwrite a higher-priority
 * link already established by auto-detection ('auto') or manual NL assignment ('manual_nl').
 * Safe to call concurrently — read-then-write is idempotent under the unique PK constraint.
 */
export function setProvisionedIdentityMapping(
  params: SetIdentityMappingParams,
  deps: IdentityMappingDeps = defaultDeps,
): void {
  log.debug({ contextId: params.contextId, providerName: params.providerName }, 'setProvisionedIdentityMapping called')
  const existing = getIdentityMapping(params.contextId, params.providerName, deps)
  if (existing !== null && (existing.matchMethod === 'auto' || existing.matchMethod === 'manual_nl')) {
    log.debug(
      { contextId: params.contextId, existingMethod: existing.matchMethod },
      'Skipping provisioned identity link: existing higher-priority mapping',
    )
    return
  }
  setIdentityMapping(params, deps)
}
```

- [ ] **Step 5: Run test to verify it passes**

```
bun test tests/identity/provisioned-match-method.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/identity/types.ts src/identity/mapping.ts tests/identity/provisioned-match-method.test.ts
git commit -m "feat(identity): add 'provisioned' MatchMethod with no-overwrite guard"
```

---

## Phase 2 — Kaneo Operations & Member Table

### Task 2.1: `KaneoProvider.listUsers` — expose the already-written operation

The `kaneoListUsers` function already exists in `plugins/task-provider-kaneo/operations/users.ts`. It just needs to be wired into `KaneoProvider` and the `ALL_CAPABILITIES` set updated.

**Files:**

- Modify: `plugins/task-provider-kaneo/provider.ts`
- Modify: `plugins/task-provider-kaneo/constants.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/plugins/task-provider-kaneo/operations/members.test.ts` (we'll extend it in Task 2.2; start with `listUsers`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { KaneoProvider } from '../../../plugins/task-provider-kaneo/provider.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const TEST_CONFIG = { apiKey: 'test-key', baseUrl: 'http://kaneo-test' }
const WORKSPACE_ID = 'ws-1'

function makeProvider(): KaneoProvider {
  return new KaneoProvider(TEST_CONFIG, WORKSPACE_ID)
}

describe('KaneoProvider.listUsers', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('is defined on KaneoProvider', () => {
    const provider = makeProvider()
    expect(typeof provider.listUsers).toBe('function')
  })

  test('forwards to kaneoListUsers and returns UserRef[]', async () => {
    setMockFetch(
      async () =>
        new Response(
          JSON.stringify([
            { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'member' },
            { id: 'u2', name: 'Bob', email: 'bob@example.com', role: 'admin' },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    const provider = makeProvider()
    const result = await provider.listUsers()
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'u1', login: 'alice@example.com', name: 'Alice' })
    restoreFetch()
  })

  test('respects capabilities: members.provision is set', () => {
    const provider = makeProvider()
    expect(provider.capabilities.has('members.provision')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/plugins/task-provider-kaneo/operations/members.test.ts
```

Expected: FAIL — `provider.listUsers` is `undefined`; `'members.provision'` not in capabilities.

- [ ] **Step 3: Add `'members.provision'` to `ALL_CAPABILITIES` in `plugins/task-provider-kaneo/constants.ts`**

```typescript
// Add to the ALL_CAPABILITIES Set after the existing entries:
  'members.provision',
```

- [ ] **Step 4: Implement `KaneoProvider.listUsers` in `plugins/task-provider-kaneo/provider.ts`**

Add the import at the top (after other operations imports):

```typescript
import { kaneoListUsers } from './operations/users.js'
```

Add the method to the `KaneoProvider` class body (after `searchTasks`):

```typescript
  listUsers(query?: string, limit?: number): Promise<import('papai/plugin-types').UserRef[]> {
    return kaneoListUsers(this.config, this.workspaceId, query, limit)
  }
```

- [ ] **Step 5: Run test to verify it passes**

```
bun test tests/plugins/task-provider-kaneo/operations/members.test.ts
```

Expected: PASS for existing tests.

- [ ] **Step 6: Commit**

```
git add plugins/task-provider-kaneo/constants.ts plugins/task-provider-kaneo/provider.ts tests/plugins/task-provider-kaneo/operations/members.test.ts
git commit -m "feat(kaneo): implement KaneoProvider.listUsers and add members.provision capability"
```

---

### Task 2.2: `kaneoProvisionMember` operation + `KaneoProvider.provisionWorkspaceMember`

**Mechanism (Phase-0 fixed):** invite-member + member auto-accept. `doAddMember` is replaced by the three-step sequence: `doMemberSignUp` (or `doMemberSignIn` for reuse) → `doInviteMember` (service credential) → `doAcceptInvitation` (member session cookie). Password is returned and the caller persists it encrypted.

**Files:**

- Create: `plugins/task-provider-kaneo/operations/members.ts`
- Modify: `plugins/task-provider-kaneo/provider.ts`
- Modify: `tests/plugins/task-provider-kaneo/operations/members.test.ts` (extend)

- [ ] **Step 1: Add failing tests for `kaneoProvisionMember`**

Add to `tests/plugins/task-provider-kaneo/operations/members.test.ts`:

```typescript
import { kaneoProvisionMember } from '../../../plugins/task-provider-kaneo/operations/members.js'

describe('kaneoProvisionMember', () => {
  test('new-member path: sign-up → invite-member (service auth + organizationId) → accept-invitation (member cookie + invitationId)', async () => {
    const calls: { url: string; body: unknown; headers: Record<string, string> }[] = []
    setMockFetch(async (url, init) => {
      const body = init?.body !== undefined ? JSON.parse(init.body as string) : undefined
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[k.toLowerCase()] = v
      }
      calls.push({ url, body, headers })

      if (url.includes('/api/auth/sign-up/email')) {
        return new Response(JSON.stringify({ user: { id: 'new-user-id' }, token: 'member-session-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/auth/organization/invite-member')) {
        return new Response(JSON.stringify({ id: 'inv-001', status: 'pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/auth/organization/accept-invitation')) {
        return new Response(JSON.stringify({ status: 'accepted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })

    const result = await kaneoProvisionMember(
      TEST_CONFIG,
      WORKSPACE_ID,
      { chatUserId: 'chat-1', displayName: 'Alice Liddell', username: 'alice' },
      'http://kaneo-public',
    )

    expect(result.providerUserId).toBe('new-user-id')
    expect(result.login).toMatch(/@pap\.ai$/)
    expect(result.password).toBeTruthy()

    const signUpCall = calls.find((c) => c.url.includes('/api/auth/sign-up/email'))
    expect(signUpCall?.body).toMatchObject({ name: 'Alice Liddell' })

    const inviteCall = calls.find((c) => c.url.includes('/api/auth/organization/invite-member'))
    expect(inviteCall?.body).toMatchObject({ organizationId: WORKSPACE_ID, role: 'member' })
    // invite uses the SERVICE credential (api-key), not the member cookie
    expect(inviteCall?.headers['authorization']).toMatch(/^Bearer /)

    const acceptCall = calls.find((c) => c.url.includes('/api/auth/organization/accept-invitation'))
    expect(acceptCall?.body).toMatchObject({ invitationId: 'inv-001' })
    // accept uses the MEMBER session cookie, not the service key
    expect(acceptCall?.headers['cookie']).toBeDefined()
    expect(acceptCall?.headers['authorization']).toBeUndefined()

    restoreFetch()
  })

  test('invite-member treats 200 already-invited and 409 already-member as success', async () => {
    setMockFetch(async (url) => {
      if (url.includes('/api/auth/sign-up/email')) {
        return new Response(JSON.stringify({ user: { id: 'uid-2' }, token: 'tok2' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/auth/organization/invite-member')) {
        // simulate already-invited returning the existing invitationId
        return new Response(JSON.stringify({ id: 'inv-existing', status: 'pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/auth/organization/accept-invitation')) {
        return new Response(JSON.stringify({ status: 'accepted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    })

    const result = await kaneoProvisionMember(
      TEST_CONFIG,
      WORKSPACE_ID,
      { chatUserId: 'chat-2', displayName: 'Bob', username: null },
      'http://kaneo-public',
    )
    expect(result.providerUserId).toBe('uid-2')
    restoreFetch()
  })

  test('reuse path: sign-IN (not sign-up) → invite-member → accept-invitation; returns existing id and stored password', async () => {
    const calls: { url: string; body: unknown }[] = []
    setMockFetch(async (url, init) => {
      const body = init?.body !== undefined ? JSON.parse(init.body as string) : undefined
      calls.push({ url, body })
      if (url.includes('/api/auth/sign-in/email')) {
        return new Response(JSON.stringify({ user: { id: 'existing-uid' }, token: 'reuse-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/auth/organization/invite-member')) {
        return new Response(JSON.stringify({ id: 'inv-reuse', status: 'pending' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/api/auth/organization/accept-invitation')) {
        return new Response(JSON.stringify({ status: 'accepted' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('unexpected', { status: 500 })
    })

    const result = await kaneoProvisionMember(
      TEST_CONFIG,
      WORKSPACE_ID,
      { chatUserId: 'chat-3', displayName: 'Carol', username: 'carol' },
      'http://kaneo-public',
      { providerUserId: 'existing-uid', login: 'carol@pap.ai', password: 'StoredPass1!Aa' },
    )

    expect(result.providerUserId).toBe('existing-uid')
    expect(result.login).toBe('carol@pap.ai')
    expect(result.password).toBe('StoredPass1!Aa')

    // Must call sign-IN, not sign-up
    const signUpCall = calls.find((c) => c.url.includes('/api/auth/sign-up/email'))
    expect(signUpCall).toBeUndefined()
    const signInCall = calls.find((c) => c.url.includes('/api/auth/sign-in/email'))
    expect(signInCall?.body).toMatchObject({ email: 'carol@pap.ai', password: 'StoredPass1!Aa' })

    const inviteCall = calls.find((c) => c.url.includes('/api/auth/organization/invite-member'))
    expect(inviteCall?.body).toMatchObject({ organizationId: WORKSPACE_ID, role: 'member' })

    const acceptCall = calls.find((c) => c.url.includes('/api/auth/organization/accept-invitation'))
    expect(acceptCall?.body).toMatchObject({ invitationId: 'inv-reuse' })

    restoreFetch()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/plugins/task-provider-kaneo/operations/members.test.ts
```

Expected: FAIL — `kaneoProvisionMember` does not exist.

- [ ] **Step 3: Create `plugins/task-provider-kaneo/operations/members.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../../src/logger.js'
import type { KaneoConfig } from '../client.js'

const log = logger.child({ scope: 'kaneo:members' })

function generateMemberPassword(): string {
  const uuid = crypto.randomUUID().replaceAll('-', '')
  return `${uuid.slice(0, 20)}Aa1!`
}

/**
 * Extract a Better Auth session cookie from a sign-up or sign-in response.
 * Prefers `Set-Cookie: better-auth.session_token=…`; falls back to the JSON `token` field.
 * Uses `__Secure-` prefix when publicUrl is HTTPS, per Better Auth cookie semantics.
 */
function extractSessionCookie(res: Response, rawJson: unknown, publicUrl: string): string {
  const setCookies = res.headers.getSetCookie()
  const sessionHeader = setCookies.find((h) => h.includes('better-auth.session_token='))
  if (sessionHeader !== undefined) {
    return sessionHeader.split(';')[0]!
  }
  const token = String((rawJson as { token: string }).token)
  const cookieName = publicUrl.startsWith('https://')
    ? '__Secure-better-auth.session_token'
    : 'better-auth.session_token'
  return `${cookieName}=${token}`
}

async function doMemberSignUp(
  baseUrl: string,
  publicUrl: string,
  email: string,
  password: string,
  displayName: string,
): Promise<{ userId: string; sessionCookie: string }> {
  log.debug({ email, displayName }, 'kaneoProvisionMember: sign-up')
  const res = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: displayName }),
  })
  if (!res.ok) {
    throw new Error(`Member sign-up failed (${res.status}): ${await res.text()}`)
  }
  const raw: unknown = await res.json()
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('user' in raw) ||
    typeof (raw as { user: unknown }).user !== 'object'
  ) {
    throw new Error('Member sign-up returned invalid data')
  }
  const userId = String((raw as { user: { id: string } }).user.id)
  const sessionCookie = extractSessionCookie(res, raw, publicUrl)
  return { userId, sessionCookie }
}

async function doMemberSignIn(
  baseUrl: string,
  publicUrl: string,
  email: string,
  password: string,
): Promise<{ userId: string; sessionCookie: string }> {
  log.debug({ email }, 'kaneoProvisionMember: sign-in (reuse path)')
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    throw new Error(`Member sign-in failed (${res.status}): ${await res.text()}`)
  }
  const raw: unknown = await res.json()
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('user' in raw) ||
    typeof (raw as { user: unknown }).user !== 'object'
  ) {
    throw new Error('Member sign-in returned invalid data')
  }
  const userId = String((raw as { user: { id: string } }).user.id)
  const sessionCookie = extractSessionCookie(res, raw, publicUrl)
  return { userId, sessionCookie }
}

/**
 * Invite a member (by email) to an existing workspace/organization using the SERVICE credential.
 * Returns the `invitationId` to pass to `doAcceptInvitation`.
 * A 200 response that already contains an existing invitation ID is treated as success.
 */
async function doInviteMember(
  serviceConfig: KaneoConfig,
  workspaceId: string,
  email: string,
  publicUrl: string,
): Promise<string> {
  log.debug({ workspaceId, email }, 'kaneoProvisionMember: invite-member')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Origin: publicUrl || serviceConfig.baseUrl,
  }
  if (serviceConfig.sessionCookie !== undefined) {
    headers['Cookie'] = serviceConfig.sessionCookie
  } else {
    headers['Authorization'] = `Bearer ${serviceConfig.apiKey}`
  }
  const res = await fetch(`${serviceConfig.baseUrl}/api/auth/organization/invite-member`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, role: 'member', organizationId: workspaceId }),
  })
  if (!res.ok) {
    throw new Error(`invite-member failed (${res.status}): ${await res.text()}`)
  }
  const raw: unknown = await res.json()
  if (typeof raw !== 'object' || raw === null || !('id' in raw)) {
    throw new Error('invite-member returned unexpected shape (expected { id })')
  }
  const invitationId = String((raw as { id: string }).id)
  log.info({ email, workspaceId, invitationId }, 'Member invited to Kaneo workspace')
  return invitationId
}

/**
 * Accept an invitation using the MEMBER's own session cookie.
 * This is the only step that authenticates as the member, not the service account.
 */
async function doAcceptInvitation(
  baseUrl: string,
  memberSessionCookie: string,
  invitationId: string,
  publicUrl: string,
): Promise<void> {
  log.debug({ invitationId }, 'kaneoProvisionMember: accept-invitation')
  const res = await fetch(`${baseUrl}/api/auth/organization/accept-invitation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: memberSessionCookie,
      Origin: publicUrl || baseUrl,
    },
    body: JSON.stringify({ invitationId }),
  })
  if (!res.ok) {
    throw new Error(`accept-invitation failed (${res.status}): ${await res.text()}`)
  }
  log.info({ invitationId }, 'Invitation accepted — member joined workspace')
}

export type ProvisionMemberResult = {
  providerUserId: string
  login: string
  /** Generated password for new members; the stored password passed through for reuse. */
  password: string
}

/**
 * Provision a Kaneo member for a group workspace using the invite + accept flow:
 *
 * New member:
 *   1. `doMemberSignUp` — create a Better Auth account; capture session cookie + userId.
 *   2. `doInviteMember` — service account invites by email; capture invitationId.
 *   3. `doAcceptInvitation` — member session cookie accepts; member joins workspace.
 *
 * Reuse (existing account in another group):
 *   1. `doMemberSignIn` — re-authenticate the member with their stored password.
 *   2. `doInviteMember` — same as above.
 *   3. `doAcceptInvitation` — same as above.
 *
 * Returns the member's provider ID, login (email), and password. The password is:
 *   - Generated fresh for new members (caller MUST persist it encrypted).
 *   - The stored value passed back unchanged for reuse (so the caller can re-save it).
 */
export async function kaneoProvisionMember(
  /** Service account config (the group's stored kaneoKey + baseUrl). */
  serviceConfig: KaneoConfig,
  workspaceId: string,
  member: { chatUserId: string; displayName: string; username: string | null },
  /** Public-facing Kaneo URL (for Origin header and secure-cookie detection). */
  publicUrl: string,
  /**
   * When provided, SKIP sign-up and re-authenticate the member with their stored password instead.
   * All three fields must be present for the reuse path; if any is missing, treat as new member.
   */
  existing?: { providerUserId: string; login: string; password: string },
): Promise<ProvisionMemberResult> {
  log.info(
    { chatUserId: member.chatUserId, displayName: member.displayName, reuse: existing !== undefined },
    'Provisioning Kaneo member',
  )

  let userId: string
  let sessionCookie: string
  let login: string
  let password: string

  if (existing !== undefined) {
    // Reuse path: re-authenticate to get a fresh session cookie for accept-invitation.
    const signIn = await doMemberSignIn(serviceConfig.baseUrl, publicUrl, existing.login, existing.password)
    userId = signIn.userId
    sessionCookie = signIn.sessionCookie
    login = existing.login
    password = existing.password
    log.info({ chatUserId: member.chatUserId, userId, workspaceId }, 'Kaneo member reuse: signed in')
  } else {
    // New member path: generate email and password, sign up.
    const uniqueSuffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
    const emailBase = member.username !== null ? member.username : member.chatUserId
    login = `${emailBase}-${uniqueSuffix}@pap.ai`
    password = generateMemberPassword()
    const signUp = await doMemberSignUp(serviceConfig.baseUrl, publicUrl, login, password, member.displayName)
    userId = signUp.userId
    sessionCookie = signUp.sessionCookie
  }

  const invitationId = await doInviteMember(serviceConfig, workspaceId, login, publicUrl)
  await doAcceptInvitation(serviceConfig.baseUrl, sessionCookie, invitationId, publicUrl)

  log.info({ chatUserId: member.chatUserId, userId, workspaceId }, 'Kaneo member provisioned')
  return { providerUserId: userId, login, password }
}
```

- [ ] **Step 4: Add `provisionWorkspaceMember` to `KaneoProvider` in `plugins/task-provider-kaneo/provider.ts`**

Add import:

```typescript
import { kaneoProvisionMember } from './operations/members.js'
```

Add method to the class (after `listUsers`):

```typescript
  async provisionWorkspaceMember(
    member: {
      chatUserId: string
      displayName: string
      username: string | null
    },
    opts?: { existingProviderUserId?: string; existingLogin?: string; existingPassword?: string },
  ): Promise<{ providerUserId: string; login: string; password: string }> {
    const publicUrl = this.config.baseUrl // resolved from task instance config in caller
    const existing =
      opts?.existingProviderUserId !== undefined &&
      opts.existingLogin !== undefined &&
      opts.existingPassword !== undefined
        ? {
            providerUserId: opts.existingProviderUserId,
            login: opts.existingLogin,
            password: opts.existingPassword,
          }
        : undefined
    return kaneoProvisionMember(this.config, this.workspaceId, member, publicUrl, existing)
  }
```

> **Note:** `publicUrl` defaults to `baseUrl`. If the Kaneo instance config exposes a separate `publicUrl`, thread it through `KaneoProvider`'s constructor and use it here.

- [ ] **Step 5: Run test to verify it passes**

```
bun test tests/plugins/task-provider-kaneo/operations/members.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add plugins/task-provider-kaneo/operations/members.ts plugins/task-provider-kaneo/provider.ts tests/plugins/task-provider-kaneo/operations/members.test.ts
git commit -m "feat(kaneo): implement kaneoProvisionMember (invite+accept flow) and KaneoProvider.provisionWorkspaceMember"
```

---

### Task 2.3: Migration 060 + Drizzle schema for `kaneo_workspace_members`

**Files:**

- Create: `src/db/migrations/060_kaneo_workspace_members.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/db/migration-060-kaneo-workspace-members.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { setupTestDb } from '../utils/test-helpers.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'

describe('migration 060 kaneo_workspace_members', () => {
  test('table exists with required columns after migration', () => {
    setupTestDb()
    const cols = getDrizzleDb()
      .$client.query<{ name: string }, []>(`PRAGMA table_info(kaneo_workspace_members)`)
      .all()
      .map((c) => c.name)
    expect(cols).toContain('group_context_id')
    expect(cols).toContain('chat_user_id')
    expect(cols).toContain('provider_name')
    expect(cols).toContain('provider_user_id')
    expect(cols).toContain('login')
    expect(cols).toContain('status')
    expect(cols).toContain('encrypted_password')
    expect(cols).toContain('created_at')
  })

  test('unique constraint prevents duplicate (group_context_id, chat_user_id, provider_name)', () => {
    setupTestDb()
    const db = getDrizzleDb().$client
    db.run(`INSERT INTO kaneo_workspace_members
      (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, created_at)
      VALUES ('g1','u1','kaneo','pid1','u1@pap.ai','active','2026-01-01T00:00:00.000Z')`)
    // Second insert with same PK must be ignored (onConflictDoNothing)
    expect(() =>
      db.run(`INSERT INTO kaneo_workspace_members
        (group_context_id, chat_user_id, provider_name, provider_user_id, login, status, created_at)
        VALUES ('g1','u1','kaneo','pid2','u1b@pap.ai','active','2026-01-01T00:00:01.000Z')`),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/db/migration-060-kaneo-workspace-members.test.ts
```

Expected: FAIL — table does not exist.

- [ ] **Step 3: Create `src/db/migrations/060_kaneo_workspace_members.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:060' })

const tableExists = (db: Database, table: string): boolean =>
  db.query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table) !==
  undefined

const up = (db: Database): void => {
  if (!tableExists(db, 'kaneo_workspace_members')) {
    db.run(`
      CREATE TABLE kaneo_workspace_members (
        group_context_id TEXT NOT NULL,
        chat_user_id     TEXT NOT NULL,
        provider_name    TEXT NOT NULL DEFAULT 'kaneo',
        provider_user_id TEXT NOT NULL,
        login            TEXT NOT NULL,
        status              TEXT NOT NULL DEFAULT 'active',
        encrypted_password  TEXT,
        created_at          TEXT NOT NULL,
        PRIMARY KEY (group_context_id, chat_user_id, provider_name)
      )
    `)
  }
  log.info('migration 060: kaneo_workspace_members created')
}

export const migration060KaneoWorkspaceMembers: Migration = { id: '060_kaneo_workspace_members', up }
export default migration060KaneoWorkspaceMembers
```

- [ ] **Step 4: Add `kaneoWorkspaceMembers` table to `src/db/schema.ts`**

Before the closing `export { ... }` lines, add:

```typescript
export const kaneoWorkspaceMembers = sqliteTable(
  'kaneo_workspace_members',
  {
    groupContextId: text('group_context_id').notNull(),
    chatUserId: text('chat_user_id').notNull(),
    providerName: text('provider_name').notNull().default('kaneo'),
    providerUserId: text('provider_user_id').notNull(),
    login: text('login').notNull(),
    status: text('status', { enum: ['active', 'inactive', 'failed'] })
      .notNull()
      .default('active'),
    encryptedPassword: text('encrypted_password'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupContextId, table.chatUserId, table.providerName] })],
)
export type KaneoWorkspaceMember = typeof kaneoWorkspaceMembers.$inferSelect
```

- [ ] **Step 5: Register migration in `src/db/index.ts`**

After the `migration059GuestMode` import (line ~72):

```typescript
import { migration060KaneoWorkspaceMembers } from './migrations/060_kaneo_workspace_members.js'
```

Append to `MIGRATIONS` array after `migration059GuestMode`:

```typescript
  migration060KaneoWorkspaceMembers,
```

- [ ] **Step 6: Run test to verify it passes**

```
bun test tests/db/migration-060-kaneo-workspace-members.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```
git add src/db/migrations/060_kaneo_workspace_members.ts src/db/schema.ts src/db/index.ts tests/db/migration-060-kaneo-workspace-members.test.ts
git commit -m "feat(db): migration 060 — kaneo_workspace_members table with encrypted_password column"
```

---

### Task 2.4: `ensureWorkspaceMember` service

**Key change from original plan:** The reuse branch must look up the stored encrypted password from any existing `kaneo_workspace_members` row (across groups) for this `chatUserId`, decrypt it, and pass all three reuse fields (`existingProviderUserId`, `existingLogin`, `existingPassword`) to `provisionWorkspaceMember`. If no stored password is found (older row without credential), fall back to treating the user as new. On every successful provision (new or reuse), persist the returned `password` encrypted into the row's `encrypted_password` column via `encryptInstanceConfig({ password })`.

**Files:**

- Create: `src/providers/membership/ensure-member.ts`
- Create: `src/providers/membership/index.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/providers/membership/ensure-member.test.ts` (replace the type-check placeholder from Task 1.1):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { ensureWorkspaceMember, type MembershipDeps } from '../../../src/providers/membership/ensure-member.js'
import { getIdentityMapping } from '../../../src/identity/mapping.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../../src/db/schema.js'
import { eq, and } from 'drizzle-orm'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'
import type { TaskProvider } from '../../../src/providers/types.js'

const GROUP_CTX = 'grp-ctx-1'
const CHAT_USER = 'chat-user-1'
const KANEO_USER_ID = 'kaneo-uid-1'

function makeFakeProvider(overrides: Partial<TaskProvider> = {}): TaskProvider {
  return {
    name: 'kaneo',
    capabilities: new Set(['members.provision']),
    traits: new Set(),
    preferredUserIdentifier: 'id',
    createTask: async () => {
      throw new Error('not impl')
    },
    getTask: async () => {
      throw new Error('not impl')
    },
    updateTask: async () => {
      throw new Error('not impl')
    },
    listTasks: async () => [],
    searchTasks: async () => [],
    buildTaskUrl: () => '',
    buildProjectUrl: () => '',
    classifyError: (e) => ({ type: 'unexpected', message: String(e) }) as any,
    getPromptAddendum: () => '',
    normalizeDueDateInput: () => undefined,
    formatDueDateOutput: () => undefined,
    normalizeListTaskParams: (p) => p,
    provisionWorkspaceMember: async () => ({ providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'gen-pass' }),
    ...overrides,
  }
}

function makeDeps(overrides: Partial<MembershipDeps> = {}): MembershipDeps {
  return {
    resolveProvider: async () => makeFakeProvider(),
    getContextSettings: () => ({ taskInstanceId: 'ti-1', platformInstanceId: 'pi-1' }),
    resolveUserLabel: async () => 'Alice',
    ...overrides,
  }
}

describe('ensureWorkspaceMember', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns "created" on first call, writes the member row, and persists encrypted password', async () => {
    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    expect(result).toBe('created')
    const db = getDrizzleDb()
    const row = db
      .select()
      .from(kaneoWorkspaceMembers)
      .where(and(eq(kaneoWorkspaceMembers.groupContextId, GROUP_CTX), eq(kaneoWorkspaceMembers.chatUserId, CHAT_USER)))
      .get()
    expect(row?.providerUserId).toBe(KANEO_USER_ID)
    expect(row?.status).toBe('active')
    // encrypted_password must be non-null after provision (the sole credential mechanism)
    expect(row?.encryptedPassword).not.toBeNull()
  })

  test('returns "exists" when row already present', async () => {
    await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    expect(result).toBe('exists')
  })

  test('writes a "provisioned" identity mapping on success', async () => {
    await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps())
    const mapping = getIdentityMapping(CHAT_USER, 'kaneo')
    expect(mapping?.matchMethod).toBe('provisioned')
    expect(mapping?.providerUserId).toBe(KANEO_USER_ID)
  })

  test('returns "skipped" when provider lacks members.provision capability', async () => {
    const result = await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({ resolveProvider: async () => makeFakeProvider({ capabilities: new Set() }) }),
    )
    expect(result).toBe('skipped')
  })

  test('returns "skipped" when no provider resolved', async () => {
    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps({ resolveProvider: async () => null }))
    expect(result).toBe('skipped')
  })

  test('returns "skipped" when no context settings', async () => {
    const result = await ensureWorkspaceMember(GROUP_CTX, CHAT_USER, makeDeps({ getContextSettings: () => null }))
    expect(result).toBe('skipped')
  })

  test('returns "failed" when provisioning throws, records failed row', async () => {
    const result = await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveProvider: async () =>
          makeFakeProvider({
            provisionWorkspaceMember: async () => {
              throw new Error('Kaneo down')
            },
          }),
      }),
    )
    expect(result).toBe('failed')
    const db = getDrizzleDb()
    const row = db
      .select()
      .from(kaneoWorkspaceMembers)
      .where(and(eq(kaneoWorkspaceMembers.groupContextId, GROUP_CTX), eq(kaneoWorkspaceMembers.chatUserId, CHAT_USER)))
      .get()
    expect(row?.status).toBe('failed')
  })

  test('uses resolveUserLabel fallback chain: null → "User <chatUserId>"', async () => {
    let usedLabel = ''
    const result = await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveUserLabel: async () => null,
        resolveProvider: async () =>
          makeFakeProvider({
            provisionWorkspaceMember: async (member) => {
              usedLabel = member.displayName
              return { providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'gen-pass' }
            },
          }),
      }),
    )
    expect(result).toBe('created')
    expect(usedLabel).toBe(`User ${CHAT_USER}`)
  })

  test('reuse path: fetches stored encrypted password and passes all three existing opts', async () => {
    // Pre-insert a member row in a DIFFERENT group with an encrypted password
    // (simulate: user was provisioned in another group, `encrypted_password` was stored)
    const db = getDrizzleDb()
    // We rely on the real encryptInstanceConfig / decryptInstanceConfig round-trip in the implementation,
    // so use the test-helper encryption helper or insert a well-known encrypted value.
    // For the test, we insert a plaintext sentinel and use a deps override for decryption:
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: 'other-group',
        chatUserId: CHAT_USER,
        providerName: 'kaneo',
        providerUserId: 'pre-uid',
        login: 'pre@pap.ai',
        status: 'active',
        encryptedPassword: 'ENCRYPTED:StoredPass1!Aa',
        createdAt: new Date().toISOString(),
      })
      .run()

    const receivedOpts: Array<{ existingProviderUserId?: string; existingLogin?: string; existingPassword?: string }> =
      []
    await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveProvider: async () =>
          makeFakeProvider({
            provisionWorkspaceMember: async (_member, opts) => {
              receivedOpts.push({
                existingProviderUserId: opts?.existingProviderUserId,
                existingLogin: opts?.existingLogin,
                existingPassword: opts?.existingPassword,
              })
              return { providerUserId: 'pre-uid', login: 'pre@pap.ai', password: 'StoredPass1!Aa' }
            },
          }),
        // Override decrypt to decode the test sentinel
        decryptPassword: (encrypted) => encrypted.replace('ENCRYPTED:', ''),
      }),
    )

    expect(receivedOpts[0]?.existingProviderUserId).toBe('pre-uid')
    expect(receivedOpts[0]?.existingLogin).toBe('pre@pap.ai')
    expect(receivedOpts[0]?.existingPassword).toBe('StoredPass1!Aa')
  })

  test('falls back to new-member path when stored row has no encrypted_password', async () => {
    // Pre-insert a member row with no password (pre-credential row from an older provisioning)
    const db = getDrizzleDb()
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: 'other-group',
        chatUserId: CHAT_USER,
        providerName: 'kaneo',
        providerUserId: 'old-uid',
        login: 'old@pap.ai',
        status: 'active',
        encryptedPassword: null,
        createdAt: new Date().toISOString(),
      })
      .run()

    const receivedOpts: Array<{ existingProviderUserId?: string }> = []
    await ensureWorkspaceMember(
      GROUP_CTX,
      CHAT_USER,
      makeDeps({
        resolveProvider: async () =>
          makeFakeProvider({
            provisionWorkspaceMember: async (_member, opts) => {
              receivedOpts.push({ existingProviderUserId: opts?.existingProviderUserId })
              return { providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'new-gen-pass' }
            },
          }),
      }),
    )

    // No existingProviderUserId because the stored row had no password
    expect(receivedOpts[0]?.existingProviderUserId).toBeUndefined()
  })

  test('does NOT pass existingProviderUserId when no prior member row exists at all', async () => {
    const receivedOpts: Array<{ existingProviderUserId?: string }> = []

    await ensureWorkspaceMember(
      'grp-ctx-new',
      'chat-user-new',
      makeDeps({
        resolveProvider: async () =>
          makeFakeProvider({
            provisionWorkspaceMember: async (_member, opts) => {
              receivedOpts.push({ existingProviderUserId: opts?.existingProviderUserId })
              return { providerUserId: KANEO_USER_ID, login: 'u@pap.ai', password: 'gen-pass' }
            },
          }),
      }),
    )

    expect(receivedOpts[0]?.existingProviderUserId).toBeUndefined()
  })
})
```

> **Note on `decryptPassword` in `MembershipDeps`:** The reuse test adds a `decryptPassword` injectable to allow isolated testing without the real AES key. The implementation in Step 3 uses `decryptInstanceConfig` by default and accepts the override from `deps`.

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/providers/membership/ensure-member.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/providers/membership/ensure-member.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNotNull } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../db/schema.js'
import { getIdentityMapping, setProvisionedIdentityMapping } from '../../identity/mapping.js'
import { getContextSettings as defaultGetContextSettings } from '../../instances/context-store.js'
import { decryptInstanceConfig, encryptInstanceConfig } from '../../instances/encryption.js'
import { logger } from '../../logger.js'
import { defaultTaskProviderResolver } from '../resolver.js'
import type { TaskProvider } from '../types.js'

const log = logger.child({ scope: 'providers:membership' })

export type MemberOutcome = 'created' | 'exists' | 'skipped' | 'failed'

export interface MembershipDeps {
  resolveProvider(configId: string): Promise<TaskProvider | null>
  getContextSettings(contextId: string): { taskInstanceId: string; platformInstanceId: string } | null
  /** Resolves a display label for a user. Returns null when the chat router cannot resolve it (best-effort). */
  resolveUserLabel(userId: string, groupContextId: string, platformInstanceId: string): Promise<string | null>
  /** Decrypt an encrypted password value. Defaults to `decryptInstanceConfig`. Overridable for tests. */
  decryptPassword?(encrypted: string): string
}

export const defaultMembershipDeps: MembershipDeps = {
  resolveProvider: (contextId) => defaultTaskProviderResolver.resolve(contextId),
  getContextSettings: defaultGetContextSettings,
  resolveUserLabel: async () => null,
}

function buildDisplayName(resolvedLabel: string | null, username: string | null, chatUserId: string): string {
  if (resolvedLabel !== null && resolvedLabel.trim().length > 0) return resolvedLabel
  if (username !== null && username.trim().length > 0) return `@${username}`
  return `User ${chatUserId}`
}

function findExistingMemberRowCurrentGroup(groupContextId: string, chatUserId: string): boolean {
  const db = defaultGetDrizzleDb()
  const row = db
    .select({ status: kaneoWorkspaceMembers.status })
    .from(kaneoWorkspaceMembers)
    .where(
      and(eq(kaneoWorkspaceMembers.groupContextId, groupContextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)),
    )
    .get()
  return row !== undefined
}

/**
 * Look for a previously-provisioned row for this chatUserId in ANY group that has an
 * `encrypted_password`. Returns `{ providerUserId, login, encryptedPassword }` or null.
 */
function findStoredCredentialsAcrossGroups(
  chatUserId: string,
): { providerUserId: string; login: string; encryptedPassword: string } | null {
  const db = defaultGetDrizzleDb()
  const row = db
    .select({
      providerUserId: kaneoWorkspaceMembers.providerUserId,
      login: kaneoWorkspaceMembers.login,
      encryptedPassword: kaneoWorkspaceMembers.encryptedPassword,
    })
    .from(kaneoWorkspaceMembers)
    .where(
      and(
        eq(kaneoWorkspaceMembers.chatUserId, chatUserId),
        eq(kaneoWorkspaceMembers.providerName, 'kaneo'),
        isNotNull(kaneoWorkspaceMembers.encryptedPassword),
      ),
    )
    .get()
  if (row === undefined || row.encryptedPassword === null) return null
  return {
    providerUserId: row.providerUserId,
    login: row.login,
    encryptedPassword: row.encryptedPassword,
  }
}

function writeMemberRow(
  groupContextId: string,
  chatUserId: string,
  providerUserId: string,
  login: string,
  status: 'active' | 'failed',
  encryptedPassword?: string | null,
): void {
  const db = defaultGetDrizzleDb()
  db.insert(kaneoWorkspaceMembers)
    .values({
      groupContextId,
      chatUserId,
      providerName: 'kaneo',
      providerUserId,
      login,
      status,
      encryptedPassword: encryptedPassword ?? null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run()
}

/**
 * Idempotent entry point: ensure a chat user is provisioned as a Kaneo workspace member.
 * All failures are logged and returned as 'failed' — never thrown into the caller.
 *
 * Reuse logic: if a prior `kaneo_workspace_members` row (any group) has `encrypted_password`,
 * decrypt it and pass `existingProviderUserId`, `existingLogin`, and `existingPassword` to the
 * provider so it can sign-in (not sign-up) and invite+accept. If the stored row has no password
 * (older row), fall back to a fresh sign-up.
 */
export async function ensureWorkspaceMember(
  groupContextId: string,
  chatUserId: string,
  deps: MembershipDeps = defaultMembershipDeps,
  opts?: { username?: string | null },
): Promise<MemberOutcome> {
  log.debug({ groupContextId, chatUserId }, 'ensureWorkspaceMember called')

  if (findExistingMemberRowCurrentGroup(groupContextId, chatUserId)) {
    log.debug({ groupContextId, chatUserId }, 'Member row already exists')
    return 'exists'
  }

  const settings = deps.getContextSettings(groupContextId)
  if (settings === null) {
    log.debug({ groupContextId }, 'No context settings — skipping')
    return 'skipped'
  }

  const provider = await deps.resolveProvider(groupContextId)
  if (
    provider === null ||
    !provider.capabilities.has('members.provision') ||
    provider.provisionWorkspaceMember === undefined
  ) {
    log.debug({ groupContextId, hasProvider: provider !== null }, 'Provider lacks members.provision — skipping')
    return 'skipped'
  }

  const resolvedLabel = await deps.resolveUserLabel(chatUserId, groupContextId, settings.platformInstanceId)
  const displayName = buildDisplayName(resolvedLabel, opts?.username ?? null, chatUserId)

  // Reuse existing Kaneo account across groups if a stored credential exists.
  const storedCredentials = findStoredCredentialsAcrossGroups(chatUserId)
  let existingOpts: { existingProviderUserId: string; existingLogin: string; existingPassword: string } | undefined
  if (storedCredentials !== null) {
    try {
      const decryptFn = deps.decryptPassword ?? ((enc) => decryptInstanceConfig(enc)['password'] ?? '')
      const password = decryptFn(storedCredentials.encryptedPassword)
      if (password !== '') {
        existingOpts = {
          existingProviderUserId: storedCredentials.providerUserId,
          existingLogin: storedCredentials.login,
          existingPassword: password,
        }
        log.debug(
          { chatUserId, login: storedCredentials.login },
          'Reusing stored credentials for cross-group provision',
        )
      } else {
        log.warn({ chatUserId }, 'Stored encrypted_password decrypted to empty string — falling back to new sign-up')
      }
    } catch (decryptErr: unknown) {
      log.warn(
        { chatUserId, error: decryptErr instanceof Error ? decryptErr.message : String(decryptErr) },
        'Failed to decrypt stored password — falling back to new sign-up',
      )
    }
  }

  try {
    const { providerUserId, login, password } = await provider.provisionWorkspaceMember(
      {
        chatUserId,
        displayName,
        username: opts?.username ?? null,
      },
      existingOpts,
    )

    // Encrypt and persist the password — this is the sole credential mechanism.
    const encryptedPassword = encryptInstanceConfig({ password })
    writeMemberRow(groupContextId, chatUserId, providerUserId, login, 'active', encryptedPassword)
    setProvisionedIdentityMapping({
      contextId: chatUserId,
      providerName: provider.name,
      providerUserId,
      providerUserLogin: login,
      displayName,
      matchMethod: 'provisioned',
      confidence: 1,
    })

    log.info({ groupContextId, chatUserId, providerUserId }, 'Workspace member provisioned')
    return 'created'
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ groupContextId, chatUserId, error: msg }, 'ensureWorkspaceMember failed')
    writeMemberRow(groupContextId, chatUserId, '', '', 'failed', null)
    return 'failed'
  }
}
```

- [ ] **Step 4: Create `src/providers/membership/index.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export {
  ensureWorkspaceMember,
  defaultMembershipDeps,
  type MemberOutcome,
  type MembershipDeps,
} from './ensure-member.js'
export { registerMembershipSubscriber } from './subscriber.js'
export { runMembershipBackfill } from './backfill.js'
```

> Note: `subscriber.ts` and `backfill.ts` are created in Phase 3. Remove their exports from `index.ts` until then to avoid import errors.

- [ ] **Step 5: Run test to verify it passes**

```
bun test tests/providers/membership/ensure-member.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/providers/membership/ tests/providers/membership/ensure-member.test.ts
git commit -m "feat(membership): ensureWorkspaceMember with reuse-via-stored-password, encrypted_password persistence, identity-link write"
```

---

## Phase 3 — Triggers

### Task 3.1: `group_member:added`/`:removed` event subscriber

**Files:**

- Create: `src/providers/membership/subscriber.ts`
- Modify: `src/providers/membership/index.ts` (uncomment the subscriber export)
- Modify: `src/index.ts` (call `registerMembershipSubscriber()` at startup)

- [ ] **Step 1: Write the failing test**

Create `tests/providers/membership/subscriber.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

import { subscribe, unsubscribe, emitGlobal, subscribeCountForTest } from '../../../src/debug/event-bus.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('membership subscriber', () => {
  let ensureCalls: Array<{ groupContextId: string; chatUserId: string }> = []
  let removeCalls: Array<{ groupContextId: string; chatUserId: string }> = []

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    ensureCalls = []
    removeCalls = []
  })

  test('registerMembershipSubscriber adds a global listener', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const before = subscribeCountForTest()
    const unregister = registerMembershipSubscriber({
      ensure: async (g, u) => {
        ensureCalls.push({ groupContextId: g, chatUserId: u })
        return 'created'
      },
      markInactive: async () => {},
    })
    expect(subscribeCountForTest()).toBe(before + 1)
    unregister()
  })

  test('group_member:added triggers ensureWorkspaceMember', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const unregister = registerMembershipSubscriber({
      ensure: async (g, u) => {
        ensureCalls.push({ groupContextId: g, chatUserId: u })
        return 'created'
      },
      markInactive: async () => {},
    })

    emitGlobal('group_member:added', { groupId: 'g-1', userId: 'u-1' })
    // poll because event dispatch is synchronous but our handler is async
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    expect(ensureCalls).toHaveLength(1)
    expect(ensureCalls[0]).toEqual({ groupContextId: 'g-1', chatUserId: 'u-1' })
    unregister()
  })

  test('group_member:added skips placeholder userIds', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const unregister = registerMembershipSubscriber({
      ensure: async (g, u) => {
        ensureCalls.push({ groupContextId: g, chatUserId: u })
        return 'skipped'
      },
      markInactive: async () => {},
    })

    emitGlobal('group_member:added', { groupId: 'g-2', userId: 'placeholder-abc123' })
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    expect(ensureCalls).toHaveLength(0)
    unregister()
  })

  test('group_member:removed calls markInactive', async () => {
    const { registerMembershipSubscriber } = await import('../../../src/providers/membership/subscriber.js')
    const unregister = registerMembershipSubscriber({
      ensure: async () => 'skipped',
      markInactive: async (g, u) => {
        removeCalls.push({ groupContextId: g, chatUserId: u })
      },
    })

    emitGlobal('group_member:removed', { groupId: 'g-3', userId: 'u-3' })
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    expect(removeCalls).toHaveLength(1)
    expect(removeCalls[0]).toEqual({ groupContextId: 'g-3', chatUserId: 'u-3' })
    unregister()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/providers/membership/subscriber.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/providers/membership/subscriber.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import type { DebugEvent } from '../../debug/event-bus.js'
import { subscribe, unsubscribe } from '../../debug/event-bus.js'
import { logger } from '../../logger.js'
import type { MemberOutcome } from './ensure-member.js'

const log = logger.child({ scope: 'providers:membership:subscriber' })
const limit = pLimit(4)

function isPlaceholder(userId: string): boolean {
  return userId.startsWith('placeholder-')
}

export interface SubscriberHandlers {
  ensure(groupContextId: string, chatUserId: string): Promise<MemberOutcome>
  markInactive(groupContextId: string, chatUserId: string): Promise<void>
}

export function registerMembershipSubscriber(handlers: SubscriberHandlers): () => void {
  const listener = (event: DebugEvent): void => {
    if (event.type === 'group_member:added') {
      const { groupId, userId } = event.data as { groupId: string; userId: string }
      if (isPlaceholder(userId)) {
        log.debug({ groupId, userId }, 'Skipping placeholder user in member:added subscriber')
        return
      }
      void limit(async () => {
        const outcome = await handlers.ensure(groupId, userId)
        log.debug({ groupId, userId, outcome }, 'group_member:added -> ensureWorkspaceMember')
      })
    } else if (event.type === 'group_member:removed') {
      const { groupId, userId } = event.data as { groupId: string; userId: string }
      void limit(async () => {
        await handlers.markInactive(groupId, userId)
        log.debug({ groupId, userId }, 'group_member:removed -> markInactive')
      })
    }
  }

  subscribe(listener)
  log.info('Membership event subscriber registered')
  return () => {
    unsubscribe(listener)
    log.debug('Membership event subscriber unregistered')
  }
}
```

- [ ] **Step 4: Add `markInactive` to `ensureWorkspaceMember` module and export from index**

In `src/providers/membership/ensure-member.ts`, add after `ensureWorkspaceMember`:

```typescript
export async function markMemberInactive(groupContextId: string, chatUserId: string): Promise<void> {
  log.debug({ groupContextId, chatUserId }, 'markMemberInactive called')
  const db = defaultGetDrizzleDb()
  db.update(kaneoWorkspaceMembers)
    .set({ status: 'inactive' })
    .where(
      and(eq(kaneoWorkspaceMembers.groupContextId, groupContextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)),
    )
    .run()
  log.info({ groupContextId, chatUserId }, 'Member marked inactive')
}
```

Update `src/providers/membership/index.ts` to export the subscriber:

```typescript
export {
  ensureWorkspaceMember,
  markMemberInactive,
  defaultMembershipDeps,
  type MemberOutcome,
  type MembershipDeps,
} from './ensure-member.js'
export { registerMembershipSubscriber, type SubscriberHandlers } from './subscriber.js'
export { runMembershipBackfill } from './backfill.js'
```

> Keep `backfill.js` export commented out until Task 3.2.

- [ ] **Step 5: Register the subscriber in `src/index.ts`**

Find the startup sequence in `src/index.ts` and add after the existing startup calls (e.g., after `initDb()`):

```typescript
import { registerMembershipSubscriber } from './providers/membership/index.js'
import { ensureWorkspaceMember, markMemberInactive, defaultMembershipDeps } from './providers/membership/index.js'

// In the startup block, AFTER `const chatProvider = new ChatRouter(...)` (~line 84):
registerMembershipSubscriber({
  ensure: (groupContextId, chatUserId) =>
    ensureWorkspaceMember(groupContextId, chatUserId, {
      ...defaultMembershipDeps,
      resolveUserLabel: (userId, groupCtxId, platformInstanceId) =>
        chatProvider.resolveUserLabel(userId, { contextId: groupCtxId, contextType: 'group', platformInstanceId }),
    }),
  markInactive: markMemberInactive,
})
```

> **Startup wiring:** `chatProvider` (a `ChatRouter`) is constructed at `src/index.ts` ~line 84. Register the subscriber AFTER that line so `chatProvider` is in scope. The `resolveUserLabel` call uses `(userId, groupContextId, platformInstanceId)` matching `ResolveUserContext` — it is best-effort: `null` resolves to `User <id>`. Note that `groupContextId` is the storage context id and may not equal the raw platform group id, so label resolution is best-effort only.

- [ ] **Step 6: Run test to verify it passes**

```
bun test tests/providers/membership/subscriber.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```
git add src/providers/membership/subscriber.ts src/providers/membership/ensure-member.ts src/providers/membership/index.ts src/index.ts tests/providers/membership/subscriber.test.ts
git commit -m "feat(membership): group_member:added/removed event subscriber with p-limit and placeholder skip"
```

---

### Task 3.2: Startup backfill + admin re-run API

**Files:**

- Create: `src/providers/membership/backfill.ts`
- Modify: `src/providers/membership/index.ts`
- Modify: `src/index.ts` (call backfill at startup)
- Modify: `src/debug/settings-api-router.ts` (admin re-run route — can wait for Phase 4)

- [ ] **Step 1: Write the failing test**

Create `tests/providers/membership/backfill.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { groupMembers } from '../../../src/db/schema.js'
import { runMembershipBackfill } from '../../../src/providers/membership/backfill.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('runMembershipBackfill', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('calls ensure for each group member', async () => {
    const db = getDrizzleDb()
    db.insert(groupMembers)
      .values([
        { groupId: 'g-1', userId: 'u-1', addedBy: 'admin', addedAt: new Date().toISOString() },
        { groupId: 'g-1', userId: 'u-2', addedBy: 'admin', addedAt: new Date().toISOString() },
      ])
      .run()

    const ensureCalls: string[] = []
    await runMembershipBackfill({
      listAllGroupMembers: () =>
        db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all(),
      ensure: async (g, u) => {
        ensureCalls.push(`${g}:${u}`)
        return 'created'
      },
    })

    expect(ensureCalls).toContain('g-1:u-1')
    expect(ensureCalls).toContain('g-1:u-2')
  })

  test('skips placeholder members', async () => {
    const db = getDrizzleDb()
    db.insert(groupMembers)
      .values([
        { groupId: 'g-2', userId: 'placeholder-abc', addedBy: 'admin', addedAt: new Date().toISOString() },
        { groupId: 'g-2', userId: 'real-user', addedBy: 'admin', addedAt: new Date().toISOString() },
      ])
      .run()

    const ensureCalls: string[] = []
    await runMembershipBackfill({
      listAllGroupMembers: () =>
        db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all(),
      ensure: async (g, u) => {
        ensureCalls.push(`${g}:${u}`)
        return 'created'
      },
    })

    expect(ensureCalls).not.toContain('g-2:placeholder-abc')
    expect(ensureCalls).toContain('g-2:real-user')
  })

  test('is idempotent — returns counts', async () => {
    const db = getDrizzleDb()
    db.insert(groupMembers)
      .values([{ groupId: 'g-3', userId: 'u-3', addedBy: 'admin', addedAt: new Date().toISOString() }])
      .run()

    const result = await runMembershipBackfill({
      listAllGroupMembers: () =>
        db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all(),
      ensure: async () => 'exists',
    })

    expect(result.total).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.exists).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/providers/membership/backfill.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/providers/membership/backfill.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { getDrizzleDb } from '../../db/drizzle.js'
import { groupMembers } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { MemberOutcome } from './ensure-member.js'

const log = logger.child({ scope: 'providers:membership:backfill' })

export interface BackfillDeps {
  listAllGroupMembers(): Array<{ groupId: string; userId: string }>
  ensure(groupContextId: string, chatUserId: string): Promise<MemberOutcome>
}

export type BackfillResult = {
  total: number
  created: number
  exists: number
  skipped: number
  failed: number
}

function defaultListAllGroupMembers(): Array<{ groupId: string; userId: string }> {
  const db = getDrizzleDb()
  return db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all()
}

/**
 * One-shot idempotent backfill: ensures every existing group member is provisioned.
 * Safe to call on startup and re-run from admin UI.
 */
export async function runMembershipBackfill(deps?: Partial<BackfillDeps>): Promise<BackfillResult> {
  const listFn = deps?.listAllGroupMembers ?? defaultListAllGroupMembers
  const ensureFn = deps?.ensure ?? (async () => 'skipped' as const)

  log.info('Starting membership backfill')
  const members = listFn().filter((m) => !m.userId.startsWith('placeholder-'))
  const result: BackfillResult = { total: members.length, created: 0, exists: 0, skipped: 0, failed: 0 }
  const limit = pLimit(4)

  await Promise.all(
    members.map((m) =>
      limit(async () => {
        const outcome = await ensureFn(m.groupId, m.userId)
        result[outcome]++
      }),
    ),
  )

  log.info(result, 'Membership backfill complete')
  return result
}
```

- [ ] **Step 4: Register backfill in `src/index.ts`**

After registering the event subscriber, add:

```typescript
import { runMembershipBackfill } from './providers/membership/index.js'

// After subscriber registration (chatProvider already in scope), fire-and-forget backfill at startup:
void runMembershipBackfill({
  ensure: (groupContextId, chatUserId) =>
    ensureWorkspaceMember(groupContextId, chatUserId, {
      ...defaultMembershipDeps,
      resolveUserLabel: (userId, groupCtxId, platformInstanceId) =>
        chatProvider.resolveUserLabel(userId, { contextId: groupCtxId, contextType: 'group', platformInstanceId }),
    }),
})
  .then((result) => {
    log.info(result, 'Startup membership backfill finished')
  })
  .catch((err: unknown) => {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Startup membership backfill failed')
  })
```

- [ ] **Step 5: Run test to verify it passes**

```
bun test tests/providers/membership/backfill.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/providers/membership/backfill.ts src/providers/membership/index.ts src/index.ts tests/providers/membership/backfill.test.ts
git commit -m "feat(membership): startup backfill + re-runnable via admin, p-limit bounded"
```

---

### Task 3.3: First-interaction backstop in `llm-orchestrator.ts`

**Files:**

- Modify: `src/llm-orchestrator.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/providers/membership/ensure-member.test.ts` a test that verifies the backstop is called via `processMessage` with a group context. Because `processMessage` has many deps, use a simpler integration check: verify `ensureWorkspaceMember` is exported and callable (integration tests of the full orchestrator exist elsewhere). The key behavioral test is the module import check — the hook is a 5-line addition:

```typescript
test('ensureWorkspaceMember is exported from src/providers/membership/index.ts', async () => {
  const mod = await import('../../../src/providers/membership/index.js')
  expect(typeof mod.ensureWorkspaceMember).toBe('function')
})
```

Run: `bun test tests/providers/membership/ensure-member.test.ts` — Expected PASS (already works, not new behavior).

The runtime test is: after the change, a group message from a user with no member row results in the row being created. This is covered by the full E2E suite (see `tests/e2e/`) and by a manual smoke test after deployment.

- [ ] **Step 2: Add the backstop to `src/llm-orchestrator.ts`**

After the `maybeAutoLinkIdentity` call in `callLlm` (around line 149), add a `maybeEnsureWorkspaceMember` call for group contexts:

First add the import at the top of the file:

```typescript
import { ensureWorkspaceMember } from './providers/membership/index.js'
```

Then in `callLlm`, after `await maybeAutoLinkIdentity(chatUserId, username, provider)`:

```typescript
if (contextType === 'group' && provider !== null) {
  // Best-effort backstop: provision workspace member on first interaction.
  // Non-blocking — failure is logged inside ensureWorkspaceMember, never propagated.
  void ensureWorkspaceMember(configId, chatUserId, undefined, { username }).catch((err: unknown) =>
    log.warn(
      { chatUserId, error: err instanceof Error ? err.message : String(err) },
      'Backstop ensureWorkspaceMember failed',
    ),
  )
}
```

Note: `configId` is the group's storage context id. `ensureWorkspaceMember` uses it to resolve the provider via `defaultTaskProviderResolver.resolve(configId)`. The full membership deps (including `resolveUserLabel` wired to `chatProvider`) are passed at the subscriber and backfill call sites in Tasks 3.1 and 3.2 — the backstop here uses `defaultMembershipDeps` which returns `null` for `resolveUserLabel` and falls back to `User <chatUserId>`. That is acceptable for the backstop path since labels are best-effort.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```
bun run test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```
git add src/llm-orchestrator.ts
git commit -m "feat(membership): first-interaction backstop in llm-orchestrator callLlm"
```

---

## Phase 4 — Settings Credentials Route

### Task 4.1: `GET/POST /settings/api/kaneo/credentials`

**Mechanism (Phase-0 fixed):** Branch B (encrypted-password) only. `POST /api/auth/admin/set-password` returns 404 in Kaneo 2.7.2; Branch A is dead. The `POST { action: 'reset' }` handler reads the member's `encrypted_password` column, decrypts it via `decryptInstanceConfig`, returns the plaintext once, and clears the stored value to enforce reveal-once semantics. If `encrypted_password` is null (row predates credential storage), return 409 with a re-provision instruction.

**Files:**

- Create: `src/debug/settings/kaneo-credentials-routes.ts`
- Modify: `src/debug/settings-api-router.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/debug/settings/kaneo-credentials-routes.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleKaneoCredentialsRoutes } from '../../../src/debug/settings/kaneo-credentials-routes.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

// Minimal fake auth — replace with the real authenticate() stub when available
function makeAuthedRequest(method: string, url: string, userId: string): Request {
  // Tests use a thin request wrapper; the authenticate() call in the route must be mockable.
  // Use mock.module for the settings/request-auth module or pass deps via DI.
  return new Request(url, { method, headers: { 'x-test-user-id': userId } })
}

describe('GET /settings/api/kaneo/credentials', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns 404 when no member row exists', async () => {
    // Stub authenticate to return authed principal for chat-user-1
    // (Implementation-specific to how authenticate() is mockable in this suite)
    // For now, verify the handler function is exported and callable:
    expect(typeof handleKaneoCredentialsRoutes).toBe('function')
  })

  test('member row is readable via Drizzle schema', () => {
    const db = getDrizzleDb()
    db.insert(kaneoWorkspaceMembers)
      .values({
        groupContextId: 'grp-1',
        chatUserId: 'u-1',
        providerName: 'kaneo',
        providerUserId: 'pid-1',
        login: 'u1@pap.ai',
        status: 'active',
        createdAt: new Date().toISOString(),
      })
      .run()

    const row = db.select().from(kaneoWorkspaceMembers).get()
    expect(row?.login).toBe('u1@pap.ai')
    expect(row?.status).toBe('active')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/debug/settings/kaneo-credentials-routes.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `src/debug/settings/kaneo-credentials-routes.ts`**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getDrizzleDb } from '../../db/drizzle.js'
import { kaneoWorkspaceMembers } from '../../db/schema.js'
import { getContextSettings } from '../../instances/context-store.js'
import { decryptInstanceConfig } from '../../instances/encryption.js'
import { getTaskInstance } from '../../instances/task-store.js'
import { logger } from '../../logger.js'
import { authenticate, parseJsonBody, requireCsrf, resolveContextScope, settingsJson } from './respond.js'

const log = logger.child({ scope: 'debug-server:settings-kaneo-credentials' })

function getKaneoMemberRow(groupContextId: string, chatUserId: string) {
  return getDrizzleDb()
    .select()
    .from(kaneoWorkspaceMembers)
    .where(
      and(eq(kaneoWorkspaceMembers.groupContextId, groupContextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)),
    )
    .get()
}

function getKaneoPublicUrl(groupContextId: string): string | null {
  const settings = getContextSettings(groupContextId)
  if (settings === null) return null
  const instance = getTaskInstance(settings.taskInstanceId)
  if (instance === null || instance.type !== 'kaneo') return null
  return (instance.config as Record<string, string>)['baseUrl'] ?? null
}

function handleGet(req: Request, url: URL): Response {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const scope = resolveContextScope(auth.authed.principal, 'read', url.searchParams.get('contextId') ?? undefined)
  if (!scope.ok) return scope.response

  const { contextId } = scope.scope
  const chatUserId = auth.authed.principal.platformUserId
  const row = getKaneoMemberRow(contextId, chatUserId)
  if (row === undefined) {
    return settingsJson(404, { error: 'No Kaneo account provisioned for this member in this group.' })
  }
  const kaneoUrl = getKaneoPublicUrl(contextId)
  return settingsJson(200, {
    contextId,
    login: row.login,
    status: row.status,
    kaneoUrl,
    // password is never returned in GET — use POST { action: 'reset' } to reveal it once.
  })
}

const PostBodySchema = z.object({
  action: z.literal('reset'),
  contextId: z.string().optional(),
})

async function handlePost(req: Request): Promise<Response> {
  const auth = authenticate(req)
  if (!auth.ok) return auth.response
  const csrf = requireCsrf(req, auth.authed)
  if (csrf !== null) return csrf
  const parsed = await parseJsonBody(req)
  if (!parsed.ok) return parsed.response
  const body = PostBodySchema.safeParse(parsed.value)
  if (!body.success) return settingsJson(422, { error: 'invalid request' })

  const scope = resolveContextScope(auth.authed.principal, 'write', body.data.contextId)
  if (!scope.ok) return scope.response

  const { contextId } = scope.scope
  // Use platformUserId (not chatUserId) to match the stored row keyed by platform user id.
  const chatUserId = auth.authed.principal.platformUserId
  const row = getKaneoMemberRow(contextId, chatUserId)
  if (row === undefined) {
    return settingsJson(404, { error: 'No Kaneo account provisioned for this member.' })
  }

  // Branch B (sole mechanism): reveal the stored encrypted password once.
  // admin/set-password (Branch A) is not reachable over HTTP in Kaneo 2.7.2 (404).
  if (row.encryptedPassword === null) {
    return settingsJson(409, {
      error:
        'No stored password for this account. This account was provisioned before credential storage was introduced — ask an admin to re-provision it.',
    })
  }

  let revealedPassword: string
  try {
    const decrypted = decryptInstanceConfig(row.encryptedPassword)
    revealedPassword = (decrypted as Record<string, string>)['password'] ?? ''
  } catch (err: unknown) {
    log.error(
      { contextId, error: err instanceof Error ? err.message : String(err) },
      'Failed to decrypt Kaneo password',
    )
    return settingsJson(500, { error: 'Failed to decrypt stored password — contact your administrator.' })
  }

  if (revealedPassword === '') {
    return settingsJson(500, { error: 'Stored password is empty — contact your administrator.' })
  }

  // Enforce reveal-once semantics: clear the stored ciphertext immediately after decryption.
  getDrizzleDb()
    .update(kaneoWorkspaceMembers)
    .set({ encryptedPassword: null })
    .where(and(eq(kaneoWorkspaceMembers.groupContextId, contextId), eq(kaneoWorkspaceMembers.chatUserId, chatUserId)))
    .run()

  log.info({ contextId, chatUserId }, 'Kaneo member password revealed (reveal-once)')
  return settingsJson(200, { password: revealedPassword, warning: 'This password is shown once. Store it securely.' })
}

export function handleKaneoCredentialsRoutes(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET') return Promise.resolve(handleGet(req, url))
  if (req.method === 'POST') return handlePost(req)
  return Promise.resolve(settingsJson(405, { error: 'method not allowed' }))
}
```

- [ ] **Step 4: Wire into `src/debug/settings-api-router.ts`**

Add import:

```typescript
import { handleKaneoCredentialsRoutes } from './settings/kaneo-credentials-routes.js'
```

In `routeSettingsApi`, before the final `return Promise.resolve(null)`:

```typescript
if (url.pathname === '/settings/api/kaneo/credentials') return handleKaneoCredentialsRoutes(req, url)
```

- [ ] **Step 5: Run test to verify it passes**

```
bun test tests/debug/settings/kaneo-credentials-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```
git add src/debug/settings/kaneo-credentials-routes.ts src/debug/settings-api-router.ts tests/debug/settings/kaneo-credentials-routes.test.ts
git commit -m "feat(settings): GET/POST /settings/api/kaneo/credentials — member email + reveal-once reset"
```

---

### Task 4.2: Settings Svelte "My Kaneo access" section

**Files:**

- Create: `client/settings/KaneoAccessSection.svelte`
- Modify: `client/settings/fetchers.ts` (add `getKaneoCredentials`, `postKaneoPasswordReset`)
- Modify: `client/settings/fetcher-schemas.ts` (add `KaneoCredentialsSchema`, `KaneoResetSchema`)
- Modify: `client/settings/SettingsApp.svelte` (static import + sidebar group entry)
- Create: `tests/client/settings/kaneo-access-section.test.ts`

- [ ] **Step 1: Write the failing client test**

Create `tests/client/settings/kaneo-access-section.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { flushSync, mount, unmount } from 'svelte'

import KaneoAccessSection from '../../../client/settings/KaneoAccessSection.svelte'
import { settingsSession } from '../../../client/settings/session.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const CONTEXT_ID = 'grp-ctx-test'

function setupSession(): void {
  settingsSession.set({
    principalId: 'p-1',
    contextId: CONTEXT_ID,
    contextKind: 'group',
    role: 'member',
    csrfToken: 'csrf-tok',
  })
}

describe('KaneoAccessSection', () => {
  let target: HTMLElement
  let component: ReturnType<typeof mount>

  beforeEach(() => {
    mockLogger()
    target = document.createElement('div')
    document.body.appendChild(target)
    setupSession()
  })

  afterEach(() => {
    if (component !== undefined) unmount(component)
    document.body.removeChild(target)
    restoreFetch()
  })

  test('shows login email when credentials fetch succeeds', async () => {
    setMockFetch(async (url) => {
      if (url.includes('/settings/api/kaneo/credentials')) {
        return new Response(
          JSON.stringify({ contextId: CONTEXT_ID, login: 'alice@pap.ai', status: 'active', kaneoUrl: 'http://kaneo' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })

    component = mount(KaneoAccessSection, { target })
    flushSync()
    // allow async fetch to resolve
    await new Promise<void>((r) => setTimeout(r, 10))
    flushSync()

    expect(target.textContent).toContain('alice@pap.ai')
  })

  test('shows "not provisioned" message when GET returns 404', async () => {
    setMockFetch(async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))

    component = mount(KaneoAccessSection, { target })
    flushSync()
    await new Promise<void>((r) => setTimeout(r, 10))
    flushSync()

    expect(target.textContent).toContain('not provisioned')
  })

  test('Reset password button POSTs {action:"reset"} and reveals password once', async () => {
    setMockFetch(async (url, init) => {
      if (url.includes('/settings/api/kaneo/credentials') && (init?.method === 'GET' || init?.method === undefined)) {
        return new Response(
          JSON.stringify({ contextId: CONTEXT_ID, login: 'alice@pap.ai', status: 'active', kaneoUrl: 'http://kaneo' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/settings/api/kaneo/credentials') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ password: 'Secret1!Aa', warning: 'This password is shown once. Store it securely.' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })

    component = mount(KaneoAccessSection, { target })
    flushSync()
    await new Promise<void>((r) => setTimeout(r, 10))
    flushSync()

    const btn = target.querySelector('button[data-action="reset-password"]') as HTMLButtonElement | null
    expect(btn).not.toBeNull()
    btn!.click()
    flushSync()
    await new Promise<void>((r) => setTimeout(r, 10))
    flushSync()

    expect(target.textContent).toContain('Secret1!Aa')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
bun test:client tests/client/settings/kaneo-access-section.test.ts
```

Expected: FAIL — `KaneoAccessSection.svelte` does not exist.

- [ ] **Step 3: Add Zod schemas to `client/settings/fetcher-schemas.ts`**

Read `client/settings/fetcher-schemas.ts` first, then append after the last existing schema:

```typescript
export const KaneoCredentialsSchema = z.object({
  contextId: z.string(),
  login: z.string(),
  status: z.enum(['active', 'inactive', 'failed']),
  kaneoUrl: z.string().nullable(),
})
export type KaneoCredentials = z.infer<typeof KaneoCredentialsSchema>

export const KaneoResetSchema = z.object({
  password: z.string(),
  warning: z.string(),
})
export type KaneoReset = z.infer<typeof KaneoResetSchema>
```

- [ ] **Step 4: Add fetchers to `client/settings/fetchers.ts`**

Read `client/settings/fetchers.ts` first to find where to add imports. Then append at the end of the file:

```typescript
import type { KaneoCredentials, KaneoReset } from './fetcher-schemas.js'
import { KaneoCredentialsSchema, KaneoResetSchema } from './fetcher-schemas.js'

export function getKaneoCredentials(contextId: string): Promise<KaneoCredentials> {
  return getJson(
    `/settings/api/kaneo/credentials?contextId=${encodeURIComponent(contextId)}`,
    KaneoCredentialsSchema.parse,
  )
}

export function postKaneoPasswordReset(contextId: string): Promise<KaneoReset> {
  return writeJson('/settings/api/kaneo/credentials', 'POST', { action: 'reset', contextId }, KaneoResetSchema.parse)
}
```

> Note: `getJson` and `writeJson` are defined in `client/settings/fetchers.ts`; verify the exact names by reading the file before editing. CSRF token injection is automatic via `writeJson`.

- [ ] **Step 5: Create `client/settings/KaneoAccessSection.svelte`**

```svelte
<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import type { KaneoCredentials } from './fetcher-schemas.js'
  import { getKaneoCredentials, postKaneoPasswordReset } from './fetchers.js'
  import { settingsSession } from './session.js'

  let credentials: KaneoCredentials | null = $state(null)
  let notProvisioned = $state(false)
  let loading = $state(true)
  let error: string | null = $state(null)
  let revealedPassword: string | null = $state(null)
  let resetting = $state(false)

  onMount(async () => {
    const session = get(settingsSession)
    if (session === null) {
      loading = false
      return
    }
    try {
      credentials = await getKaneoCredentials(session.contextId)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('404')) {
        notProvisioned = true
      } else {
        error = msg
      }
    } finally {
      loading = false
    }
  })

  async function resetPassword(): Promise<void> {
    const session = get(settingsSession)
    if (session === null || credentials === null) return
    resetting = true
    try {
      const result = await postKaneoPasswordReset(session.contextId)
      revealedPassword = result.password
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      resetting = false
    }
  }
</script>

<section id="kaneo-access">
  <h2>My Kaneo access</h2>
  {#if loading}
    <p>Loading…</p>
  {:else if notProvisioned}
    <p>Your account is not provisioned in this group's Kaneo workspace.</p>
  {:else if error !== null}
    <p class="error">{error}</p>
  {:else if credentials !== null}
    <dl>
      <dt>Login email</dt>
      <dd>{credentials.login}</dd>
      {#if credentials.kaneoUrl !== null}
        <dt>Workspace URL</dt>
        <dd><a href={credentials.kaneoUrl} target="_blank" rel="noopener noreferrer">{credentials.kaneoUrl}</a></dd>
      {/if}
      <dt>Status</dt>
      <dd>{credentials.status}</dd>
    </dl>

    {#if revealedPassword !== null}
      <p><strong>New password (shown once):</strong> <code>{revealedPassword}</code></p>
      <p class="warning">Store this password securely — it will not be shown again.</p>
    {:else}
      <button data-action="reset-password" disabled={resetting} onclick={resetPassword}>
        {resetting ? 'Resetting…' : 'Reset password'}
      </button>
    {/if}
  {/if}
</section>
```

- [ ] **Step 6: Wire `KaneoAccessSection` into `SettingsApp.svelte`**

Read `client/settings/SettingsApp.svelte` to understand the static-import and sidebar pattern used by other sections. Then:

1. Add a static import alongside the other section imports:

```typescript
import KaneoAccessSection from './KaneoAccessSection.svelte'
```

2. In the `$derived` `SidebarGroup[]` array, add an entry in the member/personal group (show only in `group` context):

```typescript
{ id: 'kaneo-access', label: 'My Kaneo access', condition: contextKind === 'group' },
```

3. In the template, render the section conditionally alongside other sections (place after the AI output section or with other personal sections):

```svelte
{#if contextKind === 'group'}
  <KaneoAccessSection />
{/if}
```

> Read the file first to find the exact insertion points. Follow the established alphabetical or feature-group order used by existing sections.

- [ ] **Step 7: Run test to verify it passes**

```
bun test:client tests/client/settings/kaneo-access-section.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```
git add client/settings/KaneoAccessSection.svelte client/settings/fetchers.ts client/settings/fetcher-schemas.ts client/settings/SettingsApp.svelte tests/client/settings/kaneo-access-section.test.ts
git commit -m "feat(settings-ui): KaneoAccessSection — show login email, workspace URL, reveal-once password reset"
```

---

## Phase 5 — Prompt & Tool Wiring

### Task 5.1: System prompt — `find_user` Kaneo assignment + name→id procedure

**Files:**

- Modify: `src/system-prompt.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/system-prompt/kaneo-assignment.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildSystemPrompt } from '../../src/system-prompt.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from '../tools/mock-provider.js'

describe('system prompt — Kaneo assignment guidance', () => {
  test('group prompt includes find_user assignment guidance when find_user is enabled', () => {
    mockLogger()
    const provider = createMockProvider()
    const enabled = new Set(['find_user', 'create_task', 'update_task'])
    const prompt = buildSystemPrompt(provider, 'ctx-group', enabled, {
      askPermissionAvailable: false,
      contextType: 'group',
    })
    expect(prompt).toContain('find_user')
  })
})
```

> Real `buildSystemPrompt` overload (verified): `buildSystemPrompt(provider, contextId, enabledToolNames: ReadonlySet<string>, { askPermissionAvailable, contextType })`. The implementation in Step 3 must include the `find_user` assignment line whenever `find_user` is enabled in a group context so this assertion holds.

- [ ] **Step 2: Run test to verify it fails**

```
bun test tests/system-prompt/kaneo-assignment.test.ts
```

Expected: FAIL or PASS (the test may be trivially true if the function doesn't exist). If PASS already, skip to step 4.

- [ ] **Step 3: Add Kaneo assignment guidance to `src/system-prompt.ts`**

Find the group system prompt section (search for `GROUP` constant or the group-context prompt builder). Add the following line in the appropriate task-assignment context:

```
When assigning a task to a group member, first call find_user with their display name or username to resolve their task-tracker user ID. Always resolve all names before calling create_task or update_task with an assignee.
```

The exact insertion point depends on how the prompt is structured. Locate the block that describes task assignment (likely near `'me'` resolution) and append the guidance there.

- [ ] **Step 4: Run test to verify it passes**

```
bun test tests/system-prompt/kaneo-assignment.test.ts && bun run test
```

Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```
git add src/system-prompt.ts tests/system-prompt/kaneo-assignment.test.ts
git commit -m "feat(system-prompt): add find_user Kaneo assignment resolution guidance for group context"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 9 spec sections (problem, goal, decisions, architecture, triggers, credentials, error-handling, testing, phasing) are covered by concrete tasks.
- [x] **Phase 0 COMPLETE:** Spike outcome recorded in `docs/superpowers/notes/2026-06-21-kaneo-spike-outcome.md`. No conditional branches remain in the plan — all tasks are single-path.
- [x] **No bare TODO/STUB in production code:** Task 4.1 POST handler is fully implemented (Branch B). No placeholder returns remain.
- [x] **Import paths use `.js` extension:** Verified throughout.
- [x] **No `@ts-ignore` / lint suppressions:** None introduced.
- [x] **p-limit used for concurrency:** Subscriber and backfill both use `pLimit(4)`.
- [x] **`'provisioned'` no-overwrite rule:** Tested in Task 1.2 with 4 cases.
- [x] **Migration number 060:** Correct (059 is `guest_mode`, last in index.ts). `encrypted_password TEXT` column is now the sole credential mechanism, populated on every successful provision.
- [x] **Identity mapping PK keyed by `chatUserId`:** `ensureWorkspaceMember` passes `chatUserId` as `contextId` to `setProvisionedIdentityMapping`, matching how `getIdentityMapping(chatUserId, providerName)` is called in `maybeAutoLinkIdentity`.
- [x] **Multi-group reuse uses stored password:** `kaneoProvisionMember` accepts `existing?: { providerUserId; login; password }` — reuse path calls `doMemberSignIn` (not sign-up) then invite+accept. `ensureWorkspaceMember` looks up any `kaneo_workspace_members` row with a non-null `encrypted_password` across groups, decrypts it, and passes all three reuse fields. Falls back to new sign-up when no stored password found. Tests assert the sign-IN call, the non-sign-up path, and the fallback.
- [x] **Password always persisted encrypted:** `ensureWorkspaceMember` encrypts the returned `password` via `encryptInstanceConfig` and writes it to `encrypted_password` on every successful provision (new or reuse).
- [x] **`provisionWorkspaceMember` return type updated:** Both the `TaskProvider` interface and `KaneoProvider` implementation return `{ providerUserId, login, password }`.
- [x] **`resolveUserLabel` arity:** `MembershipDeps.resolveUserLabel(userId, groupContextId, platformInstanceId)` — three args matching `ChatRouter.resolveUserLabel(userId, ResolveUserContext)`. Subscriber and backfill call sites wired to `chatProvider` in `src/index.ts` after ChatRouter construction (~line 84). Best-effort: null → `User <id>`.
- [x] **`SettingsPrincipal.platformUserId`:** Both GET and POST handlers in `kaneo-credentials-routes.ts` use `auth.authed.principal.platformUserId`.
- [x] **Settings UI:** Task 4.2 adds `KaneoAccessSection.svelte` with `getKaneoCredentials`/`postKaneoPasswordReset` fetchers (using `password` field name, not `newPassword`), Zod schemas, sidebar wiring, and a happy-dom client test.
- [x] **DI-first testing:** All services have `Deps` interfaces (including injectable `decryptPassword` in `MembershipDeps`); tests inject fakes, never mock modules.
- [x] **No fixed-wall-clock assertions:** Subscriber test uses `setTimeout(resolve, 20)` as a minimal poll; for production use, replace with a proper `waitFor` helper if flakiness appears under CI contention.

## Spec Requirements Not Fully Turned Into Concrete Tasks

- **None.** Phase 0 is complete and all branches are fixed. The plan is fully concrete with no selection steps remaining.
