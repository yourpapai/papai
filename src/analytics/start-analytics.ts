// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import packageJson from '../../package.json' with { type: 'json' }
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'
import { FIXED_HISTOGRAM_BUCKETS_MS } from './aggregate-contract.js'
import { createContributorTracker } from './aggregate-contributors.js'
import type { ContributorTracker } from './aggregate-contributors.js'
import { contributorBasisForMetric, histogramBucketIndex } from './aggregate.js'
import { ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV, ANALYTICS_HMAC_KEYRING_ENV } from './config.js'
import { KeyVersionSchema, VersionStringSchema } from './controlled-types.js'
import { insertEligibleCanonicalEvent } from './governance/collection-serialization.js'
import { deriveCollectionRefKey, getEligibilityRef } from './governance/collection-store.js'
import { decideEligibility } from './governance/eligibility.js'
import type { AnalyticsLane, EligibilityDecision } from './governance/eligibility.js'
import { resolveActive } from './governance/generation-store.js'
import { assessGovernanceReadiness, getPolicy, resolveEffectiveLanes } from './governance/policy-store.js'
import type { EffectiveLanes } from './governance/policy-store.js'
import { deriveGovernanceActorKey, getPreference } from './governance/preference-store.js'
import { getOrCreateAnalyticsInstallId } from './identity/install-id.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from './identity/keyring.js'
import type { KeyringState } from './identity/keyring.js'
import type { NormalizerEnv } from './normalizer.js'
import { createProcessEpochCoordinator } from './process-epoch.js'
import { createAnalyticsObserver } from './runtime.js'
import type { AnalyticsObserver, QueuedAggregateIncrement, RuntimeSinks } from './runtime.js'
import type { AnalyticsSourceFact } from './source-facts.js'
import { incrementCounter, mergeHistogram } from './storage/aggregate-store.js'
import { createControlledOverflowBinding } from './storage/epoch-store.js'
import { createToolNameKeyDeriver, initAnalyticsRuntime, stopAnalyticsRuntime } from './subscriber.js'
import { createTurnContextRegistry } from './turn-context.js'
import type { AuthorizedTurnContextRegistry } from './turn-context.js'

const log = logger.child({ scope: 'analytics:wiring' })

type ActiveRuntime = Readonly<{
  observer: AnalyticsObserver
  stopCoordinator: () => Promise<Readonly<{ closed: boolean }>>
  registry: AuthorizedTurnContextRegistry
}>

let active: ActiveRuntime | null = null

/** Current runtime-owned analytics handles, or null when analytics is not started. */
export const getActiveAnalyticsRuntime = (): Readonly<{
  observer: AnalyticsObserver
  registry: AuthorizedTurnContextRegistry
} | null> => (active === null ? null : { observer: active.observer, registry: active.registry })

const pickCandidateLane = (lanes: EffectiveLanes): AnalyticsLane => {
  if (lanes.localMode === 'local_pseudonymous') return 'local_pseudonymous'
  if (lanes.localMode === 'local_aggregate') return 'local_aggregate'
  if (lanes.externalPseudonymousEnabled) return 'external_pseudonymous'
  if (lanes.externalAggregateEnabled) return 'external_aggregate'
  return 'off'
}

const readPreferences = (
  fact: AnalyticsSourceFact,
  governanceKeyring: KeyringState,
): Readonly<{
  local: 'unknown' | 'allow' | 'deny'
  external: 'unknown' | 'allow' | 'deny'
}> => {
  if (governanceKeyring.kind !== 'available' || fact.source.chatUserId === null) {
    return { local: 'unknown', external: 'unknown' }
  }
  const actorKey = deriveGovernanceActorKey({
    key: governanceKeyring.activeKey,
    keyVersion: governanceKeyring.activeVersion,
    platformInstanceId: fact.source.platformInstanceId,
    platformUserId: fact.source.chatUserId,
  })
  const row = getPreference(actorKey)
  const local = row?.localLongitudinal
  const external = row?.externalPseudonymous
  return {
    local: local === 'allow' || local === 'deny' ? local : 'unknown',
    external: external === 'allow' || external === 'deny' ? external : 'unknown',
  }
}

