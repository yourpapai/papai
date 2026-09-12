import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SessionState } from '../../../tdd/session-state.mjs'

// Mock only the seams this check consults — paths.mjs (where sessions live)
// and test-resolver.mjs (what counts as a test file). session-state.mjs stays
// REAL: its disk persistence is the behavior under assertion, and mocking the
// class leaks past bun's mock.restore() into later-loaded test files in this
// process (first registration wins; restore never reverts it), which starved
// tdd-nudge of SessionState.load and failed its nudges open.
let tempDir: string
let getSessionsDirImpl: (cwd: string) => string
let isTestFileImpl: (filePath: string) => boolean

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-test-write-'))
  getSessionsDirImpl = () => path.join(tempDir, 'sessions')
  isTestFileImpl = () => true

  mock.module('../../../tdd/paths.mjs', () => ({
    getSessionsDir: (...args: [string]) => getSessionsDirImpl(...args),
  }))

  mock.module('../../../tdd/test-resolver.mjs', () => ({
    isTestFile: (...args: [string]) => isTestFileImpl(...args),
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

/** The persisted state for a session, reloaded from disk the way a later read would see it. */
const stateOf = (sessionId: string): string[] =>
  new SessionState(sessionId, path.join(tempDir, 'sessions')).getWrittenTests()

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
    expect(stateOf(sessionId)).toContain(path.resolve(tempDir, filePath))
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

    expect(stateOf(sessionId)).toContain(path.resolve(tempDir, filePath))
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

    expect(stateOf(sessionId)).toHaveLength(2)
    expect(stateOf(sessionId)).toContain(path.resolve(tempDir, 'tests/a.test.ts'))
    expect(stateOf(sessionId)).toContain(path.resolve(tempDir, 'tests/b.spec.ts'))
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

    expect(stateOf('session-a')).toEqual([path.resolve(tempDir, 'tests/session-a.test.ts')])
    expect(stateOf('session-b')).toEqual([path.resolve(tempDir, 'tests/session-b.test.ts')])
  })
})

describe('returns null for non-test files', () => {
  test('returns null when isTestFile returns false', async () => {
    isTestFileImpl = () => false

    const trackTestWrite = await importTrackTestWrite()
    const sessionId = 'test-session-non-test'

    const result = trackTestWrite({
      tool_input: { file_path: 'src/config.ts' },
      session_id: sessionId,
      cwd: tempDir,
    })

    expect(result).toBeNull()
    expect(stateOf(sessionId)).toHaveLength(0)
  })

  test('returns null for implementation files', async () => {
    isTestFileImpl = (filePath: string) => filePath.includes('.test.') || filePath.includes('.spec.')

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

    const storedPath = stateOf(sessionId)[0]

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

    expect(stateOf(sessionId)[0]).toBe(absolutePath)
  })
})

describe('handles errors gracefully (fail open)', () => {
  test('returns null when resolving the sessions dir throws', async () => {
    getSessionsDirImpl = () => {
      throw new Error('sessions dir resolution failed')
    }

    const trackTestWrite = await importTrackTestWrite()

    const result = trackTestWrite({
      tool_input: { file_path: 'tests/error.test.ts' },
      session_id: 'error-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('returns null when persisting throws (sessions dir is a file)', async () => {
    const blocker = path.join(tempDir, 'sessions')
    fs.writeFileSync(blocker, 'not a directory')

    const trackTestWrite = await importTrackTestWrite()

    const result = trackTestWrite({
      tool_input: { file_path: 'tests/error.test.ts' },
      session_id: 'error-session',
      cwd: tempDir,
    })

    expect(result).toBeNull()
  })

  test('returns null when isTestFile throws', async () => {
    isTestFileImpl = () => {
      throw new Error('isTestFile failed')
    }

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

      const trackTestWrite = await importTrackTestWrite()
      const sessionId = `pattern-${description.replace(/[^a-z0-9]/gu, '-')}`

      const result = trackTestWrite({
        tool_input: { file_path: pattern },
        session_id: sessionId,
        cwd: tempDir,
      })

      expect(result).toBeNull()
      expect(stateOf(sessionId)).toHaveLength(1)
      expect(stateOf(sessionId)[0]).toBe(path.resolve(tempDir, pattern))
    })
  }
})
