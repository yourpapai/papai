// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, open, readdir, symlink } from 'node:fs/promises'
import path from 'node:path'

import {
  captureCandidateStoryInputs,
  type CandidateStoryManifestDependencies,
  type LoadedRuntimeInput,
  type LoadedStoryFile,
  type StoryManifest,
} from './manifest.js'
import type { StorySandboxBackend } from './sandbox.js'
import {
  type GeneratedStorySnapshotEntry,
  verifySnapshotFile,
  verifySnapshotRuntimeInput,
  verifySnapshotTopology,
} from './snapshot-integrity.js'

export type { GeneratedStorySnapshotEntry } from './snapshot-integrity.js'

export type StorySnapshotOptions = Readonly<{
  root: string
  seed: number
  bunVersion?: string
  sandboxBackend?: StorySandboxBackend
}>

export type SnapshotDependencies = Readonly<{
  afterRootCreated?(snapshotRoot: string): Promise<void>
  candidateCaptureDependencies?: CandidateStoryManifestDependencies
  changeMode?(target: string, mode: number): Promise<void>
  writeCapturedFile?(snapshotRoot: string, file: LoadedStoryFile): Promise<void>
}>

export type CandidateStorySnapshotSource = Readonly<{
  manifest: StoryManifest
  materialize(
    snapshotRoot: string,
    generatedEntries?: readonly GeneratedStorySnapshotEntry[],
  ): Promise<Readonly<{ verifyIntegrity(): Promise<void> }>>
}>

export type StorySnapshotConstructionSignals = Readonly<{
  current(): 'SIGINT' | 'SIGTERM' | undefined
  dispose(): void
}>

export function captureStorySnapshotConstructionSignals(): StorySnapshotConstructionSignals {
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

async function writeGeneratedStorySnapshotEntry(root: string, entry: GeneratedStorySnapshotEntry): Promise<void> {
  await mkdir(path.join(root, entry.path), { recursive: true })
}

async function materializeSnapshot(
  snapshotRoot: string,
  files: readonly LoadedStoryFile[],
  runtimeDirectories: readonly string[],
  runtimeInputs: readonly LoadedRuntimeInput[],
  generatedEntries: readonly GeneratedStorySnapshotEntry[],
  dependencies: SnapshotDependencies,
  signals: StorySnapshotConstructionSignals,
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
  await settleStarted(
    generatedEntries.map((entry) => writeGeneratedStorySnapshotEntry(snapshotRoot, entry)),
    'Story generated dependency entry creation failed',
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

export async function createCandidateStorySnapshotSource(
  options: StorySnapshotOptions,
  dependencies: SnapshotDependencies = {},
): Promise<CandidateStorySnapshotSource> {
  const captured = await captureCandidateStoryInputs(options, dependencies.candidateCaptureDependencies)
  return {
    manifest: captured.manifest,
    materialize: async (snapshotRoot, generatedEntries = []) => {
      const signals = captureStorySnapshotConstructionSignals()
      try {
        const controlFile = await materializeSnapshot(
          snapshotRoot,
          captured.files,
          captured.runtimeInputs.directories,
          captured.runtimeInputs.files,
          generatedEntries,
          dependencies,
          signals,
        )
        const controlManifestFile = { path: controlFile.path, sha256: sha256(controlFile.bytes) }
        const verifyIntegrity = (): Promise<void> =>
          Promise.all([
            verifySnapshotTopology(snapshotRoot, captured.manifest, controlManifestFile, generatedEntries),
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
