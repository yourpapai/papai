// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { DEFAULT_CHECKS } from '../../opencode-agent/src/config.js'
import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { Git } from '../../opencode-agent/src/git.js'
import type { GitHubApi, PullRequestRef } from '../../opencode-agent/src/github.js'
import type { TriggerEvent } from '../../opencode-agent/src/guardrails.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { AgentPromptRequest, OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import { runPipeline } from '../../opencode-agent/src/orchestrator.js'
import type { PhaseDeps } from '../../opencode-agent/src/phase-context.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'
import { extractState } from '../../opencode-agent/src/state-manager.js'
import type { IssueComment } from '../../opencode-agent/src/state-manager.js'
import type { AgentState } from '../../opencode-agent/src/types.js'

const AGENT_LOGIN = 'agent-bot'
const ISSUE = 42

const silentLogger = (): Logger => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})

const config = (overrides: Partial<PipelineConfig> = {}): PipelineConfig => ({
  repoRoot: '/repo',
  owner: 'acme',
  repo: 'widgets',
  githubToken: 'token',
  selfLogin: AGENT_LOGIN,
  model: 'anthropic/claude-sonnet-4-5',
  baseBranch: 'main',
  commitAuthorName: 'agent',
  commitAuthorEmail: 'agent@example.com',
  checks: DEFAULT_CHECKS,
  mutationCheck: { name: 'mutation', argv: ['bun', 'run', 'mutate'] },
  mutationThreshold: 0.6,
  maxReviewRounds: 2,
  maxMutationRounds: 1,
  maxAttempts: 3,
  dryRun: false,
  ...overrides,
})

const event = (overrides: Partial<TriggerEvent> = {}): TriggerEvent => ({
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  issueNumber: ISSUE,
  issueTitle: 'Add retries',
  issueBody: 'Please add retries to the HTTP client.',
  isPullRequest: false,
  commentBody: null,
  repositoryOwner: 'acme',
  repositoryName: 'widgets',
  defaultBranch: 'main',
  ...overrides,
})

const approval = (): TriggerEvent => event({ eventName: 'issue_comment', action: 'created', commentBody: '/approve' })

/** Mutable recording surface shared by every fake in a harness. */
interface PipelineIo {
  thread: IssueComment[]
  posted: string[]
  prompts: AgentPromptRequest[]
  gitCalls: string[]
  checkResults: Map<string, CommandResult>
  /** Model replies, consumed in order by successive prompts. */
  replies: string[]
  createdPr: PullRequestRef | null
  openPr: PullRequestRef | null
}

interface Harness {
  deps: PhaseDeps
  io: PipelineIo
}

const SPEC_REPLY = JSON.stringify({ status: 'spec', spec: 'Add a retry wrapper around fetch.' })
const PLAN_REPLY = JSON.stringify({
  steps: [{ title: 'Write retry tests', files: ['tests/retry.test.ts'], verification: 'bun test' }],
  summary: 'One step.',
})

const OK_CHECK: CommandResult = { command: 'check', exitCode: 0, stdout: 'Mutation score: 95%', stderr: '' }

