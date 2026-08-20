<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Derive & Storage Materialization Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove governed pseudonymous canonical-event capture and the derive job's durable storage materializations (sessions, session events, turn friction) in the Tier 0 story lane, with executable catalog records.

**Architecture:** Extend the existing `given.analyticsRuntime` story seam with a `'governed-pseudonymous'` mode that flips the seeded policy to `local_pseudonymous`, so real governed turns flow through the production observer/normalizer/eligibility pipeline into canonical `analytics_events`. Stories then invoke the real `runDeriveJob` with key material parsed from the story keyring and assert durable rows carry only purpose-keyed pseudonyms. Guest and deny-preference exclusions are proven through the same real pipeline.

**Tech Stack:** Bun 1.3.13, TypeScript, `bun:test`, existing hermetic story sandbox, drizzle-orm SQLite, `src/analytics/jobs/derive.ts`, `src/analytics/derive/*`.

## Global Constraints

- Scope is governed pseudonymous canonical-event derive and durable storage materializations. Do **not** touch delivery (`src/analytics/delivery/`), snapshots (`src/analytics/jobs/snapshot*`), backfill/rekey, intent derivation (`src/analytics/intent/`, `runIntentDerivation`), external egress, or subject-rights routes (`subject-deletion.ts`, `subject-export.ts`).
- The only harness change is the additive `'governed-pseudonymous'` mode on the existing `given.analyticsRuntime` seam; do not broaden the frozen harness in any other way.
- All scenario IDs and assertion values are deterministic; never use live network endpoints, live credentials, random data, fixed-wall-clock waits, or test ordering. Derive `nowMs` is computed from `Date.now()` plus the documented `LIVE_WATERMARK_MS` margin, never from sleeps.
- Stories run the real observer pipeline and the real `runDeriveJob`; never insert canonical `analytics_events` rows directly as the proof.
- Keep the Tier 0 floors at `lines: 0.71` and `functions: 0.70`; do not lower either value.
- Every new `scenario(...)` must be registered in `tests/stories/catalog/coverage.ts` in the same commit that introduces it; an uncataloged scenario fails `bun test:stories:contracts`.
- Use `.js` extensions in TypeScript imports and strict TypeScript without lint/type suppressions.
- Every scenario must assert one user-visible result (the chat reply) and one durable/system result (SQLite rows or derive counters).
- Goal-attempt counters are asserted as `0` only because intent classification is out of scope and therefore no `intent_classified` events exist; do not add intent events to force attempts.

---

## File Structure

| File | Responsibility |
| --- | --- |
| Modify: `tests/stories/harness/world.ts:625-671` | Accept `'governed-pseudonymous'` in `startAnalyticsRuntime` and seed `localMode: 'local_pseudonymous'` for it. |
| Modify: `tests/stories/harness/scenario.ts:236,806-808` | Widen the `analyticsRuntime` DSL signature to the two-mode union. |
| Create: `tests/stories/analytics/derive-storage.story.test.ts` | Three Tier 0 scenarios: session/friction materialization, guest + deny exclusion, idempotent rewrite. |
| Modify: `tests/stories/catalog/coverage.ts` | Add three `SCN-analytics-derive-*` ids to `CATALOG_SCENARIO_IDS`, three executable records with `provingTier: '0'`, and extend `CATALOG_SOURCE`. |

No production source files change.

### Task 1: Add the governed-pseudonymous analytics runtime mode

**Files:**
- Modify: `tests/stories/harness/world.ts:625-651`
- Modify: `tests/stories/harness/scenario.ts:236,806-808`

**Interfaces:**
- Consumes: the existing `startAnalyticsRuntime(mode: 'governed')` implementation.
- Produces: `given.analyticsRuntime(mode: 'governed' | 'governed-pseudonymous')`; `'governed'` behavior is byte-identical to today.

- [ ] **Step 1: Widen the harness mode union**

In `tests/stories/harness/scenario.ts:236` change the interface line to:

```ts
  analyticsRuntime(mode: 'governed' | 'governed-pseudonymous'): void
```

