// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Canonical behavior ledger: one record per documented behavior inventory ID
 * (`docs/architecture/behaviors.md` anchors), cross-checked against the scenario
 * catalog.
 *
 * Evidence is keyed by the dimension it proves. Each entry in `proven` declares
 * the tier that dimension is proven at and the executable scenarios that prove
 * it, so one behavior may prove its external boundary at a process-real tier
 * while proving a hermetic dimension at Tier 0 — the roadmap's "cheapest tier
 * that can exercise its regression boundary" is a property of a dimension, not
 * of a behavior. Each entry in `missing` names a dimension that is implemented
 * in production but not yet proven, and records the tier a follow-on plan is
 * expected to prove it at. A planned tier is never evidence: it carries no
 * scenarios, and `unqualifiedBehaviors()` bars any record with an open
 * dimension from global-refactor qualification.
 *
 * The required dimension set is derived (`requiredDimensions()`), never
 * declared, so a record cannot require a dimension it neither proves nor leaves
 * open, and cannot cite a scenario that proves no required dimension.
 *
 * Intentional exclusions (Task 3): two bullets in `docs/architecture/behaviors.md`
 * carry no `<!-- behavior: -->` anchor and therefore have no ledger record here —
 * the ChatRouter startup-plumbing sentence under the scope-model bullet and the
 * "Supports incoming files, …" capability-list line under guest mode. Task 3
 * scoped the inventory to independently observable top-level behaviors; those two
 * bullets are supporting mechanism description and a capability enumeration, not
 * standalone behaviors, so no ledger entry is owed for them.
 */

import { DOCUMENTED_BEHAVIOR_IDS, type DocumentedBehaviorId } from './behavior-inventory.js'
import { catalogCoverage, type CatalogScenarioId, type StoryTier } from './coverage.js'

export type CoverageDimension =
  | 'primary'
  | 'authorization-routing'
  | 'failure-recovery'
  | 'persistence-scope'
  | 'external-boundary'
export type BehaviorState = 'implemented' | 'partial' | 'blocked:missing-implementation' | 'retired'

// Canonical order; every derived dimension list and gap report follows it, so a
// ledger failure reads the same way on every run.
export const COVERAGE_DIMENSIONS: readonly CoverageDimension[] = [
  'primary',
  'authorization-routing',
  'failure-recovery',
  'persistence-scope',
  'external-boundary',
]

/** The tier one dimension is proven at, and the executable scenarios proving it. */
export type DimensionProof = Readonly<{
  provingTier: StoryTier
  scenarioIds: readonly CatalogScenarioId[]
}>

type ProvenDimensions = Readonly<Partial<Record<CoverageDimension, DimensionProof>>>
/** An open dimension records the tier it is planned to be proven at, and nothing else. */
type OpenDimensions = Readonly<Partial<Record<CoverageDimension, StoryTier>>>
type NoDimensions = Readonly<Record<string, never>>

type BehaviorCoverageBase = Readonly<{
  behaviorId: DocumentedBehaviorId
  state: BehaviorState
  rationale: string
}>

export type BehaviorCoverage =
  | (BehaviorCoverageBase &
      Readonly<{
        state: 'implemented'
        proven: ProvenDimensions
        missing: NoDimensions
      }>)
  | (BehaviorCoverageBase &
      Readonly<{
        state: 'partial'
        proven: ProvenDimensions
        missing: OpenDimensions
      }>)
  | (BehaviorCoverageBase &
      Readonly<{
        state: 'blocked:missing-implementation' | 'retired'
        proven: NoDimensions
        missing: NoDimensions
      }>)

/** Derived, never declared: what a record requires is what it proves plus what it leaves open. */
export function requiredDimensions(record: BehaviorCoverage): readonly CoverageDimension[] {
  return COVERAGE_DIMENSIONS.filter(
    (dimension) => record.proven[dimension] !== undefined || record.missing[dimension] !== undefined,
  )
}

