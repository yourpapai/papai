import { afterEach, expect, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { runPhase2b as runPhase2bType } from '../../scripts/behavior-audit/consolidate.js'
import type { ExtractedBehaviorRecord } from '../../scripts/behavior-audit/extracted-store.js'
import type { IncrementalManifest } from '../../scripts/behavior-audit/incremental.js'
import type { AgentResult } from '../../scripts/behavior-audit/phase-stats.js'
import {
  createEmptyProgressFixture,
  createManifestTestEntry,
  mockAuditBehaviorConfig,
} from './behavior-audit-integration.helpers.js'
import { cleanupTempDirs, makeTempDir, restoreBehaviorAuditEnv } from './behavior-audit-integration.runtime-helpers.js'
import { getArrayItem, loadConsolidateModule } from './behavior-audit-integration.support.js'
import { makeExtractedRecord } from './behavior-audit/test-fixtures.js'

type LoadedConsolidateModule = {
  readonly runPhase2b: typeof runPhase2bType
}

type ConsolidateInput = {
  readonly testKey: string
  readonly domain: string
  readonly behaviorId: string
}
type ConsolidatedEntry = {
  readonly domain: string
  readonly sourceDomains: readonly string[]
}

type ClassifiedArtifactRecord = {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly featureKey: string | null
  readonly featureLabel: string | null
  readonly supportingBehaviorRefs: readonly { readonly behaviorId: string; readonly reason: string }[]
  readonly relatedBehaviorHints: readonly {
    readonly testKey: string
    readonly relation: 'same-feature' | 'supporting-detail' | 'possibly-related'
    readonly reason: string
  }[]
  readonly classificationNotes: string
  readonly classifiedAt: string
}

function buildRelativeArtifactPath(directory: 'extracted' | 'classified' | 'consolidated', target: string): string {
  if (directory === 'consolidated') {
    return path.join('reports', 'audit-behavior', 'consolidated', `${target}.json`)
  }

  const domain = target.split('/')[1]
  const fileName = path.basename(target).replace('.test.ts', '.test.json')
  return path.join('reports', 'audit-behavior', directory, domain ?? 'tools', fileName)
}

function createExtractedRecord(input: {
  readonly testKey: string
  readonly testFile: string
  readonly testName: string
  readonly fullPath: string
  readonly behavior: string
  readonly context: string
  readonly keywords: readonly string[]
}): ExtractedBehaviorRecord {
  return makeExtractedRecord({
    behaviorId: input.testKey,
    testKey: input.testKey,
    testFile: input.testFile,
    domain: input.testFile.split('/')[1] ?? 'tools',
    testName: input.testName,
    fullPath: input.fullPath,
    behavior: input.behavior,
    context: input.context,
    keywords: input.keywords,
  })
}

function createClassifiedRecord(input: {
  readonly behaviorId: string
  readonly testKey: string
  readonly domain: string
  readonly visibility: 'user-facing' | 'internal' | 'ambiguous'
  readonly featureKey: string | null
  readonly featureLabel: string | null
  readonly classificationNotes: string
}): ClassifiedArtifactRecord {
  return {
    behaviorId: input.behaviorId,
    testKey: input.testKey,
    domain: input.domain,
    visibility: input.visibility,
    featureKey: input.featureKey,
    featureLabel: input.featureLabel,
    supportingBehaviorRefs: [],
    relatedBehaviorHints: [],
    classificationNotes: input.classificationNotes,
    classifiedAt: '2026-04-21T12:05:00.000Z',
  }
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true })
  await Bun.write(filePath, JSON.stringify(value, null, 2) + '\n')
}

afterEach(() => {
  restoreBehaviorAuditEnv()
  cleanupTempDirs()
})

test('consolidate-agent prompt contract treats a keyword batch as a candidate pool rather than one feature', async () => {
  const source = await Bun.file(path.join(process.cwd(), 'scripts/behavior-audit/consolidate-agent.ts')).text()
  expect(source).toContain('candidate pool')
  expect(source).toContain('never force one output per batch or one output per keyword')
})