const makeHarness = (overrides: Partial<PipelineConfig> = {}): Harness => {
  const io: PipelineIo = {
    thread: [],
    posted: [],
    prompts: [],
    gitCalls: [],
    checkResults: new Map(),
    replies: [SPEC_REPLY, PLAN_REPLY, 'Implemented.', 'PR body.'],
    createdPr: null,
    openPr: null,
  }

  let nextCommentId = 100

  const github: GitHubApi = {
    listIssueComments: () => Promise.resolve([...io.thread]),
    createComment: (_issueNumber, body) => {
      nextCommentId += 1
      io.posted.push(body)
      io.thread.push({ id: nextCommentId, body, authorLogin: AGENT_LOGIN })
      return Promise.resolve({ id: nextCommentId, url: `https://example.test/c/${nextCommentId}` })
    },
    getAuthenticatedLogin: () => Promise.resolve(AGENT_LOGIN),
    findOpenPullRequest: () => Promise.resolve(io.openPr),
    createPullRequest: () => {
      io.createdPr = { number: 7, url: 'https://example.test/pull/7' }
      return Promise.resolve(io.createdPr)
    },
  }

  const git: Git = {
    ensureBranch: (branch, base) => {
      io.gitCalls.push(`ensureBranch:${branch}:${base}`)
      return Promise.resolve()
    },
    hasChanges: () => Promise.resolve(true),
    commitAll: (message) => {
      io.gitCalls.push(`commit:${message.split('\n')[0]}`)
      return Promise.resolve(true)
    },
    push: (branch) => {
      io.gitCalls.push(`push:${branch}`)
      return Promise.resolve()
    },
    currentSha: () => Promise.resolve('deadbeef'),
  }

  const agent: OpenCodeAgent = {
    sessionId: 'session-1',
    prompt: (request) => {
      io.prompts.push(request)
      return Promise.resolve({ text: io.replies.shift() ?? '', sessionId: 'session-1' })
    },
    close: () => Promise.resolve(),
  }

  const deps: PhaseDeps = {
    github,
    git,
    runCheck: (check) => Promise.resolve(io.checkResults.get(check.name) ?? OK_CHECK),
    agent: () => Promise.resolve(agent),
    skills: () => Promise.resolve([]),
    config: config(overrides),
    log: silentLogger(),
  }

  return { deps, io }
}

/** State written by the newest comment the agent posted. */
const latestPostedState = (harness: Harness): AgentState | null => {
  const last = harness.io.posted.at(-1)
  return last === undefined ? null : extractState(last)
}

