import fs from 'node:fs'
import path from 'node:path'

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/u
const TEST_PATTERN = /\.(?:test|spec)\.(?:ts|js|tsx|jsx)$/u

/**
 * Check if a file is a test file
 * @param {string} filePath - File path to check
 * @returns {boolean} True if this is a test file
 */
export function isTestFile(filePath) {
  return TEST_PATTERN.test(filePath)
}

/**
 * Check if a file is a gateable implementation file (src/)
 * @param {string} filePath - File path to check
 * @param {string} projectRoot - Project root directory
 * @returns {boolean} True if this is a gateable implementation file
 */
export function isGateableImplFile(filePath, projectRoot) {
  // Must be under src/, client/, or review-loop/src/, match IMPL_PATTERN, and NOT match TEST_PATTERN
  const rel = path.relative(projectRoot, path.resolve(projectRoot, filePath))
  const isSrc = rel.startsWith('src/') || rel.startsWith('src\\')
  const isClient = rel.startsWith('client/') || rel.startsWith('client\\')
  const isReviewLoop = rel.startsWith('review-loop/src/') || rel.startsWith('review-loop\\src\\')
  if (!isSrc && !isClient && !isReviewLoop) return false
  if (!IMPL_PATTERN.test(rel)) return false
  if (TEST_PATTERN.test(rel)) return false
  return true
}

/**
 * Suggest a test file path for an implementation file
 * @param {string} implRelPath - Relative path from projectRoot (e.g. src/foo/bar.ts)
 * @returns {string} Suggested test file relative path (e.g. tests/foo/bar.test.ts)
 */
export function suggestTestPath(implRelPath) {
  // client/debug/helpers.ts → tests/client/debug/helpers.test.ts (keep client/ prefix)
  if (implRelPath.startsWith('client/') || implRelPath.startsWith('client\\')) {
    const ext = path.extname(implRelPath)
    const base = implRelPath.slice(0, -ext.length)
    return path.join('tests', `${base}.test${ext}`)
  }
  // review-loop/src/foo.ts → tests/review-loop/foo.test.ts
  if (implRelPath.startsWith('review-loop/src/') || implRelPath.startsWith('review-loop\\src\\')) {
    const withoutPrefix = implRelPath.replace(/^review-loop[/\\]src[/\\]/u, '')
    const ext = path.extname(withoutPrefix)
    const base = withoutPrefix.slice(0, -ext.length)
    return path.join('tests', 'review-loop', `${base}.test${ext}`)
  }
  // src/foo/bar.ts → tests/foo/bar.test.ts (strip src/ prefix)
  const withoutSrc = implRelPath.replace(/^src[/\\]/u, '')
  const ext = path.extname(withoutSrc)
  const base = withoutSrc.slice(0, -ext.length)
  return path.join('tests', `${base}.test${ext}`)
}

/**
 * Find the corresponding test file for an implementation file
 * @param {string} implAbsPath - Absolute path to implementation file
 * @param {string} projectRoot - Project root directory
 * @returns {string | null} Absolute path to test file, or null
 */
export function findTestFile(implAbsPath, projectRoot) {
  const rel = path.relative(projectRoot, implAbsPath)

  // Client files: client/debug/helpers.ts → tests/client/debug/helpers.test.ts
  if (rel.startsWith('client/') || rel.startsWith('client\\')) {
    const ext = path.extname(rel)
    const base = rel.slice(0, -ext.length)

    for (const suffix of ['.test', '.spec']) {
      const candidate = path.join(projectRoot, 'tests', `${base}${suffix}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  // review-loop/src/foo.ts → tests/review-loop/foo.test.ts
  if (rel.startsWith('review-loop/src/') || rel.startsWith('review-loop\\src\\')) {
    const withoutPrefix = rel.replace(/^review-loop[/\\]src[/\\]/u, '')
    const ext = path.extname(withoutPrefix)
    const base = withoutPrefix.slice(0, -ext.length)

    for (const suffix of ['.test', '.spec']) {
      const candidate = path.join(projectRoot, 'tests', 'review-loop', `${base}${suffix}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  // Primary: parallel tests/ directory (src/foo/bar.ts → tests/foo/bar.test.ts)
  if (rel.startsWith('src/') || rel.startsWith('src\\')) {
    const withoutSrc = rel.replace(/^src[/\\]/u, '')
    const ext = path.extname(withoutSrc)
    const base = withoutSrc.slice(0, -ext.length)

    for (const suffix of ['.test', '.spec']) {
      const candidate = path.join(projectRoot, 'tests', `${base}${suffix}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }

  // Fallback: colocated test file (same directory)
  const dir = path.dirname(implAbsPath)
  const ext = path.extname(implAbsPath)
  const baseName = path.basename(implAbsPath, ext)

  for (const suffix of ['.test', '.spec']) {
    const candidate = path.join(dir, `${baseName}${suffix}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

/**
 * Resolve the implementation file path from a test file path
 * @param {string} testRelPath - Relative path from projectRoot (e.g. tests/foo/bar.test.ts)
 * @returns {string} Implementation file relative path (e.g. src/foo/bar.ts)
 */
export function resolveImplPath(testRelPath) {
  const ext = path.extname(testRelPath)
  const base = path.basename(testRelPath, ext).replace(/\.(test|spec)$/u, '')

  if (testRelPath.startsWith('tests/') || testRelPath.startsWith('tests\\')) {
    const dir = path.dirname(testRelPath).replace(/^tests[/\\]?/u, '')
    // tests/client/debug/helpers.test.ts → client/debug/helpers.ts (client/ stays)
    if (dir.startsWith('client/') || dir.startsWith('client\\') || dir === 'client') {
      return path.join(dir, `${base}${ext}`)
    }
    // tests/scripts/foo.test.ts → scripts/foo.ts (scripts/ at root — bug fix for old src/scripts/* mapping; scripts/ is NOT a gateable source root)
    if (dir.startsWith('scripts/') || dir.startsWith('scripts\\') || dir === 'scripts') {
      return path.join(dir, `${base}${ext}`)
    }
    // tests/review-loop/foo.test.ts → review-loop/src/foo.ts
    if (dir === 'review-loop' || dir.startsWith('review-loop/') || dir.startsWith('review-loop\\')) {
      const withoutReviewLoop = dir.replace(/^review-loop[/\\]?/u, '')
      return path.join('review-loop', 'src', withoutReviewLoop, `${base}${ext}`)
    }
    // tests/foo/bar.test.ts → src/foo/bar.ts (prepend src/)
    return path.join('src', dir, `${base}${ext}`)
  }

  // Colocated test: same directory
  return path.join(path.dirname(testRelPath), `${base}${ext}`)
}

/**
 * Check if a test file imports its corresponding implementation module
 * @param {string} testAbsPath - Absolute path to the test file
 * @param {string} implAbsPath - Absolute path to the implementation file
 * @returns {boolean} True if the test file references the implementation module
 */
export function testFileImportsImpl(testAbsPath, implAbsPath) {
  const content = fs.readFileSync(testAbsPath, 'utf8')
  const testDir = path.dirname(testAbsPath)

  // Calculate relative path from test dir to impl file
  const relToImpl = path.relative(testDir, implAbsPath).replace(/\\/gu, '/')
  const noExt = relToImpl.replace(/\.(ts|tsx|js|jsx)$/u, '')
  const withJs = noExt + '.js'

  // Check for the impl path as a string literal (covers import, require, mock.module, dynamic import)
  return content.includes(withJs) || content.includes(noExt + "'") || content.includes(noExt + '"')
}