test('runPhase2b joins classified and extracted artifacts by behavior id and writes consolidated artifacts by feature key', async () => {
  const root = makeTempDir()
  mockAuditBehaviorConfig(root, null)

  const consolidate = await loadConsolidateModule(crypto.randomUUID())
  const progress = createEmptyProgressFixture(1)
  const writtenFiles = new Map<string, string>()
  const testFilePath = 'tests/tools/create-task.test.ts'
  const createTaskKey = 'tests/tools/create-task.test.ts::suite > create task'
  const validateInputKey = 'tests/tools/create-task.test.ts::suite > validate input'

  const manifest: IncrementalManifest = {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v2', reports: 'reports-v1' },
    tests: {
      [createTaskKey]: createManifestTestEntry({
        testFile: testFilePath,
        testName: 'suite > create task',
        dependencyPaths: [testFilePath],
        phase1Fingerprint: 'phase1-fp-a',
        phase2aFingerprint: 'phase2a-fp-a',
        phase2Fingerprint: null,
        behaviorId: createTaskKey,
        featureKey: 'task-creation',
        extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
        classifiedArtifactPath: buildRelativeArtifactPath('classified', testFilePath),
        domain: 'tools',
        lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
        lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
        lastPhase2CompletedAt: null,
      }),
      [validateInputKey]: createManifestTestEntry({
        testFile: testFilePath,
        testName: 'suite > validate input',
        dependencyPaths: [testFilePath],
        phase1Fingerprint: 'phase1-fp-b',
        phase2aFingerprint: 'phase2a-fp-b',
        phase2Fingerprint: null,
        behaviorId: validateInputKey,
        featureKey: 'task-creation',
        extractedArtifactPath: buildRelativeArtifactPath('extracted', testFilePath),
        classifiedArtifactPath: buildRelativeArtifactPath('classified', testFilePath),
        domain: 'tools',
        lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
        lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
        lastPhase2CompletedAt: null,
      }),
    },
  }

  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('extracted', testFilePath)), [
    createExtractedRecord({
      testKey: createTaskKey,
      testFile: testFilePath,
      testName: 'create task',
      fullPath: 'suite > create task',
      behavior: 'When a user asks to create a task, the bot saves it.',
      context: 'Calls create_task.',
      keywords: ['task-create'],
    }),
    createExtractedRecord({
      testKey: validateInputKey,
      testFile: testFilePath,
      testName: 'validate input',
      fullPath: 'suite > validate input',
      behavior: 'When input is malformed, the bot blocks task creation.',
      context: 'Runs validation guards.',
      keywords: ['task-create'],
    }),
  ])
  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('classified', testFilePath)), [
    createClassifiedRecord({
      behaviorId: createTaskKey,
      testKey: createTaskKey,
      domain: 'tools',
      visibility: 'user-facing',
      featureKey: null,
      featureLabel: 'Task creation',
      classificationNotes: 'User-facing task creation.',
    }),
    createClassifiedRecord({
      behaviorId: validateInputKey,
      testKey: validateInputKey,
      domain: 'tools',
      visibility: 'internal',
      featureKey: null,
      featureLabel: 'Task creation',
      classificationNotes: 'Supporting validation behavior.',
    }),
  ])

  const result = await consolidate.runPhase2b(
    progress,
    { version: 1, entries: {} },
    'phase2-v2',
    new Set(['task-creation']),
    manifest,
    {
      consolidateWithRetry: (): Promise<AgentResult<typeof consolidationItems>> => {
        const consolidationItems = [
          {
            id: 'task-creation::task-creation',
            item: {
              featureName: 'Task creation',
              isUserFacing: true,
              behavior: 'When a user asks to create a task, the bot saves it and confirms success.',
              userStory: 'As a user, I want to create a task in chat so I can track work quickly.',
              context: 'Calls create_task and formats the confirmation.',
              sourceBehaviorIds: [createTaskKey, validateInputKey],
              sourceTestKeys: [createTaskKey, validateInputKey],
              supportingInternalRefs: [
                {
                  behaviorId: validateInputKey,
                  summary: 'Validation guards prevent malformed task creation inputs.',
                },
              ],
            },
          },
        ]
        return Promise.resolve({
          result: consolidationItems,
          usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        })
      },
      writeConsolidatedFile: (featureKey, consolidations): Promise<void> => {
        writtenFiles.set(featureKey, JSON.stringify(consolidations, null, 2) + '\n')
        return Promise.resolve()
      },
    },
  )

  const entry = result.entries['task-creation::task-creation']
  assert(entry !== undefined, 'Expected consolidated entry')
  expect(entry.featureKey).toBe('task-creation')
  expect(entry.consolidatedArtifactPath).toBe(buildRelativeArtifactPath('consolidated', 'task-creation'))

  const fileText = writtenFiles.get('task-creation')
  assert(fileText !== undefined, 'Expected consolidated file contents to be captured')
  expect(fileText).toContain('supportingInternalRefs')
})

