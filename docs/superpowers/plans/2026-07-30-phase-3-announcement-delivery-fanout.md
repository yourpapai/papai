<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 Announcement Delivery Fan-Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `SCN-announcement-delivery-fanout` with one deterministic Tier-0 story proving authenticated, failure-isolated release-announcement delivery and independent summary accounting.

**Architecture:** Add a narrow proactive-delivery seam to the frozen scenario chat harness, with declarative subscriber/draft fixtures and read-only assertions in the scenario API. One real settings-route story uses that seam to prove authentication, best-effort fan-out, persisted status, and idempotent retry. The two stats records remain pending.

**Tech Stack:** Bun, TypeScript, Drizzle/SQLite, existing settings-session story harness.

## Global Constraints

- Do not modify production `src/` or client code; prove existing behavior only.
- Promote only `SCN-announcement-delivery-fanout`; leave both stats IDs pending.
- Drive `POST /settings/api/admin/release-notes` with a real settings session and CSRF token, never call `broadcastAnnouncement()` from the story.
- Add exactly one literal `scenario(...)`; its title must exactly match the catalog mapping below.
- Assert target sets and summary counts, never concurrent send order or wall-clock timing.
- Prove rejected anonymous, non-admin, and missing-CSRF requests make zero delivery attempts.
- Run the frozen Tier-0 contract/story/compatibility gates; never commit `reports/stories/**`.
- Keep strict TypeScript, `.js` imports, and no lint/type suppressions.

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `tests/stories/harness/chat.ts` | Fake chat delivery boundary | Queue deterministic target outcomes and expose captured proactive attempts. |
| `tests/stories/harness/chat.test.ts` | Delivery-seam contract | Test sent, returned-failure, thrown-failure, and default outcomes. |
| `tests/stories/harness/scenario.ts` | Declarative story API | Add announcement fixtures plus target/persisted-status assertions. |
| `tests/stories/harness/scenario.test.ts` | Scenario API contract | Test pre-start-only fixtures and order-independent assertions. |
| `tests/stories/settings/announcement-delivery.story.test.ts` | Cataloged behavior | Create the single authenticated fan-out story. |
| `tests/stories/catalog/coverage.ts` | Ledger | Promote only the announcement fan-out record. |
| `tests/stories/harness/catalog-coverage.test.ts` | Ledger contract | Update exact Phase 3 projections and totals. |

## Task 1: Script proactive transport outcomes

**Files:**
- Modify: `tests/stories/harness/chat.ts`
- Test: `tests/stories/harness/chat.test.ts`

**Interfaces:**

```ts
export type ScenarioProactiveDeliveryOutcome = 'sent' | 'failed' | 'throws'
export type ScenarioProactiveDeliveryPlan = Readonly<{
  contextId: string
  outcomes: readonly ScenarioProactiveDeliveryOutcome[]
}>

// New ScenarioChat members
configureProactiveDelivery(plans: readonly ScenarioProactiveDeliveryPlan[]): void
proactiveAttempts(): readonly Readonly<{
  contextId: string
  platformInstanceId: string
  markdown: string
}>[]
```

- [ ] **Step 1: Write failing chat-harness tests**

```ts
test('records every proactive attempt while consuming scripted outcomes', async () => {
  const chat = createScenarioChat('proactive-outcomes', events)
  chat.configureProactiveDelivery([
    { contextId: 'dm-ok', outcomes: ['sent'] },
    { contextId: 'group-retry', outcomes: ['failed', 'sent'] },
    { contextId: 'dm-throws', outcomes: ['throws'] },
  ])
  await chat.start()

  expect(await chat.sendMessage('scenario-platform', dmTarget('dm-ok'), 'release')).toBe(true)
  expect(await chat.sendMessage('scenario-platform', dmTarget('group-retry'), 'release')).toBe(false)
  await expect(chat.sendMessage('scenario-platform', dmTarget('dm-throws'), 'release')).rejects.toThrow(
    'Scripted proactive delivery failure',
  )
  expect(await chat.sendMessage('scenario-platform', dmTarget('group-retry'), 'release')).toBe(true)
  expect(chat.proactiveAttempts().map(({ contextId }) => contextId).toSorted()).toEqual([
    'dm-ok', 'dm-throws', 'group-retry', 'group-retry',
  ])
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/chat.test.ts`

Expected: FAIL because `ScenarioChat` has neither new member.

