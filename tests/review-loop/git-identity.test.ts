// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { applyCommitIdentity, identityEnv } from '../../review-loop/src/git-identity.js'
import { cleanupTempDirs, makeTempDir, quietGit } from './test-helpers.js'

describe('identityEnv', () => {
  test('stamps one identity onto both the author and the committer', () => {
    expect(identityEnv({ name: 'opencode-agent[bot]', email: 'agent@users.noreply.github.com' })).toEqual({
      GIT_AUTHOR_NAME: 'opencode-agent[bot]',
      GIT_AUTHOR_EMAIL: 'agent@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'opencode-agent[bot]',
      GIT_COMMITTER_EMAIL: 'agent@users.noreply.github.com',
    })
  })
})

describe('applyCommitIdentity', () => {
  test('puts the identity where every git child will read it', () => {
    const env: Record<string, string | undefined> = {}

    expect(applyCommitIdentity({ name: 'bot', email: 'bot@example.com' }, env)).toBe(true)
    expect(env['GIT_AUTHOR_NAME']).toBe('bot')
    expect(env['GIT_COMMITTER_EMAIL']).toBe('bot@example.com')
  })

  test('overrides an identity the environment already carried', () => {
    const env: Record<string, string | undefined> = { GIT_AUTHOR_NAME: 'someone else' }

    applyCommitIdentity({ name: 'bot', email: 'bot@example.com' }, env)

    expect(env['GIT_AUTHOR_NAME']).toBe('bot')
  })

  test('leaves the environment alone when no identity is configured', () => {
    const env: Record<string, string | undefined> = {}

    expect(applyCommitIdentity(undefined, env)).toBe(false)
    expect(env).toEqual({})
  })
})

describe('a commit made under the applied identity', () => {
  test('succeeds where a runner with no git identity of its own fails', () => {
    const repo = makeTempDir('review-loop-identity-')
    quietGit(['init', '-q', repo])
    writeFileSync(path.join(repo, 'a.txt'), 'hi\n')
    quietGit(['-C', repo, 'add', '-A'])

    // A hosted runner has no `user.name` anywhere, which is the state that made
    // every fix the loop committed fail with "Author identity unknown". Built up
    // rather than stripped down, so nothing the suite happens to run under can
    // put an identity back in by accident.
    const identityless: Record<string, string> = {
      // Nothing is inherited: an inherited variable is exactly how an identity
      // would sneak back into the environment this test is about not having.
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      // An unset HOME can make git fall back to the passwd entry's home and
      // read that user's real .gitconfig; an empty dir leaves nothing to find.
      HOME: makeTempDir('review-loop-identity-home-'),
    }

    expect(() => {
      execFileSync(
        'git',
        // useConfigOnly forbids the passwd/hostname identity auto-detection
        // that would let this commit succeed on a host where git can guess one.
        ['-C', repo, '-c', 'user.useConfigOnly=true', 'commit', '-m', 'no identity'],
        { env: identityless, stdio: 'pipe' },
      )
    }).toThrow()

    applyCommitIdentity({ name: 'bot', email: 'bot@example.com' }, identityless)
    execFileSync('git', ['-C', repo, 'commit', '-m', 'with identity'], { env: identityless, stdio: 'pipe' })

    const author = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%an <%ae> %cn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(author.trim()).toBe('bot <bot@example.com> bot')

    cleanupTempDirs()
  })
})
