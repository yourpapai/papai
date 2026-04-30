import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type * as IncrementalModule from '../../../scripts/behavior-audit/incremental.js'
import { runBehaviorAudit, type BehaviorAuditDeps } from '../../../scripts/behavior-audit/index.js'
import type * as ProgressMigrateModule from '../../../scripts/behavior-audit/progress-migrate.js'
import { loadProgressModule } from '../behavior-audit-integration.support.js'

type ManifestTestEntry = IncrementalModule.IncrementalManifest['tests'][string]

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'behavior-audit-incremental-'))
  tempDirs.push(dir)
  return dir
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isIncrementalModule(value: unknown): value is typeof IncrementalModule {
  return (
    isObject(value) &&
    'createEmptyManifest' in value &&
    typeof value['createEmptyManifest'] === 'function' &&
    'captureRunStart' in value &&
    typeof value['captureRunStart'] === 'function' &&
    'loadManifest' in value &&
    typeof value['loadManifest'] === 'function' &&
    'saveManifest' in value &&
    typeof value['saveManifest'] === 'function' &&
    'combineChangedFileLists' in value &&
    typeof value['combineChangedFileLists'] === 'function' &&
    'collectChangedFiles' in value &&
    typeof value['collectChangedFiles'] === 'function' &&
    'selectIncrementalWork' in value &&
    typeof value['selectIncrementalWork'] === 'function'
  )
}

function isProgressMigrateModule(value: unknown): value is typeof ProgressMigrateModule {
  return (
    isObject(value) && 'validateOrMigrateProgress' in value && typeof value['validateOrMigrateProgress'] === 'function'
  )
}

function isBehaviorAuditModule(value: unknown): value is {
  readonly runBehaviorAudit: () => Promise<void>
} {
  return isObject(value) && 'runBehaviorAudit' in value && typeof value['runBehaviorAudit'] === 'function'
}

async function loadIncrementalModule(): Promise<typeof IncrementalModule> {
  const mod: unknown = await import(`../../../scripts/behavior-audit/incremental.js?test=${crypto.randomUUID()}`)
  if (!isIncrementalModule(mod)) throw new Error('Unexpected incremental module shape')
  return mod
}

async function loadProgressMigrateModule(): Promise<typeof ProgressMigrateModule> {
  const mod: unknown = await import(`../../../scripts/behavior-audit/progress-migrate.js?test=${crypto.randomUUID()}`)
  if (!isProgressMigrateModule(mod)) throw new Error('Unexpected progress-migrate module shape')
  return mod
}