- [ ] **Step 3: Implement the minimal seam**

Add private state in `createScenarioChat()`:

```ts
const proactiveOutcomes = new Map<string, ScenarioProactiveDeliveryOutcome[]>()
let proactiveAttempts: readonly Readonly<{ contextId: string; platformInstanceId: string; markdown: string }>[] = []
```

Implement `configureProactiveDelivery` only before chat start; reject empty IDs, empty outcome arrays, and duplicate target IDs. Copy each outcome array. In `sendMessage`, retain the existing `proactive` event capture, append an attempt, consume the target queue, and return:

```ts
const outcome = proactiveOutcomes.get(target.contextId)?.shift() ?? 'sent'
if (outcome === 'throws') return Promise.reject(new Error('Scripted proactive delivery failure'))
return Promise.resolve(outcome === 'sent')
```

Unconfigured targets continue resolving `true`. Return a clone from `proactiveAttempts()`.

- [ ] **Step 4: Verify GREEN**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/chat.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/chat.ts tests/stories/harness/chat.test.ts
git commit -m "test(stories): script proactive delivery outcomes"
```

## Task 2: Add declarative announcement fixtures and assertions

**Files:**
- Modify: `tests/stories/harness/scenario.ts`
- Test: `tests/stories/harness/scenario.test.ts`

**Interfaces:**

```ts
// New ScenarioGiven members
announcementSubscription(context: DmHandle | GroupHandle, enabled: boolean): void
announcementDraft(input: Readonly<{ version: string; body: string }>): void
proactiveDelivery(plans: readonly ScenarioProactiveDeliveryPlan[]): void

// New ScenarioThen members
proactiveAttempts(): Readonly<{ equal(expectedContextIds: readonly string[]): void }>
announcementDeliveries(version: string): Readonly<{
  equal(expected: readonly Readonly<{
    contextId: string
    contextType: 'dm' | 'group'
    status: 'sent' | 'failed'
  }>[]): void
}>
```

- [ ] **Step 1: Write failing API tests**

In `scenario.test.ts`, create a world, authorize one user and one group, call the three new `given` methods before start, and assert `countSubscribers()` is `{ dm: 1, group: 1 }` and `getAnnouncementDraft('9.9.9')` contains both bodies. Add a second test that calls `given.announcementDraft(...)` after `await world.start()` and expects the normal “requires an unstarted scenario world” failure.

- [ ] **Step 2: Verify RED**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scenario.test.ts`

Expected: FAIL because announcement fixture/assertion methods are absent.

- [ ] **Step 3: Implement the API**

Import `setUserAnnounceSubscribed`, `setGroupAnnounceSubscribed`, and `upsertAnnouncementDraft` from `src/announcements/store.js`; import `announcementDeliveries` from `src/db/schema.js`; and import `ScenarioProactiveDeliveryPlan` from `./chat.js`.

Implement the fixtures inside `createGiven()`:

```ts
announcementSubscription(context, enabled): void {
  prerequisite('given.announcementSubscription')
  if (context.kind === 'dm') {
    setUserAnnounceSubscribed(context.platformInstanceId, context.user.id, enabled)
    return
  }
  setGroupAnnounceSubscribed(scopedGroupId(context), enabled)
},
announcementDraft({ version, body }): void {
  prerequisite('given.announcementDraft')
  upsertAnnouncementDraft({ version, rawBody: body, humanizedBody: body })
},
proactiveDelivery(plans): void {
  prerequisite('given.proactiveDelivery')
  world.chat.configureProactiveDelivery(plans)
},
```

Implement `then.proactiveAttempts().equal()` with sorted context IDs. Implement `then.announcementDeliveries(version).equal()` by selecting only `contextId`, `contextType`, and `status` from `announcementDeliveries` for that version; sort actual and expected by `contextId`; then compare with `tracedAssertion`. Narrow values to the two declared union types before comparison. Do not return recipient metadata, delivery timestamps, or body text.

