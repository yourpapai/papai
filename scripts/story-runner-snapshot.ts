// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readdir, readlink, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

import {
  captureCandidateStoryInputs,
  type CandidateStoryManifestDependencies,
  type LoadedRuntimeInput,
  type LoadedStoryFile,
  type StoryManifest,
} from './story-manifest.js'
import { verifySnapshotTopology } from './story-runner-snapshot-topology.js'

export type CandidateStorySnapshot = Readonly<{
  root: string
  manifest: StoryManifest
  verifyIntegrity(): Promise<void>
  cleanup(): Promise<void>
}>

type SnapshotOptions = Readonly<{ root: string; seed: number; bunVersion?: string }>
export type SnapshotDependencies = Readonly<{
  afterRootCreated?(snapshotRoot: string): Promise<void>
  candidateCaptureDependencies?: CandidateStoryManifestDependencies
  changeMode?(target: string, mode: number): Promise<void>
  writeCapturedFile?(snapshotRoot: string, file: LoadedStoryFile): Promise<void>
}>

export type CandidateStorySnapshotSource = Readonly<{
  manifest: StoryManifest
  materialize(snapshotRoot: string): Promise<Readonly<{ verifyIntegrity(): Promise<void> }>>
}>

export class StorySnapshotInterruptedError extends Error {
  readonly exitCode: 130 | 143

  constructor(signal: 'SIGINT' | 'SIGTERM') {
    super(`Story snapshot construction interrupted by ${signal}`)
    this.name = 'StorySnapshotInterruptedError'
    this.exitCode = signal === 'SIGINT' ? 130 : 143
  }
}

function throwIfInterrupted(signal: 'SIGINT' | 'SIGTERM' | undefined): void {
  if (signal !== undefined) throw new StorySnapshotInterruptedError(signal)
}

async function settleStarted<T>(operations: readonly Promise<T>[], message: string): Promise<readonly T[]> {
  const results = await Promise.allSettled(operations)
  const failures = results.flatMap((result): readonly unknown[] =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, message)
  return results.flatMap((result): readonly T[] => (result.status === 'fulfilled' ? [result.value] : []))
}
const SNAPSHOT_BUNFIG = '[test]\ntimeout = 15000\n'
const SNAPSHOT_BUNFIG_PATH = 'scripts/snapshot-bunfig.toml'

async function writeCapturedFile(root: string, file: LoadedStoryFile): Promise<void> {
  const output = path.join(root, file.path)
  await mkdir(path.dirname(output), { recursive: true })
  const handle = await open(output, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o400)
  try {
    await handle.writeFile(file.bytes)
  } finally {
    await handle.close()
  }
}

async function makeTreeReadOnly(
  directory: string,
  changeMode: (target: string, mode: number) => Promise<void>,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  await settleStarted(
    entries.map(async (entry): Promise<void> => {
      if (!entry.isDirectory()) return
      const child = path.join(directory, entry.name)
      await makeTreeReadOnly(child, changeMode)
      await changeMode(child, 0o500)
    }),
    `Story snapshot permission hardening failed under ${directory}`,
  )
  await changeMode(directory, 0o500)
}

async function makeTreeRemovable(directory: string): Promise<void> {
  await chmod(directory, 0o700).catch(() => undefined)
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => makeTreeRemovable(path.join(directory, entry.name))),
  )
}

function createCleanup(snapshotRoot: string): () => Promise<void> {
  let cleanup: Promise<void> | undefined
  return () => {
    cleanup ??= makeTreeRemovable(snapshotRoot).then(() => rm(snapshotRoot, { recursive: true, force: true }))
    return cleanup
  }
}

async function writeCapturedSymlink(
  root: string,
  file: Extract<LoadedRuntimeInput, Readonly<{ kind: 'symlink' }>>,
): Promise<void> {
  const output = path.join(root, file.path)
  await mkdir(path.dirname(output), { recursive: true })
  await symlink(file.target, output)
}

async function writeCapturedDirectory(root: string, directory: string): Promise<void> {
  await mkdir(path.join(root, directory), { recursive: true })
}

type ConstructionSignals = Readonly<{
  current(): 'SIGINT' | 'SIGTERM' | undefined
  dispose(): void
}>

function captureConstructionSignals(): ConstructionSignals {
  let signal: 'SIGINT' | 'SIGTERM' | undefined
  const onInterrupt = (): void => {
    signal ??= 'SIGINT'
  }
  const onTerminate = (): void => {
    signal ??= 'SIGTERM'
  }
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onTerminate)
  return {
    current: () => signal,
    dispose: (): void => {
      process.off('SIGINT', onInterrupt)
      process.off('SIGTERM', onTerminate)
    },
  }
}

