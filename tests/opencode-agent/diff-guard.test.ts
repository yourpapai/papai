// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { inspectStaged, measure, parseNumstat } from '../../opencode-agent/src/diff-guard.js'
import type { DiffLimits, DiffVerdict, StagedFile } from '../../opencode-agent/src/diff-guard.js'
import { createGit, credentialEnv } from '../../opencode-agent/src/git.js'
import type { GitOptions } from '../../opencode-agent/src/git.js'
import type { CommandRunner } from '../../opencode-agent/src/shell.js'

const LIMITS: DiffLimits = { maxFiles: 10, maxLines: 100 }
const TOKEN = 'ghp_0123456789abcdefghijklmnop'

/**
 * Recorded from a real `git diff --cached --numstat`, not written by hand:
 * a binary, an ordinary edit, both rename spellings git uses, and a path with a
 * space (which numstat leaves unquoted, unlike porcelain).
 */
const REAL_NUMSTAT = [
  '-\t-\tblob.bin',
  '1\t0\tkeep.txt',
  '0\t0\tsrc/{old.ts => new.ts}',
  '1\t0\tweird name.txt',
  '0\t0\tkeep.txt => totally/other.txt',
].join('\n')

const file = (path: string, lines: number | null = 1): StagedFile => ({ path, lines })

/** The reason a verdict carries, or '' when it passed. Keeps the narrowing out
 *  of the test bodies, per repo lint. */
const reasonOf = (verdict: DiffVerdict): string => (verdict.ok ? '' : verdict.reason)

describe('parseNumstat', () => {
  test('reads a recorded change set', () => {
    expect(parseNumstat(REAL_NUMSTAT)).toEqual([
      { path: 'blob.bin', lines: null },
      { path: 'keep.txt', lines: 1 },
      { path: 'src/new.ts', lines: 0 },
      { path: 'weird name.txt', lines: 1 },
      { path: 'totally/other.txt', lines: 0 },
    ])
  })

  test('keeps the destination of a brace-form rename', () => {
    expect(parseNumstat('0\t0\tsrc/{old.ts => new.ts}')[0]?.path).toBe('src/new.ts')
  })

  test('keeps the destination of an arrow-form rename', () => {
    expect(parseNumstat('0\t0\ta.txt => b/c.txt')[0]?.path).toBe('b/c.txt')
  })

  test('reports a binary as unmeasurable rather than as zero lines', () => {
    // Zero would let an arbitrarily large blob slide under a line cap.
    expect(parseNumstat('-\t-\tblob.bin')[0]?.lines).toBeNull()
  })

  test.each(['', '   \n  \n', 'nonsense-with-no-tabs'])('ignores the unusable input %p', (raw) => {
    expect(parseNumstat(raw)).toEqual([])
  })
})

describe('measure', () => {
  test('counts binaries as files but not as lines', () => {
    expect(measure([file('a.ts', 5), file('b.bin', null), file('c.ts', 3)])).toEqual({
      files: 3,
      lines: 8,
      binaries: ['b.bin'],
    })
  })
})

describe('inspectStaged', () => {
  const ok = (files: StagedFile[], diff = ''): ReturnType<typeof inspectStaged> =>
    inspectStaged(files, diff, LIMITS, [TOKEN])

  test('accepts an ordinary change set', () => {
    expect(ok([file('src/a.ts', 40), file('tests/a.test.ts', 30)])).toEqual({ ok: true })
  })

  test('refuses a credential in the staged content, whatever the file is called', () => {
    // The roadmap's example is a `.env`, but a name deny-list only catches the
    // files someone thought of. The value is the thing that must not be
    // committed — a `.env` renamed `notes.txt` is the same disaster.
    const verdict = ok([file('notes.txt')], `+++ b/notes.txt\n+OPENAI_KEY=${TOKEN}\n`)

    expect(verdict).toMatchObject({ ok: false })
    expect(reasonOf(verdict)).toContain('credentials')
  })

  test('never repeats the credential it refused', () => {
    const verdict = ok([file('notes.txt')], `+${TOKEN}`)

    expect(reasonOf(verdict)).not.toContain(TOKEN)
  })

  test('refuses too many files, and names them', () => {
    const many = Array.from({ length: 11 }, (_, index) => file(`node_modules/pkg${index}/index.js`))
    const verdict = ok(many)

    expect(verdict).toMatchObject({ ok: false })
    expect(reasonOf(verdict)).toContain('11 files changed')
    expect(reasonOf(verdict)).toContain('node_modules/pkg0/index.js')
  })

  test('truncates a very long file list rather than posting all of it', () => {
    const many = Array.from({ length: 200 }, (_, index) => file(`f${index}.ts`))
    const verdict = inspectStaged(many, '', { maxFiles: 1, maxLines: 100_000 }, [])

    expect(reasonOf(verdict)).toContain('and 190 more')
  })

  test('refuses too many lines', () => {
    const verdict = ok([file('generated.ts', 101)])

    expect(reasonOf(verdict)).toContain('101 lines changed')
  })

  test('refuses a binary it cannot size-check', () => {
    const verdict = ok([file('src/a.ts', 3), file('fixture.bin', null)])

    expect(reasonOf(verdict)).toContain('fixture.bin')
  })

  test('checks the credential before the caps, so a leak is never masked by size', () => {
    const verdict = ok([file('a.ts', 5_000)], `+${TOKEN}`)

    expect(reasonOf(verdict)).toContain('credentials')
  })

  test('sits exactly on the limits without complaint', () => {
    expect(ok([file('a.ts', 100)])).toEqual({ ok: true })
    expect(ok(Array.from({ length: 10 }, (_, index) => file(`f${index}.ts`, 0)))).toEqual({ ok: true })
  })
})

