import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('trackTestWrite', () => {
  let tempDir: string
  let getSessionsDirImpl: (cwd: string) => string
  let isTestFileImpl: (filePath: string) => boolean
  let sessionStateInstances: Map<string, MockSessionState>

  class MockSessionState {
    sessionId: string
    writtenTests: string[] = []

    constructor(sessionId: string, _sessionsDir: string) {
      this.sessionId = sessionId
      if (!sessionStateInstances.has(sessionId)) {
        sessionStateInstances.set(sessionId, this)
      }
      return sessionStateInstances.get(sessionId)!
    }

    addWrittenTest(testPath: string): void {
      this.writtenTests.push(testPath)
    }

    getWrittenTests(): string[] {
      return this.writtenTests
    }
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-test-write-'))
    sessionStateInstances = new Map()

    getSessionsDirImpl = () => path.join(tempDir, 'sessions')
    isTestFileImpl = () => true

    mock.module('../../../tdd/paths.mjs', () => ({
      getSessionsDir: (...args: [string]) => getSessionsDirImpl(...args),
    }))

    mock.module('../../../tdd/test-resolver.mjs', () => ({
      isTestFile: (...args: [string]) => isTestFileImpl(...args),
    }))

    mock.module('../../../tdd/session-state.mjs', () => ({
      SessionState: MockSessionState,
    }))
  })

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    mock.restore()
  })

  afterAll(() => {
    mock.restore()
  })

  const importTrackTestWrite = async () => {
    const mod = await import('../../../tdd/checks/track-test-write.mjs')
    return mod.trackTestWrite
  }

  describe('records test file path in session state', () => {
    test('records .test.ts file in session state', async () => {
      const trackTestWrite = await importTrackTestWrite()
      const sessionId = 'test-session-1'
      const filePath = 'tests/foo.test.ts'

      const result = trackTestWrite({
        tool_input: { file_path: filePath },
        session_id: sessionId,
        cwd: tempDir,
      })

      expect(result).toBeNull()
      const state = sessionStateInstances.get(sessionId)
      expect(state).toBeDefined()
      expect(state!.writtenTests).toContain(path.resolve(tempDir, filePath))
    })

    test('records .spec.ts file in session state', async () => {
      const trackTestWrite = await importTrackTestWrite()
      const sessionId = 'test-session-2'
      const filePath = 'tests/bar.spec.ts'

      trackTestWrite({
        tool_input: { file_path: filePath },
        session_id: sessionId,
        cwd: tempDir,
      })

      const state = sessionStateInstances.get(sessionId)
      expect(state!.writtenTests).toContain(path.resolve(tempDir, filePath))
    })

    test('records multiple test files for same session', async () => {
      const trackTestWrite = await importTrackTestWrite()
      const sessionId = 'test-session-multi'

      trackTestWrite({
        tool_input: { file_path: 'tests/a.test.ts' },
        session_id: sessionId,
        cwd: tempDir,
      })

      trackTestWrite({
        tool_input: { file_path: 'tests/b.spec.ts' },
        session_id: sessionId,
        cwd: tempDir,
      })

      const state = sessionStateInstances.get(sessionId)
      expect(state!.writtenTests).toHaveLength(2)
      expect(state!.writtenTests).toContain(path.resolve(tempDir, 'tests/a.test.ts'))
      expect(state!.writtenTests).toContain(path.resolve(tempDir, 'tests/b.spec.ts'))
    })

    test('isolates test files by session ID', async () => {
      const trackTestWrite = await importTrackTestWrite()

      trackTestWrite({
        tool_input: { file_path: 'tests/session-a.test.ts' },
        session_id: 'session-a',
        cwd: tempDir,
      })

      trackTestWrite({
        tool_input: { file_path: 'tests/session-b.test.ts' },
        session_id: 'session-b',
        cwd: tempDir,
      })

      const stateA = sessionStateInstances.get('session-a')
      const stateB = sessionStateInstances.get('session-b')

      expect(stateA!.writtenTests).toEqual([path.resolve(tempDir, 'tests/session-a.test.ts')])
      expect(stateB!.writtenTests).toEqual([path.resolve(tempDir, 'tests/session-b.test.ts')])
    })
  })

  describe('returns null for non-test files', () => {
    test('returns null when isTestFile returns false', async () => {
      isTestFileImpl = () => false
      mock.module('../../../tdd/test-resolver.mjs', () => ({
        isTestFile: (...args: [string]) => isTestFileImpl(...args),
      }))

      const trackTestWrite = await importTrackTestWrite()
      const sessionId = 'test-session-non-test'

      // Pre-create the session state so we can check it
      const MockSessionState = (await import('../../../tdd/session-state.mjs')).SessionState
      const state = new MockSessionState(sessionId, path.join(tempDir, 'sessions'))

      const result = trackTestWrite({
        tool_input: { file_path: 'src/config.ts' },
        session_id: sessionId,
        cwd: tempDir,
      })

      expect(result).toBeNull()
      expect(state.getWrittenTests()).toHaveLength(0)
    })

    test('returns null for implementation files', async () => {
      isTestFileImpl = (filePath: string) => filePath.includes('.test.') || filePath.includes('.spec.')
      mock.module('../../../tdd/test-resolver.mjs', () => ({
        isTestFile: (...args: [string]) => isTestFileImpl(...args),
      }))

      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite({
        tool_input: { file_path: 'src/utils.ts' },
        session_id: 'impl-test',
        cwd: tempDir,
      })

      expect(result).toBeNull()
    })
  })

  describe('returns null when file_path is missing', () => {
    test('returns null when file_path is undefined', async () => {
      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite({
        tool_input: { file_path: undefined as unknown as string },
        session_id: 'missing-path',
        cwd: tempDir,
      })

      expect(result).toBeNull()
    })

    test('returns null when file_path is empty string', async () => {
      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite({
        tool_input: { file_path: '' },
        session_id: 'empty-path',
        cwd: tempDir,
      })

      expect(result).toBeNull()
    })

    test('returns null when tool_input is missing file_path property', async () => {
      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite({
        tool_input: {} as { file_path: string },
        session_id: 'no-path-prop',
        cwd: tempDir,
      })

      expect(result).toBeNull()
    })
  })

  describe('resolves to absolute path before storing', () => {
    test('converts relative path to absolute path', async () => {
      const trackTestWrite = await importTrackTestWrite()
      const sessionId = 'abs-path-test'
      const relativePath = 'tests/relative.test.ts'

      trackTestWrite({
        tool_input: { file_path: relativePath },
        session_id: sessionId,
        cwd: tempDir,
      })

      const state = sessionStateInstances.get(sessionId)
      const storedPath = state!.writtenTests[0]

      expect(path.isAbsolute(storedPath)).toBe(true)
      expect(storedPath).toBe(path.resolve(tempDir, relativePath))
    })

    test('preserves already absolute paths', async () => {
      const trackTestWrite = await importTrackTestWrite()
      const sessionId = 'already-abs'
      const absolutePath = path.join(tempDir, 'tests/absolute.test.ts')

      trackTestWrite({
        tool_input: { file_path: absolutePath },
        session_id: sessionId,
        cwd: tempDir,
      })

      const state = sessionStateInstances.get(sessionId)
      expect(state!.writtenTests[0]).toBe(absolutePath)
    })
  })

  describe('handles errors gracefully (fail open)', () => {
    test('returns null when SessionState throws', async () => {
      mock.module('../../tdd/session-state.mjs', () => ({
        SessionState: {
          forClaude: () => {
            throw new Error('SessionState initialization failed')
          },
        },
      }))

      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite({
        tool_input: { file_path: 'tests/error.test.ts' },
        session_id: 'error-session',
        cwd: tempDir,
      })

      expect(result).toBeNull()
    })

    test('returns null when isTestFile throws', async () => {
      mock.module('../../tdd/test-resolver.mjs', () => ({
        isTestFile: () => {
          throw new Error('isTestFile failed')
        },
      }))

      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite({
        tool_input: { file_path: 'tests/error.test.ts' },
        session_id: 'error-session',
        cwd: tempDir,
      })

      expect(result).toBeNull()
    })

    test('returns null when addWrittenTest throws', async () => {
      mock.module('../../tdd/session-state.mjs', () => ({
        SessionState: {
          forClaude: () => ({
            addWrittenTest: () => {
              throw new Error('addWrittenTest failed')
            },
          }),
        },
      }))

      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite({
        tool_input: { file_path: 'tests/error.test.ts' },
        session_id: 'error-session',
        cwd: tempDir,
      })

      expect(result).toBeNull()
    })

    test('returns null when ctx is malformed', async () => {
      const trackTestWrite = await importTrackTestWrite()

      const result = trackTestWrite(
        null as unknown as {
          tool_input: { file_path: string }
          session_id: string
          cwd: string
        },
      )

      expect(result).toBeNull()
    })
  })

  describe('works with different test file patterns', () => {
    const testPatterns = [
      { pattern: 'tests/foo.test.ts', description: '.test.ts' },
      { pattern: 'tests/foo.spec.ts', description: '.spec.ts' },
      { pattern: 'tests/foo.test.js', description: '.test.js' },
      { pattern: 'tests/foo.spec.js', description: '.spec.js' },
      { pattern: 'tests/foo.test.tsx', description: '.test.tsx' },
      { pattern: 'tests/foo.spec.tsx', description: '.spec.tsx' },
      { pattern: 'tests/foo.test.jsx', description: '.test.jsx' },
      { pattern: 'tests/foo.spec.jsx', description: '.spec.jsx' },
      { pattern: 'src/components/Button.test.ts', description: 'colocated .test.ts' },
      { pattern: 'tests/deep/nested/path/file.spec.ts', description: 'nested path .spec.ts' },
    ]

    for (const { pattern, description } of testPatterns) {
      test(`records ${description} files`, async () => {
        isTestFileImpl = (filePath: string) => filePath.includes('.test.') || filePath.includes('.spec.')
        mock.module('../../tdd/test-resolver.mjs', () => ({
          isTestFile: (...args: [string]) => isTestFileImpl(...args),
        }))

        const trackTestWrite = await importTrackTestWrite()
        const sessionId = `pattern-${description.replace(/[^a-z0-9]/gu, '-')}`

        const result = trackTestWrite({
          tool_input: { file_path: pattern },
          session_id: sessionId,
          cwd: tempDir,
        })

        expect(result).toBeNull()
        const state = sessionStateInstances.get(sessionId)
        expect(state!.writtenTests).toHaveLength(1)
        expect(state!.writtenTests[0]).toBe(path.resolve(tempDir, pattern))
      })
    }
  })
})
