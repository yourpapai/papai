// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { logger } from '../../logger.js'
import { AnalyticsEventV1Schema } from '../contracts.js'
import type { AnalyticsEventV1 } from '../contracts.js'
import type { KeyVersion } from '../controlled-types.js'
import {
  collectionRefForEvent,
  findDerivedClarificationEvent,
  findDerivedClarificationEvents,
  findWithdrawnActorCensors,
  loadEventRow,
  loadFeatureFacts,
} from '../derive/facts.js'
import { materializeFeatureDays } from '../derive/features.js'
import { computeTurnFriction } from '../derive/friction.js'
import {
  buildGoalAttempts,
  CLARIFICATION_ABANDONED_DOMAIN,
  isClarificationAbandonmentMature,
  OBSERVATION_WINDOW_MS,
} from '../derive/outcomes.js'
import { sessionizePartition } from '../derive/sessionizer.js'
import type { SessionKeyInput } from '../derive/sessionizer.js'
import { findAffectedPartitions, loadPartitionEvents, loadTurnFacts } from '../derive/store.js'
import type { AffectedPartition, PartitionTurnFacts } from '../derive/store.js'
import {
  deleteDerivedClarificationEvent,
  replaceFeatureDays,
  replaceGoalAttempts,
  replaceSessions,
  replaceTurnFriction,
  upsertCensorIntervals,
} from '../derive/write.js'
import { insertEligibleCanonicalEvent } from '../governance/collection-serialization.js'
import { resolveActive } from '../governance/generation-store.js'
import { createPseudonym } from '../identity/pseudonym.js'
import { purgeExpired } from './retention.js'

export const LIVE_WATERMARK_MS = 120_000

const log = logger.child({ component: 'analytics-derive-job' })

type Db = ReturnType<typeof defaultGetDrizzleDb>

export type DeriveJobDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

export type DeriveJobInput = Readonly<{
  processEpochId: string
  key: Buffer
  keyVersion: KeyVersion
  nowMs: number
  localMode: 'off' | 'local_aggregate' | 'local_pseudonymous'
  windowStartMs: number
  windowEndMs: number
}>

export type DeriveJobResult = Readonly<{
  partitions: number
  sessionsWritten: number
  sessionEventsWritten: number
  attemptsWritten: number
  frictionWritten: number
  featureOpportunityDaysWritten: number
  featureUseDaysWritten: number
  clarificationAbandonedInserted: number
  clarificationAbandonedRemoved: number
  clarificationAbandonedNotEligible: number
  clarificationAbandonedNoRef: number
  censorIntervalsWritten: number
}>

type Counters = {
  -readonly [K in keyof DeriveJobResult]: number
}

const zeroCounters = (): Counters => ({
  partitions: 0,
  sessionsWritten: 0,
  sessionEventsWritten: 0,
  attemptsWritten: 0,
  frictionWritten: 0,
  featureOpportunityDaysWritten: 0,
  featureUseDaysWritten: 0,
  clarificationAbandonedInserted: 0,
  clarificationAbandonedRemoved: 0,
  clarificationAbandonedNotEligible: 0,
  clarificationAbandonedNoRef: 0,
  censorIntervalsWritten: 0,
})

const buildClarificationAbandonedEvent = (
  input: DeriveJobInput,
  source: NonNullable<ReturnType<typeof loadEventRow>>,
  turn: PartitionTurnFacts,
): AnalyticsEventV1 =>
  AnalyticsEventV1Schema.parse({
    schema: { name: 'papai.analytics.event', version: 1 },
    event: {
      id: createPseudonym({
        key: input.key,
        keyVersion: input.keyVersion,
        domain: CLARIFICATION_ABANDONED_DOMAIN,
        components: [turn.turnKey],
      }),
      name: 'clarification_abandoned',
      version: 1,
      occurred_at_ms: source.occurredAtMs + OBSERVATION_WINDOW_MS,
      ingested_at_ms: input.nowMs,
      source: 'live',
      attribution_quality: 'native',
    },
    app: { version: source.appVersion, deployment_key: source.deploymentKey },
    identity: {
      key_version: source.keyVersion,
      platform: source.platform,
      platform_instance_key: source.platformInstanceKey,
      actor_key: source.actorKey,
      context_key: source.contextKey,
      thread_key: source.threadKey,
      task_instance_key: source.taskInstanceKey,
    },
    context: {
      context_type: source.contextType,
      actor_role: source.actorRole,
      task_provider: source.taskProvider,
      invocation_mode: source.invocationMode,
    },
    correlation: { conversation_key: source.conversationKey, turn_key: turn.turnKey, session_key: null },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: source.policyVersion,
      eligibility: source.eligibility,
    },
    privacy: { max_class: 'C2' },
    props: { observation_hours: 24 },
  })

