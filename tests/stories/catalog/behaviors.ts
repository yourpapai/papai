// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Canonical behavior ledger: one record per documented behavior inventory ID
 * (`docs/architecture/behaviors.md` anchors), cross-checked against the scenario
 * catalog. An `implemented` record claims its full required-dimension matrix is
 * proven by executable catalog scenarios at the declared proving tier. A
 * `partial` record is implemented in production but matrix-incomplete: it keeps
 * its real executable scenario references and names the unproven required
 * dimensions in `missing`, so it stays structurally accountable while
 * `unqualifiedBehaviors()` bars it from global-refactor qualification until a
 * follow-on plan proves the missing dimensions and flips the record.
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

type BehaviorCoverageBase = Readonly<{
  behaviorId: DocumentedBehaviorId
  state: BehaviorState
  required: readonly CoverageDimension[]
  rationale: string
}>

export type BehaviorCoverage =
  | (BehaviorCoverageBase &
      Readonly<{
        state: 'implemented'
        provingTier: StoryTier
        scenarioIds: readonly CatalogScenarioId[]
        missing: readonly []
      }>)
  | (BehaviorCoverageBase &
      Readonly<{
        state: 'partial'
        provingTier: StoryTier
        scenarioIds: readonly CatalogScenarioId[]
        missing: readonly [CoverageDimension, ...CoverageDimension[]]
      }>)
  | (BehaviorCoverageBase &
      Readonly<{
        state: 'blocked:missing-implementation' | 'retired'
        provingTier: null
        scenarioIds: readonly []
        missing: readonly []
      }>)

