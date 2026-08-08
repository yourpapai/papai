// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { inspectSalvage, inspectStaged, measure, parseNumstat } from '../../opencode-agent/src/diff-guard.js'
import type { DiffLimits, DiffVerdict, SalvageVerdict, StagedFile } from '../../opencode-agent/src/diff-guard.js'
import { createGit, credentialEnv } from '../../opencode-agent/src/git.js'
import type { GitOptions, Salvage } from '../../opencode-agent/src/git.js'
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

/** The same two readings of a salvage verdict, for the same reason. */
const refusalOf = (verdict: SalvageVerdict): string => (verdict.ok ? '' : verdict.reason)
const capOf = (verdict: SalvageVerdict): string => (verdict.ok ? (verdict.overCap ?? '') : '')

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

describe('inspectSalvage', () => {
  const salvage = (files: StagedFile[], diff = '', limits = LIMITS): ReturnType<typeof inspectSalvage> =>
    inspectSalvage(files, diff, limits, [TOKEN])

  test('accepts an ordinary change set with nothing to report', () => {
    expect(salvage([file('src/a.ts', 40)])).toEqual({ ok: true, overCap: null })
  })

  test.each([
    ['a credential, whatever the file is called', [file('notes.txt')], `+OPENAI_KEY=${TOKEN}`, 'credentials'],
    ['a binary it cannot size-check', [file('src/a.ts', 3), file('fixture.bin', null)], '', 'fixture.bin'],
  ])('still refuses %s, because being out of time does not make it acceptable', (_label, files, diff, expected) => {
    // A credential is in git history whether or not the file is later deleted, and
    // a blob is a blob. Both refusals stay absolute on this path: a salvage that
    // trips either pushes nothing and says so.
    const verdict = salvage(files, diff)

    expect(verdict).toMatchObject({ ok: false })
    expect(refusalOf(verdict)).toContain(expected)
  })

  test.each([
    ['too many files', Array.from({ length: 11 }, (_, index) => file(`f${index}.ts`)), '11 files changed'],
    ['too many lines', [file('generated.ts', 101)], '101 lines changed'],
  ])('reports %s rather than refusing it', (_label, files, expected) => {
    // The caps exist to turn down a runaway `git add --all`. On a partial tree they
    // can refuse for a reason that has nothing to do with a runaway, and discarding
    // a real 3,000-line increment because the cap says 2,000 recreates the exact
    // loss the salvage exists to prevent.
    const verdict = salvage(files)

    expect(verdict.ok).toBe(true)
    expect(capOf(verdict)).toContain(expected)
  })

  test('the very same change set is refused on the ordinary path', () => {
    // The widening is scoped to the salvage and nowhere else — asserted as one
    // comparison, because "we relaxed it here" is only true if it still bites there.
    const runaway = Array.from({ length: 11 }, (_, index) => file(`node_modules/p${index}.js`))

    expect(inspectStaged(runaway, '', LIMITS, [TOKEN]).ok).toBe(false)
    expect(inspectSalvage(runaway, '', LIMITS, [TOKEN]).ok).toBe(true)
  })

  test('checks the credential before the caps here too, so a leak is never merely reported', () => {
    const verdict = salvage([file('a.ts', 5_000)], `+${TOKEN}`)

    expect(verdict).toMatchObject({ ok: false })
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

    expect(await createGit(guardedGit(run, LIMITS)).commitAll('msg')).toEqual({ files: 1, lines: 4 })
    expect(calls.some((call) => call.includes('commit'))).toBe(true)
  })

  test('reports the totals it measured for the commit it made', async () => {
    // The guard measures the index between `git add --all` and the commit, and
    // used to throw the figure away — so the pipeline held the one fact that
    // says whether a diff is worth reviewing and told nobody. `toEqual` is the
    // assertion on purpose: `measure`'s `binaries` is a guard's working detail
    // and must not ride out to a state block.
    const numstat = ['3\t1\tsrc/a.ts', '10\t2\ttests/a.test.ts'].join('\n')
    const { run } = captureGit({ ...DIRTY, 'git diff --cached --numstat': numstat })

    expect(await createGit(guardedGit(run, LIMITS)).commitAll('msg')).toEqual({ files: 2, lines: 16 })
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

    // `null` rather than zero totals: a tree with nothing to commit and a commit
    // that changed nothing are different answers, and only the first is one the
    // implementation phase turns into a failure.
    expect(await createGit(guardedGit(run, LIMITS)).commitAll('msg')).toBeNull()
    expect(calls.some((call) => call.includes('--cached'))).toBe(false)
  })

  test('runs the repository’s hooks on the ordinary commit', async () => {
    // The other half of the salvage's `--no-verify`: the normal implementation
    // commit is still gated on this repository's own pre-commit hook passing on the
    // runner, which is a coupling nothing in this workspace declares. Pinned here so
    // that bypassing it stays a decision about one path rather than a habit.
    const { calls, run } = captureGit({ ...DIRTY, 'git diff --cached --numstat': '3\t1\tsrc/a.ts' })

    await createGit(guardedGit(run, LIMITS)).commitAll('msg')

    expect(calls.find((call) => call.includes('commit'))).not.toContain('--no-verify')
  })
})