The implementation at `tests/stories/harness/scenario.ts:806-808` already forwards `mode` unchanged; no body change is needed there.

In `tests/stories/harness/world.ts`, change the `startAnalyticsRuntime` signature (line 625) to:

```ts
  const startAnalyticsRuntime = (mode: 'governed' | 'governed-pseudonymous'): void => {
```

and inside the policy update (lines 634-650) change the single `localMode` field to:

```ts
        localMode: mode === 'governed-pseudonymous' ? 'local_pseudonymous' : 'local_aggregate',
```

Everything else in the function — keyring env setup, governance field seeding, `startAnalytics()`, teardown restore — stays exactly as it is; `local_pseudonymous` requires the same two keyrings the fixture already sets.

- [ ] **Step 2: Run the harness contract tests and the existing governed story**

Run: `bun test:stories:contracts && bun test:stories --fixture tests/stories/analytics/governed-turn.story.test.ts`

Expected: both exit `0`; the existing `'governed'` mode is unchanged.

- [ ] **Step 3: Commit the seam**

```bash
git add tests/stories/harness/world.ts tests/stories/harness/scenario.ts
git commit -m "test(stories): add governed-pseudonymous analytics runtime mode"
```

### Task 2: Session and friction materialization story

**Files:**
- Create: `tests/stories/analytics/derive-storage.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `given.analyticsRuntime('governed-pseudonymous')` from Task 1; `runDeriveJob`, `LIVE_WATERMARK_MS`, `DeriveJobResult` from `src/analytics/jobs/derive.ts`; `parseAnalyticsKeyring` from `src/analytics/identity/keyring.ts`; `KeyVersionSchema` from `src/analytics/controlled-types.ts`; `resolveActive` from `src/analytics/governance/generation-store.ts`.
- Produces (story-local, reused by Tasks 3-4): `flushAnalytics(): Promise<void>`; `deriveKeyMaterial(): { key: Buffer; keyVersion: KeyVersion }`; `openEpochId(): string`; `runDeriveNow(localMode: 'local_aggregate' | 'local_pseudonymous'): DeriveJobResult`; `PSEUDONYM_PATTERN`.

- [ ] **Step 1: Write the failing materialization story**

Create `tests/stories/analytics/derive-storage.story.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { eq } from 'drizzle-orm'

import { KeyVersionSchema } from '../../../src/analytics/controlled-types.js'
import type { KeyVersion } from '../../../src/analytics/controlled-types.js'
import { resolveActive } from '../../../src/analytics/governance/generation-store.js'
import { ANALYTICS_HMAC_KEYRING_ENV } from '../../../src/analytics/config.js'
import { parseAnalyticsKeyring } from '../../../src/analytics/identity/keyring.js'
import { LIVE_WATERMARK_MS, runDeriveJob } from '../../../src/analytics/jobs/derive.js'
import type { DeriveJobResult } from '../../../src/analytics/jobs/derive.js'
import { getActiveAnalyticsRuntime } from '../../../src/analytics/start-analytics.js'
import { analyticsEvents, analyticsProcessEpochs } from '../../../src/db/analytics-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { analyticsSessions, analyticsTurnFriction } from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'
import { answer } from '../harness/scripted-llm.js'

const PSEUDONYM_PATTERN = /^v1\.[A-Za-z0-9_-]{32}$/u

const flushAnalytics = async (): Promise<void> => {
  await getActiveAnalyticsRuntime()?.observer.flush()
}

const deriveKeyMaterial = (): { key: Buffer; keyVersion: KeyVersion } => {
  const keyring = parseAnalyticsKeyring(process.env[ANALYTICS_HMAC_KEYRING_ENV])
  if (keyring.kind !== 'available') throw new Error('expected an available analytics keyring')
  return { key: keyring.activeKey, keyVersion: KeyVersionSchema.parse(keyring.activeVersion) }
}