async function materializeSnapshot(
  snapshotRoot: string,
  files: readonly LoadedStoryFile[],
  runtimeDirectories: readonly string[],
  runtimeInputs: readonly LoadedRuntimeInput[],
  dependencies: SnapshotDependencies,
  signals: ConstructionSignals,
): Promise<LoadedStoryFile> {
  await dependencies.afterRootCreated?.(snapshotRoot)
  throwIfInterrupted(signals.current())
  const writeFile = dependencies.writeCapturedFile ?? writeCapturedFile
  const runtimeFiles = runtimeInputs.filter(
    (input): input is Extract<LoadedRuntimeInput, Readonly<{ kind: 'file' }>> => input.kind === 'file',
  )
  await settleStarted(
    runtimeDirectories.map((directory) => writeCapturedDirectory(snapshotRoot, directory)),
    'Story snapshot directory materialization failed',
  )
  throwIfInterrupted(signals.current())
  await settleStarted(
    [...files, ...runtimeFiles].map((file) => writeFile(snapshotRoot, file)),
    'Story snapshot materialization failed',
  )
  throwIfInterrupted(signals.current())
  const controlFile = { path: SNAPSHOT_BUNFIG_PATH, bytes: new TextEncoder().encode(SNAPSHOT_BUNFIG) }
  await writeCapturedFile(snapshotRoot, controlFile)
  throwIfInterrupted(signals.current())
  const runtimeSymlinks = runtimeInputs.filter(
    (input): input is Extract<LoadedRuntimeInput, Readonly<{ kind: 'symlink' }>> => input.kind === 'symlink',
  )
  await settleStarted(
    runtimeSymlinks.map((file) => writeCapturedSymlink(snapshotRoot, file)),
    'Story snapshot symlink creation failed',
  )
  throwIfInterrupted(signals.current())
  const changeMode = dependencies.changeMode ?? ((target, mode): Promise<void> => chmod(target, mode))
  await makeTreeReadOnly(snapshotRoot, changeMode)
  throwIfInterrupted(signals.current())
  return controlFile
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function assertSnapshotDirectories(snapshotRoot: string, filePath: string): Promise<void> {
  const parts = filePath.split('/').slice(0, -1)
  const directories = parts.map((_, index) => path.join(snapshotRoot, ...parts.slice(0, index + 1)))
  const statsByDirectory = await Promise.all(directories.map((directory) => lstat(directory).catch(() => undefined)))
  for (const stats of statsByDirectory) {
    if (stats === undefined || !stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Snapshot integrity check failed: ${filePath} has an unsafe directory`)
    }
  }
}

async function verifySnapshotFile(snapshotRoot: string, file: StoryManifest['files'][number]): Promise<void> {
  await assertSnapshotDirectories(snapshotRoot, file.path)
  const absolute = path.join(snapshotRoot, file.path)
  const before = await lstat(absolute).catch(() => undefined)
  if (before === undefined || !before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Snapshot integrity check failed: ${file.path} is not a regular file`)
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    const after = await handle.stat()
    const bytes = await handle.readFile()
    if (!after.isFile() || sha256(bytes) !== file.sha256) {
      throw new Error(`Snapshot integrity check failed: ${file.path} hash changed`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Snapshot integrity check failed')) throw error
    throw new Error(`Snapshot integrity check failed: ${file.path} cannot be read safely`, { cause: error })
  } finally {
    await handle?.close()
  }
}

async function verifySnapshotRuntimeInput(
  snapshotRoot: string,
  input: StoryManifest['runtimeInputs']['files'][number],
): Promise<void> {
  if (input.kind === 'file') {
    await verifySnapshotFile(snapshotRoot, input)
    return
  }
  await assertSnapshotDirectories(snapshotRoot, input.path)
  const absolute = path.join(snapshotRoot, input.path)
  const entry = await lstat(absolute).catch(() => undefined)
  if (entry === undefined || !entry.isSymbolicLink()) {
    throw new Error(`Snapshot integrity check failed: ${input.path} is not a symbolic link`)
  }
  const target = await readlink(absolute).catch((error: unknown) => {
    throw new Error(`Snapshot integrity check failed: ${input.path} cannot be read safely`, { cause: error })
  })
  if (target !== input.target || sha256(target) !== input.sha256) {
    throw new Error(`Snapshot integrity check failed: ${input.path} symlink target changed`)
  }
}

export async function createCandidateStorySnapshotSource(
  options: SnapshotOptions,
  dependencies: SnapshotDependencies = {},
): Promise<CandidateStorySnapshotSource> {
  const captured = await captureCandidateStoryInputs(options, dependencies.candidateCaptureDependencies)
  return {
    manifest: captured.manifest,
    materialize: async (snapshotRoot) => {
      const signals = captureConstructionSignals()
      try {
        const controlFile = await materializeSnapshot(
          snapshotRoot,
          captured.files,
          captured.runtimeInputs.directories,
          captured.runtimeInputs.files,
          dependencies,
          signals,
        )
        const controlManifestFile = { path: controlFile.path, sha256: sha256(controlFile.bytes) }
        const verifyIntegrity = (): Promise<void> =>
          Promise.all([
            verifySnapshotTopology(snapshotRoot, captured.manifest, controlManifestFile),
            ...captured.manifest.files.map((file) => verifySnapshotFile(snapshotRoot, file)),
            ...captured.manifest.runtimeInputs.files.map((input) => verifySnapshotRuntimeInput(snapshotRoot, input)),
            verifySnapshotFile(snapshotRoot, controlManifestFile),
          ]).then(() => undefined)
        return { verifyIntegrity }
      } finally {
        signals.dispose()
      }
    },
  }
}

export async function createCandidateStorySnapshot(
  options: SnapshotOptions,
  dependencies: SnapshotDependencies = {},
): Promise<CandidateStorySnapshot> {
  const source = await createCandidateStorySnapshotSource(options, dependencies)
  const snapshotRoot = await mkdtemp(path.join(options.root, '.papai-story-snapshot-'))
  const cleanup = createCleanup(snapshotRoot)
  try {
    const materialized = await source.materialize(snapshotRoot)
    return { root: snapshotRoot, manifest: source.manifest, ...materialized, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