const readCollectionRef = (
  fact: AnalyticsSourceFact,
  governanceKeyring: KeyringState,
): ReturnType<typeof getEligibilityRef> => {
  if (governanceKeyring.kind !== 'available' || fact.source.chatUserId === null) return null
  const refKey = deriveCollectionRefKey({
    key: governanceKeyring.activeKey,
    keyVersion: governanceKeyring.activeVersion,
    platformInstanceId: fact.source.platformInstanceId,
    platformUserId: fact.source.chatUserId,
  })
  return getEligibilityRef(refKey)
}

const buildDecide =
  (analyticsKeyring: KeyringState, governanceKeyring: KeyringState) =>
  (fact: AnalyticsSourceFact): EligibilityDecision => {
    try {
      const policy = getPolicy()
      const lanes = resolveEffectiveLanes({ policy })
      const readiness = assessGovernanceReadiness({
        policy,
        analyticsKeyring,
        governanceKeyring,
      })
      const lane = pickCandidateLane(lanes)
      const pseudonymous = lane === 'local_pseudonymous' || lane === 'external_pseudonymous'
      const preferences = readPreferences(fact, governanceKeyring)
      return decideEligibility({
        lane,
        killSwitchActive: lanes.killSwitchActive,
        localMode: lanes.localMode,
        externalAggregateEnabled: lanes.externalAggregateEnabled,
        externalPseudonymousEnabled: lanes.externalPseudonymousEnabled,
        lawfulBasis:
          policy.lawfulBasisMode === 'consent' || policy.lawfulBasisMode === 'legitimate_interest'
            ? policy.lawfulBasisMode
            : null,
        governanceReady: readiness.ready,
        policyVersion: policy.policyVersion ?? 0,
        policyEffectiveAtMs: policy.policyEffectiveAtMs,
        nowMs: Date.now(),
        actorRole: fact.source.actorRole,
        localPreference: preferences.local,
        externalPreference: preferences.external,
        sink: null,
        collectionEligibility: pseudonymous ? readCollectionRef(fact, governanceKeyring) : null,
        deliveryGrant: null,
      })
    } catch (error) {
      log.warn(
        {
          factType: fact.type,
          errorClass: error instanceof Error ? error.constructor.name : 'non_error',
        },
        'eligibility evaluation failed closed',
      )
      return { allowed: false, reason: 'governance_incomplete' }
    }
  }

const buildNormalizerEnv = (analyticsKeyring: KeyringState): NormalizerEnv | null => {
  if (analyticsKeyring.kind !== 'available') return null
  let policyVersion = 0
  try {
    policyVersion = getPolicy().policyVersion ?? 0
  } catch {
    policyVersion = 0
  }
  return {
    hmacKey: analyticsKeyring.activeKey,
    keyVersion: KeyVersionSchema.parse(analyticsKeyring.activeVersion),
    installId: getOrCreateAnalyticsInstallId(),
    appVersion: VersionStringSchema.parse(packageJson.version),
    policyVersion,
    ingestedAtMs: Date.now(),
  }
}

const aggregateCellKeyOf = (item: QueuedAggregateIncrement): string =>
  `${item.utcDay}|${JSON.stringify(item.dimensions)}|${item.increment.metric}`

const recordContributor = (
  tracker: ContributorTracker,
  item: QueuedAggregateIncrement,
  cellKey: string,
): number | null => {
  if (item.contributorKey === null) return null
  tracker.record(item.utcDay, cellKey, item.contributorKey)
  return tracker.count(item.utcDay, cellKey)
}

export type ProductionSinkDeps = Readonly<{
  epochId: string
  tracker: ContributorTracker
  getDrizzleDb: typeof getDrizzleDb
}>