const openEpochId = (): string => {
  const row = getDrizzleDb()
    .select({ epochId: analyticsProcessEpochs.epochId })
    .from(analyticsProcessEpochs)
    .where(eq(analyticsProcessEpochs.state, 'open'))
    .get()
  if (row === undefined) throw new Error('expected one open analytics process epoch')
  return row.epochId
}

const runDeriveNow = (localMode: 'local_aggregate' | 'local_pseudonymous'): DeriveJobResult => {
  const { key, keyVersion } = deriveKeyMaterial()
  const nowMs = Date.now() + LIVE_WATERMARK_MS + 60_000
  return runDeriveJob(
    { processEpochId: openEpochId(), key, keyVersion, nowMs, localMode, windowStartMs: 0, windowEndMs: nowMs },
    { getDrizzleDb },
  )
}

scenario(
  'SCN-analytics-derive-session-friction-materialization: a pseudonymous governed turn materializes one session and one friction row with purpose-keyed pseudonyms',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.analyticsRuntime('governed-pseudonymous')

    const gated = runDeriveNow('local_aggregate')
    expect(gated).toMatchObject({ partitions: 0, sessionsWritten: 0, frictionWritten: 0 })

    given.llm([answer('First reply.')])
    await when.message(alice, dm, 'hello')
    then.replyTo(alice).equals('First reply.')
    await flushAnalytics()

    const events = getDrizzleDb().select().from(analyticsEvents).all()
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((row) => row.actorKey === null || PSEUDONYM_PATTERN.test(row.actorKey))).toBe(true)
    expect(JSON.stringify(events)).not.toContain(alice.id)

    const result = runDeriveNow('local_pseudonymous')
    expect(result).toMatchObject({
      partitions: 1,
      sessionsWritten: 1,
      frictionWritten: 1,
      attemptsWritten: 0,
      clarificationAbandonedInserted: 0,
    })
    expect(result.sessionEventsWritten).toBeGreaterThan(0)

    const generation = resolveActive({ getDrizzleDb }).generation
    const sessions = getDrizzleDb().select().from(analyticsSessions).all()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ storageGeneration: generation, turnCount: 1 })
    expect(sessions[0]!.actorKey).toMatch(PSEUDONYM_PATTERN)
    expect(sessions[0]!.actorKey).not.toContain(alice.id)

    const friction = getDrizzleDb().select().from(analyticsTurnFriction).all()
    expect(friction).toHaveLength(1)
    expect(friction[0]).toMatchObject({ storageGeneration: generation, actorKey: sessions[0]!.actorKey })
    expect(friction[0]!.turnKey).toMatch(PSEUDONYM_PATTERN)
  },
  { testTimeoutMs: 15000 },
)
```

- [ ] **Step 2: Run the story to verify the census failure**

Run: `bun test:stories --fixture tests/stories/analytics/derive-storage.story.test.ts`

Expected: the story PASSES against existing production behavior; `bun test:stories:contracts` FAILS naming the uncataloged `SCN-analytics-derive-session-friction-materialization`.

- [ ] **Step 3: Register the catalog record**

In `tests/stories/catalog/coverage.ts`, add `'SCN-analytics-derive-session-friction-materialization',` to `CATALOG_SCENARIO_IDS` immediately after `'SCN-analytics-governed-turn',`, and add the record immediately after the `'SCN-analytics-governed-turn'` record:

```ts
  'SCN-analytics-derive-session-friction-materialization': {
    verifiedAt: '2026-08-04',
    provingTier: '0',
    storyIds: [
      'tests/stories/analytics/derive-storage.story.test.ts#SCN-analytics-derive-session-friction-materialization: a pseudonymous governed turn materializes one session and one friction row with purpose-keyed pseudonyms',
    ],
  },
