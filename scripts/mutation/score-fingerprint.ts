// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'

import { findTestFile } from '../../.hooks/tdd/test-resolver.mjs'
import { createCandidateContext, listCandidateTests } from './coverage-map.js'
import { loadOverrides } from './test-overrides.js'

/**
 * Bump to invalidate every recorded score without touching CI cache keys — the in-repo
 * escape hatch when the meaning of a fingerprint changes (new inputs, different hashing)
 * rather than its inputs.
 */
export const SCORE_FINGERPRINT_VERSION = 'v1'

/**
 * Toolchain files hashed into every fingerprint. `package.json` is hashed whole rather than
 * parsed for the two mutation-runner versions: parsing buys nothing here, and the stricter
 * rule (any manifest edit re-measures) fails in the safe direction. `bun.lock` covers the
 * resolved dependency tree, so a transitive Stryker bump invalidates too.
 */
export const TOOLCHAIN_FINGERPRINT_FILES = [
  'bun.lock',
  'package.json',
  'scripts/mutation/overrides.json',
  'stryker.config.json',
] as const

const MUTATION_SCRIPTS_GLOB = 'scripts/mutation/**/*.ts'
const TEST_RESOLVER = '.hooks/tdd/test-resolver.mjs'

export interface FingerprintDeps {
  /** Project-relative read. Returns null when the file is absent — never throws. */
  readonly readFile: (relPath: string) => string | null
  /**
   * Every test whose content could plausibly change this source's score: the coverage-map
   * candidate universe, unioned with the companion and any `overrides.json` entry. A
   * SUPERSET of the test set the paired run actually uses, so it over-invalidates (editing
   * one test re-measures its package neighbours) and never under-invalidates.
   */
  readonly listCandidates: (srcFile: string) => readonly string[]
  /** Project-relative toolchain files, sorted, so a new mutation script is picked up. */
  readonly listToolchainFiles: () => readonly string[]
}

export interface SourceFingerprintInput {
  readonly srcFile: string
  readonly toolchain: string
  readonly deps: FingerprintDeps
}

const sha256 = (content: string): string => createHash('sha256').update(content).digest('hex')

/**
 * Hash a list of files as `path \0 sha256(contents)` pairs. Hashing the path alongside the
 * content is what keeps two byte-identical files from sharing a fingerprint, and hashing an
 * absent file as sha256('') keeps a deleted test from being silently indistinguishable from
 * one that never existed — the pair list itself changes.
 */
const hashFileList = (relPaths: readonly string[], readFile: FingerprintDeps['readFile']): string =>
  relPaths.map((relPath) => `${relPath}\0${sha256(readFile(relPath) ?? '')}`).join('\n')

/**
 * Hash the inputs that change how EVERY file is measured. Computed once per run, not per
 * file — it reads the whole mutation runner and the dependency tree.
 */
export const computeToolchainFingerprint = (deps: FingerprintDeps): string =>
  sha256(`${SCORE_FINGERPRINT_VERSION}\0${hashFileList(deps.listToolchainFiles(), deps.readFile)}`)

/**
 * The guard that decides whether a previously recorded score may be reused for this file.
 *
 * Hashes CONTENTS ONLY — never size, mtime, inode or absolute path. `scripts/test/fingerprint.ts`
 * deliberately does the opposite (`size + mtimeMs`) because it fingerprints a local working
 * tree between edits; reusing it here would produce a 100% miss rate, since every CI job
 * checks the repository out fresh and every mtime is therefore new. Do not consolidate the two.
 *
 * The recorded baseline is deliberately NOT an input: when a merge raises a file's floor, the
 * carried-over score must be re-judged against the new floor rather than quietly re-measured.
 */
export const computeSourceFingerprint = (input: SourceFingerprintInput): string => {
  const { srcFile, toolchain, deps } = input
  const source = `${srcFile}\0${sha256(deps.readFile(srcFile) ?? '')}`
  const tests = hashFileList(deps.listCandidates(srcFile), deps.readFile)
  return `${SCORE_FINGERPRINT_VERSION}:${sha256([SCORE_FINGERPRINT_VERSION, toolchain, source, tests].join('\0'))}`
}

const readFileOrNull = (absPath: string): string | null => {
  try {
    return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : null
  } catch {
    return null
  }
}

const scanGlob = (projectRoot: string, pattern: string): string[] => {
  try {
    return [...new Glob(pattern).scanSync({ cwd: projectRoot, onlyFiles: true })].toSorted()
  } catch {
    return []
  }
}

const safeLoadOverrides = (projectRoot: string): Record<string, string[]> => {
  try {
    return loadOverrides(path.join(projectRoot, 'scripts/mutation/overrides.json'))
  } catch {
    // A malformed overrides file still changes the toolchain hash, so failing open here
    // costs nothing: every score is invalidated by that route anyway.
    return {}
  }
}

/** Production deps. One memoized content cache backs both candidate scanning and hashing. */
export const createDefaultFingerprintDeps = (projectRoot: string): FingerprintDeps => {
  const contents = new Map<string, string>()
  const readAbs = (absPath: string): string => {
    const cached = contents.get(absPath)
    if (cached !== undefined) return cached
    const content = readFileOrNull(absPath) ?? ''
    contents.set(absPath, content)
    return content
  }
  const ctx = createCandidateContext(projectRoot, readAbs)
  const overrides = safeLoadOverrides(projectRoot)

  return {
    readFile: (relPath) => readFileOrNull(path.resolve(projectRoot, relPath)),
    listCandidates: (srcFile) => {
      const companionAbs = findTestFile(path.resolve(projectRoot, srcFile), projectRoot)
      const companion = companionAbs === null ? [] : [path.relative(projectRoot, companionAbs)]
      const candidates = listCandidateTests(srcFile, projectRoot, ctx)
      return [...new Set([...companion, ...candidates, ...(overrides[srcFile] ?? [])])].toSorted()
    },
    listToolchainFiles: () =>
      [
        ...new Set([...TOOLCHAIN_FINGERPRINT_FILES, TEST_RESOLVER, ...scanGlob(projectRoot, MUTATION_SCRIPTS_GLOB)]),
      ].toSorted(),
  }
}