test('runPhase2b groups joined artifact inputs by feature key and preserves cross-domain provenance', async () => {
  const root = makeTempDir()
  mockAuditBehaviorConfig(root, null)

  const consolidate: LoadedConsolidateModule = await loadConsolidateModule(crypto.randomUUID())
  const progress = createEmptyProgressFixture(2)
  let capturedFeatureKey: string | null = null
  let capturedDomains: readonly string[] = []
  const toolsTestFile = 'tests/tools/a.test.ts'
  const commandsTestFile = 'tests/commands/b.test.ts'
  const toolsTestKey = 'tests/tools/a.test.ts::suite > case'
  const commandsTestKey = 'tests/commands/b.test.ts::suite > case'
  const manifest: IncrementalManifest = {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    phaseVersions: { phase1: 'phase1-v1', phase2: 'phase2-v1', reports: 'reports-v1' },
    tests: {
      [toolsTestKey]: createManifestTestEntry({
        testFile: toolsTestFile,
        testName: 'suite > case',
        dependencyPaths: [toolsTestFile],
        phase1Fingerprint: 'phase1-tools',
        phase2aFingerprint: 'phase2a-tools',
        phase2Fingerprint: null,
        behaviorId: toolsTestKey,
        featureKey: 'group-targeting',
        extractedArtifactPath: buildRelativeArtifactPath('extracted', toolsTestFile),
        classifiedArtifactPath: buildRelativeArtifactPath('classified', toolsTestFile),
        domain: 'tools',
        lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
        lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
        lastPhase2CompletedAt: null,
      }),
      [commandsTestKey]: createManifestTestEntry({
        testFile: commandsTestFile,
        testName: 'suite > case',
        dependencyPaths: [commandsTestFile],
        phase1Fingerprint: 'phase1-commands',
        phase2aFingerprint: 'phase2a-commands',
        phase2Fingerprint: null,
        behaviorId: commandsTestKey,
        featureKey: 'group-targeting',
        extractedArtifactPath: buildRelativeArtifactPath('extracted', commandsTestFile),
        classifiedArtifactPath: buildRelativeArtifactPath('classified', commandsTestFile),
        domain: 'commands',
        lastPhase1CompletedAt: '2026-04-21T12:00:00.000Z',
        lastPhase2aCompletedAt: '2026-04-21T12:05:00.000Z',
        lastPhase2CompletedAt: null,
      }),
    },
  }

  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('extracted', toolsTestFile)), [
    createExtractedRecord({
      testKey: toolsTestKey,
      testFile: toolsTestFile,
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When a user targets a group, the bot routes the request correctly.',
      context: 'Routes through group context selection.',
      keywords: ['group-targeting', 'shared-feature'],
    }),
  ])
  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('classified', toolsTestFile)), [
    createClassifiedRecord({
      behaviorId: toolsTestKey,
      testKey: toolsTestKey,
      domain: 'tools',
      visibility: 'user-facing',
      featureKey: null,
      featureLabel: 'Group targeting',
      classificationNotes: 'User-facing feature.',
    }),
  ])
  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('extracted', commandsTestFile)), [
    createExtractedRecord({
      testKey: commandsTestKey,
      testFile: commandsTestFile,
      testName: 'case',
      fullPath: 'suite > case',
      behavior: 'When a user configures a group action, the bot applies the group target.',
      context: 'Resolves group target before command execution.',
      keywords: ['group-targeting', 'shared-feature'],
    }),
  ])
  await writeJsonArtifact(path.join(root, buildRelativeArtifactPath('classified', commandsTestFile)), [
    createClassifiedRecord({
      behaviorId: commandsTestKey,
      testKey: commandsTestKey,
      domain: 'commands',
      visibility: 'internal',
      featureKey: null,
      featureLabel: 'Group targeting',
      classificationNotes: 'Supporting internal behavior.',
    }),
  ])

  const result = await consolidate.runPhase2b(
    progress,
    { version: 1, entries: {} },
    'phase2-v1',
    new Set(['group-targeting']),
    manifest,
    {
      consolidateWithRetry: (
        featureKey: string,
        inputs: readonly ConsolidateInput[],
      ): Promise<AgentResult<
        readonly {
          readonly id: string
          readonly item: {
            readonly featureName: string
            readonly isUserFacing: boolean
            readonly behavior: string
            readonly userStory: string | null
            readonly context: string
            readonly sourceTestKeys: string[]
            readonly sourceBehaviorIds: string[]
            readonly supportingInternalRefs: { behaviorId: string; summary: string }[]
          }
        }[]
      > | null> => {
        capturedFeatureKey = featureKey
        capturedDomains = inputs.map((input) => input.domain)

        return Promise.resolve({
          result: [
            {
              id: `${featureKey}::combined-feature`,
              item: {
                featureName: 'Combined feature',
                isUserFacing: true,
                behavior: 'When a user acts, something happens.',
                userStory: 'As a user, I can do something.',
                context: 'Implementation context.',
                sourceTestKeys: inputs.map((input) => input.testKey),
                sourceBehaviorIds: inputs.map((input) => input.behaviorId),
                supportingInternalRefs: [],
              },
            },
          ],
          usage: { inputTokens: 200, outputTokens: 100, toolCalls: 2, toolNames: ['readFile', 'grep'] },
        })
      },
      writeConsolidatedFile: async (): Promise<void> => {},
    },
  )

  expect(Object.keys(result.entries).length).toBeGreaterThan(0)
  assert(capturedFeatureKey !== null, 'Expected captured feature key')
  const featureKey: string = capturedFeatureKey
  expect(featureKey).toBe('group-targeting')
  expect(capturedDomains).toEqual(['tools', 'commands'])
  const savedEntries = Object.values(result.entries) as readonly ConsolidatedEntry[]
  expect(savedEntries).toHaveLength(1)
  expect(getArrayItem(savedEntries, 0).domain).toBe('cross-domain')
  expect(getArrayItem(savedEntries, 0).sourceDomains).toEqual(['commands', 'tools'])
})