```

- [ ] **Step 4: Run the story and the contracts**

Run: `bun test:stories --fixture tests/stories/analytics/derive-storage.story.test.ts && bun test:stories:contracts`

Expected: both exit `0`.

- [ ] **Step 5: Commit the materialization story**

```bash
git add tests/stories/analytics/derive-storage.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover derive session and friction materialization"
```

### Task 3: Guest and deny-preference exclusion story

**Files:**
- Modify: `tests/stories/analytics/derive-storage.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `flushAnalytics`, `runDeriveNow` from Task 2; `deriveGovernanceActorKey` from `src/analytics/governance/preference-store.ts`; `upsertPreferenceDenyInTx`, `appendPolicyAuditInTx` from `src/analytics/governance/preference-lifecycle.ts`; `parseGovernanceKeyring` from `src/analytics/identity/keyring.ts`; `given.guest`, `given.guestMode`, `given.group`, `given.member` from the harness.
- Produces: `denyLocalCollection(platformInstanceId: string, platformUserId: string): void` story-local helper, reused nowhere else.

- [ ] **Step 1: Write the failing exclusion story**

Add imports to the story file:

```ts
import { ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV } from '../../../src/analytics/config.js'
import { upsertPreferenceDenyInTx, appendPolicyAuditInTx } from '../../../src/analytics/governance/preference-lifecycle.js'
import { deriveGovernanceActorKey } from '../../../src/analytics/governance/preference-store.js'
import { parseGovernanceKeyring } from '../../../src/analytics/identity/keyring.js'
```

Append the helper and scenario:

```ts
const denyLocalCollection = (platformInstanceId: string, platformUserId: string): void => {
  const keyring = parseGovernanceKeyring(process.env[ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV])
  if (keyring.kind !== 'available') throw new Error('expected an available governance keyring')
  const governanceActorKey = deriveGovernanceActorKey({
    key: keyring.activeKey,
    keyVersion: keyring.activeVersion,
    platformInstanceId,
    platformUserId,
  })
  const nowMs = Date.now()
  getDrizzleDb().transaction((tx) => {
    upsertPreferenceDenyInTx(tx, { governanceActorKey, keyVersion: keyring.activeVersion, policyVersion: 1, source: 'settings', nowMs })
    appendPolicyAuditInTx(tx, { governanceActorKey, action: 'deny', policyVersion: 1, nowMs })
  })
}

scenario(
  'SCN-analytics-derive-guest-and-deny-exclusion: guest turns and deny-preference member turns produce no canonical events and no derive rows',
  async ({ given, when, then }) => {
    const member = given.user('member-writer')
    const denied = given.user('denied-member')
    const guest = given.guest('guest-reader')
    const group = given.group('analytics-exclusion-team')
    given.member(group, member)
    given.member(group, denied)
    given.assign(group, given.taskInstance())
    given.guestMode(group, true)
    given.analyticsRuntime('governed-pseudonymous')
    denyLocalCollection(denied.platformInstanceId, denied.id)

    given.llm([answer('Member reply.'), answer('Denied reply.'), answer('Guest reply.')])
    await when.message(member, group, 'member turn')
    then.replyIn(group).equals('Member reply.')
    await when.message(denied, group, 'denied turn')
    then.replyIn(group).equals('Denied reply.')
    await when.message(guest, group, 'guest turn')
    then.replyIn(group).equals('Guest reply.')
    await flushAnalytics()

    const result = runDeriveNow('local_pseudonymous')
    expect(result.partitions).toBe(1)

    const sessions = getDrizzleDb().select().from(analyticsSessions).all()
    expect(sessions).toHaveLength(1)
    const serialized = JSON.stringify(sessions)
    expect(serialized).not.toContain(denied.id)
    expect(serialized).not.toContain(guest.id)

    const events = getDrizzleDb()
      .select({ actorRole: analyticsEvents.actorRole })
      .from(analyticsEvents)
      .all()
    expect(events.every((row) => row.actorRole !== 'guest')).toBe(true)
    expect(getDrizzleDb().select().from(analyticsTurnFriction).all()).toHaveLength(1)
  },
  { testTimeoutMs: 15000 },
)
```

Only the allowed member's partition is derived: the denied member's events are refused at eligibility (never inserted into `analytics_events`), and `partitionFilter` in `src/analytics/derive/store.ts:47-55` excludes `guest` actor roles even if aggregate-only guest cells exist.

