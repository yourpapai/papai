// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { ConsolidatedManifest } from '../../../scripts/behavior-audit/incremental.js'
import type { ScoresFile } from '../../../scripts/behavior-audit/scores-types.js'
import { mockAuditBehaviorConfig } from '../behavior-audit-integration.helpers.js'
import {
  cleanupTempDirs,
  makeTempDir,
  originalOpenAiApiKey,
  restoreBehaviorAuditEnv,
  restoreOpenAiApiKey,
} from '../behavior-audit-integration.runtime-helpers.js'
import { loadReportWriterModule, loadScoresWriterModule } from '../behavior-audit-integration.support.js'

function isScoresFile(value: unknown): value is ScoresFile {
  if (typeof value !== 'object' || value === null) return false
  if (typeof (value as { generatedAt?: unknown }).generatedAt !== 'string') return false
  if (typeof (value as { model?: unknown }).model !== 'string') return false
  if (!Array.isArray((value as { domains?: unknown }).domains)) return false
  return true
}

function parseScoresFile(text: string): ScoresFile {
  const parsed: unknown = JSON.parse(text)
  if (!isScoresFile(parsed)) {
    throw new Error('scores.json payload failed shape guard')
  }
  return parsed
}

interface StoryEvaluationRecord {
  readonly consolidatedId: string
  readonly maria: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly dani: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly viktor: { readonly discover: number; readonly use: number; readonly retain: number; readonly notes: string }
  readonly flaws: readonly string[]
  readonly improvements: readonly string[]
  readonly evaluatedAt: string
}

interface ConsolidatedRecord {
  readonly id: string
  readonly domain: string
  readonly featureName: string
  readonly isUserFacing: boolean
  readonly behavior: string
  readonly userStory: string
  readonly context: string
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalRefs: readonly {
    readonly behaviorId: string
    readonly summary: string
  }[]
  readonly entryPointHints: readonly {
    readonly kind: 'command' | 'tool' | 'handler' | 'route'
    readonly identifier: string
  }[]
  readonly closure: {
    readonly closureStatus: 'resolved' | 'partial' | 'unresolved' | 'unverified'
    readonly entryPoints: readonly {
      readonly kind: 'command' | 'tool' | 'handler' | 'route'
      readonly identifier: string
      readonly resolved: boolean
      readonly evidence: { readonly filePath: string; readonly symbol?: string } | null
    }[]
  } | null
}

beforeEach(() => {
  if (originalOpenAiApiKey === undefined) {
    process.env['OPENAI_API_KEY'] = 'test-openai-api-key'
    return
  }
  process.env['OPENAI_API_KEY'] = originalOpenAiApiKey
})

afterEach(() => {
  restoreBehaviorAuditEnv()
  restoreOpenAiApiKey()
  cleanupTempDirs()
})

interface Fixture {
  readonly root: string
  readonly paths: string
  readonly featureKey: string
  readonly consolidatedId: string
}

async function writeArtifactFiles(
  root: string,
  consolidated: readonly ConsolidatedRecord[],
  evaluated: readonly StoryEvaluationRecord[],
  featureKey: string,
): Promise<Fixture> {
  const paths = path.join(root, 'reports', 'audit-behavior')
  mkdirSync(path.join(paths, 'consolidated'), { recursive: true })
  mkdirSync(path.join(paths, 'evaluated'), { recursive: true })

  await Bun.write(path.join(paths, 'consolidated', `${featureKey}.json`), JSON.stringify(consolidated, null, 2) + '\n')
  await Bun.write(path.join(paths, 'evaluated', `${featureKey}.json`), JSON.stringify(evaluated, null, 2) + '\n')

  return {
    root,
    paths,
    featureKey,
    consolidatedId: consolidated[0]?.id ?? `${featureKey}::feature`,
  }
}

function buildManifest(
  fixture: Fixture,
  overrides: Partial<ConsolidatedManifest['entries'][string]> = {},
): ConsolidatedManifest {
  const testKey = 'tests/tools/sample.test.ts::suite > create task'
  const consolidatedId = fixture.consolidatedId
  return {
    version: 1 as const,
    entries: {
      [consolidatedId]: {
        consolidatedId,
        domain: 'tools',
        featureName: 'Task creation',
        consolidatedArtifactPath: path.join('reports', 'audit-behavior', 'consolidated', `${fixture.featureKey}.json`),
        evaluatedArtifactPath: path.join('reports', 'audit-behavior', 'evaluated', `${fixture.featureKey}.json`),
        sourceTestKeys: [testKey],
        sourceBehaviorIds: [testKey],
        supportingInternalBehaviorIds: [],
        isUserFacing: true,
        featureKey: fixture.featureKey,
        keywords: ['task-create'],
        sourceDomains: ['tools'],
        phase2Fingerprint: 'phase2-fp',
        phase3Fingerprint: 'phase3-fp',
        lastConsolidatedAt: '2026-07-19T12:02:00.000Z',
        lastEvaluatedAt: '2026-07-19T12:05:00.000Z',
        ...overrides,
      },
    },
  }
}

