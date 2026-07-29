// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import nodePath from 'node:path'

import { loadCandidateStoryFiles } from '../../../scripts/story/inputs.js'
import { extractStoryScenarios } from '../../../scripts/story/scenarios.js'
import {
  AUDIT_RECORDS,
  CATALOG_SCENARIO_IDS,
  catalogCoverage,
  LIVE_STORY_TIERS,
  PHASE3_UNCATALOGUED_CLUSTER_IDS,
  STORY_FAMILIES,
  STORY_SEAM_IDS,
  STORY_TIERS,
  TIER_SUITE_ROOTS,
  toPendingReason,
  type StoryFamily,
  type StorySeamId,
} from '../catalog/coverage.js'
import { PARITY_GROUPS } from './parity/expectations.js'

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort()
}

function isNeitherIdSet(scenarioId: string, firstIds: ReadonlySet<string>, secondIds: ReadonlySet<string>): boolean {
  return !firstIds.has(scenarioId) && !secondIds.has(scenarioId)
}

function isCensusScenarioId(scenarioId: string): boolean {
  return scenarioId.startsWith('SCN-settings-api-') || scenarioId === 'SCN-settings-task-instance-assignment'
}

function resolveStoryContractRoot(harnessDirectory: string): string {
  return nodePath.resolve(harnessDirectory, '../../..')
}

const ACP_COMMAND_STORY_ID =
  'tests/stories/integrations/runtime-extensions/command-prompt.story.test.ts#SCN-coding-acp-command: eligible and ineligible runtime extension command and prompt'

const ACP_CATALOG_STORY_IDS = {
  'SCN-coding-acp-start-fresh':
    'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-start-fresh: starts a configured session through the real ACP tool loop',
  'SCN-coding-acp-start-on-pr':
    'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-start-on-pr: starts a configured session with PR and forge token',
  'SCN-coding-acp-cautious-permission-roundtrip':
    'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-cautious-permission-roundtrip: resolves matching cautious decisions and leaves empty queues untouched',
  'SCN-coding-acp-list-sessions':
    'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-sessions: returns only sessions known to this chat',
  'SCN-coding-acp-session-status':
    'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-session-status: preserves a declared missing-session response without local mutation',
  'SCN-coding-acp-list-projects':
    'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-projects: lists the local repository catalogue without Magi',
  'SCN-coding-acp-list-agents':
    'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-agents: gets available agents through guarded Magi HTTP',
  'SCN-coding-acp-finish-push':
    'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-finish-push: pushes with the exact requested finish payload',
  'SCN-coding-acp-finish-pr':
    'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-finish-pr: opens a PR with the exact requested title and body',
  'SCN-coding-acp-cancel':
    'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-cancel: cancels exactly the selected coding session',
  'SCN-coding-acp-continue-followup':
    'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-continue-followup: continues a locally known session and records its child',
  'SCN-coding-acp-continue-by-pr':
    'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-continue-by-pr: follows up only the locally known matching PR session',
  'SCN-coding-acp-mcp-session':
    'tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#SCN-coding-acp-mcp-session: starts a session with an exact configured MCP upstream and credential map',
  'SCN-coding-acp-not-configured':
    'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-not-configured: refuses an unconfigured start without creating a session',
  'SCN-coding-acp-self-hosted-forge-preflight':
    'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-self-hosted-forge-preflight: refuses a self-hosted repository without forge settings',
  'SCN-coding-acp-whomayuse-denied':
    'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-whomayuse-denied: hides session start from an operator-denied member',
  'SCN-coding-acp-guest-denied':
    'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-guest-denied: hides session start from a guest group turn',
  'SCN-coding-acp-command': ACP_COMMAND_STORY_ID,
  'SCN-coding-acp-mcp-fail-closed':
    'tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#an unresolved MCP selection fails closed before Magi session startup',
  'SCN-coding-acp-upstream-failure':
    'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#configured ACP upstream failure does not persist a session or expose credentials',
  'SCN-coding-acp-tool-eligibility':
    'tests/stories/integrations/runtime-extensions/tool-eligibility.story.test.ts#runtime extension ACP tool is offered and executed only in its eligible context',
} as const