- [ ] **Step 2: Run the story to verify the census failure**

Run: `bun test:stories --fixture tests/stories/analytics/derive-storage.story.test.ts`

Expected: both scenarios PASS; contracts FAIL naming `SCN-analytics-derive-guest-and-deny-exclusion`.

- [ ] **Step 3: Register the catalog record**

Add `'SCN-analytics-derive-guest-and-deny-exclusion',` to `CATALOG_SCENARIO_IDS` after the Task 2 id, and the record after the Task 2 record:

```ts
  'SCN-analytics-derive-guest-and-deny-exclusion': {
    verifiedAt: '2026-08-04',
    provingTier: '0',
    storyIds: [
      'tests/stories/analytics/derive-storage.story.test.ts#SCN-analytics-derive-guest-and-deny-exclusion: guest turns and deny-preference member turns produce no canonical events and no derive rows',
    ],
  },
```

- [ ] **Step 4: Run the story and the contracts**

Run: `bun test:stories --fixture tests/stories/analytics/derive-storage.story.test.ts && bun test:stories:contracts`

Expected: both exit `0`.

- [ ] **Step 5: Commit the exclusion story**

```bash
git add tests/stories/analytics/derive-storage.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover derive guest and deny exclusion"
```

### Task 4: Idempotent derive rewrite story

**Files:**
- Modify: `tests/stories/analytics/derive-storage.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `flushAnalytics`, `runDeriveNow` from Task 2.
- Produces: nothing reused by later tasks.

- [ ] **Step 1: Write the failing idempotency story**

Append the scenario:

```ts
scenario(
  'SCN-analytics-derive-idempotent-rewrite: re-running derive replaces materializations with identical pseudonymous keys and stable counts',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.assign(dm, given.taskInstance())
    given.analyticsRuntime('governed-pseudonymous')

    given.llm([answer('Only reply.')])
    await when.message(alice, dm, 'hello again')
    then.replyTo(alice).equals('Only reply.')
    await flushAnalytics()

    const first = runDeriveNow('local_pseudonymous')
    expect(first).toMatchObject({ partitions: 1, sessionsWritten: 1, frictionWritten: 1 })
    const firstSessions = getDrizzleDb().select().from(analyticsSessions).all()
    const firstFriction = getDrizzleDb().select().from(analyticsTurnFriction).all()

    const second = runDeriveNow('local_pseudonymous')
    expect(second).toEqual(first)
    const secondSessions = getDrizzleDb().select().from(analyticsSessions).all()
    const secondFriction = getDrizzleDb().select().from(analyticsTurnFriction).all()

    expect(secondSessions).toHaveLength(1)
    expect(secondSessions[0]!.sessionKey).toBe(firstSessions[0]!.sessionKey)
    expect(secondFriction).toHaveLength(1)
    expect(secondFriction[0]!.turnKey).toBe(firstFriction[0]!.turnKey)
  },
  { testTimeoutMs: 15000 },
)
```

`replaceSessions`/`replaceTurnFriction` in `src/analytics/derive/write.ts` delete the partition's rows and reinsert them from the same deterministic inputs, and `createPseudonym` is a pure HMAC, so keys and counters are stable across runs.

- [ ] **Step 2: Run the story to verify the census failure**

Run: `bun test:stories --fixture tests/stories/analytics/derive-storage.story.test.ts`

Expected: all three scenarios PASS; contracts FAIL naming `SCN-analytics-derive-idempotent-rewrite`.

- [ ] **Step 3: Register the catalog record and extend the source line**

Add `'SCN-analytics-derive-idempotent-rewrite',` to `CATALOG_SCENARIO_IDS` after the Task 3 id, and the record after the Task 3 record:

```ts
  'SCN-analytics-derive-idempotent-rewrite': {
    verifiedAt: '2026-08-04',
    provingTier: '0',
    storyIds: [
      'tests/stories/analytics/derive-storage.story.test.ts#SCN-analytics-derive-idempotent-rewrite: re-running derive replaces materializations with identical pseudonymous keys and stable counts',
    ],
  },
