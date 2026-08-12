// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { memoizeAgent } from '../../opencode-agent/src/agent-handle.js'
import type { FetchLike } from '../../opencode-agent/src/github.js'
import { parseArgs, runCli, UsageError } from '../../opencode-agent/src/index.js'
import { createLogger } from '../../opencode-agent/src/logger.js'
import type { OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import type { CommandRunner } from '../../opencode-agent/src/shell.js'
import { REPORTED_OUTPUT } from '../../opencode-agent/src/step-output.js'
import { silentOctokitLog } from './test-helpers.js'

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
    abort: (): Promise<boolean> => Promise.resolve(true),
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
  /**
   * Reaction writes, kept apart from `posted`.
   *
   * Not tidiness: a reaction is not a comment, and folding the two together
   * would let a run that says nothing on the issue but reacts to it read as a
   * run that reported — which is the exact distinction `RunResult.reported`
   * exists to make.
   */
  reactions: { method: string; url: string; body: string }[]
  /**
   * Label writes, kept apart for the same reason as the reactions, plus one of
   * its own: labels are the channel most likely to be issued and least likely
   * to be noticed, so a label POST landing in `posted` would quietly turn every
   * "posted exactly one comment" assertion in this file into a lie.
   */
  labelCalls: { method: string; url: string; body: string }[]
  /**
   * Comment *edits*, kept apart from `posted` for the reason the label writes
   * are: an edit is not a comment, and folding the two together would let the
   * status channel — which edits once a minute — read as a run that posted
   * once a minute, which is the whole one-comment budget seen from the wire.
   */
  edits: { url: string; body: string }[]
  /**
   * Where each comment went, kept beside `posted` rather than folded into it.
   *
   * A pull-request comment is answered on the **issue**, and a body alone cannot
   * show that: the two threads are the same endpoint with a different number in
   * the path, so the number is the only place the asymmetry is visible.
   */
  postUrls: string[]
  /** Every read, so "resolved without an API call" can be asserted rather than assumed. */
  reads: string[]
  fetch: FetchLike
}

/** What the fake API says a pull request merges from, unless a test says otherwise. */
const AGENT_HEAD = {
  merged: false,
  state: 'open',
  head: { ref: 'agent/issue-42', repo: { full_name: 'acme/widgets' } },
}

/** Labels the fake issue already carries, none of them this pipeline's. */
const EXISTING_LABELS = [{ name: 'bug' }]

/**
 * A GitHub transport that answers reads with `thread` and records writes.
 * The branching lives out here so no test body carries a conditional.
 */
const recordPosts = (thread: unknown, pullRequest: unknown = AGENT_HEAD): PostRecorder => {
  const posted: string[] = []
  const postUrls: string[] = []
  const reads: string[] = []
  const reactions: { method: string; url: string; body: string }[] = []
  const labelCalls: { method: string; url: string; body: string }[] = []
  const edits: { url: string; body: string }[] = []
  const json = (payload: unknown, status: number): Response =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

  const isLabelCall = (url: string): boolean => /\/labels(\/|\?|$)/u.test(url)

  const write = (method: string, url: string, body: string): Response => {
    if (url.includes('/reactions')) {
      reactions.push({ method, url, body })
      return json({ id: 5, content: 'eyes' }, 201)
    }
    if (method === 'PATCH' && url.includes('/issues/comments/')) {
      edits.push({ url, body })
      return json({ id: 9, html_url: 'https://example.test/c/9' }, 200)
    }
    if (isLabelCall(url)) {
      labelCalls.push({ method, url, body })
      return json([], 200)
    }
    posted.push(body)
    postUrls.push(url)
    return json({ id: 9, html_url: 'https://example.test/c/9' }, 201)
  }
  const read = (method: string, url: string, body: string): Response => {
    reads.push(url)
    if (isLabelCall(url)) {
      labelCalls.push({ method, url, body })
      return json(EXISTING_LABELS, 200)
    }
    // Three reads share one shape, and the path is all that tells them apart:
    // the pull request's head, the issue's own title and body, and the thread.
    if (/\/pulls\/\d+$/u.test(url)) return json(pullRequest, 200)
    if (/\/issues\/\d+$/u.test(url)) return json({ number: 42, title: 'Add retries', body: 'Please add retries.' }, 200)
    return json(thread, 200)
  }
  const byMethod: Record<string, (method: string, url: string, body: string) => Response> = {
    POST: write,
    PATCH: write,
    DELETE: write,
  }
  // Octokit always sends a string body; the wider `RequestInit` type does not
  // know that, and stringifying a non-string would silently record "[object Object]".
  const bodyOf = (body: BodyInit | null | undefined): string => (typeof body === 'string' ? body : '')

  return {
    posted,
    postUrls,
    reads,
    reactions,
    labelCalls,
    edits,
    fetch: (url, init) => {
      const method = init?.method ?? 'GET'
      return Promise.resolve((byMethod[method] ?? read)(method, url, bodyOf(init?.body)))
    },
  }
}

