// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdir, rename } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { z } from 'zod'

import { CONSOLIDATED_MANIFEST_PATH, INCREMENTAL_MANIFEST_PATH, PROJECT_ROOT } from './config.js'
export {
  buildPhase1Fingerprint,
  buildPhase2Fingerprint,
  buildPhase2ConsolidationFingerprint,
  buildPhase3EvaluationFingerprint,
  hashText,
} from './fingerprints.js'

export interface ManifestTestEntry {
  readonly testFile: string
  readonly testName: string
  readonly dependencyPaths: readonly string[]
  readonly phase1Fingerprint: string | null
  readonly phase2aFingerprint: string | null
  readonly phase2Fingerprint: string | null
  readonly behaviorId: string | null
  readonly featureKey?: string | null
  readonly extractedArtifactPath?: string | null
  readonly classifiedArtifactPath: string | null
  readonly domain: string
  readonly lastPhase1CompletedAt: string | null
  readonly lastPhase2aCompletedAt: string | null
  readonly lastPhase2CompletedAt: string | null
}

export interface IncrementalManifest {
  readonly version: 1
  readonly lastStartCommit: string | null
  readonly lastStartedAt: string | null
  readonly lastCompletedAt: string | null
  readonly phaseVersions: {
    readonly phase1: string
    readonly phase2: string
    readonly reports: string
  }
  readonly tests: Record<string, ManifestTestEntry>
}

export interface IncrementalSelection {
  readonly phase1SelectedTestKeys: readonly string[]
  readonly phase2aSelectedTestKeys: readonly string[]
  readonly phase2bSelectedFeatureKeys: readonly string[]
  readonly phase3SelectedConsolidatedIds: readonly string[]
  readonly reportRebuildOnly: boolean
}

export type { SelectIncrementalWorkInput } from './incremental-selection.js'
export { selectIncrementalWork } from './incremental-selection.js'

export interface ConsolidatedManifestEntry {
  readonly consolidatedId: string
  readonly domain: string
  readonly featureName: string
  readonly consolidatedArtifactPath?: string | null
  readonly evaluatedArtifactPath?: string | null
  readonly sourceTestKeys: readonly string[]
  readonly sourceBehaviorIds: readonly string[]
  readonly supportingInternalBehaviorIds: readonly string[]
  readonly isUserFacing: boolean
  readonly featureKey: string
  readonly keywords: readonly string[]
  readonly sourceDomains: readonly string[]
  readonly phase2Fingerprint: string | null
  readonly phase3Fingerprint?: string | null
  readonly lastConsolidatedAt: string | null
  readonly lastEvaluatedAt?: string | null
}

export interface ConsolidatedManifest {
  readonly version: 1
  readonly entries: Record<string, ConsolidatedManifestEntry>
}

const ManifestTestEntrySchema = z.object({
  testFile: z.string(),
  testName: z.string(),
  dependencyPaths: z.array(z.string()),
  phase1Fingerprint: z.string().nullable(),
  phase2aFingerprint: z.string().nullable().default(null),
  phase2Fingerprint: z.string().nullable(),
  behaviorId: z.string().nullable().default(null),
  featureKey: z.string().nullable().optional(),
  extractedArtifactPath: z.string().nullable().optional(),
  classifiedArtifactPath: z.string().nullable().default(null),
  domain: z.string(),
  lastPhase1CompletedAt: z.string().nullable(),
  lastPhase2aCompletedAt: z.string().nullable().default(null),
  lastPhase2CompletedAt: z.string().nullable(),
}) satisfies z.ZodType<ManifestTestEntry>

const IncrementalManifestSchema = z.object({
  version: z.literal(1),
  lastStartCommit: z.string().nullable().default(null),
  lastStartedAt: z.string().nullable().default(null),
  lastCompletedAt: z.string().nullable().default(null),
  phaseVersions: z
    .object({
      phase1: z.string().default(''),
      phase2: z.string().default(''),
      reports: z.string().default(''),
    })
    .default({ phase1: '', phase2: '', reports: '' }),
  tests: z.record(z.string(), ManifestTestEntrySchema).default({}),
})

const ConsolidatedManifestEntrySchema = z.object({
  consolidatedId: z.string(),
  domain: z.string(),
  featureName: z.string(),
  consolidatedArtifactPath: z.string().nullable().default(null),
  evaluatedArtifactPath: z.string().nullable().default(null),
  sourceTestKeys: z.array(z.string()),
  sourceBehaviorIds: z.array(z.string()).default([]),
  supportingInternalBehaviorIds: z.array(z.string()).default([]),
  isUserFacing: z.boolean(),
  featureKey: z.string(),
  keywords: z.array(z.string()).default([]),
  sourceDomains: z.array(z.string()).default([]),
  phase2Fingerprint: z.string().nullable(),
  phase3Fingerprint: z.string().nullable().default(null),
  lastConsolidatedAt: z.string().nullable(),
  lastEvaluatedAt: z.string().nullable().default(null),
}) satisfies z.ZodType<ConsolidatedManifestEntry>

const ConsolidatedManifestSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), ConsolidatedManifestEntrySchema),
})

export function createEmptyManifest(): IncrementalManifest {
  return {
    version: 1,
    lastStartCommit: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    phaseVersions: { phase1: '', phase2: '', reports: '' },
    tests: {},
  }
}

export function createEmptyConsolidatedManifest(): ConsolidatedManifest {
  return { version: 1, entries: {} }
}

export function captureRunStart(
  manifest: IncrementalManifest,
  currentHead: string,
  startedAt: string,
): {
  readonly previousLastStartCommit: string | null
  readonly updatedManifest: IncrementalManifest
} {
  return {
    previousLastStartCommit: manifest.lastStartCommit,
    updatedManifest: {
      ...manifest,
      lastStartCommit: currentHead,
      lastStartedAt: startedAt,
    },
  }
}

function splitGitPathOutput(output: Uint8Array): readonly string[] {
  const decodedOutput = new TextDecoder().decode(output)
  return decodedOutput.split('\u0000').filter((line) => line.length > 0)
}

async function runGitLines(args: readonly string[]): Promise<readonly string[]> {
  const proc = Bun.spawn(['git', ...args], {
    cwd: PROJECT_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const errorMessage = stderr.trim()
    throw new Error(errorMessage.length > 0 ? errorMessage : `Git command failed: git ${args.join(' ')}`)
  }
  return splitGitPathOutput(stdout)
}

function runGitNameOnlyDiff(rangeOrFlag: string | null): Promise<readonly string[]> {
  const args = ['diff', '--name-only', '-z']
  return runGitLines(rangeOrFlag === null ? args : [...args, rangeOrFlag])
}

function runGitUntrackedFiles(): Promise<readonly string[]> {
  return runGitLines(['ls-files', '--others', '--exclude-standard', '-z'])
}

export function combineChangedFileLists(lists: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(lists.flat())].toSorted()
}

export async function collectChangedFiles(previousLastStartCommit: string | null): Promise<readonly string[]> {
  const committed =
    previousLastStartCommit === null ? [] : await runGitNameOnlyDiff(`${previousLastStartCommit}...HEAD`)
  const staged = await runGitNameOnlyDiff('--cached')
  const unstaged = await runGitNameOnlyDiff(null)
  const untracked = await runGitUntrackedFiles()

  return combineChangedFileLists([committed, staged, unstaged, untracked])
}

export async function loadManifest(): Promise<IncrementalManifest | null> {
  const manifestFile = Bun.file(INCREMENTAL_MANIFEST_PATH)
  if (!(await manifestFile.exists())) return null
  return IncrementalManifestSchema.parse(JSON.parse(await manifestFile.text()))
}

export async function saveManifest(manifest: IncrementalManifest): Promise<void> {
  const parsedManifest = IncrementalManifestSchema.parse(manifest)
  const manifestDir = dirname(INCREMENTAL_MANIFEST_PATH)
  const tempManifestPath = join(
    manifestDir,
    `.${basename(INCREMENTAL_MANIFEST_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )

  await mkdir(manifestDir, { recursive: true })
  await Bun.write(tempManifestPath, JSON.stringify(parsedManifest, null, 2) + '\n')
  await rename(tempManifestPath, INCREMENTAL_MANIFEST_PATH)
}

export async function loadConsolidatedManifest(): Promise<ConsolidatedManifest | null> {
  const manifestFile = Bun.file(CONSOLIDATED_MANIFEST_PATH)
  if (!(await manifestFile.exists())) return null
  const text = await manifestFile.text()
  return ConsolidatedManifestSchema.parse(JSON.parse(text))
}

export async function saveConsolidatedManifest(manifest: ConsolidatedManifest): Promise<void> {
  const parsed = ConsolidatedManifestSchema.parse(manifest)
  const manifestDir = dirname(CONSOLIDATED_MANIFEST_PATH)
  const tempPath = join(
    manifestDir,
    `.${basename(CONSOLIDATED_MANIFEST_PATH)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  )
  await mkdir(manifestDir, { recursive: true })
  await Bun.write(tempPath, JSON.stringify(parsed, null, 2) + '\n')
  await rename(tempPath, CONSOLIDATED_MANIFEST_PATH)
}
