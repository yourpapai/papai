// Run tests after a file edit; block if RED or coverage dropped below session baseline

import path from 'node:path'

import { getSessionBaseline } from '../coverage-session.mjs'
import { getCoverage } from '../coverage.mjs'
import { findTestFile, isTestFile, isGateableImplFile } from '../test-resolver.mjs'
import { runTest } from '../test-runner.mjs'

const IMPL_PATTERN = /\.(?:ts|js|tsx|jsx)$/u

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_input: { file_path?: string }, session_id: string, cwd: string }} ctx
 * @returns {Promise<BlockResult | null>}
 */
export async function verifyTestsPass(ctx) {
  try {
    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (!IMPL_PATTERN.test(filePath)) return null

    const absPath = path.resolve(cwd, filePath)
    const testFile = isTestFile(filePath) ? absPath : findTestFile(absPath, cwd)
    if (!testFile) return null

    const result = await runTest(testFile, cwd)

    if (!result.passed) {
      const relFile = path.relative(cwd, absPath)
      const isTest = isTestFile(filePath)
      return {
        decision: 'block',
        reason:
          `Tests failed after ${isTest ? 'writing' : 'editing'} \`${relFile}\`.\n\n` +
          `── Test output ──────────────────────────────\n` +
          `${result.output}\n` +
          `─────────────────────────────────────────────\n\n` +
          (isTest
            ? 'Next step: Write the implementation to make this test pass.'
            : 'Next step: Fix the code to make all tests pass.'),
      }
    }

    // Coverage enforcement — only for impl files in src/
    if (!isTestFile(filePath) && isGateableImplFile(filePath, cwd)) {
      // Get session-level baseline (captured at session start by PreToolUse hook)
      const baseline = getSessionBaseline(session_id, cwd)
      const baselineCov = baseline?.[absPath]

      if (baselineCov && baselineCov.total > 0) {
        const cov = getCoverage(testFile, absPath, cwd)
        if (cov && cov.total > 0) {
          const baselinePct = baselineCov.covered / baselineCov.total
          const currentPct = cov.covered / cov.total
          if (currentPct < baselinePct) {
            const relFile = path.relative(cwd, absPath)
            const drop = ((baselinePct - currentPct) * 100).toFixed(1)
            return {
              decision: 'block',
              reason:
                `Code coverage dropped in \`${relFile}\`.\n\n` +
                `Before: ${(baselinePct * 100).toFixed(1)}% (${baselineCov.covered}/${baselineCov.total} lines)\n` +
                `After:  ${(currentPct * 100).toFixed(1)}% (${cov.covered}/${cov.total} lines), −${drop}pp\n\n` +
                `Next step: Write tests to cover the new code paths.`,
            }
          }
        }
      }
    }
  } catch {
    // Fail open
  }
  return null
}
