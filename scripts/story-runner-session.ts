// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

import { chmod, lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rm, symlink } from 'node:fs/promises'
import path from 'node:path'

import { hashDependencyTree } from './story-dependency-snapshot-tree.js'
import type { StoryDependencySnapshot } from './story-dependency-snapshot.js'
import { acquireCandidateDependencySnapshot } from './story-manifest-dependencies.js'
import type { StoryManifest } from './story-manifest.js'
import {
  copyReports,
  createReportFiles,
  reporterMappings,
  type ReportMapping,
  type SessionFileSystem,
  verifyReportFiles,
} from './story-runner-session-reports.js'
import {
  createCandidateStorySnapshotSource,
  type CandidateStorySnapshotSource,
  type SnapshotDependencies,
} from './story-runner-snapshot.js'

export type StoryRunnerSession = Readonly<{
  root: string
  appRoot: string
  tempRoot: string
  manifest: StoryManifest
  childReporterArguments: readonly string[]
  reportPaths: readonly string[]
  verifyIntegrity(): Promise<void>
  copyReports(): Promise<void>
  cleanup(): Promise<void>
}>

export type StoryRunnerSessionOptions = Readonly<{
  root: string
  seed: number
  bunVersion?: string
  reporterArguments: readonly string[]
}>

export type StoryRunnerSessionDependencies = Readonly<{
  acquireDependencySnapshot?(
    options: Readonly<{ projectRoot: string; cacheRoot: string; bunVersion: string }>,
  ): Promise<StoryDependencySnapshot>
  createSnapshotSource?(
    options: Readonly<{ root: string; seed: number; bunVersion?: string }>,
    dependencies: SnapshotDependencies,
  ): Promise<CandidateStorySnapshotSource>
  fileSystem?: Partial<SessionFileSystem>
}>

const fileSystem: SessionFileSystem = {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  readdir: (target) => readdir(target, { withFileTypes: true }),
  realpath,
  rm,
  symlink: (target, link): Promise<void> => symlink(target, link, 'dir'),
}

async function makeTreeRemovable(directory: string, fs: SessionFileSystem): Promise<void> {
  await fs.chmod(directory, 0o700).catch(() => undefined)
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => makeTreeRemovable(path.join(directory, entry.name), fs)),
  )
}

function cleanupSession(root: string, fs: SessionFileSystem): () => Promise<void> {
  let cleanup: Promise<void> | undefined
  return () => {
    cleanup ??= makeTreeRemovable(root, fs).then(() => fs.rm(root, { recursive: true, force: true }))
    return cleanup
  }
}

async function verifySession(
  appIntegrity: Readonly<{ verifyIntegrity(): Promise<void> }>,
  dependency: StoryDependencySnapshot,
  nodeModules: string,
  reports: readonly ReportMapping[],
  fs: SessionFileSystem,
): Promise<void> {
  await appIntegrity.verifyIntegrity()
  await verifyDependencySnapshot(dependency)
  const nodeModulesEntry = await fs.lstat(nodeModules)
  if (!nodeModulesEntry.isSymbolicLink() || (await fs.readlink(nodeModules)) !== dependency.root) {
    throw new Error('Story session dependency link does not point to the verified dependency snapshot')
  }
  await verifyReportFiles(reports, fs)
}

async function verifyDependencySnapshot(dependency: StoryDependencySnapshot): Promise<void> {
  const root = await lstat(dependency.root)
  if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o222) !== 0) {
    throw new Error('Story session dependency snapshot is unsafe')
  }
  const treeHash = await hashDependencyTree(
    dependency.root,
    { lstat, open, readlink, readdir: (target) => readdir(target, { withFileTypes: true }), realpath },
    true,
  )
  if (treeHash !== dependency.treeHash) throw new Error('Story session dependency snapshot fingerprint changed')
}

export async function createStoryRunnerSession(
  options: StoryRunnerSessionOptions,
  dependencies: StoryRunnerSessionDependencies = {},
): Promise<StoryRunnerSession> {
  const fs: SessionFileSystem = { ...fileSystem, ...dependencies.fileSystem }
  const dependency = await acquireSessionDependency(options, dependencies)
  await verifyDependencySnapshot(dependency)
  const source = await captureSessionSource(options, dependencies, dependency)
  return materializeSession(options, source, dependency, fs)
}

function acquireSessionDependency(
  options: StoryRunnerSessionOptions,
  dependencies: StoryRunnerSessionDependencies,
): Promise<StoryDependencySnapshot> {
  const bunVersion = options.bunVersion ?? Bun.version
  if (dependencies.acquireDependencySnapshot === undefined) {
    return acquireCandidateDependencySnapshot(options.root, bunVersion, {})
  }
  return dependencies.acquireDependencySnapshot({
    projectRoot: options.root,
    cacheRoot: process.env['PAPAI_STORY_DEPENDENCY_CACHE_ROOT'] ?? path.join(options.root, '.story-dependencies'),
    bunVersion,
  })
}

function captureSessionSource(
  options: StoryRunnerSessionOptions,
  dependencies: StoryRunnerSessionDependencies,
  dependency: StoryDependencySnapshot,
): Promise<CandidateStorySnapshotSource> {
  const sourceFactory = dependencies.createSnapshotSource ?? createCandidateStorySnapshotSource
  return sourceFactory(options, {
    candidateCaptureDependencies: { acquireDependencySnapshot: () => Promise.resolve(dependency) },
  })
}

async function materializeSession(
  options: StoryRunnerSessionOptions,
  source: CandidateStorySnapshotSource,
  dependency: StoryDependencySnapshot,
  fs: SessionFileSystem,
): Promise<StoryRunnerSession> {
  const root = await fs.mkdtemp(path.join(options.root, '.papai-story-session-'))
  const cleanup = cleanupSession(root, fs)
  try {
    const appRoot = path.join(root, 'app')
    const tempRoot = path.join(root, 'tmp')
    const nodeModules = path.join(root, 'node_modules')
    const reportsRoot = path.join(root, 'reports')
    const mapped = reporterMappings(options.reporterArguments, options.root, root)
    await fs.mkdir(appRoot, { recursive: true, mode: 0o700 })
    const appIntegrity = await source.materialize(appRoot)
    await fs.mkdir(tempRoot, { recursive: true, mode: 0o700 })
    await fs.chmod(tempRoot, 0o700)
    await fs.mkdir(reportsRoot, { recursive: true, mode: 0o700 })
    await createReportFiles(mapped.reports, fs)
    await fs.symlink(dependency.root, nodeModules, 'dir')
    const verifyIntegrity = (): Promise<void> =>
      verifySession(appIntegrity, dependency, nodeModules, mapped.reports, fs)
    return {
      root,
      appRoot,
      tempRoot,
      manifest: source.manifest,
      childReporterArguments: mapped.argumentsForChild,
      reportPaths: mapped.reports.map((report) => report.livePath),
      verifyIntegrity,
      copyReports: (): Promise<void> => copyReports(mapped.reports, options.root, fs),
      cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}