test('rebuildReportsFromStoredResults emits scores.json sidecar with composite, percentile, and trend fields', async () => {
  const root = makeTempDir()
  mockAuditBehaviorConfig(root, null)

  const fixture = await writeArtifactFiles(
    root,
    [
      {
        id: 'task-creation::feature',
        domain: 'tools',
        featureName: 'Task creation',
        isUserFacing: true,
        behavior: 'Creates a task from chat.',
        userStory: 'As a user, I can create a task.',
        context: 'Task creation context.',
        sourceTestKeys: ['tests/tools/sample.test.ts::suite > create task'],
        sourceBehaviorIds: ['tests/tools/sample.test.ts::suite > create task'],
        supportingInternalRefs: [],
        entryPointHints: [{ kind: 'command', identifier: '/config' }],
        closure: {
          closureStatus: 'partial',
          entryPoints: [
            {
              kind: 'command',
              identifier: '/config',
              resolved: true,
              evidence: { filePath: 'src/commands/config.ts', symbol: 'configCommand' },
            },
            {
              kind: 'tool',
              identifier: 'createTask',
              resolved: false,
              evidence: null,
            },
          ],
        },
      },
    ],
    [
      {
        consolidatedId: 'task-creation::feature',
        maria: { discover: 4, use: 4, retain: 3, notes: 'Clear primary path.' },
        dani: { discover: 3, use: 4, retain: 3, notes: 'Works once discovered.' },
        viktor: { discover: 2, use: 3, retain: 2, notes: 'Needs stronger affordances.' },
        flaws: [],
        improvements: [],
        evaluatedAt: '2026-07-19T12:05:00.000Z',
      },
    ],
    'task-creation',
  )

  const writer = await loadReportWriterModule(crypto.randomUUID())
  await writer.rebuildReportsFromStoredResults({ consolidatedManifest: buildManifest(fixture) })

  const scoresPath = path.join(fixture.paths, 'stories', 'scores.json')
  expect(await Bun.file(scoresPath).exists()).toBe(true)
  const scores = parseScoresFile(await Bun.file(scoresPath).text())

  expect(scores.model).toBe('qwen3-30b-a3b')
  expect(scores.domains).toHaveLength(1)
  const domain = scores.domains[0]!
  expect(domain.domain).toBe('tools')
  expect(domain.stories).toHaveLength(1)
  const story = domain.stories[0]!
  expect(story.consolidatedId).toBe('task-creation::feature')
  expect(story.composite).toBeCloseTo((4 + 4 + 3 + 3 + 4 + 3 + 2 + 3 + 2) / 9, 5)
  expect(story.percentile).toBe(100)
  expect(story.bottomDecile).toBe(false)
  expect(story.trendDelta).toBe(null)
  expect(story.closureStatus).toBe('partial')
  expect(story.entryPoints).toHaveLength(2)
  expect(story.entryPoints[0]!.resolved).toBe(true)
  expect(story.entryPoints[1]!.resolved).toBe(false)
})

test('writeScoresJson applies prior snapshot to compute trendDelta per story', async () => {
  const root = makeTempDir()
  mockAuditBehaviorConfig(root, null)

  const scoresWriter = await loadScoresWriterModule(crypto.randomUUID())

  const consolidatedByDomain = new Map<
    string,
    readonly {
      readonly id: string
      readonly domain: string
      readonly featureName: string
      readonly isUserFacing: boolean
      readonly behavior: string
      readonly userStory: string | null
      readonly context: string
      readonly sourceTestKeys: readonly string[]
      readonly sourceBehaviorIds: readonly string[]
      readonly supportingInternalRefs: readonly { readonly behaviorId: string; readonly summary: string }[]
      readonly entryPointHints: readonly {
        readonly kind: 'command' | 'tool' | 'handler' | 'route'
        readonly identifier: string
      }[]
      readonly closure: {
        readonly closureStatus: 'resolved' | 'partial' | 'unresolved' | 'unverified'
        readonly entryPoints: readonly {
          readonly kind: 'command' | 'tool' | 'handler' | 'route'
          readonly identifier: string
          readonly resolved: boolean
          readonly evidence: { readonly filePath: string; readonly symbol?: string } | null
        }[]
      } | null
    }[]
  >([
    [
      'tools',
      [
        {
          id: 'task-creation::feature',
          domain: 'tools',
          featureName: 'Task creation',
          isUserFacing: true,
          behavior: '',
          userStory: 'As a user, I can create a task.',
          context: '',
          sourceTestKeys: [],
          sourceBehaviorIds: [],
          supportingInternalRefs: [],
          entryPointHints: [],
          closure: null,
        },
      ],
    ],
  ])

  const evaluatedByDomain = new Map<
    string,
    readonly {
      readonly testName: string
      readonly behavior: string
      readonly userStory: string
      readonly maria: {
        readonly discover: number
        readonly use: number
        readonly retain: number
        readonly notes: string
      }
      readonly dani: {
        readonly discover: number
        readonly use: number
        readonly retain: number
        readonly notes: string
      }
      readonly viktor: {
        readonly discover: number
        readonly use: number
        readonly retain: number
        readonly notes: string
      }
      readonly flaws: readonly string[]
      readonly improvements: readonly string[]
    }[]
  >([
    [
      'tools',
      [
        {
          testName: 'Task creation',
          behavior: '',
          userStory: '',
          maria: { discover: 4, use: 4, retain: 4, notes: '' },
          dani: { discover: 4, use: 4, retain: 4, notes: '' },
          viktor: { discover: 4, use: 4, retain: 4, notes: '' },
          flaws: [],
          improvements: [],
        },
      ],
    ],
  ])

  const prior = {
    domains: [
      {
        stories: [{ consolidatedId: 'task-creation::feature', composite: 3.4 }],
      },
    ],
  }

  const result = await scoresWriter.writeScoresJson(consolidatedByDomain, evaluatedByDomain, prior)

  expect(result.domains).toHaveLength(1)
  const story = result.domains[0]!.stories[0]!
  expect(story.consolidatedId).toBe('task-creation::feature')
  expect(story.trendDelta).toBeCloseTo(0.6, 5)
  expect(story.closureStatus).toBe('unverified')
})
