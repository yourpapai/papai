<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 5b — Group-Session Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group coding session resolves the **acting user's own** credentials (key, forge, agent), per a per-group `coding_identity` policy (`initiator` default | `designated:<userId>` | `shared`), instead of the group-shared vault.

**Architecture:** A pure `identityContext(storageContextId, chatUserId)` returns the context to read creds from — `toScopedContextId({ platformInstanceId, nativeContextId: chatUserId })` for the initiator (which equals the DM config-context for DMs, so DMs are byte-identical), the group config-context for `shared`, or the designated member's personal context. `chatUserId` is threaded into `buildCodingSecretsFacade`; the five resolvers read at `identityContext` (and `resolveAgentSecrets`/`resolveProviderHost` still let 5a's `sharedKeyContext` win for the provider key). The policy lives on `authorized_groups.coding_identity` (keyed by the group's scoped context id). magi unchanged.

**Tech Stack:** Bun + `bun:test`, Drizzle (SQLite), Zod v4, Svelte 5 (runes). papai only (`/Users/ki/Projects/yourpapai/papai`).

**Spec:** `docs/superpowers/specs/2026-06-27-phase-5b-group-session-identity-design.md`

> **Execute on `master`**, test-first. **Knip ordering:** A1 bundles the column + `getGroupCodingIdentity` reader + `identityContext` + resolver/facade threading (one consumer chain); `setGroupCodingIdentity` is **deferred to A2** (its route consumer). A3 is messages/docs only. Explicit `git add` paths (never add untracked WIP, e.g. `docs/superpowers/plans/2026-06-26-acp-cleanup.md`).

---

## File Structure

- Create `src/db/migrations/065_coding_identity.ts` + register in `src/db/index.ts`.
- Modify `src/db/schema.ts` — `authorizedGroups.codingIdentity` column.
- Modify `src/authorized-groups.ts` — `getGroupCodingIdentity` (A1), `setGroupCodingIdentity` (A2).
- Modify `src/coding-credentials/resolve-agent-secrets.ts` — `identityContext` + thread `chatUserId` through the five resolvers.
- Modify `src/plugins/tool-runtime.ts` — thread `chatUserId` into `buildCodingSecretsFacade`.
- Create `src/debug/settings/group/coding-identity-routes.ts` (or add to `group-routes.ts`) + client section + fetchers/schema + `SettingsApp.svelte` (A2).
- Modify `plugins/acp/session-tools.ts` — refusal wording (A3); `CLAUDE.md`.

---

## Task A1: schema/migration + policy reader + identityContext + resolver/facade threading

**Files:** `src/db/schema.ts`, `src/db/migrations/065_coding_identity.ts`, `src/db/index.ts`, `src/authorized-groups.ts`, `src/coding-credentials/resolve-agent-secrets.ts`, `src/plugins/tool-runtime.ts`. Tests: `tests/coding-credentials/resolve-agent-secrets.test.ts`, a migration/store test.

> Read: `src/db/schema.ts` `authorizedGroups` (keyed by `groupId` = scoped context id; has `guestMode`/`announceSubscribed`), `src/db/migrations/059_guest_mode.ts` (column-add pattern) + `src/db/index.ts` `MIGRATIONS` array, `src/authorized-groups.ts` (`isGuestModeEnabled`/`setGuestMode` template), `src/coding-credentials/resolve-agent-secrets.ts` (the five resolvers + `configContextOf` + 5a's `sharedKeyContext`), `src/chat/scoped-context.ts` (`parseScopedContextId`, `toScopedContextId`), `src/plugins/tool-runtime.ts` (`buildCodingSecretsFacade` + its call in `buildPluginToolRuntimeContext`).

- [ ] **Step 1: Failing tests**

```ts
// resolve-agent-secrets.test.ts — group redirect (use a PROPERLY scoped, parseable context)
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { addAuthorizedGroup } from '../../src/authorized-groups.js' // or the existing add helper
import { setGroupCodingIdentity } from '../../src/authorized-groups.js' // (lands in A2; for the A1 test, set the column directly or via the store helper if present)

test('group initiator: resolves the acting user’s personal creds, not the group’s', () => {
  const groupCtx = toScopedContextId({ platformInstanceId: 'pi9', nativeContextId: 'group-1' })
  const initiatorCtx = toScopedContextId({ platformInstanceId: 'pi9', nativeContextId: 'alice' })
  const storage = toScopedThreadContextId({ platformInstanceId: 'pi9', nativeContextId: 'group-1', threadId: 't1' })
  // group default policy is 'initiator'
  updateCodingCredentials(
    groupCtx,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-GROUP' },
    'x',
  )
  updateCodingCredentials(
    initiatorCtx,
    'agent-provider',
    { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-ALICE' },
    'x',
  )
  expect(resolveAgentSecrets(storage, 'alice')).toEqual({ ANTHROPIC_API_KEY: 'sk-ALICE' })
})
test('group shared: resolves the group vault', () => {
  /* set coding_identity='shared' → expect sk-GROUP */
})
test('DM path is reference-identical (pi + userId == DM config-context)', () => {
  /* scoped DM ctx → resolves user’s creds with any policy default */
})
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: schema + migration**
  - `schema.ts`: add to `authorizedGroups` — `codingIdentity: text('coding_identity').notNull().default('initiator')`.
  - `src/db/migrations/065_coding_identity.ts` (mirror `059_guest_mode.ts`): `ALTER TABLE authorized_groups ADD COLUMN coding_identity TEXT NOT NULL DEFAULT 'initiator'` guarded by a `columnExists` check; export `migration065CodingIdentity`.
  - Register in `src/db/index.ts` `MIGRATIONS` (import + array entry, after `064`).

- [ ] **Step 4: reader** in `src/authorized-groups.ts` (mirror `isGuestModeEnabled`):

```ts
export function getGroupCodingIdentity(groupId: string): string {
  const row = getDrizzleDb()
    .select({ codingIdentity: authorizedGroups.codingIdentity })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.groupId, groupId))
    .get()
  return row?.codingIdentity ?? 'initiator'
}
```

(Defer `setGroupCodingIdentity` to A2 — knip.)

- [ ] **Step 5: `identityContext`** in `resolve-agent-secrets.ts`:

```ts
import { getGroupCodingIdentity } from '../authorized-groups.js'
import { parseScopedContextId, toScopedContextId } from '../chat/scoped-context.js'