interface GitCapture {
  calls: string[][]
  run: CommandRunner
}

/** Fake git. `stdouts` maps a joined argv to its output; the branching lives
 *  out here so no test body carries a conditional. */
const captureGit = (stdouts: Record<string, string>): GitCapture => {
  const calls: string[][] = []
  const run: CommandRunner = (argv) => {
    calls.push([...argv])
    const key = argv.join(' ')
    return Promise.resolve({ command: key, exitCode: 0, stdout: stdouts[key] ?? '', stderr: '' })
  }
  return { calls, run }
}

const DIRTY = { 'git status --porcelain': ' M src/a.ts\n' }

const guardedGit = (run: CommandRunner, limits: DiffLimits, secrets: readonly string[] = []): GitOptions => ({
  run,
  cwd: '/repo',
  authorName: 'agent',
  authorEmail: 'agent@example.com',
  limits,
  secrets,
  credential: null,
})

describe('credentialEnv', () => {
  const credential = { remote: 'https://github.com/', token: 'ghp_supersecrettoken12345' }

  test('carries the token in a config env var, not in a file or argv', () => {
    // `persist-credentials: true` wrote it into `.git/config`, which the model's
    // `build` profile can read — scrubbing `process.env` does nothing about a
    // file. A URL or `git -c` form would put it in argv, where `/proc` and the
    // `GitError` message published to the issue would both carry it.
    const env = credentialEnv(credential)

    expect(env?.['GIT_CONFIG_COUNT']).toBe('1')
    expect(env?.['GIT_CONFIG_KEY_0']).toBe('http.https://github.com/.extraheader')
    expect(env?.['GIT_CONFIG_VALUE_0']).toBe(
      `AUTHORIZATION: basic ${Buffer.from('x-access-token:ghp_supersecrettoken12345').toString('base64')}`,
    )
  })

  test('scopes the header to the configured remote, not to github.com', () => {
    // A header scoped to the wrong host is silently not sent, so an Enterprise
    // Server install would fail to authenticate with no clue why.
    const env = credentialEnv({ remote: 'https://git.acme.internal/', token: 'x' })

    expect(env?.['GIT_CONFIG_KEY_0']).toBe('http.https://git.acme.internal/.extraheader')
  })

  test('supplies nothing for an anonymous checkout', () => {
    expect(credentialEnv(null)).toBeUndefined()
  })

  test('every git invocation carries it, not just the push', async () => {
    // `ensureBranch` fetches before anything is pushed, and a private repository
    // needs the credential for that too.
    const envs: (Record<string, string> | undefined)[] = []
    const run: CommandRunner = (argv, options) => {
      envs.push(options.env)
      return Promise.resolve({ command: argv.join(' '), exitCode: 0, stdout: '', stderr: '' })
    }

    await createGit({ ...guardedGit(run, LIMITS), credential }).ensureBranch('agent/issue-1', 'master')

    expect(envs.length).toBeGreaterThan(1)
    expect(envs.every((env) => env?.['GIT_CONFIG_VALUE_0'] !== undefined)).toBe(true)
  })

  test('never puts the token in the argv git is spawned with', async () => {
    const calls: string[][] = []
    const run: CommandRunner = (argv) => {
      calls.push([...argv])
      return Promise.resolve({ command: argv.join(' '), exitCode: 0, stdout: '', stderr: '' })
    }

    await createGit({ ...guardedGit(run, LIMITS), credential }).push('agent/issue-1')

    expect(calls.flat().join(' ')).not.toContain('ghp_')
  })
})

describe('commitAll runs the guard', () => {
  test('commits a change set inside the limits', async () => {
    const { calls, run } = captureGit({ ...DIRTY, 'git diff --cached --numstat': '3\t1\tsrc/a.ts' })

    expect(await createGit(guardedGit(run, LIMITS)).commitAll('msg')).toBe(true)
    expect(calls.some((call) => call.includes('commit'))).toBe(true)
  })

  test('refuses, unstages, and never commits when the guard trips', async () => {
    const numstat = Array.from({ length: 11 }, (_, index) => `1\t0\tnode_modules/p${index}.js`).join('\n')
    const { calls, run } = captureGit({ ...DIRTY, 'git diff --cached --numstat': numstat })

    await expect(createGit(guardedGit(run, LIMITS)).commitAll('msg')).rejects.toThrow('Refusing to commit')
    expect(calls.some((call) => call.includes('commit'))).toBe(false)
    // A half-staged index is a poor thing to hand a retry.
    expect(calls).toContainEqual(['git', 'reset'])
  })

  test('refuses a staged credential', async () => {
    const { calls, run } = captureGit({
      ...DIRTY,
      'git diff --cached --numstat': '1\t0\t.env',
      'git diff --cached': `+++ b/.env\n+KEY=${TOKEN}\n`,
    })

    await expect(createGit(guardedGit(run, LIMITS, [TOKEN])).commitAll('msg')).rejects.toThrow('Refusing to commit')
    expect(calls.some((call) => call.includes('commit'))).toBe(false)
  })

  test('does not stage or inspect anything when the tree is clean', async () => {
    const { calls, run } = captureGit({})

    expect(await createGit(guardedGit(run, LIMITS)).commitAll('msg')).toBe(false)
    expect(calls.some((call) => call.includes('--cached'))).toBe(false)
  })
})
