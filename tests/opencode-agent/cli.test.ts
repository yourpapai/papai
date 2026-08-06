// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseArgs, runCli, UsageError } from '../../opencode-agent/src/index.js'
import { createLogger } from '../../opencode-agent/src/logger.js'

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

describe('runCli', () => {
  const env = {
    GITHUB_REPOSITORY: 'acme/widgets',
    GITHUB_TOKEN: 'tok',
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'gpt-5',
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

  test('requires the OpenAI model, rather than guessing one', async () => {
    const eventPath = await writeEvent('nomodel', {
      action: 'opened',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 1, title: 't', body: 'b', author_association: 'OWNER' },
    })
    const { OPENAI_MODEL: _unused, ...withoutModel } = env

    const attempt = runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issues'],
      env: withoutModel,
      logger: silentLogger,
    })

    await expect(attempt).rejects.toThrow('OPENAI_MODEL')
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