/** The context whose vault holds the acting identity's creds for this session. */
export function identityContext(storageContextId: string, chatUserId: string): string {
  const pi = parseScopedContextId(storageContextId)?.platformInstanceId
  if (pi === undefined) return configContextOf(storageContextId) // legacy/non-scoped → unchanged
  const groupCtx = configContextOf(storageContextId)
  const policy = getGroupCodingIdentity(groupCtx)
  if (policy === 'shared') return groupCtx
  if (policy.startsWith('designated:')) {
    return toScopedContextId({ platformInstanceId: pi, nativeContextId: policy.slice('designated:'.length) })
  }
  // 'initiator' (and the default for DMs / non-group contexts, which yields the user's own context)
  return toScopedContextId({ platformInstanceId: pi, nativeContextId: chatUserId })
}
```

> Note: for a DM, `groupCtx === toScopedContextId({pi, nativeContextId: chatUserId})` and `getGroupCodingIdentity(dmCtx)` returns the `'initiator'` default (no `authorized_groups` row), so `identityContext` returns the DM's own context — **byte-identical** to today.

- [ ] **Step 6: thread `chatUserId` through the resolvers** — each of `resolveAgentSecrets`, `resolveProviderHost`, `resolveForgeToken`, `resolveForge`, `resolveAgent` gains a `chatUserId: string` param and uses `identityContext(storageContextId, chatUserId)` in place of `configContextOf(storageContextId)`. Keep 5a: `resolveAgentSecrets`/`resolveProviderHost` use `sharedKeyContext(storageContextId) ?? identityContext(storageContextId, chatUserId)`. Update every existing call in the test file to pass a `chatUserId` (for the non-parseable `STORAGE_CTX` DM tests, any value works — `pi` is undefined so the path is unchanged).

- [ ] **Step 7: facade** — `buildCodingSecretsFacade(pluginId, storageContextId, hasPermission, chatUserId)`; the five methods pass `chatUserId`. Update the call site in `buildPluginToolRuntimeContext` (pass `runtime.chatUserId`). The acp `RuntimeContext` type is **untouched** (the facade redirects internally).

- [ ] **Step 8: Run → pass; `bun run knip` (exit 0).**

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts src/db/migrations/065_coding_identity.ts src/db/index.ts src/authorized-groups.ts src/coding-credentials/resolve-agent-secrets.ts src/plugins/tool-runtime.ts tests/
git commit -m "feat(coding-credentials): group-session identity resolves the acting user's creds"
```

---

## Task A2: per-group `coding_identity` setting — store setter + route + settings UI

**Files:** `src/authorized-groups.ts` (`setGroupCodingIdentity`), `src/debug/settings/group-routes.ts` (or a new `group/coding-identity-routes.ts` registered there), `client/settings/{fetchers.ts,fetcher-schemas.ts,SettingsApp.svelte}`, a new `client/settings/sections/CodingIdentitySection.svelte`. Tests: route + section.

> Read: `src/debug/settings/group-routes.ts` (`handleGroupRoutes`, the `guest-mode` GET/PATCH, `requireGroup(authed,'write',contextId)` → `outcome.group.contextId`), `src/groups.ts` (`isGroupMember(groupId, userId)`, `listGroupMembers`), `client/settings/sections/GuestModeSection.svelte` + the fetchers/schema + `SettingsApp.svelte` `{#if isGroup}` block.

- [ ] **Step 1: setter** in `authorized-groups.ts` (mirror `setGuestMode`):