const pendingCoverage = catalogCoverage.filter((coverage) => coverage.kind === 'pending')

const phase3UncataloguedClusterIdSet: ReadonlySet<string> = new Set(PHASE3_UNCATALOGUED_CLUSTER_IDS)

const auditSeams = (coverage: (typeof catalogCoverage)[number]): readonly StorySeamId[] =>
  coverage.kind === 'pending' && coverage.audit.readiness.state === 'needs-seam' ? coverage.audit.readiness.seams : []

function pendingNeedsSeamTierProjections(coverage: readonly (typeof catalogCoverage)[number][]): readonly string[] {
  return coverage.flatMap((entry) => {
    if (entry.kind !== 'pending' || entry.audit.readiness.state !== 'needs-seam') return []
    return [`${entry.scenarioId}@${entry.audit.readiness.unblockedByTier}`]
  })
}

const FAMILY_QUEUE_EXPECTATIONS: ReadonlyArray<readonly [string, StoryFamily]> = [
  ['SCN-meta-', 'F1'],
  ['SCN-cmd-', 'F1'],
  ['SCN-task-', 'F2'],
  ['SCN-memory-', 'F3'],
  ['SCN-memo-', 'F3'],
  ['SCN-instructions-', 'F3'],
  ['SCN-history-', 'F3'],
  ['SCN-fetch-', 'F3'],
  ['SCN-http-mcp-plugin', 'F7'],
  ['SCN-http-', 'F4'],
  ['SCN-deferred-', 'F5'],
  ['SCN-reminder-', 'F5'],
  ['SCN-web-fetch', 'F6'],
  ['SCN-settings-admin-mcp-', 'F7'],
  ['SCN-queue-', 'F1'],
  ['SCN-attachments-', 'F2'],
  ['SCN-byok-', 'F1'],
  ['SCN-message-cache-', 'F3'],
  ['SCN-usage-', 'F4'],
  ['SCN-announcement-', 'F1'],
  ['SCN-stats-', 'F4'],
  ['SCN-scheduler-', 'F5'],
  ['SCN-changelog-', 'F1'],
  ['SCN-plugin-', 'F7'],
  ['SCN-interaction-', 'F8'],
  ['SCN-coding-nerv-', 'unqueued'],
  ['SCN-supervise-', 'unqueued'],
]

const familyQueueMismatches = pendingCoverage.flatMap((coverage) => {
  const expectation = FAMILY_QUEUE_EXPECTATIONS.find(([prefix]) => coverage.scenarioId.startsWith(prefix))
  return expectation === undefined || coverage.audit.family !== expectation[1] ? [coverage.scenarioId] : []
})

