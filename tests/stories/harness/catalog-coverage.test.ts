// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import nodePath from 'node:path'

import { loadCandidateStoryFiles } from '../../../scripts/story-manifest-candidate.js'
import { extractStoryScenarios } from '../../../scripts/story-manifest-scenarios.js'
import { CATALOG_SCENARIO_IDS, catalogCoverage, toPendingReason } from '../catalog/coverage.js'

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort()
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
} as const

describe('scenario catalog coverage', () => {
  test('resolves the repository root from a nested harness snapshot path', () => {
    expect(resolveStoryContractRoot('/tmp/story-snapshot/tests/stories/harness')).toBe('/tmp/story-snapshot')
  })

  test('classifies every catalog scenario exactly once', () => {
    const ledgerIds = catalogCoverage.map(({ scenarioId }) => scenarioId)

    expect(CATALOG_SCENARIO_IDS).toHaveLength(126)
    expect(new Set(CATALOG_SCENARIO_IDS).size).toBe(126)
    expect(sorted(ledgerIds)).toEqual(sorted(CATALOG_SCENARIO_IDS))
  })

  test('marks interaction scenarios as forward-only', () => {
    const interactionCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-interaction-'))

    expect(interactionCoverage).toHaveLength(4)
    expect(interactionCoverage.map(({ catalogStatus }) => catalogStatus)).toEqual([
      'forward-only',
      'forward-only',
      'forward-only',
      'forward-only',
    ])
  })

  test('maps the ACP command catalog record to its eligible and ineligible command story', () => {
    expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-coding-acp-command')).toEqual({
      scenarioId: 'SCN-coding-acp-command',
      catalogStatus: 'confirmed',
      kind: 'executable',
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

    expect(acpCoverage).toHaveLength(18)
    expect(executableAcpCoverage).toHaveLength(18)
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
    const pendingCoverage = catalogCoverage.filter((coverage) => coverage.kind === 'pending')
    const executableCoverage = catalogCoverage.filter((coverage) => coverage.kind === 'executable')

    for (const coverage of pendingCoverage) expect(coverage.reason.toString().trim().length).toBeGreaterThan(0)

    const executableReferences = executableCoverage.flatMap((coverage) => {
      expect(coverage.storyIds.length).toBeGreaterThanOrEqual(1)
      for (const storyId of coverage.storyIds) {
        expect(extractedStoryIds.has(storyId)).toBe(true)
      }
      return coverage.storyIds
    })

    expect(new Set(executableReferences).size).toBe(executableReferences.length)
  })
})