```ts
export function setGroupCodingIdentity(groupId: string, identity: string): void {
  getDrizzleDb()
    .update(authorizedGroups)
    .set({ codingIdentity: identity })
    .where(eq(authorizedGroups.groupId, groupId))
    .run()
}
```

- [ ] **Step 2: Failing route test** — `GET /settings/api/group/coding-identity?contextId=<group>` returns `{ contextId, identity }`; `PATCH { identity:'shared', contextId }` round-trips; `PATCH { identity:'designated:not-a-member', contextId }` → **422**; `PATCH` for an unauthorized actor → **403**; an invalid identity string (not `members`/`initiator`/`shared`/`designated:*`) → 422.

- [ ] **Step 3: route** — add `GET/PATCH /settings/api/group/coding-identity` to `handleGroupRoutes`. Auth: `requireGroup(authed, 'read'|'write', body/query.contextId)` → use `outcome.group.contextId` as the `groupId`. Body: `z.object({ identity: z.string().min(1), contextId: z.string().min(1) })`. **Validate** `identity` ∈ {`initiator`,`shared`} OR matches `designated:<userId>` where `isGroupMember(groupId, userId)` (else 422). GET returns `{ contextId, identity: getGroupCodingIdentity(groupId) }`.

- [ ] **Step 4: client** — `fetcher-schemas.ts`: `GroupCodingIdentityResponseSchema = z.object({ contextId: z.string(), identity: z.string() })`. `fetchers.ts`: `fetchGroupCodingIdentity(contextId)` / `patchGroupCodingIdentity({ identity, contextId })`. `CodingIdentitySection.svelte` (mirror `GuestModeSection.svelte`): a control for initiator / shared / designated (a member `<select>` populated from a members fetch for the designated case). Wire into `SettingsApp.svelte` `{#if isGroup}` block + a sidebar item.

- [ ] **Step 5: Run → pass (route + `bun test:client`); `bun run knip` (exit 0).**

- [ ] **Step 6: Commit**

```bash
git add src/authorized-groups.ts src/debug/settings/group-routes.ts client/settings/fetchers.ts client/settings/fetcher-schemas.ts client/settings/sections/CodingIdentitySection.svelte client/settings/SettingsApp.svelte tests/
git commit -m "feat(settings-ui): per-group coding-session identity policy"
```

---

## Task A3: refusal wording + docs

**Files:** `plugins/acp/session-tools.ts`, `CLAUDE.md`. Tests: acp.

> The `resolve()`/`resolveForgeToken()` null branches already return `not_configured`. Refine the message so a group initiator understands it's **their** creds that are missing.

- [ ] **Step 1: Failing test** — `start_session` with no creds for the acting identity returns `not_configured` with a message mentioning configuring **your** coding credentials (DM). (Assert the message text contains the new phrasing.)

- [ ] **Step 2: Implement** — in `start_session` + `review_pr`, keep the `not_configured` error code; update the message to e.g. `"You haven't set up your coding credentials. DM me and open settings → Coding sessions to configure your AI provider key (and code host)."` Keep it accurate for the DM case too (it's always "your" creds, since even a designated session refuses on the designee's missing creds — acceptable generic wording).

- [ ] **Step 3: doc** — `CLAUDE.md`: group-session identity (per-group `coding_identity` policy `initiator`/`designated`/`shared`; sessions run under the acting user's key/forge/agent; force-shared-key still overrides only the provider key; DM/shared paths unchanged).

- [ ] **Step 4: Run → pass (`bun test tests/plugins/acp/`); `bun run knip` (exit 0).**

- [ ] **Step 5: Commit**

```bash
git add plugins/acp/session-tools.ts CLAUDE.md tests/plugins/acp/
git commit -m "feat(acp): per-identity not_configured wording for group sessions"
```

---

## Final verification

- [ ] `bun run check:full` — green.
- [ ] Manual reasoning / test matrix: group `initiator` → acting user's key+forge+agent (not the group's); a second user → their own; group `shared` → group vault (reference-identical); group `designated:<u>` → u's creds; `designated:<non-member>` rejected at save (422); DM unchanged; `force-shared-key` ON + `initiator` → operator provider key + initiator's forge.
- [ ] Migration `065` applies idempotently (column-exists guard); existing `authorized_groups` rows backfill `coding_identity='initiator'`.

---

## Spec-coverage self-check

| Spec item                                                          | Task |
| ------------------------------------------------------------------ | ---- |
| `identityContext` (initiator/shared/designated; DM byte-identical) | A1   |
| thread `chatUserId` into facade + 5 resolvers                      | A1   |
| `authorized_groups.coding_identity` column + migration + reader    | A1   |
| compose with 5a force-shared-key (provider key only)               | A1   |
| per-group policy setter + route + settings UI + member validation  | A2   |
| refuse-don't-fall-back wording                                     | A3   |

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-phase-5b-group-session-identity.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
**2. Inline Execution** — execute here with checkpoints.

Suggested order A1 → A2 → A3 (all papai, shared files → sequential). **Which approach?**
