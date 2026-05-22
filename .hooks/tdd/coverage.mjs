import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LCOV_FILE = 'coverage/lcov.info'
const SINGLE_FILE_TIMEOUT = 30_000
const FULL_SUITE_TIMEOUT = 120_000

/**
 * @typedef {Object} CoverageStats
 * @property {number} covered
 * @property {number} total
 */

/**
 * Parse an LCOV file and return line coverage for a specific file.
 * @param {string} lcovPath
 * @param {string} implAbsPath
 * @returns {CoverageStats | null}
 */
function parseLcov(lcovPath, implAbsPath) {
  const content = fs.readFileSync(lcovPath, 'utf8')
  for (const section of content.split('end_of_record')) {
    const sfMatch = section.match(/^SF:(.+)$/mu)
    if (!sfMatch) continue
    if (path.resolve(sfMatch[1]) !== implAbsPath) continue
    const lhMatch = section.match(/^LH:(\d+)$/mu)
    const lfMatch = section.match(/^LF:(\d+)$/mu)
    if (!lhMatch || !lfMatch) continue
    return { covered: parseInt(lhMatch[1]), total: parseInt(lfMatch[1]) }
  }
  return null
}

/**
 * Parse an LCOV file and return line coverage for ALL files.
 * @param {string} lcovPath
 * @returns {Record<string, CoverageStats>}
 */
function parseAllLcov(lcovPath) {
  const content = fs.readFileSync(lcovPath, 'utf8')
  const result = {}
  for (const section of content.split('end_of_record')) {
    const sfMatch = section.match(/^SF:(.+)$/mu)
    if (!sfMatch) continue
    const lhMatch = section.match(/^LH:(\d+)$/mu)
    const lfMatch = section.match(/^LF:(\d+)$/mu)
    if (!lhMatch || !lfMatch) continue
    result[path.resolve(sfMatch[1].trim())] = {
      covered: parseInt(lhMatch[1]),
      total: parseInt(lfMatch[1]),
    }
  }
  return result
}

/**
 * Run the full test suite with coverage and return per-file line coverage for all files.
 * Returns null if coverage is unavailable (fail-open).
 * @param {string} projectRoot
 * @returns {Record<string, CoverageStats> | null}
 */
export function getFullCoverage(projectRoot) {
  try {
    execSync('bun test --coverage --coverage-reporter=lcov', {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: FULL_SUITE_TIMEOUT,
    })
    const lcovPath = path.join(projectRoot, LCOV_FILE)
    if (!fs.existsSync(lcovPath)) return null
    const result = parseAllLcov(lcovPath)
    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}

/**
 * Run bun coverage for a test file and return line coverage stats for the impl file.
 * Returns null if coverage is unavailable (fail-open).
 * @param {string} testFile - Absolute path to test file
 * @param {string} implAbsPath - Absolute path to impl file
 * @param {string} projectRoot
 * @returns {CoverageStats | null}
 */
export function getCoverage(testFile, implAbsPath, projectRoot) {
  try {
    execSync(`bun test ${testFile} --coverage --coverage-reporter=lcov`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: SINGLE_FILE_TIMEOUT,
    })
    const lcovPath = path.join(projectRoot, LCOV_FILE)
    if (!fs.existsSync(lcovPath)) return null
    return parseLcov(lcovPath, implAbsPath)
  } catch {
    return null
  }
}
