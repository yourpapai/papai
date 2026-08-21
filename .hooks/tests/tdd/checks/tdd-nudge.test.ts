import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getTddNudge } from '../../../tdd/checks/tdd-nudge.mjs'
import { SessionState } from '../../../tdd/session-state.mjs'

let isTestFileImpl = (filePath: string) => false
let isGateableImplFileImpl = (filePath: string, projectRoot: string) => false
let findTestFileImpl = (implAbsPath: string, projectRoot: string): string | null => null
let suggestTestPathImpl = (implRelPath: string): string => 'tests/example.test.ts'
let getSessionsDirImpl = (cwd: string): string => path.join(cwd, '.hooks', 'sessions')

mock.module('../../../tdd/test-resolver.mjs', () => ({
  isTestFile: (filePath: string) => isTestFileImpl(filePath),
  isGateableImplFile: (filePath: string, projectRoot: string) => isGateableImplFileImpl(filePath, projectRoot),
  findTestFile: (implAbsPath: string, projectRoot: string) => findTestFileImpl(implAbsPath, projectRoot),
  suggestTestPath: (implRelPath: string) => suggestTestPathImpl(implRelPath),
}))

mock.module('../../../tdd/paths.mjs', () => ({
  getSessionsDir: (cwd: string) => getSessionsDirImpl(cwd),
}))

describe('getTddNudge', () => {
  let tmpDir: string
  let sessionsDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdd-nudge-test-'))
    sessionsDir = path.join(tmpDir, '.hooks', 'sessions')
    fs.mkdirSync(sessionsDir, { recursive: true })

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

  describe('returns nudge when gateable file has no covering test', () => {
    test('returns nudge with advisory message', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/new-module.ts' },
        session_id: 'nudge-session',
        cwd: tmpDir,
      }

      const result = getTddNudge(ctx)

      expect(result).not.toBeNull()
      expect(result?.decision).toBe('nudge')
      expect(result?.reason).toContain('src/new-module.ts')
      expect(result?.reason).toContain('tests/new-module.test.ts')
      expect(result?.reason).toContain('TDD')
    })

    test('includes suggested test path in nudge reason', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/utils/helper.ts' },
        session_id: 'suggest-nudge-session',
        cwd: tmpDir,
      }

      const result = getTddNudge(ctx)

      expect(result).not.toBeNull()
      expect(result?.reason).toContain('tests/utils/helper.test.ts')
      expect(result?.reason).toContain('next time')
    })

    test('nudge message is advisory not blocking', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/advisory.ts' },
        session_id: 'advisory-session',
        cwd: tmpDir,
      }

      const result = getTddNudge(ctx)

      expect(result?.decision).toBe('nudge')
      expect(result?.reason).not.toContain('Cannot write')
    })
  })

  describe('dedup — second write to same file in same session does not re-nudge', () => {
    test('second call for same file returns null', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx = {
        tool_input: { file_path: 'src/dedup.ts' },
        session_id: 'dedup-session',
        cwd: tmpDir,
      }

      const first = getTddNudge(ctx)
      expect(first).not.toBeNull()

      const second = getTddNudge(ctx)
      expect(second).toBeNull()
    })

    test('different files each get a nudge', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctx1 = {
        tool_input: { file_path: 'src/file-a.ts' },
        session_id: 'multi-file-session',
        cwd: tmpDir,
      }
      const ctx2 = {
        tool_input: { file_path: 'src/file-b.ts' },
        session_id: 'multi-file-session',
        cwd: tmpDir,
      }

      const first = getTddNudge(ctx1)
      const second = getTddNudge(ctx2)

      expect(first).not.toBeNull()
      expect(second).not.toBeNull()
    })

    test('same file in different session nudges again', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const ctxA = {
        tool_input: { file_path: 'src/shared.ts' },
        session_id: 'session-a',
        cwd: tmpDir,
      }
      const ctxB = {
        tool_input: { file_path: 'src/shared.ts' },
        session_id: 'session-b',
        cwd: tmpDir,
      }

      const first = getTddNudge(ctxA)
      expect(first).not.toBeNull()

      const second = getTddNudge(ctxB)
      expect(second).not.toBeNull()
    })
  })

  describe('returns null (no nudge) for non-gateable and covered cases', () => {
    test('for test files', () => {
      isTestFileImpl = () => true
      isGateableImplFileImpl = () => false

      const ctx = {
        tool_input: { file_path: 'tests/foo.test.ts' },
        session_id: 'test-file-session',
        cwd: tmpDir,
      }

      const result = getTddNudge(ctx)
      expect(result).toBeNull()
    })

    test('for non-gateable files', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => false

      const ctx = {
        tool_input: { file_path: 'docs/readme.md' },
        session_id: 'non-gateable-session',
        cwd: tmpDir,
      }

      const result = getTddNudge(ctx)
      expect(result).toBeNull()
    })

    test('when test file exists on disk', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => path.join(tmpDir, 'tests', 'foo.test.ts')

      const ctx = {
        tool_input: { file_path: 'src/foo.ts' },
        session_id: 'has-test-session',
        cwd: tmpDir,
      }

      const result = getTddNudge(ctx)
      expect(result).toBeNull()
    })

    test('when test was written this session', () => {
      isTestFileImpl = () => false
      isGateableImplFileImpl = () => true
      findTestFileImpl = () => null

      const state = new SessionState('written-session', sessionsDir)
      state.addWrittenTest(path.join(tmpDir, 'tests', 'bar.test.ts'))

      const ctx = {
        tool_input: { file_path: 'src/bar.ts' },
        session_id: 'written-session',
        cwd: tmpDir,
      }

      const result = getTddNudge(ctx)
      expect(result).toBeNull()
    })

    test('returns null when file_path is missing', () => {
      const ctx = {
        tool_input: {},
        session_id: 'missing-path-session',
        cwd: tmpDir,
      } as { tool_input: { file_path?: string }; session_id: string; cwd: string }

      const result = getTddNudge(ctx)
      expect(result).toBeNull()
    })
  })
})