describe('runPipeline guardrails', () => {
  test('skips a run raised by a Bot without touching the issue', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: event({ senderType: 'Bot' }), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('skips a non-maintainer', async () => {
    const harness = makeHarness()

    const result = await runPipeline({
      event: event({ authorAssociation: 'CONTRIBUTOR' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('CONTRIBUTOR')
    expect(harness.io.posted).toEqual([])
  })
})

describe('runPipeline phase 1', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('posts a design spec and parks in DESIGN_SPEC', async () => {
    const result = await runPipeline({ event: event(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted).toHaveLength(1)
    expect(harness.io.posted[0]).toContain('### Design spec')
    expect(harness.io.posted[0]).toContain('/approve')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('posts clarification questions and stays in INIT_OR_CLARIFY', async () => {
    harness.io.replies = [JSON.stringify({ status: 'clarify', questions: ['Which client?', 'How many retries?'] })]

    const result = await runPipeline({ event: event(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('Which client?')
    expect(latestPostedState(harness)?.phase).toBe('INIT_OR_CLARIFY')
  })

  test('re-runs triage when a maintainer answers without a slash command', async () => {
    harness.io.replies = [JSON.stringify({ status: 'clarify', questions: ['Which client?'] }), SPEC_REPLY]
    await runPipeline({ event: event(), deps: harness.deps })

    harness.io.thread.push({ id: 500, body: 'The HTTP client.', authorLogin: 'maintainer' })
    const result = await runPipeline({
      event: event({ eventName: 'issue_comment', action: 'created', commentBody: 'The HTTP client.' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('waiting')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('parks in FAILED when the model returns unusable JSON', async () => {
    harness.io.replies = ['I could not decide.']

    const result = await runPipeline({ event: event(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('Run failed in INIT_OR_CLARIFY')
    expect(harness.io.posted[0]).toContain('/retry')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('INIT_OR_CLARIFY')
    expect(state?.attempts).toBe(1)
  })
})

describe('runPipeline phases 2-4', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await runPipeline({ event: event(), deps: harness.deps })
    harness.io.posted.length = 0
  })

  test('/approve cascades through plan, implement and delivery in one run', async () => {
    const result = await runPipeline({ event: approval(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.map((body) => body.split('\n')[0])).toEqual([
      '### Execution plan',
      '### Implementation report',
      '### Pull request ready',
    ])
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('cuts, commits and pushes the issue branch', async () => {
    await runPipeline({ event: approval(), deps: harness.deps })

    expect(harness.io.gitCalls).toContain('ensureBranch:agent/issue-42:main')
    expect(harness.io.gitCalls).toContain('push:agent/issue-42')
    expect(harness.io.gitCalls.some((call) => call.startsWith('commit:'))).toBe(true)
  })

  test('records the branch and the pull request URL in the persisted state', async () => {
    await runPipeline({ event: approval(), deps: harness.deps })

    const state = latestPostedState(harness)
    expect(state?.branch).toBe('agent/issue-42')
    expect(state?.prUrl).toBe('https://example.test/pull/7')
    expect(state?.approved).toBe(true)
  })

  test('opens a pull request that closes the issue', async () => {
    let body = ''
    harness.deps.github.createPullRequest = (input): Promise<PullRequestRef> => {
      body = input.body
      return Promise.resolve({ number: 7, url: 'https://example.test/pull/7' })
    }

    await runPipeline({ event: approval(), deps: harness.deps })

    expect(body).toContain('Closes #42')
  })

  test('reuses an already-open pull request instead of opening a second', async () => {
    harness.io.openPr = { number: 3, url: 'https://example.test/pull/3' }

    await runPipeline({ event: approval(), deps: harness.deps })

    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.posted.at(-1)).toContain('https://example.test/pull/3')
  })

  test('still delivers when the review loop stays red, and says so', async () => {
    harness.io.checkResults.set('lint', { command: 'lint', exitCode: 1, stdout: 'lint blew up', stderr: '' })

    const result = await runPipeline({ event: approval(), deps: harness.deps })

    expect(result.status).toBe('completed')
    const report = harness.io.posted.find((body) => body.startsWith('### Implementation report'))
    expect(report).toContain('❌ red')
    expect(report).toContain('lint blew up')
  })

  test('fails when the agent produced no file changes', async () => {
    harness.deps.git.hasChanges = (): Promise<boolean> => Promise.resolve(false)

    const result = await runPipeline({ event: approval(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(latestPostedState(harness)?.resumeFrom).toBe('REVIEW_AND_MUTATE')
  })
})

describe('runPipeline command handling', () => {
  test('ignores a comment with no command while waiting for approval', async () => {
    const harness = makeHarness()
    await runPipeline({ event: event(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({
      event: event({ eventName: 'issue_comment', action: 'created', commentBody: 'nice work' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('rejects /approve arriving in a phase that cannot accept it', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: approval(), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('/approve is not valid in INIT_OR_CLARIFY')
    expect(harness.io.posted).toEqual([])
  })

  test('/replan sends an unapproved spec back through triage', async () => {
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY, SPEC_REPLY]
    await runPipeline({ event: event(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({
      event: event({ eventName: 'issue_comment', action: 'created', commentBody: '/replan' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Design spec')
  })

  test('/cancel parks the issue in COMPLETE without doing more work', async () => {
    const harness = makeHarness()
    await runPipeline({ event: event(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({
      event: event({ eventName: 'issue_comment', action: 'created', commentBody: '/cancel' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('completed')
    expect(harness.io.gitCalls).toEqual([])
  })

  test('/retry resumes the failed phase rather than replaying the pipeline', async () => {
    const harness = makeHarness()
    harness.io.replies = ['not json', SPEC_REPLY]
    await runPipeline({ event: event(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({
      event: event({ eventName: 'issue_comment', action: 'created', commentBody: '/retry' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Design spec')
    expect(latestPostedState(harness)?.attempts).toBe(1)
  })

  test('stops retrying once the attempt budget is spent', async () => {
    const harness = makeHarness({ maxAttempts: 1 })
    harness.io.replies = ['not json', 'not json either']
    await runPipeline({ event: event(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({
      event: event({ eventName: 'issue_comment', action: 'created', commentBody: '/retry' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Retry budget exhausted')
    expect(harness.io.posted).toEqual([])
  })
})
