// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { GitHubApi } from '../../opencode-agent/src/github.js'
import { reportIdentityDrift, resolveSelfLogin } from '../../opencode-agent/src/identity.js'
import type { Logger, LogLevel } from '../../opencode-agent/src/logger.js'

interface Recorded {
  level: LogLevel
  message: string
}

const recorder = (): { lines: Recorded[]; log: Logger } => {
  const lines: Recorded[] = []
  const at =
    (level: LogLevel) =>
    (_fields: Record<string, unknown>, message: string): void =>
      void lines.push({ level, message })
  return { lines, log: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') } }
}

/** Only `getAuthenticatedLogin` matters here; the rest of the surface is unused. */
const api = (login: () => Promise<string>): GitHubApi => {
  const unused = (): never => {
    throw new Error('not used by resolveSelfLogin')
  }
  return {
    getAuthenticatedLogin: login,
    listIssueComments: unused,
    createComment: unused,
    getIssue: unused,
    findPullRequest: unused,
    createPullRequest: unused,
    updatePullRequest: unused,
  }
}

const answers = (login: string): GitHubApi => api(() => Promise.resolve(login))
const refuses = (message: string): GitHubApi => api(() => Promise.reject(new Error(message)))

describe('resolveSelfLogin', () => {
  test('an explicit override wins outright', async () => {
    const { log } = recorder()

    expect(await resolveSelfLogin({ override: 'agent-bot', api: refuses('never called'), owner: 'acme', log })).toBe(
      'agent-bot',
    )
  })

  test.each(['', '   '])('a blank override %p is not an override', async (override) => {
    const { log } = recorder()

    expect(await resolveSelfLogin({ override, api: answers('from-token'), owner: 'acme', log })).toBe('from-token')
  })

  test('derives the identity from the token when nothing is pinned', async () => {
    const { log } = recorder()

    expect(await resolveSelfLogin({ override: null, api: answers('agent-bot'), owner: 'acme', log })).toBe('agent-bot')
  })

  test('falls back to the owner when the token cannot say, and warns', async () => {
    // A GitHub App installation token cannot read `/user`, and that is the token
    // the workflow recommends — so this branch is the expected path, not an
    // exotic error. It has to be loud, because the failure it prevents is
    // silent.
    const { lines, log } = recorder()

    const login = await resolveSelfLogin({
      override: null,
      api: refuses('Resource not accessible by integration'),
      owner: 'acme',
      log,
    })

    expect(login).toBe('acme')
    expect(lines.filter((line) => line.level === 'warn')).toHaveLength(1)
    expect(lines[0]?.message).toContain('AGENT_SELF_LOGIN')
  })

  test('treats an empty answer as no answer', async () => {
    const { lines, log } = recorder()

    expect(await resolveSelfLogin({ override: null, api: answers('   '), owner: 'acme', log })).toBe('acme')
    expect(lines.some((line) => line.level === 'warn')).toBe(true)
  })
})

describe('reportIdentityDrift', () => {
  test('says nothing when the recorded author matches', () => {
    const { lines, log } = recorder()

    reportIdentityDrift('agent-bot', 'agent-bot', log)

    expect(lines).toEqual([])
  })

  test('ignores case, as GitHub does', () => {
    const { lines, log } = recorder()

    reportIdentityDrift('Agent-Bot', 'agent-bot', log)

    expect(lines).toEqual([])
  })

  test('reports a mismatch at error, naming the fix', () => {
    // Before this, a wrong identity produced no signal at all: the next run
    // simply failed to find its own state and started the issue over.
    const { lines, log } = recorder()

    reportIdentityDrift('acme', 'github-actions[bot]', log)

    expect(lines).toHaveLength(1)
    expect(lines[0]?.level).toBe('error')
    expect(lines[0]?.message).toContain('AGENT_SELF_LOGIN')
  })

  test('stays quiet when the API reported no author at all', () => {
    const { lines, log } = recorder()

    reportIdentityDrift('agent-bot', '', log)

    expect(lines).toEqual([])
  })
})