function recordGap(record: BehaviorCoverage): string | undefined {
  if (record.rationale.trim() === '') return 'blank rationale'
  if (record.state !== 'implemented' && record.state !== 'partial') return undefined
  if (record.state === 'implemented' && requiredDimensions(record).length === 0) return 'missing scenario'
  const unproven = COVERAGE_DIMENSIONS.find((dimension) => record.proven[dimension]?.scenarioIds.length === 0)
  if (unproven !== undefined) return `${unproven} proven with no scenario`
  if (!requiredDimensions(record).includes('primary')) return 'missing primary dimension'
  if (record.state === 'partial' && Object.keys(record.missing).length === 0) {
    return 'partial record with no open dimension'
  }
  return undefined
}

export function coverageGaps(records: readonly BehaviorCoverage[]): readonly string[] {
  return records
    .flatMap((record) => {
      const gap = recordGap(record)
      return gap === undefined ? [] : [`${record.behaviorId}: ${gap}`]
    })
    .toSorted()
}

export function unqualifiedBehaviors(records: readonly BehaviorCoverage[]): readonly DocumentedBehaviorId[] {
  return records
    .filter((record) => record.state === 'partial')
    .map((record) => record.behaviorId)
    .toSorted()
}

/**
 * Catalog cross-check: every scenario a dimension references must exist in the
 * catalog as an executable record, and its catalog proving tier must equal the
 * tier *that dimension* declares, so a dimension can never point at a pending
 * gap or claim a tier the evidence does not run at.
 */
export function scenarioReferenceGaps(records: readonly BehaviorCoverage[]): readonly string[] {
  const executableTierByScenario = new Map<CatalogScenarioId, StoryTier>(
    catalogCoverage
      .filter((coverage) => coverage.kind === 'executable')
      .map((coverage) => [coverage.scenarioId, coverage.provingTier]),
  )
  return records
    .flatMap((record) =>
      COVERAGE_DIMENSIONS.flatMap((dimension) => {
        const proof = record.proven[dimension]
        if (proof === undefined) return []
        return proof.scenarioIds.flatMap((scenarioId) => {
          const prefix = `${record.behaviorId}: ${dimension} cites ${scenarioId}`
          const executableTier = executableTierByScenario.get(scenarioId)
          if (executableTier === undefined) return [`${prefix}, which is not an executable catalog scenario`]
          if (proof.provingTier !== executableTier) {
            return [`${prefix}, which proves at tier ${executableTier}, not declared tier ${proof.provingTier}`]
          }
          return []
        })
      }),
    )
    .toSorted()
}

