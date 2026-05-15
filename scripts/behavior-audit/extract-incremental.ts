// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { extractedArtifactPathForTestFile } from './artifact-paths.js'
import { PROJECT_ROOT } from './config.js'
import { getDomain } from './domain-map.js'
import type { ExtractedBehaviorRecord } from './extracted-store.js'
import type { IncrementalManifest } from './incremental.js'
import { buildPhase1Fingerprint, buildPhase2Fingerprint, hashText } from './incremental.js'
import type { ParsedTestFile, TestCase } from './test-parser.js'

function deriveImplPath(testPath: string): string {
  return testPath.replace(/^tests\//, 'src/').replace(/\.test\.ts$/, '.ts')
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function loadMirroredSourceHash(testFilePath: string): Promise<string | null> {
  const mirroredPath = deriveImplPath(testFilePath)
  const absoluteMirroredPath = join(PROJECT_ROOT, mirroredPath)
  if (!(await fileExists(absoluteMirroredPath))) {
    return null
  }
  return hashText(await Bun.file(absoluteMirroredPath).text())
}

function buildManifestEntry(input: {
  readonly testKey: string
  readonly testFile: ParsedTestFile
  readonly testCase: TestCase
  readonly dependencyPaths: readonly string[]
  readonly extractedArtifactPath: string
  readonly phase1Fingerprint: string
  readonly phase2Fingerprint: string
  readonly lastPhase2CompletedAt: string | null
}): IncrementalManifest['tests'][string] {
  return {
    testFile: input.testFile.filePath,
    testName: input.testCase.fullPath,
    dependencyPaths: input.dependencyPaths,
    phase1Fingerprint: input.phase1Fingerprint,
    phase2aFingerprint: null,
    phase2Fingerprint: input.phase2Fingerprint,
    behaviorId: null,
    featureKey: null,
    extractedArtifactPath: input.extractedArtifactPath,
    classifiedArtifactPath: null,
    domain: getDomain(input.testFile.filePath),
    lastPhase1CompletedAt: new Date().toISOString(),
    lastPhase2aCompletedAt: null,
    lastPhase2CompletedAt: input.lastPhase2CompletedAt,
  }
}

async function loadFileDependencies(testFile: ParsedTestFile): Promise<{
  readonly testFileHash: string
  readonly mirroredSourceHash: string | null
  readonly dependencyPaths: readonly string[]
  readonly extractedArtifactPath: string
}> {
  const testFileHash = hashText(await Bun.file(join(PROJECT_ROOT, testFile.filePath)).text())
  const mirroredPath = deriveImplPath(testFile.filePath)
  const mirroredSourceHash = await loadMirroredSourceHash(testFile.filePath)
  const dependencyPaths = mirroredSourceHash === null ? [testFile.filePath] : [testFile.filePath, mirroredPath]
  const extractedArtifactPath = extractedArtifactPathForTestFile(testFile.filePath).replace(`${PROJECT_ROOT}/`, '')
  return { testFileHash, mirroredSourceHash, dependencyPaths, extractedArtifactPath }
}

export async function updateManifestForExtractedTest(input: {
  readonly manifest: IncrementalManifest
  readonly testFile: ParsedTestFile
  readonly testCase: TestCase
  readonly extractedBehavior: ExtractedBehaviorRecord
}): Promise<{ readonly manifest: IncrementalManifest; readonly phase1Changed: boolean }> {
  const testKey = `${input.testFile.filePath}::${input.testCase.fullPath}`
  const deps = await loadFileDependencies(input.testFile)
  const previousEntry = input.manifest.tests[testKey]
  const phase1Fingerprint = buildPhase1Fingerprint({
    testKey,
    testFileHash: deps.testFileHash,
    testSource: input.testCase.source,
    mirroredSourceHash: deps.mirroredSourceHash,
    phaseVersion: input.manifest.phaseVersions.phase1,
  })
  const phase1Changed = previousEntry === undefined || previousEntry.phase1Fingerprint !== phase1Fingerprint
  const phase2Fingerprint = buildPhase2Fingerprint({
    testKey,
    behavior: input.extractedBehavior.behavior,
    context: input.extractedBehavior.context,
    keywords: input.extractedBehavior.keywords,
    phaseVersion: input.manifest.phaseVersions.phase2,
  })
  const phase2FingerprintChanged = previousEntry === undefined || previousEntry.phase2Fingerprint !== phase2Fingerprint
  const lastPhase2CompletedAt = phase2FingerprintChanged ? null : previousEntry.lastPhase2CompletedAt
  return {
    manifest: {
      ...input.manifest,
      tests: {
        ...input.manifest.tests,
        [testKey]: buildManifestEntry({
          testKey,
          testFile: input.testFile,
          testCase: input.testCase,
          dependencyPaths: deps.dependencyPaths,
          extractedArtifactPath: deps.extractedArtifactPath,
          phase1Fingerprint,
          phase2Fingerprint,
          lastPhase2CompletedAt,
        }),
      },
    },
    phase1Changed,
  }
}