- [ ] **Step 4: Verify GREEN**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scenario.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): expose announcement fanout fixtures"
```

## Task 3: Add the single end-to-end fan-out story

**Files:**
- Create: `tests/stories/settings/announcement-delivery.story.test.ts`

**Interfaces:** Consumes all Task 2 APIs. Produces this exact literal ID:

```text
tests/stories/settings/announcement-delivery.story.test.ts#SCN-announcement-delivery-fanout: eligible release subscribers receive independent best-effort delivery accounting
```

- [ ] **Step 1: Create the story**

Use one `scenario(...)` with the literal title above. Import `packageJson` from the root `package.json` with a JSON import attribute so the fixture uses the same current version as the route. Its setup must create a super-admin, a non-admin, two subscribed DMs, one unsubscribed DM, one subscribed group, and one unsubscribed group. Seed:

```ts
given.announcementDraft({ version: packageJson.version, body: 'Release notes for fan-out verification.' })
given.proactiveDelivery([
  { contextId: sentUser.id, outcomes: ['sent'] },
  { contextId: failedUser.id, outcomes: ['throws', 'sent'] },
  { contextId: sentGroup.id, outcomes: ['sent'] },
])
```

Issue three rejected requests before the valid broadcast: `when.request(...)` without auth must return 401; `when.settingsRequest(memberSession, ...)` must return 403; and `when.settingsRequest(adminSession, ..., { csrf: false })` must return 403. Then assert `then.proactiveAttempts().equal([])`.

Use `POST`, JSON content type, and `{ action: 'broadcast' }` for each valid request. The first valid response must exactly equal:

```ts
{
  version: packageJson.version,
  broadcast: { sent: 2, failed: 1, skipped: 0 },
  counts: { dm: 2, group: 1 },
}
```

Assert target IDs are exactly the two subscribed DMs and subscribed group; assert rows are `sent`, `failed`, `sent` respectively. Make a second valid request. It must exactly equal `{ sent: 1, failed: 0, skipped: 2 }` under the same version/counts; only the previously failed DM is newly attempted; its final persisted row becomes `sent`. The unsubscribed DM and group must be absent from both attempt assertions.

- [ ] **Step 2: Verify the story**

Run: `bun test:stories -- --fixture tests/stories/settings/announcement-delivery.story.test.ts`

Expected: PASS with one logical scenario. The first broadcast proves a thrown delivery is counted and isolated; the second proves successful deliveries are skipped and a prior failure can retry.

- [ ] **Step 3: Commit**

```bash
git add tests/stories/settings/announcement-delivery.story.test.ts
git commit -m "test(stories): cover announcement delivery fanout"
```

## Task 4: Promote the one catalog record and qualify frozen inputs

**Files:**
- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:** Add this exact mapping:

```ts
'SCN-announcement-delivery-fanout': {
  verifiedAt: '2026-07-30',
  provingTier: '0',
  storyIds: [
    'tests/stories/settings/announcement-delivery.story.test.ts#SCN-announcement-delivery-fanout: eligible release subscribers receive independent best-effort delivery accounting',
  ],
},
```

- [ ] **Step 1: Write failing catalog expectations**

In `catalog-coverage.test.ts`, add the mapping to `PROMOTED_PHASE3_CATALOG_STORY_IDS`; add one `'0'` to the promoted-tier expectation; change Phase 3 pending from 9 to 8; remove the announcement record from `PHASE3_AUDIT_PROJECTION`; and change both executable total assertions from 181 to 182.

- [ ] **Step 2: Verify RED**

Run: `bun test:stories:contracts`

Expected: FAIL because this catalog ID is still a pending audit record.

- [ ] **Step 3: Promote the ledger entry**

Add the exact mapping to `EXECUTABLE_STORY_MAPPINGS` in `coverage.ts`. Delete only the `SCN-announcement-delivery-fanout: ready('F1', ...)` audit entry. Do not change `GAP_SCENARIO_IDS`; the mapping now classifies it as confirmed. Leave both stats records unchanged.

- [ ] **Step 4: Verify contracts and full Tier 0**

Run:

```bash
bun test:stories:contracts
bun test:stories
```

Expected: PASS. Exactly one Phase 3 pending record becomes executable, while both stats records remain pending.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): promote announcement delivery fanout"
```

- [ ] **Step 6: Record post-merge compatibility evidence**

After merge, on the new master baseline:

```bash
PAPAI_BASELINE_SHA="$(git rev-parse HEAD)"
bun test:stories:contracts
bun test:stories
bun test:stories:manifest
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat --manifest-only
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat
```

Expected: all commands PASS. Record `PAPAI_BASELINE_SHA` and `treeHash` from `reports/stories/manifest.json` in the handoff; do not commit reports.