async function loadBehaviorAuditEntryPoint(tag: string): Promise<void> {
  const mod: unknown = await import(`../../../scripts/behavior-audit/index.js?test=${tag}`)
  if (!isBehaviorAuditModule(mod)) {
    throw new Error('Unexpected behavior-audit module shape')
  }
  await mod.runBehaviorAudit().catch((error: unknown) => {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

async function runCommand(command: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errorMessage = stderr.trim()
    if (errorMessage.length > 0) {
      throw new Error(errorMessage)
    }
    throw new Error(`Command failed: ${command.join(' ')}`)
  }
  return stdout.trim()
}

async function initializeGitRepo(root: string): Promise<void> {
  await runCommand(['git', 'init', '-q'], root)
  await runCommand(
    [
      'git',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'init',
      '-q',
    ],
    root,
  )
}

async function commitAll(root: string, message: string): Promise<void> {
  await runCommand(['git', 'add', '.'], root)
  await runCommand(
    [
      'git',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      message,
      '-q',
    ],
    root,
  )
}

function isSavedManifest(
  value: unknown,
): value is { readonly lastStartCommit: string | null; readonly lastStartedAt: string | null } {
  if (!isObject(value)) {
    return false
  }
  if (!('lastStartCommit' in value) || !('lastStartedAt' in value)) {
    return false
  }

  const lastStartCommit = value['lastStartCommit']
  if (typeof lastStartCommit !== 'string' && lastStartCommit !== null) {
    return false
  }

  const lastStartedAt = value['lastStartedAt']
  if (typeof lastStartedAt !== 'string' && lastStartedAt !== null) {
    return false
  }

  return true
}

function assertLoaded<T>(value: T | null, message: string): asserts value is T {
  assert(value !== null, message)
}

function objectKeys(value: object | undefined): string[] {
  return value === undefined ? [] : Object.keys(value)
}

function makeProcessExitThrow(code: number | undefined): never {
  throw new Error(code === undefined ? 'process.exit:0' : `process.exit:${code}`)
}

function assertPhase2aBeforePhase2b<T>(value: T | undefined, message: string): asserts value is T {
  assert(value !== undefined, message)
}

function createNoopProgressReporter(): {
  readonly emit: () => void
  readonly end: () => void
} {
  return {
    emit: (): void => undefined,
    end: (): void => undefined,
  }
}

function createManifestTestEntry(
  input: Omit<
    ManifestTestEntry,
    | 'phase2aFingerprint'
    | 'behaviorId'
    | 'featureKey'
    | 'extractedArtifactPath'
    | 'classifiedArtifactPath'
    | 'lastPhase2aCompletedAt'
  > &
    Partial<
      Pick<
        ManifestTestEntry,
        | 'phase2aFingerprint'
        | 'behaviorId'
        | 'featureKey'
        | 'extractedArtifactPath'
        | 'classifiedArtifactPath'
        | 'lastPhase2aCompletedAt'
      >
    >,
): ManifestTestEntry {
  return {
    phase2aFingerprint: null,
    behaviorId: null,
    featureKey: null,
    extractedArtifactPath: null,
    classifiedArtifactPath: null,
    lastPhase2aCompletedAt: null,
    ...input,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('behavior-audit incremental manifest', () => {
  let root: string
  let reportsDir: string
  let manifestPath: string
  let phase1ManifestSnapshot: string | null
  let phase1Calls: number

  beforeEach(() => {
    root = makeTempDir()
    reportsDir = path.join(root, 'reports')
    manifestPath = path.join(reportsDir, 'incremental-manifest.json')
    phase1ManifestSnapshot = null
    phase1Calls = 0

    const testsDir = path.join(root, 'tests', 'tools')
    mkdirSync(testsDir, { recursive: true })
    writeFileSync(path.join(testsDir, 'sample.test.ts'), "test('sample', () => {})\n")

    // This suite intentionally keeps narrow module mocks because it is verifying
    // entrypoint startup behavior that happens during delayed module import.
    void mock.module('../../../scripts/behavior-audit/config.js', () => ({
      MODEL: 'qwen3-30b-a3b',
      BASE_URL: 'http://localhost:1234/v1',
      PROJECT_ROOT: root,
      REPORTS_DIR: reportsDir,
      AUDIT_BEHAVIOR_DIR: path.join(reportsDir, 'audit-behavior'),
      CLASSIFIED_DIR: path.join(reportsDir, 'classified'),
      CONSOLIDATED_DIR: path.join(reportsDir, 'consolidated'),
      STORIES_DIR: path.join(reportsDir, 'stories'),
      PROGRESS_PATH: path.join(reportsDir, 'progress.json'),
      INCREMENTAL_MANIFEST_PATH: manifestPath,
      CONSOLIDATED_MANIFEST_PATH: path.join(reportsDir, 'consolidated-manifest.json'),
      KEYWORD_VOCABULARY_PATH: path.join(reportsDir, 'keyword-vocabulary.json'),
      PHASE1_TIMEOUT_MS: 1_200_000,
      PHASE2_TIMEOUT_MS: 300_000,
      PHASE3_TIMEOUT_MS: 600_000,
      MAX_RETRIES: 3,
      RETRY_BACKOFF_MS: [100_000, 300_000, 900_000] as const,
      MAX_STEPS: 20,
      EXCLUDED_PREFIXES: [
        'tests/e2e/',
        'tests/client/',
        'tests/helpers/',
        'tests/scripts/',
        'tests/review-loop/',
        'tests/types/',
      ] as const,
    }))
    void mock.module('../../../scripts/behavior-audit/extract.js', () => ({
      runPhase1: async (): Promise<void> => {
        phase1Calls += 1
        phase1ManifestSnapshot = await Bun.file(manifestPath).text()
      },
    }))
    void mock.module('../../../scripts/behavior-audit/classify.js', () => ({
      runPhase2a: (): Promise<ReadonlySet<string>> => Promise.resolve(new Set()),
    }))
    void mock.module('../../../scripts/behavior-audit/consolidate.js', () => ({
      runPhase2b: (): Promise<{ readonly version: 1; readonly entries: Record<string, never> }> =>
        Promise.resolve({
          version: 1,
          entries: {},
        }),
    }))
    void mock.module('../../../scripts/behavior-audit/evaluate.js', () => ({
      runPhase3: async (): Promise<void> => {},
    }))
    void mock.module('../../../scripts/behavior-audit/report-writer.js', () => ({
      rebuildReportsFromStoredResults: async (): Promise<void> => {},
    }))
  })

  test('createEmptyManifest starts with null lastStartCommit and empty tests', async () => {
    const incremental = await loadIncrementalModule()
    const manifest = incremental.createEmptyManifest()

    expect(manifest.version).toBe(1)
    expect(manifest.lastStartCommit).toBeNull()
    expect(manifest.tests).toEqual({})
  })

  test('loadManifest backfills missing optional fields for older files', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 1,
      }),
    )

    const loaded = await incremental.loadManifest()

    expect(loaded).not.toBeNull()
    assertLoaded(loaded, 'Expected manifest to load')

    expect(loaded.lastStartCommit).toBeNull()
    expect(loaded.lastStartedAt).toBeNull()
    expect(loaded.lastCompletedAt).toBeNull()
    expect(loaded.phaseVersions).toEqual({ phase1: '', phase2: '', reports: '' })
    expect(loaded.tests).toEqual({})
  })

  test('loadManifest ignores legacy alias fields and leaves canonical entries null', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 1,
        tests: {
          'tests/tools/create-task.test.ts::suite > case': {
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'phase1-fingerprint',
            phase2Fingerprint: 'phase2-fingerprint',
            behaviorId: 'behavior-1',
            featureKey: null,
            extractedArtifactPath: null,
            classifiedArtifactPath: 'reports/audit-behavior/classified/tools/create-task.test.json',
            domain: 'tools',
            lastPhase1CompletedAt: '2026-04-23T12:00:00.000Z',
            lastPhase2CompletedAt: '2026-04-23T12:05:00.000Z',
          },
        },
      }),
    )

    const loaded = await incremental.loadManifest()

    expect(loaded).not.toBeNull()
    assertLoaded(loaded, 'Expected manifest to load')

    const entry = loaded.tests['tests/tools/create-task.test.ts::suite > case']
    expect(entry).toBeDefined()
    expect(entry?.featureKey).toBeNull()
    expect(entry?.extractedArtifactPath).toBeNull()
    const unknownKeys = objectKeys(entry).filter(
      (k) =>
        ![
          'testFile',
          'testName',
          'dependencyPaths',
          'phase1Fingerprint',
          'phase2aFingerprint',
          'phase2Fingerprint',
          'behaviorId',
          'featureKey',
          'extractedArtifactPath',
          'classifiedArtifactPath',
          'domain',
          'lastPhase1CompletedAt',
          'lastPhase2aCompletedAt',
          'lastPhase2CompletedAt',
        ].includes(k),
    )
    expect(unknownKeys).toEqual([])
  })

  test('loadConsolidatedManifest ignores legacy alias fields and leaves canonical entries null', async () => {
    const incremental = await loadIncrementalModule()
    const consolidatedManifestPath = path.join(reportsDir, 'consolidated-manifest.json')

    await Bun.write(
      consolidatedManifestPath,
      JSON.stringify({
        version: 1,
        entries: {
          'task-creation::task-creation': {
            consolidatedId: 'task-creation::task-creation',
            domain: 'tools',
            featureName: 'Task creation',
            consolidatedArtifactPath: 'reports/audit-behavior/consolidated/task-creation.json',
            evaluatedArtifactPath: 'reports/audit-behavior/evaluated/task-creation.json',
            sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
            sourceBehaviorIds: ['behavior-1'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            featureKey: 'task-creation',
            keywords: ['task-create'],
            sourceDomains: ['tools'],
            phase2Fingerprint: 'phase2-fingerprint',
            lastConsolidatedAt: '2026-04-23T12:10:00.000Z',
            lastEvaluatedAt: '2026-04-23T12:15:00.000Z',
          },
        },
      }),
    )

    const loaded = await incremental.loadConsolidatedManifest()

    expect(loaded).not.toBeNull()
    assertLoaded(loaded, 'Expected consolidated manifest to load')

    const entry = loaded.entries['task-creation::task-creation']
    expect(entry).toBeDefined()
    expect(entry?.featureKey).toBe('task-creation')
    const unknownKeys = objectKeys(entry).filter(
      (k) =>
        ![
          'consolidatedId',
          'domain',
          'featureName',
          'consolidatedArtifactPath',
          'evaluatedArtifactPath',
          'sourceTestKeys',
          'sourceBehaviorIds',
          'supportingInternalBehaviorIds',
          'isUserFacing',
          'featureKey',
          'keywords',
          'sourceDomains',
          'phase2Fingerprint',
          'phase3Fingerprint',
          'lastConsolidatedAt',
          'lastEvaluatedAt',
        ].includes(k),
    )
    expect(unknownKeys).toEqual([])
  })

  test('loadManifest throws when manifest content is malformed', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(manifestPath, '{not valid json')

    await expect(incremental.loadManifest()).rejects.toThrow()
  })

  test('loadManifest throws when manifest JSON is schema-invalid', async () => {
    const incremental = await loadIncrementalModule()

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 2,
        tests: {},
      }),
    )

    await expect(incremental.loadManifest()).rejects.toThrow()
  })

  test('captureRunStart saves previous lastStartCommit for diffing and writes new HEAD immediately', async () => {
    const incremental = await loadIncrementalModule()
    const manifest = {
      ...incremental.createEmptyManifest(),
      lastStartCommit: 'old-commit',
    }

    const result = incremental.captureRunStart(manifest, 'new-commit', '2026-04-17T12:00:00.000Z')

    expect(result.previousLastStartCommit).toBe('old-commit')
    expect(result.updatedManifest.lastStartCommit).toBe('new-commit')
    expect(result.updatedManifest.lastStartedAt).toBe('2026-04-17T12:00:00.000Z')
  })

  test('combineChangedFileLists unions and sorts paths deterministically', async () => {
    const incremental = await loadIncrementalModule()

    const paths = incremental.combineChangedFileLists([
      ['tests/tools/a.test.ts', 'src/tools/a.ts'],
      ['src/tools/a.ts', 'scripts/behavior-audit/evaluate.ts'],
      [],
      ['new-file.ts'],
    ])

    expect(paths).toEqual([
      'new-file.ts',
      'scripts/behavior-audit/evaluate.ts',
      'src/tools/a.ts',
      'tests/tools/a.test.ts',
    ])
  })

  test('collectChangedFiles unions committed, staged, unstaged, and untracked paths', async () => {
    const incremental = await loadIncrementalModule()
    await initializeGitRepo(root)

    const committedPath = path.join(root, 'committed.ts')
    const stagedPath = path.join(root, 'staged.ts')
    const unstagedPath = path.join(root, 'unstaged.ts')
    writeFileSync(committedPath, 'export const committed = 1\n')
    writeFileSync(stagedPath, 'export const staged = 1\n')
    writeFileSync(unstagedPath, 'export const unstaged = 1\n')
    await commitAll(root, 'seed tracked files')

    const previousLastStartCommit = await runCommand(['git', 'rev-parse', 'HEAD'], root)

    writeFileSync(committedPath, 'export const committed = 2\n')
    await commitAll(root, 'commit tracked change')

    writeFileSync(stagedPath, 'export const staged = 2\n')
    await runCommand(['git', 'add', 'staged.ts'], root)

    writeFileSync(unstagedPath, 'export const unstaged = 2\n')

    writeFileSync(path.join(root, 'untracked.ts'), 'export const untracked = 1\n')

    const changedFiles = await incremental.collectChangedFiles(previousLastStartCommit)

    expect(changedFiles).toEqual(['committed.ts', 'staged.ts', 'unstaged.ts', 'untracked.ts'])
  })

  test('collectChangedFiles skips committed diff when previousLastStartCommit is null', async () => {
    const incremental = await loadIncrementalModule()
    await initializeGitRepo(root)

    writeFileSync(path.join(root, 'tracked.ts'), 'export const tracked = 1\n')
    await commitAll(root, 'seed tracked file')

    writeFileSync(path.join(root, 'committed-only.ts'), 'export const committedOnly = 1\n')
    await commitAll(root, 'commit without baseline')

    writeFileSync(path.join(root, 'staged-only.ts'), 'export const stagedOnly = 1\n')
    await runCommand(['git', 'add', 'staged-only.ts'], root)

    writeFileSync(path.join(root, 'unstaged-only.ts'), 'export const unstagedOnly = 1\n')
    writeFileSync(path.join(root, 'untracked-only.ts'), 'export const untrackedOnly = 1\n')

    const changedFiles = await incremental.collectChangedFiles(null)

    expect(changedFiles).toEqual(['staged-only.ts', 'unstaged-only.ts', 'untracked-only.ts'])
  })

  test('collectChangedFiles preserves literal filenames with newlines', async () => {
    const incremental = await loadIncrementalModule()
    await initializeGitRepo(root)

    const committedName = 'committed\nname.ts'
    const stagedName = 'staged\nname.ts'
    const unstagedName = 'unstaged\nname.ts'
    const untrackedName = 'untracked\nname.ts'

    writeFileSync(path.join(root, committedName), 'export const committed = 1\n')
    writeFileSync(path.join(root, stagedName), 'export const staged = 1\n')
    writeFileSync(path.join(root, unstagedName), 'export const unstaged = 1\n')
    await commitAll(root, 'seed tracked files with newline names')

    const previousLastStartCommit = await runCommand(['git', 'rev-parse', 'HEAD'], root)

    writeFileSync(path.join(root, committedName), 'export const committed = 2\n')
    await commitAll(root, 'commit tracked newline name change')

    writeFileSync(path.join(root, stagedName), 'export const staged = 2\n')
    await runCommand(['git', 'add', stagedName], root)

    writeFileSync(path.join(root, unstagedName), 'export const unstaged = 2\n')

    writeFileSync(path.join(root, untrackedName), 'export const untracked = 1\n')

    const changedFiles = await incremental.collectChangedFiles(previousLastStartCommit)

    expect(changedFiles).toEqual([committedName, stagedName, unstagedName, untrackedName].toSorted())
  })

  test('buildPhase1Fingerprint changes when mirrored source hash changes', async () => {
    const incremental = await loadIncrementalModule()

    const a = incremental.buildPhase1Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      testFileHash: 'test-hash',
      testSource: 'it(...)',
      mirroredSourceHash: 'src-a',
      phaseVersion: 'v1',
    })
    const b = incremental.buildPhase1Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      testFileHash: 'test-hash',
      testSource: 'it(...)',
      mirroredSourceHash: 'src-b',
      phaseVersion: 'v1',
    })

    expect(a).not.toBe(b)
  })

  test('buildPhase2Fingerprint changes when extracted context changes', async () => {
    const incremental = await loadIncrementalModule()

    const a = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask and persists provider output.',
      keywords: ['task-create'],
      phaseVersion: 'v1',
    })
    const b = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask, enriches metadata, and persists provider output.',
      keywords: ['task-create'],
      phaseVersion: 'v1',
    })

    expect(a).not.toBe(b)
  })

  test('selectIncrementalWork marks Phase 1 and Phase 2 when a dependency path changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: ['src/tools/create-task.ts'],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork reruns only Phase 2 when only the Phase 2 version changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: [],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2-old', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
          'tests/tools/no-behavior.test.ts::suite > pending': createManifestTestEntry({
            testFile: 'tests/tools/no-behavior.test.ts',
            testName: 'suite > pending',
            dependencyPaths: ['tests/tools/no-behavior.test.ts'],
            phase1Fingerprint: 'fp3',
            phase2Fingerprint: null,
            extractedArtifactPath: null,
            domain: 'tools',
            lastPhase1CompletedAt: null,
            lastPhase2CompletedAt: null,
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2-new', reports: 'r1' },
      discoveredTestKeys: [
        'tests/tools/create-task.test.ts::suite > case',
        'tests/tools/no-behavior.test.ts::suite > pending',
      ],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual([])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork reports rebuild only when only the report version changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: [],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1-old' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1-new' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual([])
    expect(selection.phase2aSelectedTestKeys).toEqual([])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(true)
  })

  test('selectIncrementalWork selects newly discovered tests for both phases', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: [],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {},
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > new case'],
      previousConsolidatedManifest: null,
    })

    expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > new case'])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > new case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual([])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork selects all consolidated ids when phase1 changes may produce new consolidated ids', async () => {
    const incremental = await loadIncrementalModule()

    const previousConsolidatedManifest: IncrementalModule.ConsolidatedManifest = {
      version: 1,
      entries: {
        'tools::old-feature': {
          consolidatedId: 'tools::old-feature',
          domain: 'tools',
          featureName: 'Old feature',
          sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
          sourceBehaviorIds: ['tests/tools/create-task.test.ts::suite > case'],
          supportingInternalBehaviorIds: [],
          isUserFacing: true,
          featureKey: 'old-feature',
          keywords: ['old-keyword'],
          sourceDomains: ['tools'],
          phase2Fingerprint: 'fp',
          lastConsolidatedAt: '2026-04-20T12:00:00.000Z',
        },
      },
    }

    const selection = incremental.selectIncrementalWork({
      changedFiles: ['src/tools/create-task.ts'],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2Fingerprint: 'fp2',
            extractedArtifactPath: 'reports/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2CompletedAt: 'y',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest,
    })

    expect(selection.phase1SelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual([])
    expect(selection.phase3SelectedConsolidatedIds).toEqual(['tools::old-feature'])
    expect(selection.reportRebuildOnly).toBe(false)
  })

  test('selectIncrementalWork selects affected feature keys when phase2a metadata changed', async () => {
    const incremental = await loadIncrementalModule()

    const selection = incremental.selectIncrementalWork({
      changedFiles: ['src/tools/create-task.ts'],
      previousManifest: {
        version: 1,
        lastStartCommit: 'abc',
        lastStartedAt: 'x',
        lastCompletedAt: 'y',
        phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
        tests: {
          'tests/tools/create-task.test.ts::suite > case': createManifestTestEntry({
            testFile: 'tests/tools/create-task.test.ts',
            testName: 'suite > case',
            dependencyPaths: ['tests/tools/create-task.test.ts', 'src/tools/create-task.ts'],
            phase1Fingerprint: 'fp1',
            phase2aFingerprint: 'fp2a',
            phase2Fingerprint: 'fp2b',
            behaviorId: 'tests/tools/create-task.test.ts::suite > case',
            featureKey: 'task-creation',
            extractedArtifactPath: 'reports/audit-behavior/behaviors/tools/create-task.test.behaviors.md',
            domain: 'tools',
            lastPhase1CompletedAt: 'x',
            lastPhase2aCompletedAt: 'y',
            lastPhase2CompletedAt: 'z',
          }),
        },
      },
      currentPhaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
      discoveredTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
      previousConsolidatedManifest: {
        version: 1,
        entries: {
          'task-creation::task-creation': {
            consolidatedId: 'task-creation::task-creation',
            domain: 'tools',
            featureName: 'Task creation',
            sourceTestKeys: ['tests/tools/create-task.test.ts::suite > case'],
            sourceBehaviorIds: ['tests/tools/create-task.test.ts::suite > case'],
            supportingInternalBehaviorIds: [],
            isUserFacing: true,
            featureKey: 'task-creation',
            keywords: ['task-create'],
            sourceDomains: ['tools'],
            phase2Fingerprint: 'fp',
            lastConsolidatedAt: '2026-04-21T12:00:00.000Z',
          },
        },
      },
    })

    expect(selection.phase2aSelectedTestKeys).toEqual(['tests/tools/create-task.test.ts::suite > case'])
    expect(selection.phase2bSelectedFeatureKeys).toEqual(['task-creation'])
    expect(selection.phase3SelectedConsolidatedIds).toEqual(['task-creation::task-creation'])
  })

  test('saveManifest writes through a temp file and atomically renames it into place', async () => {
    const renameSpy = spyOn(fsPromises, 'rename')
    const incremental = await loadIncrementalModule()

    await incremental.saveManifest(incremental.createEmptyManifest())

    const reportEntries = readdirSync(reportsDir)
    expect(reportEntries).toEqual(['incremental-manifest.json'])
    expect(renameSpy).toHaveBeenCalledTimes(1)
    const firstRenameCall = renameSpy.mock.calls[0]
    assert(firstRenameCall !== undefined, 'Expected rename to be called')
    expect(firstRenameCall[0]).not.toBe(manifestPath)
    expect(firstRenameCall[1]).toBe(manifestPath)
  })

  test('startup writes lastStartCommit to the manifest before phase execution', async () => {
    await initializeGitRepo(root)
    const currentHead = await runCommand(['git', 'rev-parse', 'HEAD'], root)

    await loadBehaviorAuditEntryPoint(crypto.randomUUID())

    const savedManifestJson: unknown = JSON.parse(await Bun.file(manifestPath).text())
    assert(isSavedManifest(savedManifestJson), 'Saved manifest shape mismatch')

    expect(savedManifestJson.lastStartCommit).toBe(currentHead)
    expect(savedManifestJson.lastStartedAt).not.toBeNull()
    expect(phase1Calls).toBe(1)
    expect(phase1ManifestSnapshot).not.toBeNull()
    assert(phase1ManifestSnapshot !== null, 'Expected phase1 manifest snapshot')
    expect(JSON.parse(phase1ManifestSnapshot)).toMatchObject({
      lastStartCommit: currentHead,
    })
  })

  test('startup stops on corrupt manifest before overwriting it', async () => {
    await initializeGitRepo(root)

    await Bun.write(manifestPath, '{broken json')

    const errorCalls: string[] = []
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: readonly unknown[]) => {
      errorCalls.push(args.map(String).join(' '))
    })
    const processExitSpy = spyOn(process, 'exit').mockImplementation(makeProcessExitThrow as typeof process.exit)

    await expect(loadBehaviorAuditEntryPoint(crypto.randomUUID())).rejects.toThrow('process.exit:1')
    expect(await Bun.file(manifestPath).text()).toBe('{broken json')
    expect(errorCalls.some((line) => line.includes('Fatal error:'))).toBe(true)
    expect(phase1Calls).toBe(0)

    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  test('startup stops on schema-invalid manifest before overwriting it', async () => {
    await initializeGitRepo(root)

    await Bun.write(
      manifestPath,
      JSON.stringify({
        version: 2,
        tests: {},
      }),
    )

    const errorCalls: string[] = []
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: readonly unknown[]) => {
      errorCalls.push(args.map(String).join(' '))
    })
    const processExitSpy = spyOn(process, 'exit').mockImplementation(makeProcessExitThrow as typeof process.exit)

    await expect(loadBehaviorAuditEntryPoint(crypto.randomUUID())).rejects.toThrow('process.exit:1')
    expect(await Bun.file(manifestPath).text()).toBe('{"version":2,"tests":{}}')
    expect(errorCalls.some((line) => line.includes('Fatal error:'))).toBe(true)
    expect(phase1Calls).toBe(0)

    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })

  test('buildPhase2Fingerprint changes when canonical keywords change', async () => {
    const incremental = await loadIncrementalModule()

    const a = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask and persists provider output.',
      keywords: ['task-create', 'task-save'],
      phaseVersion: 'v1',
    })
    const b = incremental.buildPhase2Fingerprint({
      testKey: 'tests/tools/a.test.ts::suite > case',
      behavior: 'When the user creates a task, the bot saves it.',
      context: 'Calls createTask and persists provider output.',
      keywords: ['task-create', 'task-persist'],
      phaseVersion: 'v1',
    })

    expect(a).not.toBe(b)
  })

  test('createEmptyProgress returns checkpoint-only version 5 progress', async () => {
    const mod = await loadProgressModule(crypto.randomUUID())
    const progress = mod.createEmptyProgress(2)

    expect(progress.version).toBe(5)
    expect(progress.phase2a).not.toHaveProperty('classifiedBehaviors')
    expect(progress.phase2b).not.toHaveProperty('consolidations')
    expect(progress.phase3).not.toHaveProperty('evaluations')
  })

  test('validateOrMigrateProgress resets non-V4/V5 progress to fresh V5', async () => {
    const { validateOrMigrateProgress } = await loadProgressMigrateModule()
    const result = validateOrMigrateProgress({ startedAt: '2025-01-01T00:00:00Z', phase1: {} })
    expect(result).not.toBeNull()
    expect(result!.version).toBe(5)
    expect(result!.phase1.status).toBe('not-started')
  })

  test('startup passes changed tests through phase2a and phase2b without touching unrelated candidate features', async () => {
    const calls: { readonly phase2a: readonly string[]; readonly phase2b: readonly string[] }[] = []

    const deps: BehaviorAuditDeps = {
      requireOpenAiApiKey: () => {},
      prepareIncrementalRun: () =>
        Promise.resolve({
          previousManifest: {
            version: 1,
            lastStartCommit: null,
            lastStartedAt: null,
            lastCompletedAt: null,
            phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
            tests: {},
          },
          previousLastStartCommit: null,
          updatedManifest: {
            version: 1,
            lastStartCommit: 'head-1',
            lastStartedAt: '2026-04-22T12:00:00.000Z',
            lastCompletedAt: null,
            phaseVersions: { phase1: 'p1', phase2: 'p2', reports: 'r1' },
            tests: {},
          },
        }),
      selectIncrementalRunWork: () =>
        Promise.resolve({
          parsedFiles: [
            {
              filePath: 'tests/tools/sample.test.ts',
              tests: [{ name: 'sample', fullPath: 'sample', source: '', startLine: 1, endLine: 1 }],
            },
          ],
          previousConsolidatedManifest: null,
          selection: {
            phase1SelectedTestKeys: ['tests/tools/sample.test.ts::sample'],
            phase2aSelectedTestKeys: ['tests/tools/sample.test.ts::sample'],
            phase2bSelectedFeatureKeys: [],
            phase3SelectedConsolidatedIds: [],
            reportRebuildOnly: false,
          },
        }),
      loadOrCreateProgress: () =>
        Promise.resolve({
          version: 5,
          startedAt: '2026-04-22T12:00:00.000Z',
          phase1: {
            status: 'not-started',
            completedTests: {},
            failedTests: {},
            completedFiles: [],
            stats: { filesTotal: 1, filesDone: 0, testsExtracted: 0, testsFailed: 0 },
          },
          phase1b: {
            status: 'not-started',
            lastRunAt: null,
            threshold: 0,
            minClusterSize: 2,
            linkage: 'single',
            maxClusterSize: 0,
            gapThreshold: 0,
            embeddingModel: '',
            embeddingBaseUrl: '',
            embeddingCachePath: null,
            stats: { slugsBefore: 0, slugsAfter: 0, mergesApplied: 0, behaviorsUpdated: 0, keywordsRemapped: 0 },
          },
          phase2a: {
            status: 'not-started',
            completedBehaviors: {},
            failedBehaviors: {},
            stats: { behaviorsTotal: 0, behaviorsDone: 0, behaviorsFailed: 0 },
          },
          phase2b: {
            status: 'not-started',
            completedFeatureKeys: {},
            failedFeatureKeys: {},
            stats: {
              featureKeysTotal: 0,
              featureKeysDone: 0,
              featureKeysFailed: 0,
              behaviorsConsolidated: 0,
            },
          },
          phase3: {
            status: 'not-started',
            completedConsolidatedIds: {},
            failedConsolidatedIds: {},
            stats: { consolidatedIdsTotal: 0, consolidatedIdsDone: 0, consolidatedIdsFailed: 0 },
          },
        }),
      createProgressReporter: () => createNoopProgressReporter(),
      rebuildReportsFromStoredResults: () => Promise.resolve(),
      runPhase1IfNeeded: () => Promise.resolve(),
      runPhase1bIfNeeded: () => Promise.resolve(),
      runPhase2aIfNeeded: (_progress, _manifest, selectedTestKeys) => {
        calls.push({ phase2a: [...selectedTestKeys].toSorted(), phase2b: [] })
        return Promise.resolve(new Set(['task-creation']))
      },
      runPhase2bIfNeeded: (_progress, _phaseVersion, selectedFeatureKeys) => {
        const last = calls[calls.length - 1]
        assertPhase2aBeforePhase2b(last, 'Expected phase2a call before phase2b')
        calls[calls.length - 1] = {
          phase2a: last.phase2a,
          phase2b: [...selectedFeatureKeys].toSorted(),
        }
        return Promise.resolve({ version: 1, entries: {} })
      },
      saveConsolidatedManifest: () => Promise.resolve(),
      runPhase3IfNeeded: () => Promise.resolve(),
      stdout: { isTTY: false },
      isTestEnvironment: true,
      log: { log: mock(() => {}) },
    }

    await runBehaviorAudit(deps)

    expect(calls).toEqual([
      {
        phase2a: ['tests/tools/sample.test.ts::sample'],
        phase2b: ['task-creation'],
      },
    ])
  })
})
