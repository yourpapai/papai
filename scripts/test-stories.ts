// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import {
  buildBaselineStoryManifest,
  buildCandidateStoryManifest,
  compareStoryManifests,
  type StoryManifest,
  writeStoryManifest,
} from './story-manifest.js'
import { removeStoryReport, STORY_JUNIT_REPORT_PATH, STORY_MANIFEST_REPORT_PATH } from './story-reports.js'
import { type ParsedStoryRunnerArguments, parseStoryRunnerArguments, STORY_SEED } from './story-runner-arguments.js'
import { sanitizedStoryEnvironment } from './story-runner-environment.js'
import {
  type CandidateStorySnapshot,
  createCandidateStorySnapshot,
  StorySnapshotInterruptedError,
} from './story-runner-snapshot.js'

export { parseStoryRunnerArguments, STORY_SEED }

type SpawnedChild = Readonly<{
  exited: Promise<number>
  kill(signal: NodeJS.Signals): void
}>

type RunnerDependencies = Readonly<{
  cwd: string
  env: Record<string, string | undefined>
  spawn(command: readonly string[], options: Parameters<typeof Bun.spawn>[1]): SpawnedChild
  discoverStories(): Promise<readonly string[]>
  discoverContracts(): Promise<readonly string[]>
  buildCandidateSnapshot?(options: Readonly<{ root: string; seed: number }>): Promise<CandidateStorySnapshot>
  buildCandidateManifest(options: Readonly<{ root: string; seed: number }>): Promise<StoryManifest>
  buildBaselineManifest(options: Readonly<{ root: string; ref: string; seed: number }>): Promise<StoryManifest>
  writeManifest(manifest: StoryManifest, outputPath: string): Promise<void>
  removeReport(reportPath: string): Promise<void>
}>

async function discoverStories(root: string): Promise<readonly string[]> {
  const files: string[] = []
  const glob = new Bun.Glob('tests/stories/**/*.story.test.ts')
  for await (const file of glob.scan({ cwd: root, onlyFiles: true })) files.push(file)
  return files.sort()
}

async function discoverContracts(root: string): Promise<readonly string[]> {
  const files: string[] = []
  const glob = new Bun.Glob('tests/stories/harness/**/*.test.ts')
  for await (const file of glob.scan({ cwd: root, onlyFiles: true })) files.push(file)
  return files.sort()
}

function waitForChild(child: SpawnedChild): Promise<number> {
  return child.exited
}

type SnapshotLifecycle = Readonly<{
  attachChild(child: SpawnedChild): void
  interruptedExitCode(): number | undefined
}>

async function withSnapshotLifecycle(
  snapshot: CandidateStorySnapshot,
  run: (lifecycle: SnapshotLifecycle) => Promise<number>,
): Promise<number> {
  let signal: 'SIGINT' | 'SIGTERM' | undefined
  let child: SpawnedChild | undefined
  const forward = (received: 'SIGINT' | 'SIGTERM'): void => {
    if (signal !== undefined) return
    signal = received
    child?.kill(received)
  }
  const onInterrupt = (): void => {
    forward('SIGINT')
  }
  const onTerminate = (): void => {
    forward('SIGTERM')
  }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  try {
    const exitCode = await run({
      attachChild: (spawned) => {
        child = spawned
        if (signal !== undefined) spawned.kill(signal)
      },
      interruptedExitCode: () => (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : undefined),
    })
    return signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : exitCode
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
    await snapshot.cleanup()
  }
}

function defaultDependencies(): RunnerDependencies {
  const cwd = process.cwd()
  return {
    cwd,
    env: process.env,
    spawn: (command, options) => Bun.spawn([...command], options),
    discoverStories: () => discoverStories(cwd),
    discoverContracts: () => discoverContracts(cwd),
    buildCandidateSnapshot: createCandidateStorySnapshot,
    buildCandidateManifest: buildCandidateStoryManifest,
    buildBaselineManifest: buildBaselineStoryManifest,
    writeManifest: writeStoryManifest,
    removeReport: removeStoryReport,
  }
}

export async function runStoryTests(
  args: readonly string[],
  dependencies: RunnerDependencies = defaultDependencies(),
): Promise<number> {
  try {
    await clearStandardReports(dependencies)
    return await executeStoryTests(parseStoryRunnerArguments(args), dependencies)
  } catch (error) {
    if (error instanceof StorySnapshotInterruptedError) return error.exitCode
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }
}

async function clearStandardReports(dependencies: RunnerDependencies): Promise<void> {
  const reportPaths = [STORY_MANIFEST_REPORT_PATH, STORY_JUNIT_REPORT_PATH]
  const results = await Promise.allSettled(
    reportPaths.map((reportPath) =>
      Promise.resolve().then(() => dependencies.removeReport(path.join(dependencies.cwd, reportPath))),
    ),
  )
  const failedPaths = reportPaths.filter((_, index) => results[index]?.status === 'rejected')
  const failures: unknown[] = []
  for (const result of results) {
    if (result.status === 'rejected') failures.push(result.reason as unknown)
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `Unable to clear standard story reports: ${failedPaths.join(', ')}`)
  }
}

function explicitBaselineRef(parsed: ParsedStoryRunnerArguments, dependencies: RunnerDependencies): string | undefined {
  const baselineRef = parsed.baselineRef ?? (parsed.compat ? dependencies.env['BASE_REF'] : undefined)
  if (parsed.compat && (baselineRef === undefined || baselineRef.trim() === '')) {
    throw new Error('Compatibility mode requires --baseline-ref=<ref> or an explicit BASE_REF')
  }
  return baselineRef
}

