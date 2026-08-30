// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'

import { openCoverageCache } from './coverage-cache.js'
import type { CoverageCache } from './coverage-cache.js'
import { classifyTestLane, spawnAndParseLcov } from './coverage-runner.js'
import type { SpawnAndParse, SpawnCoverageOptions } from './coverage-runner.js'

export type CoverageMap = Record<string, string[]>

export interface CoverageMapDeps {
  /** Tests that could plausibly cover `srcFile` (static import scan narrows the universe). */
  readonly listCandidateTests: (srcFile: string) => readonly string[]
  /** Run one test file with coverage; return sourceFile -> lines-hit (>0 means covered). */
  readonly runCoverage: (testFile: string, projectRoot: string) => ReadonlyMap<string, number>
  /** Optional: persist any batched coverage-cache writes once the batch completes. */
  readonly flush?: () => void
  /**
   * Optional: where the "no covering test" notice goes. Defaults to
   * `console.error`, so a real `bun scripts/mutation/paired-run.ts` still
   * reports an uncovered source on stderr. A caller that owns its own reporter
   * — or a test that drives the uncovered case on purpose — passes one here.
   */
  readonly warn?: (message: string) => void
}

export interface BuildCoverageMapInput {
  readonly sourceFiles: readonly string[]
  readonly projectRoot: string
  readonly deps: CoverageMapDeps
}

/** Build {sourceFile -> testFiles that cover it} for the requested sources. */
export function buildCoverageMap(input: BuildCoverageMapInput): CoverageMap {
  const out: CoverageMap = {}
  const warn =
    input.deps.warn ??
    ((message: string): void => {
      console.error(message)
    })
  try {
    for (const srcFile of input.sourceFiles) {
      const candidates = input.deps.listCandidateTests(srcFile)
      const covering: string[] = []
      for (const testFile of candidates) {
        const hits = input.deps.runCoverage(testFile, input.projectRoot)
        if ((hits.get(srcFile) ?? 0) > 0) covering.push(testFile)
      }
      if (covering.length > 0) out[srcFile] = covering
      else warn(`coverage-map: no covering test found for ${srcFile} (checked ${candidates.length} candidates)`)
    }
  } finally {
    input.deps.flush?.()
  }
  return out
}

const DEFAULT_CACHE_PATH = 'reports/paired/coverage-map.cache.json'
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DEFAULT_COVERAGE_DIR = 'reports/coverage'
const DEFAULT_LCOV_NAME = 'lcov.info'
// A single-file coverage run is usually a few seconds, but meta-tests like
// tests/analytics/privacy-contract.test.ts re-spawn ~30 nested `bun test` fixture runs and
// take ~40s locally; CI runners are slower still. 120s absorbs that without masking a hang.
const DEFAULT_TIMEOUT_MS = 120_000
const TEST_SCAN_PATTERN = 'tests/**/*.test.ts'

export interface DefaultCoverageMapDepsOptions {
  readonly cachePath?: string
  readonly cacheTtlMs?: number
  readonly coverageDir?: string
  readonly lcovName?: string
  readonly timeoutMs?: number
}

/** Memoized per-batch candidate universe + import-scan context. */
export interface CandidateContext {
  readonly scan: () => readonly string[]
  readonly importsImpl: (testAbs: string, srcAbs: string) => boolean
}

/**
 * Build the memoized context {@link listCandidateTests} needs: the runnable test universe
 * (scanned once per batch) plus the import scan over memoized file contents. Callers that
 * already memoize test-file reads for another purpose pass their reader in so the batch
 * reads each test file exactly once.
 */
export function createCandidateContext(
  projectRoot: string,
  readTestContent?: (testAbs: string) => string,
): CandidateContext {
  const contentCache = new Map<string, string>()
  const read = readTestContent ?? ((testAbs: string): string => readMemoizedContent(testAbs, contentCache))
  let scanned: readonly string[] | undefined
  return {
    scan: () => (scanned ??= scanTestFiles(projectRoot)),
    importsImpl: (testAbs, srcAbs) => scanImportsInContent(read(testAbs), testAbs, srcAbs),
  }
}

/**
 * Production default deps for `buildCoverageMap`. `listCandidateTests` narrows the universe via
 * two heuristics unioned together: (a) tests whose text directly imports the source (mirrors the
 * TDD write-hook's `testFileImportsImpl`), AND (b) tests in the same package directory as the
 * source's companion (catches transitive coverage where a same-package index test exercises the
 * source indirectly through a re-exporting barrel). External-lane tests (tests/e2e/**,
 * tests/stories/**) are excluded from the universe — they need Docker / the sandboxed story
 * runner and cannot be spawned per-file. `runCoverage` spawns a per-lane `bun test --coverage`
 * (tests/client/** runs with the `test:client` preset so bun's pathIgnorePatterns don't hide
 * it), parses the lcov, and consults a content-keyed TTL cache; failures are never cached.
 * Never throws — fails open to empty.
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
  const ctx = createCandidateContext(projectRoot, readTestContent)
  return {
    listCandidateTests: (srcFile) => listCandidateTests(srcFile, projectRoot, ctx),
    runCoverage: (testFile, runRoot) =>
      runCoverageFor(testFile, runRoot, { coverageDir, lcovName, timeoutMs, cache, cacheTtlMs, readTestContent }),
    flush: () => {
      cache.flush()
    },
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

/**
 * Tests that could plausibly cover `srcFile`: same-package-directory tests unioned with tests
 * whose text imports the source. Repo-relative, sorted. Shared with `scripts/test/affected.ts`,
 * which uses it as the second half of its selection (the graph walk is the first).
 */
export const listCandidateTests = (srcFile: string, projectRoot: string, ctx: CandidateContext): string[] => {
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
    return [...new Glob(TEST_SCAN_PATTERN).scanSync({ cwd: projectRoot, onlyFiles: true })]
      .filter((testRel) => classifyTestLane(testRel) !== 'external')
      .sort()
  } catch {
    return []
  }
}

/**
 * Derive the same-package tests directory for a source file, mirroring the src↔tests directory
 * mapping in `.hooks/tdd/test-resolver.mjs` (`findTestFile` / `suggestTestPath`). For
 * `src/chat/mattermost/file-helpers.ts` this returns `tests/chat/mattermost`; for `src/history.ts`
 * it returns `tests` (top-level); for `plugins/foo/bar.ts` → `tests/plugins/foo`;
 * for `review-loop/src/x.ts` → `tests/review-loop`;
 * for `client/a/b.ts` → `tests/client/a`.
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

interface RunCoverageOptions extends SpawnCoverageOptions {
  readonly cache: CoverageCache
  readonly cacheTtlMs: number
  readonly readTestContent: (testAbs: string) => string
  /** Test seam: replaces the real bun spawn. Production callers leave it undefined. */
  readonly spawnAndParse?: SpawnAndParse
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
  const spawn = opts.spawnAndParse ?? spawnAndParseLcov
  const fresh = spawn(testFile, projectRoot, opts)
  // Fail open to empty WITHOUT caching: a transient spawn failure (timeout, runner hiccup)
  // must not poison the 24h content-keyed cache and stick until the test file changes.
  if (fresh === null) return new Map()
  opts.cache.set(key, fresh)
  return fresh
}

const cacheKeyForTest = (testAbs: string, readContent: (testAbs: string) => string): string => {
  const content = readContent(testAbs)
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  return `${testAbs}:${hash}`
}

export { samePackageTestDir as _samePackageTestDirForTest, runCoverageFor as _runCoverageForTest }
