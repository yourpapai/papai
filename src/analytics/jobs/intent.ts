// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, asc, eq, isNotNull } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsEventCollectionRefs, analyticsEvents } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { AnalyticsEventV1Schema } from '../contracts.js'
import type { AnalyticsEventV1 } from '../contracts.js'
import type { ConfidenceBucket, KeyVersion } from '../controlled-types.js'
import { insertEligibleCanonicalEvent } from '../governance/collection-serialization.js'
import type { CollectionEligibilityRef } from '../governance/eligibility.js'
import { createPseudonym } from '../identity/pseudonym.js'
import { classifyHybrid, toClassifierToolSlug } from '../intent/classifier.js'
import type { IntentPrediction } from '../intent/classifier.js'
import { INTENT_IDS, isCoreIntent, sortGoals, TAXONOMY_VERSION } from '../intent/taxonomy.js'

export type IntentDerivationDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

export type IntentDerivationInput = Readonly<{
  processEpochId: string
  key: Buffer
  keyVersion: KeyVersion
  nowMs: number
  localMode: 'off' | 'local_aggregate' | 'local_pseudonymous'
  limit?: number
}>

export type IntentDerivationResult = Readonly<{
  scanned: number
  alreadyPresent: number
  inserted: number
  skippedNoRef: number
  skippedGuest: number
  notEligible: number
}>

type Db = ReturnType<typeof defaultGetDrizzleDb>
type TurnRow = typeof analyticsEvents.$inferSelect

const log = logger.child({ component: 'analytics-intent-derivation' })
const DEFAULT_LIMIT = 200

const confidenceBucketFor = (confidence: number): ConfidenceBucket => {
  if (confidence < 0.5) return 'lt_050'
  if (confidence < 0.7) return '050_069'
  if (confidence < 0.85) return '070_084'
  if (confidence < 0.95) return '085_094'
  return 'ge_095'
}

const scanTurns = (db: Db, limit: number): readonly TurnRow[] =>
  db
    .select()
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.eventName, 'turn_completed'),
        isNotNull(analyticsEvents.turnKey),
        isNotNull(analyticsEvents.actorKey),
      ),
    )
    .orderBy(asc(analyticsEvents.occurredAtMs), asc(analyticsEvents.eventId))
    .limit(limit)
    .all()

const refFor = (db: Db, eventId: string): CollectionEligibilityRef | null => {
  const row = db
    .select({
      refKey: analyticsEventCollectionRefs.refKey,
      keyVersion: analyticsEventCollectionRefs.keyVersion,
      generation: analyticsEventCollectionRefs.generation,
    })
    .from(analyticsEventCollectionRefs)
    .where(eq(analyticsEventCollectionRefs.eventId, eventId))
    .get()
  return row ?? null
}

const hasEvent = (db: Db, eventName: string, turnKey: string): boolean =>
  db
    .select({ eventId: analyticsEvents.eventId })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.eventName, eventName), eq(analyticsEvents.turnKey, turnKey)))
    .limit(1)
    .get() !== undefined

const toolSlugsFor = (db: Db, turnKey: string): readonly string[] =>
  db
    .select({ propsJson: analyticsEvents.propsJson })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.eventName, 'tool_completed'), eq(analyticsEvents.turnKey, turnKey)))
    .orderBy(asc(analyticsEvents.occurredAtMs), asc(analyticsEvents.eventId))
    .all()
    .flatMap((row) => {
      const parsed: unknown = JSON.parse(row.propsJson)
      if (typeof parsed !== 'object' || parsed === null || !('tool_slug' in parsed)) {
        return []
      }
      const slug = (parsed as Readonly<{ tool_slug: unknown }>).tool_slug
      return typeof slug === 'string' ? [toClassifierToolSlug(slug)] : []
    })

const propsFor = (prediction: IntentPrediction): Record<string, unknown> => ({
  taxonomy: TAXONOMY_VERSION,
  primary: INTENT_IDS[prediction.primary],
  goals: [...new Set(sortGoals(prediction.goals.filter(isCoreIntent)).map((goal) => INTENT_IDS[goal]))].slice(0, 3),
  confidence: confidenceBucketFor(prediction.confidence),
  strategy: 'hybrid_v1',
  abstained: prediction.abstained,
})