const writeAggregateItem = (item: QueuedAggregateIncrement, deps: ProductionSinkDeps): void => {
  const cellKey = aggregateCellKeyOf(item)
  const quality = {
    disclosureScope: 'local_only',
    contributorBasis: contributorBasisForMetric(item.increment.metric),
    contributorCount: recordContributor(deps.tracker, item, cellKey),
  }
  const base = {
    utcDay: item.utcDay,
    definitionVersion: 1,
    platform: item.dimensions.platform,
    contextType: item.dimensions.context_type,
    actorRole: item.dimensions.actor_role,
    taskProvider: item.dimensions.task_provider,
    appVersion: item.dimensions.app_version,
    aggregateCellKey: cellKey,
    epochId: deps.epochId,
  }
  const storeDeps = { getDrizzleDb: deps.getDrizzleDb }
  if (item.increment.kind === 'counter') {
    incrementCounter(
      {
        ...base,
        metric: item.increment.metric,
        delta: item.increment.delta,
        ...quality,
      },
      storeDeps,
    )
    return
  }
  const counts = FIXED_HISTOGRAM_BUCKETS_MS.map(() => 0)
  const bucketIndex = histogramBucketIndex(item.increment.valueMs)
  counts[bucketIndex] = 1
  mergeHistogram(
    {
      ...base,
      metric: item.increment.metric,
      fixedBuckets: FIXED_HISTOGRAM_BUCKETS_MS,
      counts,
      sum: item.increment.valueMs,
      sampleCount: 1,
      ...quality,
    },
    storeDeps,
  )
}

export const createProductionSinks = (deps: ProductionSinkDeps): RuntimeSinks => ({
  writeEvents: (items): void => {
    items.forEach((item) => {
      insertEligibleCanonicalEvent(
        {
          event: item.event,
          processEpochId: deps.epochId,
          collectionRef: item.collectionRef,
        },
        { getDrizzleDb: deps.getDrizzleDb },
      )
    })
  },
  writeAggregates: (items): void => {
    items.forEach((item) => {
      writeAggregateItem(item, deps)
    })
  },
})

export const startAnalytics = (): void => {
  if (active !== null) return
  resolveActive()
  const analyticsKeyring = parseAnalyticsKeyring(process.env[ANALYTICS_HMAC_KEYRING_ENV])
  const governanceKeyring = parseGovernanceKeyring(process.env[ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV])
  let observerRef: AnalyticsObserver | null = null
  const coordinator = createProcessEpochCoordinator({
    getDrizzleDb,
    drain: () => observerRef?.flush() ?? Promise.resolve(),
  })
  coordinator.recoverStaleEpochs()
  coordinator.open()
  const registry = createTurnContextRegistry()
  const healthCounts = { queue_full: 0, observer_failure: 0 }
  const observer = createAnalyticsObserver({
    decide: buildDecide(analyticsKeyring, governanceKeyring),
    normalizerEnv: () => buildNormalizerEnv(analyticsKeyring),
    health: {
      increment: (counter) => {
        healthCounts[counter] += 1
        log.warn({ counter, total: healthCounts[counter] }, 'analytics health signal')
      },
    },
    log,
    onControlledOverflow: createControlledOverflowBinding({ epochId: coordinator.epochId }),
    sinks: createProductionSinks({
      epochId: coordinator.epochId,
      tracker: createContributorTracker(),
      getDrizzleDb,
    }),
  })
  observerRef = observer
  initAnalyticsRuntime({ observer, registry, deriveToolNameKey: createToolNameKeyDeriver(analyticsKeyring) })
  active = { observer, stopCoordinator: coordinator.close, registry }
  log.info({ epochId: coordinator.epochId }, 'analytics runtime started')
}

export const stopAnalytics = async (): Promise<void> => {
  if (active === null) return
  const current = active
  active = null
  stopAnalyticsRuntime()
  current.registry.clear()
  const result = await current.stopCoordinator()
  if (!result.closed) {
    log.warn('analytics epoch left open for startup recovery')
  }
  log.info('analytics runtime stopped')
}