```

Extend `CATALOG_SOURCE` by appending to the existing literal:

```ts
'; extended 2026-08-04 with 3 derive storage (@0) ids (analytics-derive-storage-coverage)'
```

- [ ] **Step 4: Run the story and the contracts**

Run: `bun test:stories --fixture tests/stories/analytics/derive-storage.story.test.ts && bun test:stories:contracts`

Expected: both exit `0`.

- [ ] **Step 5: Commit the idempotency story**

```bash
git add tests/stories/analytics/derive-storage.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover idempotent derive rewrite"
```

## Final Verification

- [ ] Run `bun test:stories --fixture tests/stories/analytics/derive-storage.story.test.ts tests/stories/analytics/governed-turn.story.test.ts`; expected exit code `0`.
- [ ] Run `bun test:stories:contracts`; expected exit code `0`.
- [ ] Run `bun test:stories:coverage`; expected exit code `0`, with lines `>= 71.00%` and functions `>= 70.00%`.
- [ ] Run `bun run typecheck && bun run lint`; expected exit code `0`.
- [ ] Run `git status --short`; expected output shows no uncommitted changes under `tests/` or `src/`.
- [ ] Verify no story file imports `src/analytics/delivery/`, `src/analytics/jobs/snapshot`, `runBackfillJob`, `runIntentDerivation`, `src/analytics/rekey/`, `subject-deletion`, or `subject-export`.

## Outcome — abandoned 2026-08-20 (Tasks 2–4 blocked)

Task 1 landed (`bcf162c73`) and was reverted (`f34ced120`) once its only
consumers were dropped. Tasks 2–4 were **not** executed: their core premise is
false.

**Premise:** "real governed turns flow through the production
observer/normalizer/eligibility pipeline into canonical `analytics_events`"
once `analytics_policy.local_mode` is `local_pseudonymous`.

**Reality:** a live turn can never write a canonical event, because
`decideEligibility` requires a collection-eligibility ref
(`src/analytics/governance/eligibility.ts:143`,
`if (input.collectionEligibility === null) return denied('governance_incomplete')`)
and **no production code ever grants one**:

- `setEligibilityState` (`src/analytics/governance/collection-store.ts:135`) is
  the only writer of `state='allow'`. It has zero callers in `src/`,
  `plugins/`, or `client/`; every reference is under `tests/`.
- The settings preference route
  (`src/debug/settings/analytics-routes.ts:161`) records an `allow` preference
  via `setPreference` but grants no eligibility ref; `preference-store.ts`
  contains no eligibility logic.
- The only production eligibility writer is `revokeEligibilityInTx`
  (`subject-service.ts:158`), on subject withdrawal.

Measured directly: after `given.analyticsRuntime('governed-pseudonymous')` and
one governed turn, `analytics_policy` holds
`local_mode=local_pseudonymous, lawful_basis_mode=legitimate_interest,
policy_effective_at_ms=<now>`, and `analytics_collection_eligibility`,
`analytics_preferences`, and `analytics_events` are all empty. The turn passes
the lane and preference gates and is denied `governance_incomplete` at the
eligibility-ref check.

**Consequences.** The `local_pseudonymous` collection lane is unreachable in
the shipped product, so `runDeriveJob` and the sessions/friction
materializations are unexercised by any live path — which is why their coverage
is low. `docs/operations/analytics-runbook.md` Stage C ("enable
`local_pseudonymous` for explicit test actors or one controlled installation
only") has no shipped mechanism behind it.

**Not done, deliberately.** Seeding `setEligibilityState` from the story would
have unblocked Tasks 2–4 but would prove the derive pipeline from a state the
product cannot reach — a subsystem proof wearing an end-to-end story's clothes,
which is what the T0 lane exists to prevent. Closing the gap for real means
wiring the grant into the allow path, which is a production privacy-governance
change and needs its own change proposal and review.