export function coverageGaps(records: readonly BehaviorCoverage[]): readonly string[] {
  return records
    .flatMap((record) => {
      if (record.rationale.trim() === '') return [`${record.behaviorId}: blank rationale`]
      if (record.state === 'implemented' || record.state === 'partial') {
        if (!record.required.includes('primary')) return [`${record.behaviorId}: missing primary dimension`]
        if (record.scenarioIds.length === 0) return [`${record.behaviorId}: missing scenario`]
      }
      return []
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
 * Catalog cross-check: every scenario a ledger record references must exist in
 * the catalog as an executable record, and its catalog proving tier must equal
 * the tier the ledger record declares, so a ledger entry can never point at a
 * pending gap or claim a tier the evidence does not run at.
 */
export function scenarioReferenceGaps(records: readonly BehaviorCoverage[]): readonly string[] {
  const executableTierByScenario = new Map<CatalogScenarioId, StoryTier>(
    catalogCoverage
      .filter((coverage) => coverage.kind === 'executable')
      .map((coverage) => [coverage.scenarioId, coverage.provingTier]),
  )
  return records
    .flatMap((record) =>
      record.scenarioIds.flatMap((scenarioId) => {
        const executableTier = executableTierByScenario.get(scenarioId)
        if (executableTier === undefined)
          return [`${record.behaviorId}: ${scenarioId} is not an executable catalog scenario`]
        if (record.provingTier !== executableTier) {
          return [
            `${record.behaviorId}: ${scenarioId} proves at tier ${executableTier}, not declared tier ${record.provingTier}`,
          ]
        }
        return []
      }),
    )
    .toSorted()
}

const BEHAVIOR_COVERAGE_RECORDS: readonly BehaviorCoverage[] = [
  {
    behaviorId: 'thread-scoped-contexts',
    state: 'implemented',
    provingTier: '0',
    scenarioIds: ['SCN-context-thread-scope', 'SCN-chat-interaction-payload'],
    required: ['primary', 'persistence-scope'],
    missing: [],
    rationale:
      'The thread-scope story proves group threads share config while isolating history; the Discord interaction story proves Discord contexts resolve to channel scope, not threads.',
  },
  {
    behaviorId: 'scope-model',
    state: 'implemented',
    provingTier: '0',
    scenarioIds: ['SCN-context-thread-scope', 'SCN-context-group-identity'],
    required: ['primary', 'persistence-scope'],
    missing: [],
    rationale:
      'Both context stories prove thread-isolated live state with group-shared durable config and distinct per-user identities.',
  },
  {
    behaviorId: 'settings-only-configuration',
    state: 'implemented',
    provingTier: '0',
    scenarioIds: ['SCN-settings-bootstrap', 'SCN-cmd-config-dm', 'SCN-cmd-config-group'],
    required: ['primary', 'authorization-routing'],
    missing: [],
    rationale:
      'Bootstrap proves first-run configuration lands in the settings UI; the /config stories prove the DM single-use link and the group redirect that refuses plain members.',
  },
  {
    behaviorId: 'reply-to-bot-routing',
    state: 'partial',
    provingTier: '0',
    scenarioIds: ['SCN-chat-message-normalization'],
    required: ['primary', 'authorization-routing'],
    missing: ['primary', 'authorization-routing'],
    rationale:
      'The normalization story proves only the standalone-mention boundary this equivalence extends; no executable story sends a group reply to the bot’s own message, so the Telegram/Discord equivalence and the Mattermost/Kontur exclusion are unproven.',
  },
  {
    behaviorId: 'identity-provisioning',
    state: 'partial',
    provingTier: '0',
    scenarioIds: ['SCN-task-identity', 'SCN-settings-identity', 'SCN-context-group-identity'],
    required: ['primary', 'authorization-routing', 'persistence-scope'],
    missing: ['authorization-routing', 'persistence-scope'],
    rationale:
      'Group-turn member provisioning and settings-saved identity resolution are proven; the placeholder pending-entry rebind on first DM, open_dm_access auto-provisioning and durable blocks, and the strict 422 group-add path have no story.',
  },
  {
    behaviorId: 'guest-readonly',
    state: 'implemented',
    provingTier: '0',
    scenarioIds: ['SCN-task-guest-readonly', 'SCN-coding-acp-guest-denied', 'SCN-settings-api-group'],
    required: ['primary', 'authorization-routing'],
    missing: [],
    rationale:
      'Guest group turns prove the hardcoded read-only toolset, the ACP guest denial, and the admin-only group guest-mode toggle.',
  },
  {
    behaviorId: 'alert-edge-triggering',
    state: 'partial',
    provingTier: '0',
    scenarioIds: ['SCN-deferred-alert-create', 'SCN-deferred-fire-alert'],
    required: ['primary', 'persistence-scope', 'failure-recovery'],
    missing: ['persistence-scope', 'failure-recovery'],
    rationale:
      'Alert creation and an overdue-task fire are proven; the stored match-set edge transitions, leave/re-entry semantics, cooldown, and the migration-069 first-cycle empty-set behavior have no story.',
  },
  {
    behaviorId: 'repo-catalogue',
    state: 'implemented',
    provingTier: '0',
    scenarioIds: [
      'SCN-coding-acp-list-projects',
      'SCN-settings-coding-repos',
      'SCN-coding-acp-self-hosted-forge-preflight',
    ],
    required: ['primary', 'persistence-scope', 'external-boundary'],
    missing: [],
    rationale:
      'The catalogue is listed without Magi, a settings-registered repo is persisted and startable, and the self-hosted preflight fails closed without forge settings.',
  },
  {
    behaviorId: 'release-announcements',
    state: 'partial',
    provingTier: '0',
    scenarioIds: ['SCN-announcement-delivery-fanout', 'SCN-settings-api-release', 'SCN-changelog-version-section'],
    required: ['primary', 'authorization-routing', 'external-boundary'],
    missing: ['external-boundary'],
    rationale:
      'Delivery fan-out accounting, admin-only release-subscription toggles, and changelog-section extraction are proven; the humanize-once central-LLM draft, the admin review notice, and the broadcast route have no story.',
  },
  {
    behaviorId: 'mid-run-control',
    state: 'partial',
    provingTier: '0',
    scenarioIds: ['SCN-cmd-stop-noop', 'SCN-cmd-stop-graceful', 'SCN-cmd-stop-abort'],
    required: ['primary', 'authorization-routing', 'failure-recovery'],
    missing: ['authorization-routing', 'failure-recovery'],
    rationale:
      'The /stop ladder (noop, graceful wind-down, force-abort) is proven; mid-run steering injection at the tool-step boundary (mid-turn-run-control seam) and honest partial side-effect reporting have no story.',
  },
  {
    behaviorId: 'live-status',
    state: 'partial',
    provingTier: '2',
    scenarioIds: ['SCN-chat-turn-tool-loop'],
    required: ['primary', 'external-boundary', 'failure-recovery'],
    missing: ['failure-recovery'],
    rationale:
      'The process-real smoke turn observes the ephemeral status post and its edit/delete lifecycle at the real Mattermost boundary; the placeholder freeze/dismiss ordering, minLabelMs hold, per-tool labels, and the error-path dismiss guarantee have no story.',
  },
  {
    behaviorId: 'chat-participant-resolution',
    state: 'partial',
    provingTier: '0',
    scenarioIds: ['SCN-context-group-identity'],
    required: ['primary', 'authorization-routing'],
    missing: ['primary', 'authorization-routing'],
    rationale:
      'The group-identity story proves only the member-roster substrate the resolver queries; the resolve_chat_participant tool registration, fuzzy ranking, label resolution, and delivery.mention_user_ids population have no story.',
  },
  {
    behaviorId: 'privacy-gated-analytics',
    state: 'partial',
    provingTier: '0',
    scenarioIds: [
      'SCN-analytics-governed-turn',
      'SCN-analytics-consent-grant',
      'SCN-analytics-subject-rights',
      'SCN-settings-admin-analytics',
      'SCN-stats-anonymity',
    ],
    required: ['primary', 'authorization-routing', 'persistence-scope', 'external-boundary'],
    missing: ['persistence-scope', 'external-boundary'],
    rationale:
      'A governed turn records one epoch-bound aggregate with the kill switch fail-closed, consent through settings grants the collection ref the pseudonymous lane needs and the subject can export, withdraw, and delete the resulting record, the operator reviews policy through settings, and stats omit raw identity; derive jobs, the Metabase snapshot pipeline, and the external egress lanes have no story.',
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
