// Advisory TDD nudge — allow write, emit once per file per session

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
 * @typedef {Object} NudgeResult
 * @property {'nudge'} decision
 * @property {string} reason
 */

/**
 * Check if a gateable impl file is written without a covering test and return
 * an advisory nudge payload. Returns null when no nudge is needed.
 * Dedupes per file per session via SessionState.tddNudgedFiles.
 *
 * Intended for PostToolUse (after write succeeds) — the write is allowed,
 * the nudge is emitted once for the next turn.
 *
 * @param {{ tool_input: { file_path?: string }, session_id: string, cwd: string }} ctx
 * @returns {NudgeResult | null}
 */
export function getTddNudge(ctx) {
  try {
    const { tool_input, session_id, cwd } = ctx
    const filePath = tool_input.file_path
    if (!filePath) return null
    if (isTestFile(filePath)) return null
    if (!isGateableImplFile(filePath, cwd)) return null

    const absPath = path.resolve(cwd, filePath)

    const testOnDisk = findTestFile(absPath, cwd)
    if (testOnDisk) {
      if (!testFileImportsImpl(testOnDisk, absPath)) {
        const state = new SessionState(session_id, getSessionsDir(cwd))
        const dedupKey = absPath
        if (state.hasTddNudged(dedupKey)) return null
        const relImpl = path.relative(cwd, absPath)
        const expectedImport = path
          .relative(path.dirname(testOnDisk), absPath)
          .replace(/\\/gu, '/')
          .replace(/\.(ts|tsx)$/u, '.js')
        const relTest = path.relative(cwd, testOnDisk)
        state.addTddNudged(dedupKey)
        return {
          decision: 'nudge',
          reason:
            `Wrote \`${relImpl}\` but its test \`${relTest}\` does not import the implementation.\n\n` +
            `Expected import from \`${expectedImport}\` in the test.\n\n` +
            `Next time write the failing test first — follow TDD.`,
        }
      }
      return null
    }

    const state = new SessionState(session_id, getSessionsDir(cwd))
    const dedupKey = absPath
    if (state.hasTddNudged(dedupKey)) return null

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

    state.addTddNudged(dedupKey)
    return {
      decision: 'nudge',
      reason:
        `Wrote \`${relPath}\` without a covering test — next time write the failing test first, follow TDD.\n\n` +
        `Expected test: ${suggestedTest}\n\n` +
        `CI will require it.`,
    }
  } catch {
    return null
  }
}
