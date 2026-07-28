// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'

import { testFileImportsImpl } from '../../.hooks/tdd/test-resolver.mjs'

export type CoverageMap = Record<string, string[]>

export interface CoverageMapDeps {
  /** Tests that could plausibly cover `srcFile` (static import scan narrows the universe). */
  readonly listCandidateTests: (srcFile: string) => readonly string[]
  /** Run one test file with coverage; return sourceFile -> lines-hit (>0 means covered). */
  readonly runCoverage: (testFile: string, projectRoot: string) => ReadonlyMap<string, number>
}

export interface BuildCoverageMapInput {
  readonly sourceFiles: readonly string[]
  readonly projectRoot: string
  readonly deps: CoverageMapDeps
}

/** Build {sourceFile -> testFiles that cover it} for the requested sources. */
export function buildCoverageMap(input: BuildCoverageMapInput): CoverageMap {
  const out: CoverageMap = {}
  for (const srcFile of input.sourceFiles) {
    const candidates = input.deps.listCandidateTests(srcFile)
    const covering: string[] = []
    for (const testFile of candidates) {
      const hits = input.deps.runCoverage(testFile, input.projectRoot)
      if ((hits.get(srcFile) ?? 0) > 0) covering.push(testFile)
    }
    if (covering.length > 0) out[srcFile] = covering
    else console.error(`coverage-map: no covering test found for ${srcFile} (checked ${candidates.length} candidates)`)
  }
  return out
}

const DEFAULT_CACHE_PATH = 'reports/paired/coverage-map.cache.json'
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_COVERAGE_DIR = 'reports/coverage'
const DEFAULT_LCOV_NAME = 'lcov.info'
const DEFAULT_TIMEOUT_MS = 30_000
const TEST_SCAN_PATTERN = 'tests/**/*.test.ts'

export interface DefaultCoverageMapDepsOptions {
  readonly cachePath?: string
  readonly cacheTtlMs?: number
  readonly coverageDir?: string
  readonly lcovName?: string
  readonly timeoutMs?: number
}

interface CoverageCacheEntry {
  readonly value: ReadonlyArray<readonly [string, number]>
  readonly ts: number
}

type CoverageCacheFile = { entries: Record<string, CoverageCacheEntry> }

interface CoverageCache {
  readonly get: (key: string, ttlMs: number) => Map<string, number> | undefined
  readonly set: (key: string, value: Map<string, number>) => void
}

/**
 * Production default deps for `buildCoverageMap`. `listCandidateTests` narrows the universe
 * via `testFileImportsImpl` (static import scan); `runCoverage` spawns `bun test --coverage`,
 * parses the lcov, and consults a content-keyed TTL cache. Never throws — fails open to empty.
 */
export function createDefaultCoverageMapDeps(
  projectRoot: string,
  options: DefaultCoverageMapDepsOptions = {},
): CoverageMapDeps {
  const cachePath = path.resolve(projectRoot, options.cachePath ?? DEFAULT_CACHE_PATH)
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const coverageDir = options.coverageDir ?? DEFAULT_COVERAGE_DIR
  const lcovName = options.lcovName ?? DEFAULT_LCOV_NAME
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const cache = openCoverageCache(cachePath)
  return {
    listCandidateTests: (srcFile) => listCandidateTests(srcFile, projectRoot),
    runCoverage: (testFile, runRoot) =>
      runCoverageFor(testFile, runRoot, { coverageDir, lcovName, timeoutMs, cache, cacheTtlMs }),
  }
}

const listCandidateTests = (srcFile: string, projectRoot: string): string[] => {
  const srcAbs = path.isAbsolute(srcFile) ? srcFile : path.resolve(projectRoot, srcFile)
  return scanTestFiles(projectRoot).filter((testRel) => {
    try {
      return testFileImportsImpl(path.resolve(projectRoot, testRel), srcAbs)
    } catch {
      return false
    }
  })
}

const scanTestFiles = (projectRoot: string): string[] =>
  [...new Glob(TEST_SCAN_PATTERN).scanSync({ cwd: projectRoot, onlyFiles: true })].sort()

