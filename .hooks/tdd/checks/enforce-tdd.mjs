// Block impl writes if no test file exists (Red phase gate)

import path from 'node:path'

import { getSessionsDir } from '../paths.mjs'
import { SessionState } from '../session-state.mjs'
import {
  findTestFile,
  isTestFile,
  isGateableImplFile,
  suggestTestPath,
  testFileImportsImpl,
} from '../test-resolver.mjs'

/**
 * @typedef {Object} BlockResult
 * @property {'block'} decision
 * @property {string} reason
 */

/**
 * @param {{ tool_input: { file_path?: string }, session_id: string, cwd: string }} ctx
 * @returns {BlockResult | null}
 */
export function enforceTdd(ctx) {
  try {
    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (isTestFile(filePath)) return null
    if (!isGateableImplFile(filePath, cwd)) return null

    const absPath = path.resolve(cwd, filePath)

    const testOnDisk = findTestFile(absPath, cwd)
    if (testOnDisk) {
      // Test file exists — verify it actually imports the implementation module
      if (!testFileImportsImpl(testOnDisk, absPath)) {
        const relImpl = path.relative(cwd, absPath)
        const relTest = path.relative(cwd, testOnDisk)
        const testDir = path.dirname(testOnDisk)
        const expectedImport = path
          .relative(testDir, absPath)
          .replace(/\\/gu, '/')
          .replace(/\.(ts|tsx)$/u, '.js')
        return {
          decision: 'block',
          reason:
            `Cannot write \`${relImpl}\` because the test file \`${relTest}\` does not import the implementation module.\n\n` +
            `The test must contain an import from \`${expectedImport}\`.\n\n` +
            `Fix the test to import and test \`${relImpl}\` before writing the implementation.`,
        }
      }
      return null
    }

    const state = new SessionState(session_id, getSessionsDir(cwd))
    const writtenTests = state.getWrittenTests()
    const alreadyTestedThisSession = writtenTests.some((testAbsPath) => {
      const testRel = path.relative(cwd, testAbsPath)
      if (testRel.startsWith('tests/') || testRel.startsWith('tests\\')) {
        const withoutTests = testRel.replace(/^tests[/\\]/u, '')
        const ext = path.extname(withoutTests)
        const base = withoutTests.slice(0, -ext.length).replace(/\.(test|spec)$/u, '')
        if (path.join(cwd, 'src', `${base}${ext}`) === absPath) return true
      }
      return false
    })
    if (alreadyTestedThisSession) return null

    const relPath = path.relative(cwd, absPath)
    const suggestedTest = suggestTestPath(relPath)

    return {
      decision: 'block',
      reason:
        `Cannot write \`${relPath}\` because no test file exists.\n\n` +
        `Step 1: Write a failing test:\n` +
        `  → ${suggestedTest}\n\n` +
        `Step 2: Write the implementation to make the test pass.`,
    }
  } catch {
    return null
  }
}