describe('salvageAll — the commit a wall-clock stop makes', () => {
  /** The reason or cap note a salvage carries, whichever it has. Keeps the
   *  narrowing out of the test bodies, per repo lint. */
  const noteOf = (salvage: Salvage): string => {
    if (salvage.kind === 'refused') return salvage.reason
    return salvage.kind === 'committed' ? (salvage.overCap ?? '') : ''
  }

  test('commits with --no-verify, because otherwise it cannot commit at all', async () => {
    // Not an optimisation. `prepare` copies `scripts/pre-commit.sh` into
    // `.git/hooks/pre-commit` on any install where `.git` exists — the Actions
    // runner included — and that hook runs lint, typecheck and format over the
    // staged files. A tree interrupted mid-edit fails all of them, so without this
    // `git commit` exits non-zero and the salvage loses everything it exists to keep.
    const { calls, run } = captureGit({ ...DIRTY, 'git diff --cached --numstat': '60\t20\tsrc/a.ts' })

    const salvaged = await createGit(guardedGit(run, LIMITS)).salvageAll('msg')

    expect(salvaged).toEqual({ kind: 'committed', totals: { files: 1, lines: 80 }, overCap: null })
    expect(calls.find((call) => call.includes('commit'))).toContain('--no-verify')
  })

  test('reports a change set over the caps and commits it anyway', async () => {
    const numstat = Array.from({ length: 11 }, (_, index) => `1\t0\tsrc/f${index}.ts`).join('\n')
    const { calls, run } = captureGit({ ...DIRTY, 'git diff --cached --numstat': numstat })

    const salvaged = await createGit(guardedGit(run, LIMITS)).salvageAll('msg')

    expect(salvaged.kind).toBe('committed')
    expect(noteOf(salvaged)).toContain('11 files changed')
    expect(calls.some((call) => call.includes('commit'))).toBe(true)
  })

  test.each([
    ['a staged credential', { 'git diff --cached --numstat': '1\t0\t.env', 'git diff --cached': `+KEY=${TOKEN}` }],
    ['a staged binary', { 'git diff --cached --numstat': '-\t-\tfixture.bin' }],
  ])('refuses %s, unstages, and commits nothing', async (_label, stdouts) => {
    const { calls, run } = captureGit({ ...DIRTY, ...stdouts })

    const salvaged = await createGit(guardedGit(run, LIMITS, [TOKEN])).salvageAll('msg')

    expect(salvaged.kind).toBe('refused')
    expect(noteOf(salvaged)).not.toContain(TOKEN)
    expect(calls.some((call) => call.includes('commit'))).toBe(false)
    expect(calls).toContainEqual(['git', 'reset'])
  })

  test('reports a clean tree as clean rather than as a failure', async () => {
    // A turn stopped before it wrote anything is a legitimate outcome: the stop
    // still parks and still hands over, it simply has nothing to keep.
    const { calls, run } = captureGit({})

    expect(await createGit(guardedGit(run, LIMITS)).salvageAll('msg')).toEqual({ kind: 'clean' })
    expect(calls.some((call) => call.includes('--cached'))).toBe(false)
  })

  test('pushes with --no-verify only when asked, and plainly otherwise', async () => {
    const { calls, run } = captureGit({})
    const git = createGit(guardedGit(run, LIMITS))

    await git.push('agent/issue-1')
    await git.push('agent/issue-1', { noVerify: true })

    expect(calls).toContainEqual(['git', 'push', '-u', 'origin', 'agent/issue-1'])
    expect(calls).toContainEqual(['git', 'push', '--no-verify', '-u', 'origin', 'agent/issue-1'])
  })
})