async function verifyCompatibility(
  parsed: ParsedStoryRunnerArguments,
  dependencies: RunnerDependencies,
  candidate?: StoryManifest,
): Promise<void> {
  const baselineRef = explicitBaselineRef(parsed, dependencies)
  const candidateManifest =
    candidate ?? (await dependencies.buildCandidateManifest({ root: dependencies.cwd, seed: parsed.seed }))
  await dependencies.writeManifest(candidateManifest, path.join(dependencies.cwd, STORY_MANIFEST_REPORT_PATH))
  if (!parsed.compat || baselineRef === undefined) return
  const baseline = await dependencies.buildBaselineManifest({
    root: dependencies.cwd,
    ref: baselineRef,
    seed: parsed.seed,
  })
  compareStoryManifests(candidateManifest, baseline)
}

async function storyFiles(
  parsed: ParsedStoryRunnerArguments,
  dependencies: RunnerDependencies,
  snapshot?: CandidateStorySnapshot,
): Promise<readonly string[]> {
  if (snapshot !== undefined) {
    const selected =
      parsed.fixture === undefined
        ? snapshot.manifest.files
            .map((file) => file.path)
            .filter((file) =>
              parsed.contracts
                ? file.startsWith('tests/stories/harness/') && file.endsWith('.test.ts')
                : file.startsWith('tests/stories/') && file.endsWith('.story.test.ts'),
            )
        : [path.relative(dependencies.cwd, path.resolve(dependencies.cwd, parsed.fixture)).split(path.sep).join('/')]
    const frozen = new Set(snapshot.manifest.files.map((file) => file.path))
    const unsupported = selected.find((file) => !frozen.has(file))
    if (unsupported !== undefined) throw new Error(`Story fixture is not a frozen snapshot input: ${unsupported}`)
    if (selected.length === 0) throw new Error('No story tests found')
    return selected.map((file) => path.join(snapshot.root, file))
  }
  const files =
    parsed.fixture === undefined
      ? await (parsed.contracts ? dependencies.discoverContracts() : dependencies.discoverStories())
      : [`./${path.relative(dependencies.cwd, path.resolve(dependencies.cwd, parsed.fixture))}`]
  if (files.length === 0) throw new Error('No story tests found')
  return files
}

async function executeStoryTests(
  parsed: ParsedStoryRunnerArguments,
  dependencies: RunnerDependencies,
): Promise<number> {
  if (parsed.manifestOnly) {
    await verifyCompatibility(parsed, dependencies)
    return 0
  }
  const snapshot = await dependencies.buildCandidateSnapshot?.({ root: dependencies.cwd, seed: parsed.seed })
  if (snapshot !== undefined) {
    return withSnapshotLifecycle(snapshot, async (lifecycle): Promise<number> => {
      await verifyCompatibility(parsed, dependencies, snapshot.manifest)
      const interrupted = lifecycle.interruptedExitCode()
      if (interrupted !== undefined) return interrupted
      const files = await storyFiles(parsed, dependencies, snapshot)
      const interruptedAfterDiscovery = lifecycle.interruptedExitCode()
      if (interruptedAfterDiscovery !== undefined) return interruptedAfterDiscovery
      await snapshot.verifyIntegrity()
      const interruptedAfterIntegrity = lifecycle.interruptedExitCode()
      if (interruptedAfterIntegrity !== undefined) return interruptedAfterIntegrity
      const child = spawnStoryChild(parsed, dependencies, files, snapshot)
      lifecycle.attachChild(child)
      const exitCode = await waitForChild(child)
      await snapshot.verifyIntegrity()
      return exitCode
    })
  }
  await verifyCompatibility(parsed, dependencies)
  const files = await storyFiles(parsed, dependencies)
  const child = spawnStoryChild(parsed, dependencies, files)
  return waitForChild(child)
}

function spawnStoryChild(
  parsed: ParsedStoryRunnerArguments,
  dependencies: RunnerDependencies,
  files: readonly string[],
  snapshot?: CandidateStorySnapshot,
): SpawnedChild {
  return dependencies.spawn(
    [
      'bun',
      '--no-env-file',
      `--config=${snapshot === undefined ? '/dev/null' : path.join(snapshot.root, 'scripts/snapshot-bunfig.toml')}`,
      'test',
      '--path-ignore-patterns',
      '',
      ...(snapshot === undefined
        ? parsed.contracts
          ? []
          : ['--preload', './tests/stories/preload.ts']
        : [
            '--preload',
            path.join(snapshot.root, 'tests/setup.ts'),
            '--preload',
            path.join(snapshot.root, 'tests/mock-reset.ts'),
            ...(parsed.contracts ? [] : ['--preload', path.join(snapshot.root, 'tests/stories/preload.ts')]),
          ]),
      ...parsed.forwarded,
      ...files,
    ],
    {
      cwd: dependencies.cwd,
      env: sanitizedStoryEnvironment(dependencies.env),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      ipc(message) {
        if (message === 'PAPAI_STORY_CHILD_READY') console.log('CHILD_READY')
        if (message === 'PAPAI_STORY_CHILD_SIGTERM') console.log('CHILD_SIGTERM')
      },
    },
  )
}

if (import.meta.main) process.exitCode = await runStoryTests(process.argv.slice(2))