interface RunCoverageOptions {
  readonly coverageDir: string
  readonly lcovName: string
  readonly timeoutMs: number
  readonly cache: CoverageCache
  readonly cacheTtlMs: number
}

const runCoverageFor = (
  testFile: string,
  projectRoot: string,
  opts: RunCoverageOptions,
): ReadonlyMap<string, number> => {
  const testAbs = path.isAbsolute(testFile) ? testFile : path.resolve(projectRoot, testFile)
  const key = cacheKeyForTest(testAbs)
  const cached = opts.cache.get(key, opts.cacheTtlMs)
  if (cached !== undefined) return cached
  const fresh = spawnAndParseLcov(testFile, projectRoot, opts)
  opts.cache.set(key, fresh)
  return fresh
}

const spawnAndParseLcov = (
  testFile: string,
  projectRoot: string,
  opts: Pick<RunCoverageOptions, 'coverageDir' | 'lcovName' | 'timeoutMs'>,
): Map<string, number> => {
  let spawned = true
  try {
    execFileSync('bun', ['test', testFile, '--coverage', '--coverage-reporter=lcov'], {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout: opts.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`coverage-map: bun coverage failed for ${testFile}: ${message}`)
    spawned = false
  }
  if (!spawned) return new Map()
  const lcovPath = path.join(projectRoot, opts.coverageDir, opts.lcovName)
  if (!fs.existsSync(lcovPath)) {
    console.error(`coverage-map: lcov missing at ${lcovPath} for ${testFile}`)
    return new Map()
  }
  try {
    return parseLcovAll(lcovPath, projectRoot)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`coverage-map: lcov parse failed for ${lcovPath}: ${message}`)
    return new Map()
  }
}

/** Parse lcov into project-relative `sourceFile -> lines-hit` (keys match requested sourceFiles). */
const parseLcovAll = (lcovPath: string, projectRoot: string): Map<string, number> => {
  const content = fs.readFileSync(lcovPath, 'utf8')
  const out = new Map<string, number>()
  for (const section of content.split('end_of_record')) {
    const sfMatch = section.match(/^SF:(.+)$/mu)
    const lhMatch = section.match(/^LH:(\d+)$/mu)
    if (sfMatch === null || lhMatch === null) continue
    const sfPath = sfMatch[1]
    const lhText = lhMatch[1]
    if (sfPath === undefined || lhText === undefined) continue
    const abs = path.resolve(projectRoot, sfPath.trim())
    const linesHit = Number.parseInt(lhText, 10)
    if (Number.isFinite(linesHit)) out.set(path.relative(projectRoot, abs), linesHit)
  }
  return out
}

const cacheKeyForTest = (testAbs: string): string => {
  const content = fs.existsSync(testAbs) ? fs.readFileSync(testAbs, 'utf8') : ''
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  return `${testAbs}:${hash}`
}

const openCoverageCache = (cachePath: string): CoverageCache => {
  const entries = readCacheFile(cachePath)
  return {
    get: (key, ttlMs) => {
      const entry = entries[key]
      if (entry === undefined) return undefined
      if (Date.now() - entry.ts > ttlMs) return undefined
      return new Map(entry.value)
    },
    set: (key, value) => {
      entries[key] = { value: [...value.entries()], ts: Date.now() }
      writeCacheFile(cachePath, { entries })
    },
  }
}

const isCoverageCacheFile = (value: unknown): value is CoverageCacheFile => {
  if (typeof value !== 'object' || value === null) return false
  if (!('entries' in value)) return false
  const entries: unknown = value.entries
  return typeof entries === 'object' && entries !== null
}

const readCacheFile = (cachePath: string): Record<string, CoverageCacheEntry> => {
  try {
    if (!fs.existsSync(cachePath)) return {}
    const parsed: unknown = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    if (!isCoverageCacheFile(parsed)) return {}
    return parsed.entries
  } catch {
    return {}
  }
}

const writeCacheFile = (cachePath: string, cache: CoverageCacheFile): void => {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(cache))
  } catch {
    // best-effort cache persistence; a write failure must not abort the run
  }
}