const BEHAVIOR_COVERAGE_RECORDS: readonly BehaviorCoverage[] = [
  {
    behaviorId: 'thread-scoped-contexts',
    state: 'implemented',
    proven: {
      primary: { provingTier: '0', scenarioIds: ['SCN-context-thread-scope'] },
      'persistence-scope': {
        provingTier: '0',
        scenarioIds: ['SCN-context-thread-scope', 'SCN-chat-interaction-payload'],
      },
    },
    missing: {},
    rationale:
      'The thread-scope story proves group threads share config while isolating history; the Discord interaction story proves Discord contexts resolve to channel scope, not threads.',
  },
  {
    behaviorId: 'scope-model',
    state: 'implemented',
    proven: {
      primary: { provingTier: '0', scenarioIds: ['SCN-context-thread-scope', 'SCN-context-group-identity'] },
      'persistence-scope': {
        provingTier: '0',
        scenarioIds: ['SCN-context-thread-scope', 'SCN-context-group-identity'],
      },
    },
    missing: {},
    rationale:
      'Both context stories prove thread-isolated live state with group-shared durable config and distinct per-user identities.',
  },
  {
    behaviorId: 'settings-only-configuration',
    state: 'implemented',
    proven: {
      primary: { provingTier: '0', scenarioIds: ['SCN-settings-bootstrap', 'SCN-cmd-config-dm'] },
      'authorization-routing': { provingTier: '0', scenarioIds: ['SCN-cmd-config-group'] },
    },
    missing: {},
    rationale:
      'Bootstrap proves first-run configuration lands in the settings UI and the DM story proves the single-use link; the group story proves the redirect that refuses plain members.',
  },
  {
    behaviorId: 'reply-to-bot-routing',
    state: 'partial',
    proven: {},
    missing: { primary: '0', 'authorization-routing': '3' },
    rationale:
      'No executable story sends a group reply to the bot’s own message, so nothing this behavior requires is proven. SCN-chat-message-normalization proves only the standalone-mention boundary this equivalence extends — substrate, not evidence. The Telegram/Discord equivalence and the Mattermost/Kontur exclusion are adapter behavior and are planned at Tier 3; the router-side reply handling is planned at Tier 0.',
  },
  {
    behaviorId: 'identity-provisioning',
    state: 'partial',
    proven: {
      primary: {
        provingTier: '0',
        scenarioIds: ['SCN-task-identity', 'SCN-settings-identity', 'SCN-context-group-identity'],
      },
    },
    missing: { 'authorization-routing': '0', 'persistence-scope': '0' },
    rationale:
      'Group-turn member provisioning and settings-saved identity resolution are proven; the placeholder pending-entry rebind on first DM, open_dm_access auto-provisioning and durable blocks, and the strict 422 group-add path have no story.',
  },
  {
    behaviorId: 'guest-readonly',
    state: 'implemented',
    proven: {
      primary: { provingTier: '0', scenarioIds: ['SCN-task-guest-readonly'] },
      'authorization-routing': {
        provingTier: '0',
        scenarioIds: ['SCN-coding-acp-guest-denied', 'SCN-settings-api-group'],
      },
    },
    missing: {},
    rationale:
      'The guest group turn proves the hardcoded read-only toolset; the ACP denial and the admin-only group guest-mode toggle prove the authorization boundary.',
  },
  {
    behaviorId: 'alert-edge-triggering',
    state: 'partial',
    proven: {
      primary: { provingTier: '0', scenarioIds: ['SCN-deferred-alert-create', 'SCN-deferred-fire-alert'] },
    },
    missing: { 'failure-recovery': '0', 'persistence-scope': '0' },
    rationale:
      'Alert creation and an overdue-task fire are proven; the stored match-set edge transitions, leave/re-entry semantics, cooldown, and the migration-069 first-cycle empty-set behavior have no story.',
  },
  {
    behaviorId: 'repo-catalogue',
    state: 'implemented',
    proven: {
      primary: { provingTier: '0', scenarioIds: ['SCN-coding-acp-list-projects'] },
      'persistence-scope': { provingTier: '0', scenarioIds: ['SCN-settings-coding-repos'] },
      'external-boundary': { provingTier: '0', scenarioIds: ['SCN-coding-acp-self-hosted-forge-preflight'] },
    },
    missing: {},
    rationale:
      'The catalogue is listed without Magi, a settings-registered repo is persisted and startable, and the self-hosted preflight fails closed without forge settings.',
  },
  {
    behaviorId: 'release-announcements',
    state: 'partial',
    proven: {
      primary: {
        provingTier: '0',
        scenarioIds: ['SCN-announcement-delivery-fanout', 'SCN-changelog-version-section'],
      },
      'authorization-routing': { provingTier: '0', scenarioIds: ['SCN-settings-api-release'] },
    },
    missing: { 'external-boundary': '0' },
    rationale:
      'Delivery fan-out accounting and changelog-section extraction are proven, as are the admin-only release-subscription toggles; the humanize-once central-LLM draft, the admin review notice, and the broadcast route have no story.',
  },
  {
    behaviorId: 'mid-run-control',
    state: 'partial',
    proven: {
      primary: {
        provingTier: '0',
        scenarioIds: ['SCN-cmd-stop-noop', 'SCN-cmd-stop-graceful', 'SCN-cmd-stop-abort'],
      },
    },
    missing: { 'authorization-routing': '0', 'failure-recovery': '0' },
    rationale:
      'The /stop ladder (noop, graceful wind-down, force-abort) is proven; mid-run steering injection at the tool-step boundary (mid-turn-run-control seam) and honest partial side-effect reporting have no story.',
  },
  {
    behaviorId: 'live-status',
    state: 'partial',
    proven: {
      primary: { provingTier: '2', scenarioIds: ['SCN-chat-turn-tool-loop'] },
      'external-boundary': { provingTier: '2', scenarioIds: ['SCN-chat-turn-tool-loop'] },
    },
    missing: { 'failure-recovery': '0' },
    rationale:
      'The process-real smoke turn observes the ephemeral status post and its edit/delete lifecycle at the real Mattermost boundary, which only Tier 2 can do; the placeholder freeze/dismiss ordering, minLabelMs hold, per-tool labels, and the error-path dismiss guarantee are hermetic and are planned at Tier 0.',
  },
  {
    behaviorId: 'chat-participant-resolution',
    state: 'implemented',
    proven: {
      primary: {
        provingTier: '0',
        scenarioIds: ['SCN-chat-participant-ranking', 'SCN-chat-participant-label-fallback'],
      },
      'authorization-routing': { provingTier: '0', scenarioIds: ['SCN-chat-participant-dm-absent'] },
    },
    missing: {},
    rationale:
      'The ranking story proves the group_members ∪ message_metadata union, exact > prefix > substring ordering, and the resolved id reaching delivery.mention_user_ids on a persisted group reminder; the fallback story proves an unresolvable and a throwing label both degrade to the identifier without failing the turn. authorization-routing closes on its one denial surface reachable from production wiring — a non-group context withholds the tool — since the other two conjuncts of the registration gate (a defined resolver, a defined contextId) are always satisfied by production wiring and only defensive elsewhere.',
  },
  {
    behaviorId: 'privacy-gated-analytics',
    state: 'partial',
    proven: {
      primary: {
        provingTier: '0',
        scenarioIds: [
          'SCN-analytics-governed-turn',
          'SCN-analytics-subject-rights',
          'SCN-analytics-derived-materialization',
          'SCN-stats-anonymity',
        ],
      },
      'authorization-routing': {
        provingTier: '0',
        scenarioIds: ['SCN-analytics-consent-grant', 'SCN-settings-admin-analytics'],
      },
    },
    missing: { 'persistence-scope': '0', 'external-boundary': '0' },
    rationale:
      'A governed turn records one epoch-bound aggregate with the kill switch fail-closed, the subject can export, withdraw, and delete the resulting record, the derive job materializes sessions, friction, and feature days from those events, and stats omit raw identity; consent through settings grants the collection ref the pseudonymous lane needs and the operator reviews policy through settings. The Metabase snapshot pipeline and the external egress lanes have no story.',
  },
]

function assertValidLedger(records: readonly BehaviorCoverage[]): void {
  const ids = records.map(({ behaviorId }) => behaviorId)
  if (new Set(ids).size !== ids.length || ids.length !== DOCUMENTED_BEHAVIOR_IDS.length) {
    throw new Error('Behavior coverage ledger must carry exactly one record per documented behavior')
  }
  const structuralGaps = coverageGaps(records)
  if (structuralGaps.length > 0) throw new Error(`Invalid behavior coverage ledger: ${structuralGaps.join('; ')}`)
  const referenceGaps = scenarioReferenceGaps(records)
  if (referenceGaps.length > 0) throw new Error(`Invalid behavior scenario references: ${referenceGaps.join('; ')}`)
}

assertValidLedger(BEHAVIOR_COVERAGE_RECORDS)

export const BEHAVIOR_COVERAGE: readonly BehaviorCoverage[] = Object.freeze(
  BEHAVIOR_COVERAGE_RECORDS.map((record) => Object.freeze(record)),
)
