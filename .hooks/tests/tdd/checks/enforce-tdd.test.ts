import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { enforceTdd } from '../../../tdd/checks/enforce-tdd.mjs'
import { SessionState } from '../../../tdd/session-state.mjs'

// Mock dependencies
let isTestFileImpl = (filePath: string) => false
let isGateableImplFileImpl = (filePath: string, projectRoot: string) => false
let findTestFileImpl = (implAbsPath: string, projectRoot: string): string | null => null
let suggestTestPathImpl = (implRelPath: string): string => 'tests/example.test.ts'
let getSessionsDirImpl = (cwd: string): string => path.join(cwd, '.hooks', 'sessions')
let getSessionBaselineImpl = (): Record<string, { covered: number; total: number }> | null => null

mock.module('../../../tdd/test-resolver.mjs', () => ({
  isTestFile: (filePath: string) => isTestFileImpl(filePath),
  isGateableImplFile: (filePath: string, projectRoot: string) => isGateableImplFileImpl(filePath, projectRoot),
  findTestFile: (implAbsPath: string, projectRoot: string) => findTestFileImpl(implAbsPath, projectRoot),
  suggestTestPath: (implRelPath: string) => suggestTestPathImpl(implRelPath),
}))

mock.module('../../../tdd/paths.mjs', () => ({
  getSessionsDir: (cwd: string) => getSessionsDirImpl(cwd),
}))

describe('enforceTdd', () => {
  let tmpDir: string
  let sessionsDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-tdd-test-'))
    sessionsDir = path.join(tmpDir, '.hooks', 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })

    // Reset mock implementations to defaults
    isTestFileImpl = () => false
    isGateableImplFileImpl = () => true
    findTestFileImpl = () => null
    suggestTestPathImpl = (implRelPath: string) => {
      const withoutSrc = implRelPath.replace(/^src[/\\]/u, '')
      const ext = path.extname(withoutSrc)
      const base = withoutSrc.slice(0, -ext.length)
      return path.join('tests', `${base}.test${ext}`)
    }
    getSessionsDirImpl = () => sessionsDir
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  afterAll(() => {
    mock.restore()
  })

  describe('returns null (not blocking)', () => {
    test('for test files', () => {
      isTestFileImpl = () => true
      isGateableImplFileImpl = () => false

      const ctx = {
        tool_input: { file_path: 'tests/foo.test.ts' },
        session_id: 'test-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })

    test('for non-gateable files (not in src/, not .ts/.js)', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => false

      const ctx = {
        tool_input: { file_path: 'docs/readme.md' },
        session_id: 'test-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })

    test('when test file exists on disk', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => path.join(tmpDir, 'tests', 'foo.test.ts')

      const ctx = {
        tool_input: { file_path: 'src/foo.ts' },
        session_id: 'test-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })

    test('when test was written this session', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      // Simulate a test being written this session
      const state = new SessionState('test-session', sessionsDir)
      state.addWrittenTest(path.join(tmpDir, 'tests', 'bar.test.ts'))

      const ctx = {
        tool_input: { file_path: 'src/bar.ts' },
        session_id: 'test-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })

    test('when test was written this session with nested path', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const state = new SessionState('nested-session', sessionsDir)
      state.addWrittenTest(path.join(tmpDir, 'tests', 'providers', 'kaneo', 'client.test.ts'))

      const ctx = {
        tool_input: { file_path: 'src/providers/kaneo/client.ts' },
        session_id: 'nested-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })
  })

  describe('blocks implementation writes', () => {
    test('when no test exists and no session test', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/new-module.ts' },
        session_id: 'block-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)

      expect(result).not.toBeNull()
      expect(result?.decision).toBe('block')
      expect(result?.reason).toContain('Cannot write')
      expect(result?.reason).toContain('src/new-module.ts')
    })

    test('includes suggested test path in block reason', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/utils/helper.ts' },
        session_id: 'suggest-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)

      expect(result).not.toBeNull()
      expect(result?.reason).toContain('tests/utils/helper.test.ts')
      expect(result?.reason).toContain('Step 1: Write a failing test')
      expect(result?.reason).toContain('Step 2: Write the implementation')
    })

    test('handles nested src paths correctly', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/deep/nested/module.ts' },
        session_id: 'nested-block-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)

      expect(result).not.toBeNull()
      expect(result?.reason).toContain('tests/deep/nested/module.test.ts')
    })
  })

  describe('graceful failure handling', () => {
    test('returns null when file_path is missing', () => {
      const ctx = {
        tool_input: {},
        session_id: 'missing-path-session',
        cwd: tmpDir,
      } as { tool_input: { file_path?: string }; session_id: string; cwd: string }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })

    test('returns null when tool_input is empty', () => {
      const ctx = {
        tool_input: {},
        session_id: 'empty-input-session',
        cwd: tmpDir,
      } as { tool_input: { file_path?: string }; session_id: string; cwd: string }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })

    test('returns null on unexpected errors (fail open)', () => {
      // Make isTestFile throw to simulate an error
      isTestFileImpl = () => {
        throw new Error('Unexpected error')
      }

      const ctx = {
        tool_input: { file_path: 'src/error.ts' },
        session_id: 'error-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })
  })

  describe('session state isolation', () => {
    test('does not allow test from different session', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      // Add test to session A
      const stateA = new SessionState('session-a', sessionsDir)
      stateA.addWrittenTest(path.join(tmpDir, 'tests', 'shared.test.ts'))

      // Try to write impl in session B
      const ctx = {
        tool_input: { file_path: 'src/shared.ts' },
        session_id: 'session-b',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).not.toBeNull()
      expect(result?.decision).toBe('block')
    })

    test('allows impl when test exists in current session only', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      // Add test to current session
      const state = new SessionState('current-session', sessionsDir)
      state.addWrittenTest(path.join(tmpDir, 'tests', 'current.test.ts'))

      const ctx = {
        tool_input: { file_path: 'src/current.ts' },
        session_id: 'current-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).toBeNull()
    })
  })

  describe('edge cases', () => {
    test('handles absolute file paths', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: path.join(tmpDir, 'src', 'absolute.ts') },
        session_id: 'absolute-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).not.toBeNull()
      expect(result?.reason).toContain('src/absolute.ts')
    })

    test('handles files with multiple dots in name', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/utils.helper.test.ts' },
        session_id: 'dots-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      // Note: This is a gateable file (ends with .ts, not a test pattern)
      expect(result).not.toBeNull()
    })

    test('handles jsx and tsx files', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = (filePath: string) => filePath.endsWith('.tsx')
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/components/Button.tsx' },
        session_id: 'tsx-session',
        cwd: tmpDir,
      }

      const result = enforceTdd(ctx)
      expect(result).not.toBeNull()
      expect(result?.reason).toContain('src/components/Button.tsx')
    })
  })
})
