// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FetchLike } from '../../opencode-agent/src/github.js'
import { memoizeAgent, parseArgs, runCli, UsageError } from '../../opencode-agent/src/index.js'
import { createLogger } from '../../opencode-agent/src/logger.js'
import type { OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import type { CommandRunner } from '../../opencode-agent/src/shell.js'

const workDir = await mkdtemp(path.join(tmpdir(), 'opencode-agent-cli-'))

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

const writeEvent = async (name: string, payload: unknown): Promise<string> => {
  const filePath = path.join(workDir, `${name}.json`)
  await writeFile(filePath, JSON.stringify(payload), 'utf8')
  return filePath
}

const silentLogger = createLogger({ level: 'error', sink: () => {} })

describe('parseArgs', () => {
  test('reads space-separated flags', () => {
    const args = parseArgs(['--event-path', '/tmp/e.json', '--event-name', 'issues'], {})

    expect(args.eventPath).toBe('/tmp/e.json')
    expect(args.eventName).toBe('issues')
    expect(args.logLevel).toBe('info')
  })

  test('reads --flag=value form', () => {
    const args = parseArgs(['--event-path=/tmp/e.json', '--event-name=issue_comment'], {})

    expect(args.eventName).toBe('issue_comment')
  })

  test('falls back to the Actions runner environment', () => {
    const args = parseArgs([], {
      GITHUB_EVENT_PATH: '/gh/event.json',
      GITHUB_EVENT_NAME: 'issues',
      GITHUB_WORKSPACE: '/gh/workspace',
    })

    expect(args.eventPath).toBe('/gh/event.json')
    expect(args.repoRoot).toBe('/gh/workspace')
  })

  test('flags win over the environment', () => {
    const args = parseArgs(['--event-name', 'issue_comment'], {
      GITHUB_EVENT_PATH: '/gh/event.json',
      GITHUB_EVENT_NAME: 'issues',
    })

    expect(args.eventName).toBe('issue_comment')
  })

  test('resolves a relative repo root to an absolute path', () => {
    const args = parseArgs(['--event-path', 'e.json', '--event-name', 'issues', '--repo-root', '.'], {})

    expect(path.isAbsolute(args.repoRoot)).toBe(true)
  })

  test.each([
    [[], {}],
    [['--event-path', '/tmp/e.json'], {}],
    [['--event-name', 'issues'], {}],
  ])('rejects incomplete arguments %p', (argv, env) => {
    expect(() => parseArgs(argv, env)).toThrow(UsageError)
  })

  test('rejects a flag with no value', () => {
    expect(() => parseArgs(['--event-path', '--event-name', 'issues'], {})).toThrow('requires a value')
  })

  test('rejects an unknown log level', () => {
    expect(() => parseArgs(['--event-path', 'e.json', '--event-name', 'issues', '--log-level', 'loud'], {})).toThrow(
      '--log-level',
    )
  })
})

describe('memoizeAgent', () => {
  const fakeAgent = (closed: { count: number }, tokens = 0): OpenCodeAgent => ({
    sessionId: 'session-1',
    prompt: (): Promise<{ text: string; sessionId: string }> => Promise.resolve({ text: '', sessionId: 'session-1' }),
    tokensUsed: (): Promise<number> => Promise.resolve(tokens),
    close: (): Promise<void> => {
      closed.count += 1
      return Promise.resolve()
    },
  })

  test('never boots a server just to shut one down', async () => {
    let booted = 0
    const handle = memoizeAgent(() => {
      booted += 1
      return Promise.resolve(fakeAgent({ count: 0 }))
    })

    await handle.close()

    expect(booted).toBe(0)
  })

  test('reports no spend without booting a server to ask', async () => {
    // Most phases never prompt the model. Booting a server to be told it has
    // spent nothing would cost more than the guardrail saves.
    let booted = 0
    const handle = memoizeAgent(() => {
      booted += 1
      return Promise.resolve(fakeAgent({ count: 0 }, 900))
    })

    expect(await handle.tokensUsed()).toBe(0)
    expect(booted).toBe(0)
  })

  test('reports the session’s spend once one has been booted', async () => {
    const handle = memoizeAgent(() => Promise.resolve(fakeAgent({ count: 0 }, 3602)))
    await handle.get()

    expect(await handle.tokensUsed()).toBe(3602)
  })

  test('boots at most once, however many phases ask for it', async () => {
    let booted = 0
    const handle = memoizeAgent(() => {
      booted += 1
      return Promise.resolve(fakeAgent({ count: 0 }))
    })

    const [first, second] = await Promise.all([handle.get(), handle.get()])

    expect(booted).toBe(1)
    expect(first).toBe(second)
  })

  test('closes a booted session', async () => {
    // The session owns a spawned `opencode serve` holding a listening socket;
    // skipping this leaves it running after the job's work is done.
    const closed = { count: 0 }
    const handle = memoizeAgent(() => Promise.resolve(fakeAgent(closed)))

    await handle.get()
    await handle.close()

    expect(closed.count).toBe(1)
  })

  test('a failed boot does not turn teardown into a second failure', async () => {
    const handle = memoizeAgent(() => Promise.reject(new Error('server down')))

    await expect(handle.get()).rejects.toThrow('server down')
    await expect(handle.close()).resolves.toBeUndefined()
  })
})

interface PostRecorder {
  posted: string[]
  fetch: FetchLike
}

/**
 * A GitHub transport that answers reads with `thread` and records writes.
 * The branching lives out here so no test body carries a conditional.
 */
const recordPosts = (thread: unknown): PostRecorder => {
  const posted: string[] = []
  const json = (payload: unknown, status: number): Response =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

  const write = (body: string): Response => {
    posted.push(body)
    return json({ id: 9, html_url: 'https://example.test/c/9' }, 201)
  }
  const read = (): Response => json(thread, 200)
  const byMethod: Record<string, (body: string) => Response> = { POST: write, PATCH: write }
  // Octokit always sends a string body; the wider `RequestInit` type does not
  // know that, and stringifying a non-string would silently record "[object Object]".
  const bodyOf = (body: BodyInit | null | undefined): string => (typeof body === 'string' ? body : '')

  return {
    posted,
    fetch: (_url, init) => Promise.resolve((byMethod[init?.method ?? 'GET'] ?? read)(bodyOf(init?.body))),
  }
}

describe('runCli', () => {
  const env = {
    GITHUB_REPOSITORY: 'acme/widgets',
    GITHUB_TOKEN: 'tok',
    LLM_API_KEY: 'sk-test',
    LLM_MODEL: 'gpt-5',
    LLM_BASE_URL: 'https://api.openai.com/v1',
    AGENT_SELF_LOGIN: 'agent-bot',
  }

  test('drives a full local run from an event file and stops at the bot guard', async () => {
    const eventPath = await writeEvent('bot', {
      action: 'created',
      sender: { login: 'agent-bot', type: 'Bot' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 1, body: '/approve', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'main' },
    })

    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
    })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('Bot')
  })

  test('strips the credentials from the environment before anything can spawn', async () => {
    // The OpenCode server inherits this process's environment wholesale, so a
    // credential still present here is readable by the model's `bash` tool.
    const eventPath = await writeEvent('scrub', {
      action: 'created',
      sender: { login: 'someone', type: 'Bot' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 1, body: 'hi', author_association: 'OWNER' },
    })
    const live = {
      ...env,
      GITHUB_TOKEN: 'ghp_0123456789abcdefghij',
      LLM_API_KEY: 'sk-0123456789abcdefghij',
      GH_TOKEN: 'ghp_0123456789abcdefghij',
      PATH: '/usr/bin',
    }

    await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: live,
      logger: silentLogger,
    })

    expect(Object.hasOwn(live, 'GITHUB_TOKEN')).toBe(false)
    expect(Object.hasOwn(live, 'LLM_API_KEY')).toBe(false)
    expect(Object.hasOwn(live, 'GH_TOKEN')).toBe(false)
    expect(live.PATH).toBe('/usr/bin')
  })

  test('a body posted by a real run carries no credential', async () => {
    // End to end through the real GitHub adapter: proves the pipeline actually
    // wires its secrets in, which a redaction test on the adapter alone cannot.
    // `/cancel` reaches a posted comment without booting a model.
    const token = 'ghp_0123456789abcdefghijklmnopqrst'
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `stopped\n\n<!-- AGENT_STATE: ${JSON.stringify({
          v: 1,
          phase: 'FAILED',
          issueId: 42,
          resumeFrom: 'EXECUTION_PLAN',
          lastError: `git failed: remote rejected, token ${token}`,
        })} -->`,
      },
    ]
    const eventPath = await writeEvent('redact', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 2, body: '/cancel', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env, GITHUB_TOKEN: token },
      logger: silentLogger,
      fetch: github.fetch,
    })

    expect(result.status).toBe('completed')
    expect(github.posted).toHaveLength(1)
    // The credential arrived through the restored state's `lastError`, which
    // the hidden block republishes on every comment.
    expect(github.posted[0]).toContain('[redacted]')
    expect(github.posted[0]).not.toContain(token)
  })

  test('a guarded run never shells out to work out a base branch', async () => {
    // Base-branch resolution can cost a round trip to the remote, so it has to
    // stay behind the guardrails: a bot comment must be dropped without ever
    // running git, let alone failing on it.
    const eventPath = await writeEvent('lazy', {
      action: 'created',
      sender: { login: 'someone', type: 'Bot' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 1, body: 'hi', author_association: 'OWNER' },
    })
    const commands: string[] = []
    const record: CommandRunner = (argv) => {
      commands.push(argv.join(' '))
      return Promise.resolve({ command: argv.join(' '), exitCode: 0, stdout: '', stderr: '' })
    }

    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
      run: record,
    })

    expect(result.status).toBe('skipped')
    // Asserting the status alone is not enough: a resolution kicked off eagerly
    // still runs git, and its rejection goes unobserved because nothing awaits
    // the result on this path.
    expect(commands).toEqual([])
  })

  test('skips a payload that carries no issue', async () => {
    const eventPath = await writeEvent('dispatch', { action: 'requested', sender: { login: 'maintainer' } })

    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'workflow_dispatch'],
      env,
      logger: silentLogger,
    })

    expect(result.status).toBe('skipped')
    expect(result.state).toBeNull()
  })

  test('ignores a red run on a branch the agent does not own', async () => {
    const eventPath = await writeEvent('foreign-ci', {
      action: 'completed',
      workflow_run: { name: 'CI', head_branch: 'feature/other', conclusion: 'failure', html_url: 'u' },
      repository: { default_branch: 'main' },
    })

    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'workflow_run'],
      env,
      logger: silentLogger,
    })

    expect(result.status).toBe('skipped')
  })

  test('requires the model name, rather than guessing one', async () => {
    const eventPath = await writeEvent('nomodel', {
      action: 'opened',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 1, title: 't', body: 'b', author_association: 'OWNER' },
    })
    const { LLM_MODEL: _unused, ...withoutModel } = env

    const attempt = runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issues'],
      env: withoutModel,
      logger: silentLogger,
    })

    await expect(attempt).rejects.toThrow('LLM_MODEL')
  })

  test('fails loudly when the event file is missing', async () => {
    const attempt = runCli({
      argv: ['--event-path', path.join(workDir, 'nope.json'), '--event-name', 'issues'],
      env,
      logger: silentLogger,
    })

    await expect(attempt).rejects.toThrow()
  })

  test('fails when required configuration is absent', async () => {
    const eventPath = await writeEvent('noconfig', {
      action: 'opened',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 1, title: 't', body: 'b', author_association: 'OWNER' },
    })

    const attempt = runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issues'],
      env: {},
      logger: silentLogger,
    })

    await expect(attempt).rejects.toThrow('GITHUB_REPOSITORY')
  })
})
