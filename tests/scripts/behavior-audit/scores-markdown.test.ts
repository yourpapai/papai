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
import { loadReportWriterModule } from '../behavior-audit-integration.support.js'

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

function buildManifest(fixture: Fixture): ConsolidatedManifest {
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
      },
    },
  }
}

test('per-story markdown surfaces composite, percentile, closure callout, and entry-point list', async () => {
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
        sourceTestKeys: [],
        sourceBehaviorIds: [],
        supportingInternalRefs: [],
        entryPointHints: [
          { kind: 'command', identifier: '/config' },
          { kind: 'tool', identifier: 'createTask' },
        ],
        closure: {
          closureStatus: 'partial',
          entryPoints: [
            {
              kind: 'command',
              identifier: '/config',
              resolved: true,
              evidence: { filePath: 'src/commands/config.ts' },
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

  const markdown = await Bun.file(path.join(fixture.paths, 'stories', 'tools.md')).text()

  expect(markdown).toContain('**Composite:**')
  expect(markdown).toContain('(no prior snapshot)')
  expect(markdown).toContain('**Domain rank:** 100th percentile')
  expect(markdown).toContain('⚠ Closure check: 1 of 2 entry points resolved (partial)')
  expect(markdown).toContain('**Entry points:**')
  expect(markdown).toContain('- ✓ command: /config')
  expect(markdown).toContain('- ✗ tool: createTask')
})

test('per-story markdown omits closure callout when status is resolved', async () => {
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
        behavior: 'Creates a task.',
        userStory: 'As a user, I can create a task.',
        context: '',
        sourceTestKeys: [],
        sourceBehaviorIds: [],
        supportingInternalRefs: [],
        entryPointHints: [{ kind: 'command', identifier: '/config' }],
        closure: {
          closureStatus: 'resolved',
          entryPoints: [
            {
              kind: 'command',
              identifier: '/config',
              resolved: true,
              evidence: { filePath: 'src/commands/config.ts' },
            },
          ],
        },
      },
    ],
    [
      {
        consolidatedId: 'task-creation::feature',
        maria: { discover: 5, use: 5, retain: 5, notes: '' },
        dani: { discover: 5, use: 5, retain: 5, notes: '' },
        viktor: { discover: 5, use: 5, retain: 5, notes: '' },
        flaws: [],
        improvements: [],
        evaluatedAt: '2026-07-19T12:05:00.000Z',
      },
    ],
    'task-creation',
  )

  const writer = await loadReportWriterModule(crypto.randomUUID())
  await writer.rebuildReportsFromStoredResults({ consolidatedManifest: buildManifest(fixture) })

  const markdown = await Bun.file(path.join(fixture.paths, 'stories', 'tools.md')).text()
  expect(markdown).not.toContain('⚠ Closure check')
  expect(markdown).toContain('- ✓ command: /config')
})

test('index markdown surfaces Closure Gaps section when a story has unresolved entry points', async () => {
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
        behavior: 'Creates a task.',
        userStory: 'As a user, I can create a task.',
        context: '',
        sourceTestKeys: [],
        sourceBehaviorIds: [],
        supportingInternalRefs: [],
        entryPointHints: [{ kind: 'tool', identifier: 'missingTool' }],
        closure: {
          closureStatus: 'unresolved',
          entryPoints: [
            {
              kind: 'tool',
              identifier: 'missingTool',
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
        maria: { discover: 3, use: 3, retain: 3, notes: '' },
        dani: { discover: 3, use: 3, retain: 3, notes: '' },
        viktor: { discover: 3, use: 3, retain: 3, notes: '' },
        flaws: [],
        improvements: [],
        evaluatedAt: '2026-07-19T12:05:00.000Z',
      },
    ],
    'task-creation',
  )

  const writer = await loadReportWriterModule(crypto.randomUUID())
  await writer.rebuildReportsFromStoredResults({ consolidatedManifest: buildManifest(fixture) })

  const index = await Bun.file(path.join(fixture.paths, 'stories', 'index.md')).text()
  expect(index).toContain('## Closure Gaps')
  expect(index).toContain('"Task creation" (tools): 1 unresolved — unresolved')
})

test('index markdown Top Movers section is omitted when no prior snapshot exists', async () => {
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
        behavior: 'Creates a task.',
        userStory: 'As a user, I can create a task.',
        context: '',
        sourceTestKeys: [],
        sourceBehaviorIds: [],
        supportingInternalRefs: [],
        entryPointHints: [],
        closure: null,
      },
    ],
    [
      {
        consolidatedId: 'task-creation::feature',
        maria: { discover: 5, use: 5, retain: 5, notes: '' },
        dani: { discover: 5, use: 5, retain: 5, notes: '' },
        viktor: { discover: 5, use: 5, retain: 5, notes: '' },
        flaws: [],
        improvements: [],
        evaluatedAt: '2026-07-19T12:05:00.000Z',
      },
    ],
    'task-creation',
  )

  const writer = await loadReportWriterModule(crypto.randomUUID())
  await writer.rebuildReportsFromStoredResults({ consolidatedManifest: buildManifest(fixture) })

  const index = await Bun.file(path.join(fixture.paths, 'stories', 'index.md')).text()
  expect(index).not.toContain('## Closure Gaps')
  expect(index).not.toContain('## Top Movers')
})

test('writeIndexFile surfaces Top Movers when scores carry trend deltas', async () => {
  const root = makeTempDir()
  mockAuditBehaviorConfig(root, null)

  const writer = await loadReportWriterModule(crypto.randomUUID())
  const scores: ScoresFile = {
    generatedAt: '2026-07-19T12:00:00.000Z',
    model: 'qwen3-30b-a3b',
    domains: [
      {
        domain: 'tools',
        stories: [
          {
            featureKey: 'a::f',
            consolidatedId: 'a::f',
            domain: 'tools',
            featureName: 'Alpha',
            userStory: '',
            composite: 4.5,
            percentile: 100,
            bottomDecile: false,
            maria: { discover: 5, use: 5, retain: 5 },
            dani: { discover: 5, use: 5, retain: 5 },
            viktor: { discover: 5, use: 5, retain: 5 },
            flaws: [],
            improvements: [],
            trendDelta: 0.7,
            closureStatus: 'resolved',
            entryPoints: [],
          },
          {
            featureKey: 'b::f',
            consolidatedId: 'b::f',
            domain: 'tools',
            featureName: 'Beta',
            userStory: '',
            composite: 2.5,
            percentile: 50,
            bottomDecile: false,
            maria: { discover: 3, use: 3, retain: 3 },
            dani: { discover: 3, use: 3, retain: 3 },
            viktor: { discover: 3, use: 3, retain: 3 },
            flaws: [],
            improvements: [],
            trendDelta: -0.6,
            closureStatus: 'resolved',
            entryPoints: [],
          },
        ],
      },
    ],
  }

  await writer.writeIndexFile([], 2, 0, new Map(), new Map(), [], scores)

  const index = await Bun.file(path.join(root, 'reports', 'audit-behavior', 'stories', 'index.md')).text()
  expect(index).toContain('## Top Movers')
  expect(index).toContain('### Improving')
  expect(index).toContain('- "Alpha" (tools): +0.7')
  expect(index).toContain('### Declining')
  expect(index).toContain('- "Beta" (tools): -0.6')
})
