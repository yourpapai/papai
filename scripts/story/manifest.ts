// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import {
  currentStoryManifestCommit,
  loadBaselineRuntimeInputs,
  loadBaselineStoryFiles,
  resolveStoryManifestCommit,
} from './baseline.js'
import { acquireCandidateDependencySnapshot, type CandidateStoryManifestDependencies } from './dependencies.js'
import type { StoryDependencySnapshot } from './dependencies.js'
import { loadCandidateStoryFiles, type LoadedStoryFile } from './inputs.js'
import { removeStoryReport } from './reports.js'
import { hashRuntimeTree, loadCandidateRuntimeInputTree, type LoadedRuntimeInput } from './runtime-inputs.js'
import { selectStorySandboxBackend, type StorySandboxBackend } from './sandbox.js'
import { extractStoryScenarios } from './scenarios.js'

export type { CandidateStoryManifestDependencies } from './dependencies.js'
export type { LoadedStoryFile } from './inputs.js'
export type { LoadedRuntimeInput } from './runtime-inputs.js'
export type { StorySandboxBackend } from './sandbox.js'

const FILE_HASH = /^[a-f0-9]{64}$/u

const StoryFileSchema = z.strictObject({ path: z.string(), sha256: z.string().regex(FILE_HASH) })
const StoryScenarioSchema = z.strictObject({ id: z.string(), checkpoints: z.array(z.string()) })
const RuntimeFileSchema = z.strictObject({
  kind: z.literal('file'),
  path: z.string(),
  sha256: z.string().regex(FILE_HASH),
})
const RuntimeSymlinkSchema = z.strictObject({
  kind: z.literal('symlink'),
  path: z.string(),
  sha256: z.string().regex(FILE_HASH),
  target: z.string(),
})
const RuntimeInputSchema = z.discriminatedUnion('kind', [RuntimeFileSchema, RuntimeSymlinkSchema])
const RuntimeDirectoriesSchema = z.array(z.string().regex(/^(?:src|plugins|public)(?:\/[^/\\]+)*$/u)).refine(
  (directories) =>
    directories.every((directory, index) => {
      const previous = directories[index - 1]
      return index === 0 || (previous !== undefined && previous < directory)
    }),
  'Runtime directories must be unique and sorted',
)
const RuntimeInputManifestSchema = z.strictObject({
  treeHash: z.string().regex(FILE_HASH),
  directories: RuntimeDirectoriesSchema,
  files: z.array(RuntimeInputSchema),
})
const DependencySnapshotSchema = z.strictObject({
  key: z.string().regex(FILE_HASH),
  treeHash: z.string().regex(FILE_HASH),
  bunVersion: z.string().min(1),
})
const SandboxBackendSchema = z.enum(['linux-docker'])

export const StoryManifestSchema = z.strictObject({
  version: z.literal(4),
  commit: z.string().min(7),
  bunVersion: z.string().min(1),
  seed: z.number().int(),
  treeHash: z.string().regex(FILE_HASH),
  files: z.array(StoryFileSchema),
  runtimeInputs: RuntimeInputManifestSchema,
  dependencySnapshot: DependencySnapshotSchema.optional(),
  sandboxBackend: SandboxBackendSchema.optional(),
  scenarios: z.array(StoryScenarioSchema),
})

export type StoryManifest = z.infer<typeof StoryManifestSchema>
type StoryFile = z.infer<typeof StoryFileSchema>
type StoryScenario = z.infer<typeof StoryScenarioSchema>
type ManifestOptions = Readonly<{
  root: string
  seed: number
  bunVersion?: string
  sandboxBackend?: StorySandboxBackend
}>
type BaselineOptions = ManifestOptions & Readonly<{ ref: string }>
export type CapturedCandidateStoryInputs = Readonly<{
  manifest: StoryManifest
  files: readonly LoadedStoryFile[]
  runtimeInputs: Readonly<{
    manifest: StoryManifest['runtimeInputs']
    directories: readonly string[]
    files: readonly LoadedRuntimeInput[]
  }>
}>
export type StoryManifestWriteDeps = Readonly<{
  write(temporaryPath: string, contents: string): Promise<void>
  rename(temporaryPath: string, outputPath: string): Promise<void>
  removeTemporary(temporaryPath: string): Promise<void>
}>