/**
 * A transport that turns down every reaction and passes everything else
 * through — a token without `issues: write`, seen from the wire. Out here
 * because a test body may carry no conditional.
 */
const refusingReactions = (inner: FetchLike): FetchLike => {
  const refuse = (): Promise<Response> =>
    Promise.resolve(new Response('{"message":"Resource not accessible by integration"}', { status: 403 }))

  return (url, init) => (url.includes('/reactions') ? refuse() : inner(url, init))
}

/**
 * The same, for every label endpoint — including the read, because a token that
 * cannot write labels is usually one that cannot see the issue at all.
 */
const refusingLabels = (inner: FetchLike): FetchLike => {
  const refuse = (): Promise<Response> =>
    Promise.resolve(new Response('{"message":"Resource not accessible by integration"}', { status: 403 }))

  return (url, init) => (/\/labels(\/|\?|$)/u.test(url) ? refuse() : inner(url, init))
}

/**
 * A fresh, empty `$GITHUB_OUTPUT`, and a reader for whatever the run appended.
 *
 * Empty rather than absent so the two marker tests differ only in the run, not
 * in whether the file existed — an absent file would let a write that silently
 * did nothing pass for a write that was correctly withheld.
 */
const outputFile = async (name: string): Promise<{ path: string; read: () => Promise<string> }> => {
  const filePath = path.join(workDir, `${name}.output`)
  await writeFile(filePath, '', 'utf8')
  return { path: filePath, read: (): Promise<string> => readFile(filePath, 'utf8') }
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
          v: 3,
          phase: 'FAILED',
          issueId: 42,
          resumeFrom: 'PLANNING',
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
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('completed')
    expect(github.posted).toHaveLength(1)
    // The credential arrived through the restored state's `lastError`, which
    // the hidden block republishes on every comment.
    expect(github.posted[0]).toContain('[redacted]')
    expect(github.posted[0]).not.toContain(token)
  })

  test('stands down with one comment when the checkout has no openspec/ tree (design D10)', async () => {
    // The agent runs in repos other than papai. A checkout without an
    // `openspec/` root cannot run the compliant pipeline, and the agent never
    // scaffolds OpenSpec into a foreign repo: it posts one clear comment naming
    // the remedy and exits without spawning the OpenCode server. The temp
    // `workDir` has no `openspec/`, so pointing `--repo-root` at it triggers the
    // probe's stand-down verdict.
    const eventPath = await writeEvent('stand-down', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 'Add retries', body: 'Please add retries.', author_association: 'OWNER' },
      comment: { id: 2, body: 'go ahead', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts([])
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment', '--repo-root', workDir],
      env,
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('skipped')
    expect(result.reported).toBe(true)
    expect(github.posted).toHaveLength(1)
    expect(github.posted[0]).toContain('openspec')
    expect(github.posted[0]).toContain('standing down')
  })

  test('a real run acknowledges the comment that triggered it', async () => {
    // End to end through `contain`, `assembleDeps` and the real Octokit
    // adapter. The recorded lesson of this workspace (ROADMAP S2-6, S3-3, S3-9)
    // is that a correct adapter which is never wired in passes every phase
    // test, so the wiring is what this exercises — not the module.
    // `/cancel` reaches a finished run without booting a model.
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({ v: 3, phase: 'DESIGN_SPEC', issueId: 42 })} -->`,
      },
    ]
    const eventPath = await writeEvent('reaction', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 8811, body: '/cancel', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('completed')
    // On the comment the maintainer typed, which is the whole point — the id
    // was parsed and thrown away until this stage carried it through.
    expect(github.reactions[0]?.method).toBe('POST')
    expect(github.reactions[0]?.url).toContain('/repos/acme/widgets/issues/comments/8811/reactions')
    expect(github.reactions[0]?.body).toContain('"content":"eyes"')
    // And taken off again by the end of the same run, addressed by the id the
    // create answered with. The wiring is the point here as much as above: the
    // adapter can route a delete perfectly and still never be handed one, and a
    // 👀 that outlives its run is the state this whole channel was left in.
    expect(github.reactions).toHaveLength(2)
    expect(github.reactions[1]?.method).toBe('DELETE')
    expect(github.reactions[1]?.url).toContain('/repos/acme/widgets/issues/comments/8811/reactions/5')
  })

  test('a real run labels the issue it finished', async () => {
    // Same lesson as the reaction above, and the label endpoints are four new
    // chances to relearn it: a correct adapter that `contain` and
    // `assembleDeps` never hand anything passes every phase test. `/cancel`
    // reaches COMPLETE without a pull request, which is `agent:stopped`.
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({ v: 3, phase: 'DESIGN_SPEC', issueId: 42 })} -->`,
      },
    ]
    const eventPath = await writeEvent('labels', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 8811, body: '/cancel', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('completed')
    expect(github.labelCalls).toContainEqual({
      method: 'GET',
      url: 'https://api.github.com/repos/acme/widgets/issues/42/labels?per_page=100',
      body: '',
    })
    expect(github.labelCalls).toContainEqual({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/widgets/labels',
      body: '{"name":"agent:stopped","color":"6a737d"}',
    })
    expect(github.labelCalls).toContainEqual({
      method: 'POST',
      url: 'https://api.github.com/repos/acme/widgets/issues/42/labels',
      body: '{"labels":["agent:stopped"]}',
    })
    // `bug` is the repository's own and was on the issue before this run.
    expect(github.labelCalls.filter((call) => call.url.endsWith('/labels/bug'))).toEqual([])
    // And none of it became a comment: the label writes go to their own
    // endpoints, not through `createComment`.
    expect(github.posted).toHaveLength(1)
  })

  test('a real run opens a live status comment, links its job, and finalises it', async () => {
    // Same lesson as the reaction and the labels above (ROADMAP S2-6, S3-3,
    // S3-9): a correct channel that `contain` and `assembleDeps` never hand
    // anything passes every phase test. A low ceiling reaches the answer path's
    // budget stop, which posts and returns without ever booting a model.
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({
          v: 3,
          phase: 'DESIGN_SPEC',
          issueId: 42,
          tokensSpent: 60_000,
        })} -->`,
      },
    ]
    const eventPath = await writeEvent('status', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 8811, body: '/ask why that file?', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env, GITHUB_RUN_ID: '1482', AGENT_MAX_TOKENS: '50000' },
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('failed')
    // Two comments and no more: the run's status comment, and the notice that
    // ended it. Everything in between is an edit.
    expect(github.posted).toHaveLength(2)
    expect(github.posted[0]).toContain('[this run](https://github.com/acme/widgets/actions/runs/1482)')
    // Rule 4, at the wire: the state channel gains no second writer.
    expect(github.posted[0]).not.toContain('AGENT_STATE')
    expect(github.edits).toHaveLength(1)
    expect(github.edits[0]?.url).toContain('/repos/acme/widgets/issues/comments/9')
    expect(github.edits[0]?.body).not.toContain('run in progress')
  })

  test('a local run with no job to link to opens no status comment', async () => {
    // The no-op reporter, from the outside: `--event-path` without a run is an
    // ordinary way to drive this CLI, and every other test in this file relies
    // on it posting nothing.
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({
          v: 3,
          phase: 'DESIGN_SPEC',
          issueId: 42,
          tokensSpent: 60_000,
        })} -->`,
      },
    ]
    const eventPath = await writeEvent('status-local', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 8811, body: '/ask why that file?', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env, AGENT_MAX_TOKENS: '50000' },
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('failed')
    expect(github.posted).toHaveLength(1)
    expect(github.edits).toEqual([])
  })

  test('a repository that wants no labels gets none', async () => {
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({ v: 3, phase: 'DESIGN_SPEC', issueId: 42 })} -->`,
      },
    ]
    const eventPath = await writeEvent('labels-none', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 8811, body: '/cancel', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env, AGENT_LABEL_PREFIX: 'none' },
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('completed')
    expect(github.labelCalls).toEqual([])
    expect(github.posted).toHaveLength(1)
  })

  test('labels GitHub refuses do not fail the run', async () => {
    // The rule-1 test at the transport: a token without `issues: write`, or a
    // repository that restricts who may create a label, reaches the same
    // result and posts the same comment as one where the channel worked.
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({ v: 3, phase: 'DESIGN_SPEC', issueId: 42 })} -->`,
      },
    ]
    const eventPath = await writeEvent('labels-403', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 8811, body: '/cancel', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
      // The refusal is the point of the test; Octokit's request log would
      // otherwise print it as an error line in the suite's output.
      octokit: { fetch: refusingLabels(github.fetch), log: silentOctokitLog() },
    })

    expect(result.status).toBe('completed')
    expect(result.reported).toBe(true)
    expect(github.posted).toHaveLength(1)
  })

  test('a reaction GitHub refuses does not fail the run', async () => {
    // A token without `issues: write`, a fork run, an org policy. The rule is
    // that none of them may change what the run does or what it posts, and this
    // is the only place the real adapter's rejection is on the path.
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({ v: 3, phase: 'DESIGN_SPEC', issueId: 42 })} -->`,
      },
    ]
    const eventPath = await writeEvent('reaction-403', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 8811, body: '/cancel', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
      // As above: the refusal is expected, so its request-log line is not a
      // diagnostic and must not reach the suite's output.
      octokit: { fetch: refusingReactions(github.fetch), log: silentOctokitLog() },
    })

    expect(result.status).toBe('completed')
    expect(github.posted).toHaveLength(1)
  })

  test('tells the workflow it has reported, when it posted the failure itself', async () => {
    // The workflow's last step posts "The issue state is unchanged; reply
    // `/retry` once the cause is addressed" under `if: failure()`, which selects
    // every red job — including this one, which has just posted a give-up notice
    // explaining that `/retry` is precisely what it will not accept. The marker
    // is what keeps that step to the case its own wording describes.
    //
    // A spent retry budget is the failure path that needs no model: the run
    // posts, halts `failed`, and `main` maps that to exit 1.
    const output = await outputFile('reported')
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({
          v: 3,
          phase: 'FAILED',
          issueId: 42,
          resumeFrom: 'PLANNING',
          attempts: 3,
        })} -->`,
      },
    ]
    const eventPath = await writeEvent('reported', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 2, body: '/retry', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env, GITHUB_OUTPUT: output.path },
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('failed')
    expect(result.reported).toBe(true)
    // Asserting the flag alone is not enough: the workflow reads the file, and
    // a flag that never reaches it gates nothing.
    expect(github.posted).toHaveLength(1)
    expect(await output.read()).toContain(`${REPORTED_OUTPUT}=true`)
  })

  test('leaves the marker unwritten when it posted nothing', async () => {
    // The other half of the contract, and the one that decides whether the
    // fallback comment still happens at all: a run that says nothing on the
    // issue must not claim it did, or a job that dies with the issue silent goes
    // unreported. A guardrail drop is the cheapest silent exit there is.
    const output = await outputFile('unreported')
    const eventPath = await writeEvent('unreported', {
      action: 'created',
      sender: { login: 'agent-bot', type: 'Bot' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 1, body: '/approve', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'main' },
    })

    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env, GITHUB_OUTPUT: output.path },
      logger: silentLogger,
    })

    expect(result.status).toBe('skipped')
    expect(result.reported).toBe(false)
    expect(await output.read()).toBe('')
  })

  test('a run with no $GITHUB_OUTPUT is a local run, not a failure', async () => {
    // Every `--event-path` run is one: the variable only exists inside a step.
    // Writing to it has to be optional, and must never be the thing that turns a
    // reported failure into a crash that reports nothing.
    const prior = [
      {
        id: 1,
        user: { login: 'agent-bot' },
        body: `parked\n\n<!-- AGENT_STATE: ${JSON.stringify({
          v: 3,
          phase: 'FAILED',
          issueId: 42,
          resumeFrom: 'PLANNING',
          attempts: 3,
        })} -->`,
      },
    ]
    const eventPath = await writeEvent('nooutput', {
      action: 'created',
      sender: { login: 'maintainer', type: 'User' },
      issue: { number: 42, title: 't', body: 'b', author_association: 'OWNER' },
      comment: { id: 2, body: '/retry', author_association: 'OWNER' },
      repository: { owner: { login: 'acme' }, name: 'widgets', default_branch: 'master' },
    })

    const github = recordPosts(prior)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env },
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.reported).toBe(true)
    expect(github.posted).toHaveLength(1)
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

  /** The `issue_comment` payload GitHub sends for a comment on a pull request. */
  const pullRequestComment = (body: string): Record<string, unknown> => ({
    action: 'created',
    sender: { login: 'maintainer', type: 'User' },
    issue: {
      number: 7,
      title: 'Add retries (#42)',
      body: 'Closes #42',
      author_association: 'NONE',
      pull_request: { url: 'https://api.github.test/pulls/7' },
    },
    comment: { id: 8811, body, author_association: 'OWNER' },
    repository: { owner: { login: 'acme' }, name: 'widgets', full_name: 'acme/widgets', default_branch: 'master' },
  })

  /** A pull request whose state block says the issue is cancelled, so `/review` is refused cheaply. */
  const cancelled = [
    {
      id: 1,
      user: { login: 'agent-bot' },
      body: `stopped\n\n<!-- AGENT_STATE: ${JSON.stringify({ v: 3, phase: 'COMPLETE', issueId: 42 })} -->`,
    },
  ]

  test('resolves a pull-request comment to its issue before it contains anything', async () => {
    // The payload names the *pull request*: `github.event.issue.number` is 7
    // here. Nothing downstream of this could work out that the run is about
    // issue 42, because every block of state lives on the issue thread and the
    // restore scan reads it by number.
    const eventPath = await writeEvent('pr-review', pullRequestComment('/review'))

    const github = recordPosts(cancelled)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    // `COMPLETE` with no pull request in the block is a cancelled issue, which
    // refuses `/review` through the same predicate the issue door uses — a
    // refusal is all this needs, since what is under test is where it landed.
    expect(result.status).toBe('skipped')
    expect(github.reads.filter((url) => url.includes('/repos/acme/widgets/pulls/7'))).toHaveLength(1)
    // Typed on the pull request, answered on the issue.
    expect(github.postUrls).toEqual(['https://api.github.com/repos/acme/widgets/issues/42/comments'])
    // And acknowledged where the maintainer is actually looking.
    expect(github.reactions[0]?.url).toContain('/repos/acme/widgets/issues/comments/8811/reactions')
  })

  test('drops a pull-request comment carrying no /review without looking anything up', async () => {
    // The cheap filter, at the outermost layer: every pull request in a
    // repository gets ordinary review comments, and not one of them may cost an
    // API call before being thrown away.
    const output = await outputFile('pr-no-command')
    const eventPath = await writeEvent('pr-plain', pullRequestComment('looks good to me'))

    const github = recordPosts(cancelled)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env: { ...env, GITHUB_OUTPUT: output.path },
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('skipped')
    // Nothing was posted, so the workflow's fallback comment must stay in scope.
    expect(result.reported).toBe(false)
    expect(github.reads).toEqual([])
    expect(github.posted).toEqual([])
    expect(await output.read()).toBe('')
  })

  test('refuses a /review on a pull request opened from a fork', async () => {
    // `head.ref` is attacker-controlled, so a fork can name its branch
    // `agent/issue-42` and look, to every other field, exactly like the agent's
    // own. Without the repository comparison, anyone able to open a pull request
    // could type `/review` and buy a privileged job.
    const forked = {
      merged: false,
      state: 'open',
      head: { ref: 'agent/issue-42', repo: { full_name: 'evil/widgets' } },
    }
    const eventPath = await writeEvent('pr-fork', pullRequestComment('/review'))

    const github = recordPosts(cancelled, forked)
    const result = await runCli({
      argv: ['--event-path', eventPath, '--event-name', 'issue_comment'],
      env,
      logger: silentLogger,
      octokit: { fetch: github.fetch },
    })

    expect(result.status).toBe('skipped')
    expect(result.reported).toBe(false)
    // It got exactly as far as the one lookup that refused it: no thread read,
    // no comment, no reaction, no label.
    expect(github.reads).toEqual(['https://api.github.com/repos/acme/widgets/pulls/7'])
    expect(github.posted).toEqual([])
    expect(github.reactions).toEqual([])
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