const buildEvent = (input: IntentDerivationInput, row: TurnRow, prediction: IntentPrediction): AnalyticsEventV1 =>
  AnalyticsEventV1Schema.parse({
    schema: { name: 'papai.analytics.event', version: 1 },
    event: {
      id: createPseudonym({
        key: input.key,
        keyVersion: input.keyVersion,
        domain: 'intent-output:v1',
        components: [row.turnKey ?? '', TAXONOMY_VERSION],
      }),
      name: 'intent_classified',
      version: 1,
      occurred_at_ms: row.occurredAtMs,
      ingested_at_ms: input.nowMs,
      source: 'live',
      attribution_quality: 'native',
    },
    app: { version: row.appVersion, deployment_key: row.deploymentKey },
    identity: {
      key_version: row.keyVersion,
      platform: row.platform,
      platform_instance_key: row.platformInstanceKey,
      actor_key: row.actorKey,
      context_key: row.contextKey,
      thread_key: row.threadKey,
      task_instance_key: row.taskInstanceKey,
    },
    context: {
      context_type: row.contextType,
      actor_role: row.actorRole,
      task_provider: row.taskProvider,
      invocation_mode: row.invocationMode,
    },
    correlation: { conversation_key: row.conversationKey, turn_key: row.turnKey, session_key: row.sessionKey },
    governance: {
      purpose: 'product_analytics',
      collection_tier: 'pseudonymous',
      policy_version: row.policyVersion,
      eligibility: row.eligibility,
    },
    privacy: { max_class: 'C2' },
    props: propsFor(prediction),
  })

interface Counters {
  scanned: number
  alreadyPresent: number
  inserted: number
  skippedNoRef: number
  skippedGuest: number
  notEligible: number
}

const processTurn = (db: Db, input: IntentDerivationInput, row: TurnRow, counters: Counters): void => {
  const turnKey = row.turnKey
  if (turnKey === null) {
    return
  }
  if (row.actorRole === 'guest') {
    counters.skippedGuest += 1
    return
  }
  const ref = refFor(db, row.eventId)
  if (ref === null) {
    counters.skippedNoRef += 1
    return
  }
  if (hasEvent(db, 'intent_classified', turnKey)) {
    counters.alreadyPresent += 1
    return
  }
  const prediction = classifyHybrid({
    tool_trace: toolSlugsFor(db, turnKey).map((slug) => ({ tool_slug: slug })),
    feature_events: [],
    command_family: hasEvent(db, 'turn_stop_requested', turnKey) ? 'stop' : 'none',
  })
  const result = insertEligibleCanonicalEvent(
    { event: buildEvent(input, row, prediction), processEpochId: input.processEpochId, collectionRef: ref },
    { getDrizzleDb: () => db },
  )
  if (result.status === 'inserted') {
    counters.inserted += 1
  } else if (result.status === 'already_present') {
    counters.alreadyPresent += 1
  } else {
    counters.notEligible += 1
  }
}

export const runIntentDerivation = (
  input: IntentDerivationInput,
  deps: IntentDerivationDeps = { getDrizzleDb: defaultGetDrizzleDb },
): IntentDerivationResult => {
  const counters: Counters = {
    scanned: 0,
    alreadyPresent: 0,
    inserted: 0,
    skippedNoRef: 0,
    skippedGuest: 0,
    notEligible: 0,
  }
  if (input.localMode !== 'local_pseudonymous') {
    log.debug({ localMode: input.localMode }, 'intent derivation skipped: local mode excludes pseudonymous intent')
    return counters
  }
  const db = deps.getDrizzleDb()
  const rows = scanTurns(db, input.limit ?? DEFAULT_LIMIT)
  for (const row of rows) {
    counters.scanned += 1
    processTurn(db, input, row, counters)
  }
  log.info({ ...counters }, 'intent derivation run completed')
  return counters
}
