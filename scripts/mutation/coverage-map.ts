// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'

import { openCoverageCache } from './coverage-cache.js'
import type { CoverageCache } from './coverage-cache.js'

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

/** Memoized per-batch candidate universe + import-scan context. */
interface CandidateContext {
  readonly scan: () => readonly string[]
  readonly importsImpl: (testAbs: string, srcAbs: string) => boolean
}

/**
 * Production default deps for `buildCoverageMap`. `listCandidateTests` narrows the universe via
 * two heuristics unioned together: (a) tests whose text directly imports the source (mirrors the
 * TDD write-hook's `testFileImportsImpl`), AND (b) tests in the same package directory as the
 * source's companion (catches transitive coverage where a same-package index test exercises the
 * source indirectly through a re-exporting barrel). `runCoverage` spawns `bun test --coverage`,
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
  const contentCache = new Map<string, string>()
  const readTestContent = (testAbs: string): string => readMemoizedContent(testAbs, contentCache)
  let scanned: readonly string[] | undefined
  const ctx: CandidateContext = {
    scan: () => (scanned ??= scanTestFiles(projectRoot)),
    importsImpl: (testAbs, srcAbs) => scanImportsInContent(readTestContent(testAbs), testAbs, srcAbs),
  }
  return {
    listCandidateTests: (srcFile) => listCandidateTests(srcFile, projectRoot, ctx),
    runCoverage: (testFile, runRoot) =>
      runCoverageFor(testFile, runRoot, { coverageDir, lcovName, timeoutMs, cache, cacheTtlMs, readTestContent }),
  }
}

const readMemoizedContent = (testAbs: string, cache: Map<string, string>): string => {
  const cached = cache.get(testAbs)
  if (cached !== undefined) return cached
  let content = ''
  try {
    content = fs.existsSync(testAbs) ? fs.readFileSync(testAbs, 'utf8') : ''
  } catch {
    content = ''
  }
  cache.set(testAbs, content)
  return content
}

const listCandidateTests = (srcFile: string, projectRoot: string, ctx: CandidateContext): string[] => {
  const srcAbs = path.isAbsolute(srcFile) ? srcFile : path.resolve(projectRoot, srcFile)
  const srcRel = path.relative(projectRoot, srcAbs)
  const pkgDirAbs = path.resolve(projectRoot, samePackageTestDir(srcRel))
  return ctx
    .scan()
    .filter((testRel) => {
      const testAbs = path.resolve(projectRoot, testRel)
      if (path.dirname(testAbs) === pkgDirAbs) return true
      return ctx.importsImpl(testAbs, srcAbs)
    })
    .sort()
}

const scanTestFiles = (projectRoot: string): string[] => {
  try {
    return [...new Glob(TEST_SCAN_PATTERN).scanSync({ cwd: projectRoot, onlyFiles: true })].sort()
  } catch {
    return []
  }
}

/**
 * Derive the same-package tests directory for a source file, mirroring the src↔tests directory
 * mapping in `.hooks/tdd/test-resolver.mjs` (`findTestFile` / `suggestTestPath`). For
 * `src/chat/mattermost/file-helpers.ts` this returns `tests/chat/mattermost`; for `src/history.ts`
 * it returns `tests` (top-level); for `plugins/foo/bar.ts` → `tests/plugins/foo`;
 * for `review-loop/src/x.ts` → `tests/review-loop`; for `client/a/b.ts` → `tests/client/a`.
 */
const samePackageTestDir = (srcRel: string): string => {
  const forward = srcRel.replace(/\\/gu, '/')
  const dirOf = (p: string): string => path.dirname(p).replace(/\\/gu, '/')
  if (forward.startsWith('client/')) {
    return path.join('tests', dirOf(forward))
  }
  if (forward.startsWith('plugins/')) {
    return path.join('tests', dirOf(forward))
  }
  if (forward.startsWith('review-loop/src/')) {
    const withoutPrefix = forward.replace(/^review-loop\/src\//u, '')
    return path.join('tests', 'review-loop', dirOf(withoutPrefix))
  }
  if (forward.startsWith('src/')) {
    const withoutSrc = forward.replace(/^src\//u, '')
    return path.join('tests', dirOf(withoutSrc))
  }
  return 'tests'
}

/**
 * Mirror of `.hooks/tdd/test-resolver.mjs`'s `testFileImportsImpl`, accepting pre-read content so
 * the per-batch content cache can amortize reads across all source files. MUST stay in sync with
 * the hook's heuristic — a string-`includes` check on the relative import path with/without `.js`.
 */
const scanImportsInContent = (content: string, testAbs: string, implAbs: string): boolean => {
  if (content === '') return false
  const testDir = path.dirname(testAbs)
  const relToImpl = path.relative(testDir, implAbs).replace(/\\/gu, '/')
  const noExt = relToImpl.replace(/\.(ts|tsx|js|jsx)$/u, '')
  const withJs = `${noExt}.js`
  return content.includes(withJs) || content.includes(`${noExt}'`) || content.includes(`${noExt}"`)
}

interface RunCoverageOptions {
  readonly coverageDir: string
  readonly lcovName: string
  readonly timeoutMs: number
  readonly cache: CoverageCache
  readonly cacheTtlMs: number
  readonly readTestContent: (testAbs: string) => string
}

const runCoverageFor = (
  testFile: string,
  projectRoot: string,
  opts: RunCoverageOptions,
): ReadonlyMap<string, number> => {
  const testAbs = path.isAbsolute(testFile) ? testFile : path.resolve(projectRoot, testFile)
  const key = cacheKeyForTest(testAbs, opts.readTestContent)
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

const cacheKeyForTest = (testAbs: string, readContent: (testAbs: string) => string): string => {
  const content = readContent(testAbs)
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  return `${testAbs}:${hash}`
}