const defaultWriteDeps: StoryManifestWriteDeps = {
  write: async (temporaryPath, contents): Promise<void> => {
    await Bun.write(temporaryPath, contents)
  },
  rename,
  removeTemporary: removeStoryReport,
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function hashTree(files: readonly StoryFile[], namespace: string): string {
  const hash = createHash('sha256')
  hash.update(namespace)
  for (const file of files) {
    const pathname = Buffer.from(file.path)
    hash.update(`${pathname.byteLength}:`)
    hash.update(pathname)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

type CandidateEvidenceMetadata = Readonly<{
  bunVersion: string
  dependencySnapshot?: StoryDependencySnapshot
  sandboxBackend?: StorySandboxBackend
}>

function candidateManifestEvidence(metadata: CandidateEvidenceMetadata): Readonly<{
  dependencySnapshot?: Readonly<{ key: string; treeHash: string; bunVersion: string }>
  sandboxBackend?: StorySandboxBackend
}> {
  const dependencySnapshot =
    metadata.dependencySnapshot === undefined
      ? {}
      : {
          dependencySnapshot: {
            key: metadata.dependencySnapshot.key,
            treeHash: metadata.dependencySnapshot.treeHash,
            bunVersion: metadata.bunVersion,
          },
        }
  const sandboxBackend = metadata.sandboxBackend === undefined ? {} : { sandboxBackend: metadata.sandboxBackend }
  return { ...dependencySnapshot, ...sandboxBackend }
}

function assembleManifest(
  loaded: readonly LoadedStoryFile[],
  runtimeInputFiles: readonly LoadedRuntimeInput[],
  runtimeDirectories: readonly string[],
  metadata: Readonly<{
    commit: string
    bunVersion: string
    seed: number
    dependencySnapshot?: StoryDependencySnapshot
    sandboxBackend?: StorySandboxBackend
  }>,
): StoryManifest {
  const files = loaded.map((file): StoryFile => ({ path: file.path, sha256: sha256(file.bytes) }))
  const runtimeFiles = runtimeInputFiles.map((file): StoryManifest['runtimeInputs']['files'][number] => {
    if (file.kind === 'file') return { kind: 'file', path: file.path, sha256: sha256(file.bytes) }
    return { kind: 'symlink', path: file.path, sha256: sha256(file.target), target: file.target }
  })
  const scenarios: StoryScenario[] = loaded
    .flatMap((file) => extractStoryScenarios(file.path, file.bytes))
    .map((scenario) => ({ ...scenario, checkpoints: [...scenario.checkpoints] }))
    .sort((left, right) => compareText(left.id, right.id))
  for (let index = 1; index < scenarios.length; index += 1) {
    if (scenarios[index - 1]?.id === scenarios[index]?.id)
      throw new Error(`Duplicate scenario id: ${scenarios[index]?.id}`)
  }
  return StoryManifestSchema.parse({
    version: 4,
    ...metadata,
    treeHash: hashTree(files, 'papai-story-tree-v1\0'),
    files,
    runtimeInputs: {
      treeHash: hashRuntimeTree(runtimeFiles, runtimeDirectories),
      directories: runtimeDirectories,
      files: runtimeFiles,
    },
    ...candidateManifestEvidence(metadata),
    scenarios,
  })
}

export async function buildCandidateStoryManifest(
  options: ManifestOptions,
  dependencies: CandidateStoryManifestDependencies = {},
): Promise<StoryManifest> {
  return (await captureCandidateStoryInputs(options, dependencies)).manifest
}

export async function captureCandidateStoryInputs(
  options: ManifestOptions,
  dependencies: CandidateStoryManifestDependencies = {},
): Promise<CapturedCandidateStoryInputs> {
  const bunVersion = options.bunVersion ?? Bun.version
  const [commit, files, runtimeInputs, dependencySnapshot] = await Promise.all([
    currentStoryManifestCommit(options.root),
    loadCandidateStoryFiles(options.root),
    loadCandidateRuntimeInputTree(options.root),
    acquireCandidateDependencySnapshot(options.root, bunVersion, dependencies),
  ])
  const manifest = assembleManifest(files, runtimeInputs.files, runtimeInputs.directories, {
    commit,
    bunVersion,
    seed: options.seed,
    dependencySnapshot,
    sandboxBackend: options.sandboxBackend ?? selectStorySandboxBackend(process.platform),
  })
  return { manifest, files, runtimeInputs: { manifest: manifest.runtimeInputs, ...runtimeInputs } }
}

export async function buildBaselineStoryManifest(options: BaselineOptions): Promise<StoryManifest> {
  const commit = await resolveStoryManifestCommit(options.root, options.ref)
  const [files, runtimeInputs] = await Promise.all([
    loadBaselineStoryFiles(options.root, commit),
    loadBaselineRuntimeInputs(options.root, commit),
  ])
  return assembleManifest(files, runtimeInputs.files, runtimeInputs.directories, {
    commit,
    bunVersion: options.bunVersion ?? Bun.version,
    seed: options.seed,
  })
}

export function compareStoryManifests(candidate: StoryManifest, baseline: StoryManifest): void {
  const current = new Map(candidate.files.map((file) => [file.path, file.sha256]))
  const previous = new Map(baseline.files.map((file) => [file.path, file.sha256]))
  const added = [...current.keys()].filter((file) => !previous.has(file)).sort()
  const removed = [...previous.keys()].filter((file) => !current.has(file)).sort()
  const changed = [...current.keys()]
    .filter((file) => previous.has(file) && current.get(file) !== previous.get(file))
    .sort()
  const scenariosMatch = JSON.stringify(candidate.scenarios) === JSON.stringify(baseline.scenarios)
  if (
    candidate.treeHash === baseline.treeHash &&
    added.length === 0 &&
    removed.length === 0 &&
    changed.length === 0 &&
    scenariosMatch
  )
    return
  const details = [
    added.length === 0 ? undefined : `added: ${added.join(', ')}`,
    removed.length === 0 ? undefined : `removed: ${removed.join(', ')}`,
    changed.length === 0 ? undefined : `changed: ${changed.join(', ')}`,
    scenariosMatch ? undefined : 'scenario metadata changed',
  ].filter((line): line is string => line !== undefined)
  if (details.length === 0) details.push('tree hash changed')
  throw new Error(`Story compatibility check failed against ${baseline.commit}: ${details.join('; ')}`)
}

export async function writeStoryManifest(
  manifest: StoryManifest,
  outputPath: string,
  deps: StoryManifestWriteDeps = defaultWriteDeps,
): Promise<void> {
  StoryManifestSchema.parse(manifest)
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await deps.write(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
    await deps.rename(temporary, outputPath)
  } catch (error) {
    try {
      await deps.removeTemporary(temporary)
    } catch (cleanupError) {
      const aggregate = new AggregateError([error, cleanupError], 'Story manifest publication and cleanup failed')
      aggregate.cause = error
      throw aggregate
    }
    throw error
  }
}
