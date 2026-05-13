import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { EXCLUDED_PREFIXES, PROJECT_ROOT } from './config.js'
import { runPhase2b } from './consolidate.js'
import type { ConsolidatedManifest, IncrementalManifest, IncrementalSelection } from './incremental.js'
import {
  captureRunStart,
  collectChangedFiles,
  createEmptyConsolidatedManifest,
  createEmptyManifest,
  loadConsolidatedManifest,
  loadManifest,
  saveManifest,
  selectIncrementalWork,
} from './incremental.js'
import { loadProgress, saveProgress } from './progress-io.js'
import type {
  BehaviorAuditProgressRenderer,
  BehaviorAuditProgressReporter,
  CreateProgressReporterInput,
} from './progress-reporter.js'
import { createEmptyProgress } from './progress.js'
import type { Progress } from './progress.js'
import type { ParsedTestFile } from './test-parser.js'
import { parseTestFile } from './test-parser.js'

export function requireOpenAiApiKey(): void {
  const apiKey = process.env['OPENAI_API_KEY']
  if (apiKey !== undefined && apiKey.trim().length > 0) {
    return
  }

  throw new Error('Behavior audit requires OPENAI_API_KEY to be set')
}

export async function discoverTestFiles(): Promise<string[]> {
  const testDir = join(PROJECT_ROOT, 'tests')
  const files: string[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    const subdirs: string[] = []
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        subdirs.push(fullPath)
      } else if (entry.name.endsWith('.test.ts')) {
        const relPath = relative(PROJECT_ROOT, fullPath)
        const excluded = EXCLUDED_PREFIXES.some((p) => relPath.startsWith(p))
        if (!excluded) {
          files.push(relPath)
        }
      }
    }
    await Promise.all(subdirs.map((subdir) => walk(subdir)))
  }

  await walk(testDir)
  return files.toSorted()
}

export async function loadOrCreateProgress(testCount: number): Promise<Progress> {
  const loaded = await loadProgress()
  if (loaded === null) {
    const fresh = createEmptyProgress(testCount)
    await saveProgress(fresh)
    return fresh
  }
  return loaded
}

export function parseDiscoveredTestFiles(testFilePaths: readonly string[]): Promise<readonly ParsedTestFile[]> {
  return Promise.all(
    testFilePaths.map(async (filePath) => {
      const content = await Bun.file(join(PROJECT_ROOT, filePath)).text()
      return parseTestFile(filePath, content)
    }),
  )
}

export function getDiscoveredTestKeys(parsedFiles: readonly ParsedTestFile[]): readonly string[] {
  return parsedFiles
    .flatMap((parsedFile) => parsedFile.tests.map((testCase) => `${parsedFile.filePath}::${testCase.fullPath}`))
    .toSorted()
}

function resolveRunStartManifest(manifest: Awaited<ReturnType<typeof loadManifest>>): IncrementalManifest {
  if (manifest === null) {
    return createEmptyManifest()
  }
  return manifest
}

async function resolveHeadCommit(): Promise<string> {
  const proc = Bun.spawn(['git', 'rev-parse', 'HEAD'], {
    cwd: PROJECT_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error('Failed to resolve HEAD commit')
  }
  return output.trim()
}

export async function prepareIncrementalRun(): Promise<{
  readonly previousManifest: IncrementalManifest
  readonly previousLastStartCommit: string | null
  readonly updatedManifest: IncrementalManifest
}> {
  const previousManifest = resolveRunStartManifest(await loadManifest())
  const currentHead = await resolveHeadCommit()
  const { previousLastStartCommit, updatedManifest } = captureRunStart(
    previousManifest,
    currentHead,
    new Date().toISOString(),
  )
  await saveManifest(updatedManifest)
  return { previousManifest, previousLastStartCommit, updatedManifest }
}

export async function selectIncrementalRunWork(input: {
  readonly previousManifest: IncrementalManifest
  readonly updatedManifest: IncrementalManifest
  readonly previousLastStartCommit: string | null
  readonly log: Pick<typeof console, 'log'>
}): Promise<{
  readonly parsedFiles: readonly ParsedTestFile[]
  readonly previousConsolidatedManifest: ConsolidatedManifest | null
  readonly selection: IncrementalSelection
}> {
  const testFilePaths = await discoverTestFiles()
  input.log.log(`Found ${testFilePaths.length} test files (after exclusions)\n`)
  const parsedFiles = await parseDiscoveredTestFiles(testFilePaths)
  const discoveredTestKeys = getDiscoveredTestKeys(parsedFiles)
  const changedFiles = await collectChangedFiles(input.previousLastStartCommit)
  const previousConsolidatedManifest = await loadConsolidatedManifest()
  const selection = selectIncrementalWork({
    changedFiles,
    previousManifest: input.previousManifest,
    currentPhaseVersions: input.updatedManifest.phaseVersions,
    discoveredTestKeys,
    previousConsolidatedManifest,
  })
  return { parsedFiles, previousConsolidatedManifest, selection }
}

export async function runPhase2bIfNeeded(input: {
  readonly progress: Progress
  readonly phase2Version: string
  readonly selectedFeatureKeys: ReadonlySet<string>
  readonly reporter: BehaviorAuditProgressReporter
}): Promise<ConsolidatedManifest> {
  const loadedConsolidatedManifest = await loadConsolidatedManifest()
  let existingManifest: ConsolidatedManifest
  if (loadedConsolidatedManifest === null) {
    existingManifest = createEmptyConsolidatedManifest()
  } else {
    existingManifest = loadedConsolidatedManifest
  }

  const loadedManifest = await loadManifest()
  let currentManifest: IncrementalManifest
  if (loadedManifest === null) {
    currentManifest = createEmptyManifest()
  } else {
    currentManifest = loadedManifest
  }

  return runPhase2b(input.progress, existingManifest, input.phase2Version, input.selectedFeatureKeys, currentManifest, {
    reporter: input.reporter,
  })
}

export function toConfiguredProgressRenderer(value: string): BehaviorAuditProgressRenderer {
  switch (value) {
    case 'text':
    case 'listr2':
      return value
    default:
      return 'auto'
  }
}

export function createRunReporter(input: {
  readonly createProgressReporter: (input: CreateProgressReporterInput) => BehaviorAuditProgressReporter
  readonly configuredRenderer: string
  readonly isTTY: boolean
  readonly isTestEnvironment: boolean
  readonly log: Pick<typeof console, 'log'>
}): BehaviorAuditProgressReporter {
  return input.createProgressReporter({
    renderer: toConfiguredProgressRenderer(input.configuredRenderer),
    isTTY: input.isTTY,
    isTestEnvironment: input.isTestEnvironment,
    log: (line) => {
      input.log.log(line)
    },
  })
}

export function isTestEnvironment(): boolean {
  if (process.env['NODE_ENV'] === 'test') {
    return true
  }

  return process.env['BUN_ENV'] === 'test'
}