describe('scenario catalog coverage', () => {
  test('resolves the repository root from a nested harness snapshot path', () => {
    expect(resolveStoryContractRoot('/tmp/story-snapshot/tests/stories/harness')).toBe('/tmp/story-snapshot')
  })

  test('classifies every catalog scenario exactly once', () => {
    const ledgerIds = catalogCoverage.map(({ scenarioId }) => scenarioId)

    expect(CATALOG_SCENARIO_IDS).toHaveLength(215)
    expect(new Set(CATALOG_SCENARIO_IDS).size).toBe(215)
    expect(sorted(ledgerIds)).toEqual(sorted(CATALOG_SCENARIO_IDS))
  })

  test('catalogs every Phase 3 uncatalogued behavior as a pending gap at its lowest proving tier', () => {
    expect(PHASE3_UNCATALOGUED_CLUSTER_IDS).toEqual([
      'SCN-memory-tool-pairing',
      'SCN-queue-coalescing',
      'SCN-queue-group-serialization',
      'SCN-attachments-staged-scope-search',
      'SCN-attachments-staged-resolution',
      'SCN-byok-context-credentials',
      'SCN-byok-unreadable-credentials',
      'SCN-message-cache-persistence',
      'SCN-usage-accounting',
      'SCN-announcement-delivery-fanout',
      'SCN-stats-anonymity',
      'SCN-stats-aggregate-window',
      'SCN-scheduler-execution-tracking',
      'SCN-changelog-version-section',
      'SCN-interaction-discord-command-routing',
      'SCN-interaction-discord-format-chunking',
      'SCN-interaction-discord-response-lifecycle',
      'SCN-interaction-kontur-reply-formatting',
      'SCN-interaction-telegram-admin-authorization',
      'SCN-deferred-poller-lifecycle',
      'SCN-plugin-deny-gating',
    ])

    const phase3Coverage = catalogCoverage.filter(({ scenarioId }) => phase3UncataloguedClusterIdSet.has(scenarioId))
    expect(phase3Coverage).toHaveLength(21)
    expect(phase3Coverage.every(({ catalogStatus }) => catalogStatus === 'gap')).toBe(true)
    expect(phase3Coverage.every(({ kind }) => kind === 'pending')).toBe(true)
  })

  test('marks only platform-adapter interaction scenarios as forward-only', () => {
    const interactionCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-interaction-'))

    expect(interactionCoverage).toHaveLength(9)
    expect(interactionCoverage.map(({ catalogStatus }) => catalogStatus)).toEqual([
      'forward-only',
      'forward-only',
      'forward-only',
      'confirmed',
      'gap',
      'gap',
      'gap',
      'gap',
      'gap',
    ])
    expect(
      interactionCoverage.find(({ scenarioId }) => scenarioId === 'SCN-interaction-permission-decision')?.kind,
    ).toBe('executable')
  })

  test('maps the ACP command catalog record to its eligible and ineligible command story', () => {
    expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-coding-acp-command')).toEqual({
      scenarioId: 'SCN-coding-acp-command',
      catalogStatus: 'confirmed',
      kind: 'executable',
      provingTier: '0',
      verifiedAt: '2026-07-13',
      storyIds: [ACP_COMMAND_STORY_ID],
    })
  })

  test('maps every ACP catalog record to its literal executable story', () => {
    const acpCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-coding-acp-'))
    const executableAcpCoverage = acpCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )

    expect(acpCoverage).toHaveLength(21)
    expect(executableAcpCoverage).toHaveLength(21)
    expect(
      Object.fromEntries(executableAcpCoverage.map(({ scenarioId, storyIds }) => [scenarioId, storyIds[0]])),
    ).toEqual(ACP_CATALOG_STORY_IDS)
  })

  test('rejects blank pending reasons at the ledger boundary', () => {
    expect(() => toPendingReason('   ')).toThrow('Pending reason must not be empty')
    expect(toPendingReason('  branch audit required  ').toString()).toBe('branch audit required')
  })

  test('keeps pending reasons and executable references accountable to local literal stories', async () => {
    const candidateFiles = await loadCandidateStoryFiles(resolveStoryContractRoot(import.meta.dir))
    const extractedStoryIds = new Set(
      candidateFiles.flatMap(({ path, bytes }) => extractStoryScenarios(path, bytes).map(({ id }) => id)),
    )
    // `loadCandidateStoryFiles` only walks the frozen `tests/stories/` tree (Tier 0's suite
    // root), so this literal-story check is scoped to Tier 0 executable records; other live
    // tiers (e.g. Tier 1's `tests/e2e/`) prove their storyIds in their own suite, not here.
    const executableCoverage = catalogCoverage
      .filter((coverage) => coverage.kind === 'executable')
      .filter((coverage) => coverage.provingTier === '0')

    for (const coverage of pendingCoverage) expect(coverage.audit.rationale.toString().trim().length).toBeGreaterThan(0)

    const executableReferences = executableCoverage.flatMap((coverage) => {
      expect(coverage.storyIds.length).toBeGreaterThanOrEqual(1)
      for (const storyId of coverage.storyIds) {
        expect(extractedStoryIds.has(storyId)).toBe(true)
      }
      return coverage.storyIds
    })

    expect(new Set(executableReferences).size).toBe(executableReferences.length)
  })

  test('stamps settings catalog records with their verification date', () => {
    const settingsCoverage = catalogCoverage
      .filter((coverage) => coverage.kind === 'executable')
      .filter((coverage) => coverage.scenarioId.startsWith('SCN-settings-'))
    const mcpScenarioIds = new Set(['SCN-settings-admin-mcp-catalog', 'SCN-settings-admin-mcp-plugin-servers'])
    const censusScenarioIds = new Set(
      settingsCoverage.map(({ scenarioId }) => scenarioId).filter((scenarioId) => isCensusScenarioId(scenarioId)),
    )
    const mcpCoverage = settingsCoverage.filter((coverage) => mcpScenarioIds.has(coverage.scenarioId))
    const censusCoverage = settingsCoverage.filter((coverage) => censusScenarioIds.has(coverage.scenarioId))
    const otherCoverage = settingsCoverage.filter((coverage) =>
      isNeitherIdSet(coverage.scenarioId, mcpScenarioIds, censusScenarioIds),
    )

    expect(settingsCoverage).toHaveLength(21)
    expect(censusCoverage).toHaveLength(8)
    for (const coverage of mcpCoverage) expect(coverage.verifiedAt).toBe('2026-07-22')
    for (const coverage of censusCoverage) expect(coverage.verifiedAt).toBe('2026-07-28')
    for (const coverage of otherCoverage) expect(coverage.verifiedAt).toBe('2026-07-18')
  })

  test('maps the guest-readonly catalog record to its executable story', () => {
    expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-task-guest-readonly')).toEqual({
      scenarioId: 'SCN-task-guest-readonly',
      catalogStatus: 'confirmed',
      kind: 'executable',
      provingTier: '0',
      verifiedAt: '2026-07-19',
      storyIds: [
        'tests/stories/context/guest-readonly.story.test.ts#guest group turns can read tasks but cannot advertise writes',
      ],
    })
  })

  test('tracks the executable coverage total', () => {
    expect(catalogCoverage.filter((coverage) => coverage.kind === 'executable')).toHaveLength(167)
  })

  test('stamps every executable record with a live proving tier', () => {
    const executable = catalogCoverage.filter((coverage) => coverage.kind === 'executable')
    const offLaneTiers = executable
      .filter((coverage) => !LIVE_STORY_TIERS.includes(coverage.provingTier))
      .map(({ scenarioId, provingTier }) => `${scenarioId} -> T${provingTier}`)

    expect(executable).toHaveLength(167)
    expect(offLaneTiers).toEqual([])
    expect(new Set(executable.map((coverage) => coverage.provingTier))).toEqual(new Set(['0', '1', '2', '3']))
  })

  test('maps every @1 parity record to its exact parity story title', () => {
    // Both the catalog storyIds and the parity e2e test names derive from
    // PARITY_GROUPS[].title, but the catalog strings are hand-transcribed — this
    // is the only automated guard that a @1 storyId title matches its real test
    // (the local-literal-stories check above is Tier-0-only; the Docker lane never
    // reads the catalog). Two chained filters: inferred type predicates need them.
    const parityRecords = catalogCoverage
      .filter((coverage) => coverage.kind === 'executable')
      .filter((coverage) => coverage.provingTier === '1')
    expect(parityRecords).toHaveLength(PARITY_GROUPS.length)
    const storyIdsByScenario = new Map<string, readonly string[]>(
      parityRecords.map((coverage) => [coverage.scenarioId, coverage.storyIds]),
    )
    for (const group of PARITY_GROUPS) {
      expect(storyIdsByScenario.get(group.id)).toEqual([`tests/e2e/parity/provider-parity.test.ts#${group.title}`])
    }
  })

  test('gives every tier a distinct suite root', () => {
    const roots = STORY_TIERS.map((tier) => TIER_SUITE_ROOTS[tier])

    expect(new Set(roots).size).toBe(STORY_TIERS.length)
    expect(TIER_SUITE_ROOTS['0']).toBe('tests/stories/')
    expect(TIER_SUITE_ROOTS['1']).toBe('tests/e2e/')
  })

  test('keeps every executable story under its own tier suite root', () => {
    const executableCoverage = catalogCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )
    const misplaced = executableCoverage.flatMap((coverage) =>
      coverage.storyIds
        .filter((storyId) => !storyId.startsWith(TIER_SUITE_ROOTS[coverage.provingTier]))
        .map((storyId) => `T${coverage.provingTier} ${coverage.scenarioId} -> ${storyId}`),
    )

    expect(misplaced).toEqual([])
  })

  test('promotes command scenarios from blanket forward-only to confirmed', () => {
    const commandCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-cmd-'))

    expect(commandCoverage).toHaveLength(16)
    const statuses = commandCoverage.map(({ catalogStatus }) => catalogStatus)
    expect(statuses.filter((status) => status === 'confirmed')).toHaveLength(15)
    expect(commandCoverage.find(({ scenarioId }) => scenarioId === 'SCN-cmd-announce')?.catalogStatus).toBe('gap')
  })

  test('maps the context core stories to their catalog records', () => {
    expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-context-thread-scope')).toEqual({
      scenarioId: 'SCN-context-thread-scope',
      catalogStatus: 'confirmed',
      kind: 'executable',
      provingTier: '0',
      verifiedAt: '2026-07-19',
      storyIds: [
        'tests/stories/context/thread-scope.story.test.ts#group threads share config but isolate conversation history',
      ],
    })
    expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-context-group-identity')).toEqual({
      scenarioId: 'SCN-context-group-identity',
      catalogStatus: 'confirmed',
      kind: 'executable',
      provingTier: '0',
      verifiedAt: '2026-07-19',
      storyIds: [
        'tests/stories/context/group-users.story.test.ts#group members share durable config while retaining distinct identities',
      ],
    })
  })

  test('audit records cover exactly the pending scenarios', () => {
    const pendingIds = pendingCoverage.map(({ scenarioId }) => scenarioId)

    expect(pendingIds).toHaveLength(46)
    expect(sorted(Object.keys(AUDIT_RECORDS))).toEqual(sorted(pendingIds))
  })

  test('records a non-blank rationale and a known family for every pending scenario', () => {
    const blankRationales = pendingCoverage
      .filter((coverage) => coverage.audit.rationale.toString().trim().length === 0)
      .map(({ scenarioId }) => scenarioId)
    const unknownFamilies = pendingCoverage
      .filter((coverage) => !STORY_FAMILIES.includes(coverage.audit.family))
      .map(({ scenarioId }) => scenarioId)

    expect(blankRationales).toEqual([])
    expect(unknownFamilies).toEqual([])
  })

  test('references only known seams', () => {
    const unknownSeams = pendingCoverage.flatMap((coverage) =>
      auditSeams(coverage)
        .filter((seam) => !STORY_SEAM_IDS.includes(seam))
        .map((seam) => `${coverage.scenarioId} -> ${seam}`),
    )

    expect(unknownSeams).toEqual([])
  })

  test('names the tier that unblocks every seam-pending scenario', () => {
    const seamPendingByTier = pendingNeedsSeamTierProjections(pendingCoverage)
    expect(seamPendingByTier.toSorted()).toEqual([
      'SCN-deferred-poller-lifecycle@4',
      'SCN-interaction-discord-command-routing@3',
      'SCN-interaction-discord-format-chunking@3',
      'SCN-interaction-discord-response-lifecycle@3',
      'SCN-interaction-discord-router-wrapped@3',
      'SCN-interaction-discord-standalone-fallback@3',
      'SCN-interaction-kontur-reply-formatting@3',
      'SCN-interaction-telegram-admin-authorization@3',
      'SCN-interaction-telegram-callback@3',
    ])
  })

  test('audit readiness totals match the audit outcome', () => {
    const states = pendingCoverage.map((coverage) => coverage.audit.readiness.state)

    expect(states.filter((state) => state === 'executable-as-is')).toHaveLength(15)
    expect(states.filter((state) => state === 'needs-seam')).toHaveLength(9)
    expect(states.filter((state) => state === 'blocked')).toHaveLength(22)
  })

  test('assigns every pending scenario to its family queue', () => {
    expect(familyQueueMismatches).toEqual([])
  })
})