const reconcileClarificationAbandonment = (
  db: Db,
  input: DeriveJobInput,
  generation: string,
  partition: AffectedPartition,
  turns: readonly PartitionTurnFacts[],
  counters: Counters,
): boolean => {
  let changed = false
  const turnKeys = new Set(turns.map((turn) => turn.turnKey))
  for (const orphan of findDerivedClarificationEvents(db, generation, partition)) {
    if (turnKeys.has(orphan.turnKey)) continue
    deleteDerivedClarificationEvent(db, orphan.eventId)
    counters.clarificationAbandonedRemoved += 1
    changed = true
  }
  for (const turn of turns) {
    const existing = findDerivedClarificationEvent(db, turn.turnKey)
    const qualified = isClarificationAbandonmentMature(turn, turns, { nowMs: input.nowMs, censorStartMs: null })
    if (qualified && existing === undefined) {
      const sourceEventId = turn.clarificationSourceEventId ?? turn.anchorEventId
      const ref = collectionRefForEvent(db, sourceEventId)
      const source = loadEventRow(db, sourceEventId)
      if (ref === null || source === undefined) {
        counters.clarificationAbandonedNoRef += 1
        continue
      }
      const result = insertEligibleCanonicalEvent(
        {
          event: buildClarificationAbandonedEvent(input, source, turn),
          processEpochId: input.processEpochId,
          collectionRef: ref,
        },
        { getDrizzleDb: () => db },
      )
      if (result.status === 'inserted') {
        counters.clarificationAbandonedInserted += 1
        changed = true
      } else if (result.status === 'not_eligible') {
        counters.clarificationAbandonedNotEligible += 1
      }
    } else if (!qualified && existing !== undefined) {
      deleteDerivedClarificationEvent(db, existing.eventId)
      counters.clarificationAbandonedRemoved += 1
      changed = true
    }
  }
  return changed
}

const derivePartition = (
  db: Db,
  input: DeriveJobInput,
  generation: string,
  partition: AffectedPartition,
  keyInput: SessionKeyInput,
  counters: Counters,
): void => {
  const events = loadPartitionEvents(db, generation, partition, input.nowMs)
  const sessions = sessionizePartition({ ...partition, events }, keyInput)
  const sessionWrite = replaceSessions(db, generation, partition, sessions)
  counters.sessionsWritten += sessionWrite.sessions
  counters.sessionEventsWritten += sessionWrite.events

  let turns = loadTurnFacts(db, generation, partition, input.nowMs)
  if (reconcileClarificationAbandonment(db, input, generation, partition, turns, counters)) {
    turns = loadTurnFacts(db, generation, partition, input.nowMs)
  }

  const attempts = buildGoalAttempts(turns, { nowMs: input.nowMs, censorStartMs: null }, keyInput)
  counters.attemptsWritten += replaceGoalAttempts(db, partition, attempts, generation)

  const friction = turns.map((turn) =>
    computeTurnFriction({
      turnKey: turn.turnKey,
      actorKey: turn.actorKey,
      conversationKey: turn.conversationKey,
      occurredAtMs: turn.turnEndMs,
      anchorEventId: turn.anchorEventId,
      durationMs: turn.durationMs,
      hasRephrase: turn.hasRephrase,
      hasClarificationAbandoned: turn.hasClarificationAbandoned,
      hasPermissionIssue: turn.hasPermissionIssue,
      hasStop: turn.hasStop,
      hasDisclosureFallback: turn.hasDisclosureFallback,
      executedOutcomes: turn.executedOutcomes,
    }),
  )
  counters.frictionWritten += replaceTurnFriction(db, partition, friction, generation)
}

export const runDeriveJob = (
  input: DeriveJobInput,
  deps: DeriveJobDeps = { getDrizzleDb: defaultGetDrizzleDb },
): DeriveJobResult => {
  const counters = zeroCounters()
  if (input.localMode !== 'local_pseudonymous') {
    log.debug({ localMode: input.localMode }, 'derive job skipped: local mode excludes pseudonymous materialization')
    return counters
  }
  const db = deps.getDrizzleDb()
  const scanEndMs = Math.min(input.windowEndMs, input.nowMs - LIVE_WATERMARK_MS)
  if (scanEndMs <= input.windowStartMs) {
    log.debug({ windowStartMs: input.windowStartMs, scanEndMs }, 'derive job skipped: empty scan window')
    return counters
  }
  purgeExpired({ nowMs: input.nowMs }, { getDrizzleDb: deps.getDrizzleDb })
  const generation = resolveActive({ getDrizzleDb: deps.getDrizzleDb }).generation
  const keyInput: SessionKeyInput = { key: input.key, keyVersion: input.keyVersion }

  counters.censorIntervalsWritten += upsertCensorIntervals(db, findWithdrawnActorCensors(db))

  const partitions = findAffectedPartitions(db, generation, input.windowStartMs, scanEndMs, input.nowMs)
  counters.partitions = partitions.length
  const actors = new Set<string>()
  for (const partition of partitions) {
    derivePartition(db, input, generation, partition, keyInput, counters)
    actors.add(partition.actorKey)
  }
  for (const actorKey of actors) {
    const facts = loadFeatureFacts(db, generation, actorKey, input.nowMs)
    const written = replaceFeatureDays(db, actorKey, materializeFeatureDays(facts), generation)
    counters.featureOpportunityDaysWritten += written.opportunities
    counters.featureUseDaysWritten += written.uses
  }
  log.info({ ...counters }, 'derive job run completed')
  return counters
}
