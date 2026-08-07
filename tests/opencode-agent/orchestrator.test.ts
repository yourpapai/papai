// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { findArtifact, PLAN_MARKER, SPEC_MARKER } from '../../opencode-agent/src/artifacts.js'
import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import { DEFAULT_CHECKS } from '../../opencode-agent/src/config.js'
import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { Git } from '../../opencode-agent/src/git.js'
import type { GitHubApi, PullRequestRef, PullRequestStatus } from '../../opencode-agent/src/github.js'
import type { CiTriggerEvent, IssueTriggerEvent } from '../../opencode-agent/src/guardrails.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { AgentPromptRequest, OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import { runPipeline } from '../../opencode-agent/src/orchestrator.js'
import type { PhaseDeps } from '../../opencode-agent/src/phase-context.js'
import type { ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'
import { extractState, initialState, serializeState } from '../../opencode-agent/src/state-manager.js'
import type { AgentState, Phase } from '../../opencode-agent/src/types.js'

const AGENT_LOGIN = 'agent-bot'
const ISSUE = 42
const BASE_BRANCH = 'trunk'
const OPENING_TAG = /<untrusted_input source="[^"]*" id="([^"]+)">/u

/** A newer state block for a different issue, as a comment edit could plant. */
const PLANTED_STATE: AgentState = { ...initialState(7), phase: 'PLAN_REVIEW' }

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
  selfLoginOverride: AGENT_LOGIN,
  selfWorkflowName: 'OpenCode Issue Agent',
  openai: { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' },
  commitAuthorName: 'agent',
  commitAuthorEmail: 'agent@example.com',
  checkCommand: 'bun test',
  reviewCommand: ['bun', 'run', 'review-loop/src/cli.ts'],
  checks: DEFAULT_CHECKS,
  reviewMaxRounds: 2,
  reviewPoolSize: 1,
  agentTimeoutMs: 1000,
  ciFixMaxRounds: 2,
  maxCiAttempts: 2,
  maxAttempts: 3,
  maxTokens: 5_000_000,
  diffLimits: { maxFiles: 100, maxLines: 20_000 },
  gitRemoteBase: 'https://github.com/',
  skillRoots: ['.superpowers/skills'],
  ...overrides,
})

const issueEvent = (overrides: Partial<IssueTriggerEvent> = {}): IssueTriggerEvent => ({
  kind: 'issue',
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
  defaultBranch: BASE_BRANCH,
  ...overrides,
})

const comment = (body: string): IssueTriggerEvent =>
  issueEvent({ eventName: 'issue_comment', action: 'created', commentBody: body })

const ciEvent = (overrides: Partial<CiTriggerEvent> = {}): CiTriggerEvent => ({
  kind: 'ci',
  eventName: 'workflow_run',
  action: 'completed',
  branch: `agent/issue-${ISSUE}`,
  issueNumber: ISSUE,
  conclusion: 'failure',
  workflowName: 'CI',
  runUrl: 'https://example.test/run/1',
  fromThisRepository: true,
  defaultBranch: BASE_BRANCH,
  ...overrides,
})

/** Mutable recording surface shared by every fake in a harness. */
interface PipelineIo {
  thread: IssueComment[]
  posted: string[]
  prompts: AgentPromptRequest[]
  gitCalls: string[]
  checkResults: Map<string, CommandResult>
  /** Model replies, consumed in order by successive prompts. */
  replies: string[]
  /** Tokens the fake session reports as spent this job. */
  tokensUsed: number
  reviewResult: ReviewRunResult
  /** What `git` would report as the remote's default branch. */
  detectedBranch: string | null
  createdPr: PullRequestRef | null
  /** What the branch's pull request lookup reports, whatever became of it. */
  existingPr: PullRequestStatus | null
  prBodies: string[]
  prTitles: string[]
  /** The account GitHub records as the author of the agent's comments. */
  postedAs: string
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
const OK_CHECK: CommandResult = { command: 'check', exitCode: 0, stdout: '', stderr: '' }

const makeHarness = (overrides: Partial<PipelineConfig> = {}): Harness => {
  const io: PipelineIo = {
    thread: [],
    posted: [],
    prompts: [],
    gitCalls: [],
    checkResults: new Map(),
    replies: [],
    tokensUsed: 0,
    reviewResult: { outcome: 'passed', summary: 'no issues found', exitCode: 0 },
    detectedBranch: BASE_BRANCH,
    createdPr: null,
    existingPr: null,
    prBodies: [],
    prTitles: [],
    postedAs: AGENT_LOGIN,
  }

  let nextCommentId = 100

  const github: GitHubApi = {
    listIssueComments: () => Promise.resolve([...io.thread]),
    createComment: (_issueNumber, body) => {
      nextCommentId += 1
      io.posted.push(body)
      io.thread.push({ id: nextCommentId, body, authorLogin: io.postedAs })
      return Promise.resolve({
        id: nextCommentId,
        url: `https://example.test/c/${nextCommentId}`,
        authorLogin: io.postedAs,
      })
    },
    getIssue: () => Promise.resolve({ number: ISSUE, title: 'Add retries', body: 'Please add retries.' }),
    getAuthenticatedLogin: () => Promise.resolve(AGENT_LOGIN),
    findPullRequest: () => Promise.resolve(io.existingPr),
    createPullRequest: (input) => {
      io.prBodies.push(input.body)
      io.prTitles.push(input.title)
      io.createdPr = { number: 7, url: 'https://example.test/pull/7' }
      // A pull request that has been opened is findable, as GitHub's is.
      io.existingPr = { ...io.createdPr, state: 'open' }
      return Promise.resolve(io.createdPr)
    },
    updatePullRequest: (_number, patch) => {
      io.prBodies.push(patch.body)
      io.prTitles.push(patch.title)
      return Promise.resolve()
    },
  }

  const git: Git = {
    ensureBranch: (branch, base) => {
      io.gitCalls.push(`ensureBranch:${branch}:${base}`)
      return Promise.resolve()
    },
    commitAll: (message) => {
      io.gitCalls.push(`commit:${message.split('\n')[0]}`)
      return Promise.resolve(true)
    },
    push: (branch) => {
      io.gitCalls.push(`push:${branch}`)
      return Promise.resolve()
    },
    defaultBranch: () => Promise.resolve(io.detectedBranch),
  }

  const agent: OpenCodeAgent = {
    sessionId: 'session-1',
    prompt: (request) => {
      io.prompts.push(request)
      return Promise.resolve({ text: io.replies.shift() ?? '', sessionId: 'session-1' })
    },
    tokensUsed: () => Promise.resolve(io.tokensUsed),
    close: () => Promise.resolve(),
  }

  const deps: PhaseDeps = {
    github,
    git,
    runCheck: (check) => Promise.resolve(io.checkResults.get(check.name) ?? OK_CHECK),
    runReview: () => Promise.resolve(io.reviewResult),
    agent: () => Promise.resolve(agent),
    tokensUsed: () => Promise.resolve(io.tokensUsed),
    skills: () => Promise.resolve([]),
    baseBranch: () => Promise.resolve(BASE_BRANCH),
    selfLogin: () => Promise.resolve(AGENT_LOGIN),
    config: config(overrides),
    log: silentLogger(),
  }

  return { deps, io }
}

/**
 * A Git that refuses every operation — the shape a fresh runner presents to a
 * phase that assumes a working tree it never created. `PR_DELIVERY` must be
 * able to run against this, because on a retry that is exactly what it gets.
 */
const hostileGit = (): Git => {
  const refuse = (operation: string): never => {
    throw new Error(`git ${operation} must not run on a fresh runner`)
  }

  return {
    ensureBranch: (): Promise<void> => refuse('ensureBranch'),
    commitAll: (): Promise<boolean> => refuse('commit'),
    push: (): Promise<void> => refuse('push'),
    defaultBranch: (): Promise<string | null> => refuse('symbolic-ref'),
  }
}

const latestPostedState = (harness: Harness): AgentState | null => {
  const last = harness.io.posted.at(-1)
  return last === undefined ? null : extractState(last)
}

/** A state block an earlier job left on the thread, as a later job reads it back. */
const seedState = (harness: Harness, patch: Partial<AgentState>): void => {
  const prior: AgentState = { ...initialState(ISSUE), ...patch }
  harness.io.thread.push({ id: 800, body: `earlier\n\n${serializeState(prior)}`, authorLogin: AGENT_LOGIN })
}

/** Keeps the "did a run return a state?" narrowing out of the test bodies. */
const spentIn = (result: { state: AgentState | null }): number => result.state?.tokensSpent ?? -1

const headings = (harness: Harness): string[] => harness.io.posted.map((body) => body.split('\n')[0] ?? '')

/** Drives an issue as far as DESIGN_SPEC, ready for the review conversation. */
const toDesignSpec = async (harness: Harness): Promise<void> => {
  harness.io.replies = [SPEC_REPLY]
  await runPipeline({ event: issueEvent(), deps: harness.deps })
  harness.io.posted.length = 0
}

/** Drives an issue as far as PLAN_REVIEW. */
const toPlanReview = async (harness: Harness): Promise<void> => {
  await toDesignSpec(harness)
  harness.io.replies = [PLAN_REPLY]
  await runPipeline({ event: comment('/approve'), deps: harness.deps })
  harness.io.posted.length = 0
}

describe('guardrails', () => {
  test('skips a run raised by a Bot without touching the issue', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: issueEvent({ senderType: 'Bot' }), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('skips a non-maintainer', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: issueEvent({ authorAssociation: 'CONTRIBUTOR' }), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })
})

describe('phase 1 — triage', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('posts a design spec and parks in DESIGN_SPEC', async () => {
    harness.io.replies = [SPEC_REPLY]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Design spec')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('persists a spec whose markdown could forge the block delimiters', async () => {
    // Horizontal rules broke the original heading-scraping recovery; `-->`
    // broke the block channel that replaced it. A real design spec contains
    // both — a mermaid diagram is `A --> B`.
    const spec = [
      '## Goal',
      '',
      'Do it.',
      '',
      '---',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '## Files',
      '',
      '- `src/a.ts`',
    ].join('\n')
    harness.io.replies = [JSON.stringify({ status: 'spec', spec })]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    // Read it back the way a later job does, not by string surgery.
    expect(findArtifact(harness.io.thread, AGENT_LOGIN, SPEC_MARKER)?.text).toBe(spec)
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('a failure whose message forges the delimiter still persists its state', async () => {
    // The state block carries tool output verbatim in lastError. Losing it is
    // worse than losing an artefact: the next job restarts a live issue.
    harness.io.replies = ['error[E0308] expected struct\n  --> src/a.rs:3:9\n   |']

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(latestPostedState(harness)?.resumeFrom).toBe('INIT_OR_CLARIFY')
  })

  test('posts clarification questions and stays in INIT_OR_CLARIFY', async () => {
    harness.io.replies = [JSON.stringify({ status: 'clarify', questions: ['Which client?'] })]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('Which client?')
    expect(latestPostedState(harness)?.phase).toBe('INIT_OR_CLARIFY')
  })

  test('a plain reply while clarifying re-runs triage', async () => {
    harness.io.replies = [JSON.stringify({ status: 'clarify', questions: ['Which client?'] }), SPEC_REPLY]
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('The HTTP client.'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('parks in FAILED when the model returns unusable JSON', async () => {
    harness.io.replies = ['I could not decide.']

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('Run failed in INIT_OR_CLARIFY')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('INIT_OR_CLARIFY')
  })
})

describe('review conversation', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toDesignSpec(harness)
  })

  test('/ask answers without moving the state machine', async () => {
    harness.io.replies = ['Because the retry helper already exists there.']

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Answer')
    expect(harness.io.posted[0]).toContain('Because the retry helper already exists there.')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('/ask passes the question through to the model', async () => {
    harness.io.replies = ['an answer']
    await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(String(harness.io.prompts.at(-1)?.prompt)).toContain('why that file?')
  })

  test('/changes revises the spec and reports a new revision', async () => {
    harness.io.replies = [JSON.stringify({ status: 'spec', spec: 'Use the existing helper.' })]

    const result = await runPipeline({ event: comment('/changes use the existing helper'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('Design spec (revision 2)')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('/changes threads the maintainer feedback into the rewrite prompt', async () => {
    harness.io.replies = [JSON.stringify({ status: 'spec', spec: 'revised' })]
    await runPipeline({ event: comment('/changes use the existing helper'), deps: harness.deps })

    expect(String(harness.io.prompts.at(-1)?.prompt)).toContain('use the existing helper')
  })

  test('a plain comment classified as a question gets answered', async () => {
    harness.io.replies = [JSON.stringify({ intent: 'question' }), 'Because it already exists.']

    const result = await runPipeline({ event: comment('why that file?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Answer')
  })

  test('a plain comment classified as a change request revises the spec', async () => {
    harness.io.replies = [JSON.stringify({ intent: 'changes' }), JSON.stringify({ status: 'spec', spec: 'revised' })]

    await runPipeline({ event: comment('please use the existing helper instead'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('Design spec (revision 2)')
  })

  test('a plain comment classified as approval proceeds to planning', async () => {
    harness.io.replies = [JSON.stringify({ intent: 'approve' }), PLAN_REPLY]

    await runPipeline({ event: comment('looks great, go ahead'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### Execution plan')
  })

  test('an unusable classification falls back to answering, never to re-planning', async () => {
    harness.io.replies = ['not json at all', 'an answer']

    const result = await runPipeline({ event: comment('hmm'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Answer')
    expect(latestPostedState(harness)?.revision).toBe(1)
  })
})

describe('answering outside the review gates', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test.each<Phase>(['COMPLETE', 'REVIEW_AND_MUTATE', 'PR_DELIVERY', 'CI_FIX'])(
    '/ask in %s is answered and leaves the phase exactly there',
    async (phase) => {
      // `/ask` has always been accepted in every phase, but ANSWERED lived in
      // three rows of the transition table, so each of these crashed the runner
      // with an InvalidTransitionError after the model turn was paid for —
      // nothing posted, exit code 1, the maintainer left staring at an issue.
      seedState(harness, { phase })
      harness.io.replies = ['Because the retry helper already exists there.']

      const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

      expect(result.status).toBe('waiting')
      expect(harness.io.posted[0]).toContain('### Answer')
      expect(harness.io.posted[0]).toContain('Because the retry helper already exists there.')
      expect(latestPostedState(harness)?.phase).toBe(phase)
    },
  )

  test('/ask in FAILED answers without disturbing the parked failure', async () => {
    // The phase a maintainer most wants to ask a question in, and the one the
    // crash hurt most: the run had already failed, so this was the only thing
    // left to try.
    seedState(harness, { phase: 'FAILED', resumeFrom: 'REVIEW_AND_MUTATE', attempts: 1, lastError: 'tests exploded' })
    harness.io.replies = ['The check runner could not find bun on the PATH.']

    const result = await runPipeline({ event: comment('/ask why did this fail?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('The check runner could not find bun on the PATH.')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    // Still resumable: a question must not cost the maintainer the `/retry`.
    expect(state?.resumeFrom).toBe('REVIEW_AND_MUTATE')
  })

  test('a failed /ask in COMPLETE reports without dragging a delivered issue backwards', async () => {
    // Two crashes on one path: the answer's own ANSWERED was refused, and when
    // the model call failed instead, the failure path's `transition(FAILED)`
    // was refused too, because COMPLETE deliberately accepts neither.
    seedState(harness, { phase: 'COMPLETE', prUrl: 'https://example.test/pull/7' })
    harness.deps.agent = (): Promise<OpenCodeAgent> => Promise.reject(new Error('the model endpoint rejected it'))

    const result = await runPipeline({ event: comment('/ask what did you change?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### I could not answer that')
    expect(harness.io.posted[0]).toContain('the model endpoint rejected it')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('COMPLETE')
    expect(state?.resumeFrom).toBeNull()
    expect(state?.attempts).toBe(0)
  })

  test('a failed /ask spends no attempt and promises no retry', async () => {
    // The related defect: a failed answer used to park the state with
    // `resumeFrom: 'DESIGN_SPEC'` and invite `/retry`, which then resumed into a
    // waiting phase with no handler and re-parked with "Parked in DESIGN_SPEC",
    // one attempt poorer for a round trip that did nothing.
    await toDesignSpec(harness)
    harness.deps.agent = (): Promise<OpenCodeAgent> => Promise.reject(new Error('the model timed out'))

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).not.toContain('/retry')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('DESIGN_SPEC')
    expect(state?.resumeFrom).toBeNull()
    expect(state?.attempts).toBe(0)
  })
})

describe('plan review gate', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('/approve on the spec stops at the plan rather than implementing', async () => {
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(headings(harness)).toEqual(['### Execution plan (revision 2)'])
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
    expect(harness.io.gitCalls).toEqual([`ensureBranch:agent/issue-${ISSUE}:${BASE_BRANCH}`])
  })

  test('/changes on the plan re-plans without touching the spec', async () => {
    await toPlanReview(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/changes split step 1'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### Execution plan (revision 3)')
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
  })

  test('/approve on the plan cascades through implementation and delivery', async () => {
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(headings(harness)).toEqual(['### Implementation report', '### Pull request ready'])
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })
})

describe('implementation and delivery', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
  })

  test('pushes the branch in the phase that made the commit', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    // Delivery must not depend on a working tree; the push happens in phase 3.
    const pushIndex = harness.io.gitCalls.indexOf(`push:agent/issue-${ISSUE}`)
    expect(pushIndex).toBeGreaterThan(-1)
    expect(harness.io.gitCalls.filter((call) => call.startsWith('commit:'))).toHaveLength(2)
  })

  test('pushes before the phase ends, so the commit outlives the job', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    const calls = harness.io.gitCalls
    const push = calls.indexOf(`push:agent/issue-${ISSUE}`)
    const lastCommit = calls.map((call) => call.startsWith('commit:')).lastIndexOf(true)

    // An Actions working tree dies with the job: a commit that is not pushed by
    // the end of the phase that made it cannot be recovered by any later retry.
    expect(push).toBeGreaterThan(lastCommit)
  })

  test('resumes delivery on a fresh runner, touching git not at all', async () => {
    // The job that implemented the work pushed the branch, then died before the
    // pull request existed. This is the scenario that used to be unrecoverable:
    // delivery pushed a branch that a fresh checkout does not have locally.
    harness.deps.github.createPullRequest = (): Promise<PullRequestRef> => {
      throw new Error('GitHub was down')
    }

    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    expect(latestPostedState(harness)?.resumeFrom).toBe('PR_DELIVERY')
    expect(harness.io.gitCalls).toContain(`push:agent/issue-${ISSUE}`)

    // A brand-new runner: no branch checked out, no commit, no working tree.
    harness.io.posted.length = 0
    harness.deps.git = hostileGit()
    harness.deps.github.createPullRequest = (input): Promise<PullRequestRef> => {
      harness.io.prBodies.push(input.body)
      return Promise.resolve({ number: 7, url: 'https://example.test/pull/7' })
    }

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.at(-1)).toContain('https://example.test/pull/7')
    expect(harness.io.prBodies.at(-1)).toContain(`Closes #${ISSUE}`)
  })

  test('opens a pull request that closes the issue', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prBodies[0]).toContain(`Closes #${ISSUE}`)
    expect(harness.io.prBodies[0]).toContain('review-loop summary')
  })

  test('records the pull request in the persisted state', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    const state = latestPostedState(harness)
    expect(state?.prUrl).toBe('https://example.test/pull/7')
    expect(state?.prNumber).toBe(7)
  })

  test('refreshes an already-open pull request rather than opening a second', async () => {
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'open' }

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prBodies).toHaveLength(1)
    expect(harness.io.posted.at(-1)).toContain('https://example.test/pull/3')
  })

  test('a reused pull request follows the issue as it reads now, not as it read when opened', async () => {
    // An earlier job opened the pull request under the old name. Refreshing
    // used to patch the body alone, so the title stayed frozen there forever.
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'open' }
    const renamed = issueEvent({
      eventName: 'issue_comment',
      action: 'created',
      commentBody: '/approve',
      issueTitle: 'Add retries and backoff',
    })

    await runPipeline({ event: renamed, deps: harness.deps })

    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prTitles).toEqual([`Add retries and backoff (#${ISSUE})`])
  })

  test('stands down instead of opening a second pull request once the first merged', async () => {
    // An open-only lookup reports a merged pull request as `[]` — identical to
    // one that never existed — so delivery used to open a twin from a branch
    // with nothing left to merge.
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'merged' }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prTitles).toEqual([])
    expect(harness.io.posted.at(-1)).toContain('already merged')
    expect(latestPostedState(harness)?.prNumber).toBe(3)
  })

  test('does not re-open work a maintainer closed', async () => {
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'closed' }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prTitles).toEqual([])
    expect(harness.io.posted.at(-1)).toContain('closed without merging')
  })

  test('reports a repository with no review loop as unconfigured, not as red', async () => {
    // A checkout without the workspace has no review configured; that is not a
    // review that failed, and calling it one made every run elsewhere red.
    harness.io.reviewResult = { outcome: 'unavailable', summary: 'No review loop is configured.', exitCode: 0 }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('not configured for this repository')
    expect(harness.io.posted[0]).not.toContain('❌')
  })

  test('still delivers when the review loop exits red, and says so', async () => {
    harness.io.reviewResult = { outcome: 'failed', summary: 'two issues left open', exitCode: 1 }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('❌ exited 1')
    expect(harness.io.posted[0]).toContain('two issues left open')
  })

  test('fails when the agent produced no file changes', async () => {
    // A clean tree is what `commitAll` reports, not something asked separately.
    harness.deps.git.commitAll = (): Promise<boolean> => Promise.resolve(false)

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(latestPostedState(harness)?.resumeFrom).toBe('REVIEW_AND_MUTATE')
  })

  test('every prompt states the envelope rule for the id that prompt actually uses', async () => {
    // The rule and the terminator are minted together; if a handler ever built
    // them from separate calls the model would be told to trust an id that
    // never appears, and every real delimiter would look forged.
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prompts.length).toBeGreaterThan(0)
    for (const request of harness.io.prompts) {
      const id = OPENING_TAG.exec(request.prompt)?.[1]
      expect(id).toBeDefined()
      expect(request.system).toContain(`</untrusted_input:${id}>`)
    }
  })

  test('a state block naming another issue never reaches git', async () => {
    // Maintainers can edit the agent's comments. `issueId` names the branch
    // through `branchNameFor`, the commit trailers, and the `Closes #n` the
    // pull request carries, so a planted number would have the agent push to
    // `agent/issue-7` and close a different issue.
    harness.io.thread.push({ id: 999, body: `planted\n\n${serializeState(PLANTED_STATE)}`, authorLogin: AGENT_LOGIN })

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.gitCalls.join(' ')).not.toContain('agent/issue-7')
    expect(harness.io.gitCalls.join(' ')).toContain(`agent/issue-${ISSUE}`)
  })

  test('a mismatched posting identity fails now, not one job later', async () => {
    // The in-job thread mirror carries the author GitHub *recorded*. If it
    // carried the assumed one instead, delivery would find the report this job
    // just wrote while the next job — reading real authors back from the API —
    // could not. Failing the same way in both places is what makes the
    // misconfiguration visible; `reportIdentityDrift` says why on the same run.
    harness.io.postedAs = 'github-actions[bot]'

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prBodies.at(-1)).toContain('No implementation report was recorded')
  })

  test('finds its own report when the identity matches', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prBodies.at(-1)).toContain('Implementation report')
  })

  test('persists the plan so a later job reads it back verbatim', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.thread.some((entry) => entry.body.includes(PLAN_MARKER))).toBe(true)
  })
})

describe('CI fixing', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    harness.io.posted.length = 0
    harness.io.gitCalls.length = 0
  })

  test('a red run on the agent branch starts a fix round', async () => {
    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('### CI fix attempt 1 of 2')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('repairs failing checks and pushes the fix', async () => {
    harness.io.checkResults.set('lint', { command: 'lint', exitCode: 1, stdout: 'lint blew up', stderr: '' })
    harness.io.replies = ['Fixed the lint error.']

    await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(String(harness.io.prompts.at(-1)?.prompt)).toContain('lint blew up')
    expect(harness.io.gitCalls).toContain(`push:agent/issue-${ISSUE}`)
  })

  test('reports the remaining failures when it cannot get green', async () => {
    harness.io.checkResults.set('test', { command: 'test', exitCode: 1, stdout: 'still failing', stderr: '' })
    harness.io.replies = ['tried', 'tried again']

    await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('❌ still red')
    expect(harness.io.posted[0]).toContain('still failing')
  })

  test('a green run is ignored', async () => {
    const result = await runPipeline({ event: ciEvent({ conclusion: 'success' }), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('the agent pipeline failing does not feed itself', async () => {
    const result = await runPipeline({
      event: ciEvent({ workflowName: 'OpenCode Issue Agent' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('says so on the issue when it stops trying, rather than going quiet', async () => {
    // A red check arrives on its own schedule with nobody reading the Actions
    // log, so a silent give-up is indistinguishable from an agent still working.
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted).toHaveLength(1)
    expect(harness.io.posted[0]).toContain('I have stopped trying to fix CI')
    expect(harness.io.posted[0]).toContain('https://example.test/pull/7')
    expect(latestPostedState(harness)?.ciBudgetReported).toBe(true)
  })

  test('says it once, however many more red runs arrive', async () => {
    // CI fires on every push and re-run; repeating the notice would be spam.
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('Already reported')
    expect(harness.io.posted).toEqual([])
  })

  test.each(['merged', 'closed'] as const)('a red run on a %s pull request buys no fix round', async (state) => {
    // CI keeps firing on a branch after its pull request settles — a later
    // push, a re-run, a flake — and a fix round's commits would land somewhere
    // nobody will merge again.
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state }

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain(state)
    expect(harness.io.gitCalls).toEqual([])
    expect(harness.io.posted).toEqual([])
  })

  test('a settled pull request does not spend a CI-fix attempt', async () => {
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state: 'merged' }
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })

    // The budget is for repairing a live pull request; standing down must not
    // consume it, or a reopened one would arrive with nothing left to spend.
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state: 'open' }
    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.at(-1)).toContain('CI fix attempt 1 of 2')
  })

  test('a red run on a branch with no pull request has nowhere to go', async () => {
    harness.io.existingPr = null

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('nowhere to go')
    expect(harness.io.gitCalls).toEqual([])
  })

  test('the spent-budget notice is not posted to a merged pull request', async () => {
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.posted.length = 0
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state: 'merged' }

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    // "I have stopped trying to fix CI" is noise on work that already landed.
    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('does not touch the working tree once the budget is spent', async () => {
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.gitCalls.length = 0

    await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(harness.io.gitCalls).toEqual([])
  })
})

describe('commands and budgets', () => {
  test('/cancel is durable — a later /approve does not resurrect the issue', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)

    const cancelled = await runPipeline({ event: comment('/cancel'), deps: harness.deps })

    expect(cancelled.status).toBe('completed')
    expect(harness.io.posted).toHaveLength(1)
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')

    harness.io.posted.length = 0
    const after = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(after.status).toBe('skipped')
    expect(harness.io.gitCalls).toEqual([])
  })

  test('a cancelled issue stays cancelled when a maintainer keeps talking', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)
    await runPipeline({ event: comment('/cancel'), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('ok, can we revisit this?'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('the closing comment does not promise a restart the machine refuses', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)

    await runPipeline({ event: comment('/cancel'), deps: harness.deps })

    // COMPLETE accepts nothing; the wording has to match that, not soften it.
    const closing = String(harness.io.posted[0])
    expect(closing).toContain('will not restart me')
    expect(closing.toLowerCase()).not.toContain('comment again')
  })

  test('a delivered issue closes by pointing at the pull request', async () => {
    const harness = makeHarness()
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    // Delivery posts its own closing comment; no bare "Stopped" on a shipped issue.
    expect(harness.io.posted.at(-1)).toContain('https://example.test/pull/7')
    expect(harness.io.posted.join('\n')).not.toContain('### Stopped')
  })

  test('rejects /approve arriving in a phase that cannot accept it', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('not valid in INIT_OR_CLARIFY')
  })

  test('says so on the issue rather than only in the job log', async () => {
    // This used to skip in silence. A maintainer who types a command and sees
    // nothing has no way to tell a refusal from an agent that never woke up —
    // which is how a mis-set AGENT_SELF_LOGIN went unnoticed while every
    // `/changes` was refused against a state that had been restarted.
    const harness = makeHarness()

    await runPipeline({ event: comment('/changes do it differently'), deps: harness.deps })

    const refusal = String(harness.io.posted.at(-1))
    expect(refusal).toContain('/changes')
    expect(refusal).toContain('INIT_OR_CLARIFY')
    // Derived from the transition table, so it cannot promise a command the
    // machine would refuse in turn.
    expect(refusal).toContain('/cancel')
    expect(refusal).toContain('/ask')
    expect(refusal).not.toContain('`/approve`')
  })

  test('/changes is accepted once the agent can read back its own spec', async () => {
    // The regression this file exists for: with the wrong self-login the spec
    // comment is invisible, the state restores to INIT_OR_CLARIFY, and the
    // maintainer's `/changes` is refused. Reading it back is what makes the
    // command land in DESIGN_SPEC and send the issue round for a new spec.
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY, SPEC_REPLY]
    await runPipeline({ event: issueEvent(), deps: harness.deps })

    const result = await runPipeline({ event: comment('/changes narrow the scope'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(result.state?.phase).toBe('DESIGN_SPEC')
    expect(harness.io.posted.at(-1)).toContain('### Design spec')
  })

  test('a single malformed reply is repaired rather than failing the run', async () => {
    // This used to park the issue in FAILED and wait for a human `/retry` over
    // a stray sentence around an otherwise fine object.
    const harness = makeHarness()
    harness.io.replies = ['here you go: not json', SPEC_REPLY]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted.at(-1)).toContain('### Design spec')
    expect(harness.io.prompts).toHaveLength(2)
    expect(String(harness.io.prompts[1]?.prompt)).toContain('could not be used')
  })

  test('re-asks once, not until it works', async () => {
    const harness = makeHarness()
    harness.io.replies = ['not json', 'still not json', SPEC_REPLY]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.prompts).toHaveLength(2)
    expect(latestPostedState(harness)?.resumeFrom).toBe('INIT_OR_CLARIFY')
  })

  test('/retry resumes the failed phase rather than replaying the pipeline', async () => {
    const harness = makeHarness()
    harness.io.replies = ['not json', 'still not json', SPEC_REPLY]
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Design spec')
  })

  test('an exhausted retry budget is reported on the issue, not swallowed', async () => {
    const harness = makeHarness({ maxAttempts: 1 })
    harness.io.replies = ['not json', 'not json either']
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Retry budget exhausted')
    expect(harness.io.posted[0]).toContain('### Giving up')
  })
})

describe('the retry budget', () => {
  /** A failure an earlier job parked, with the last attempt already spent on it. */
  const seedSpentBudget = (harness: Harness): void =>
    seedState(harness, {
      phase: 'FAILED',
      resumeFrom: 'EXECUTION_PLAN',
      attempts: 3,
      lastError: 'the planning turn returned no JSON',
    })

  test('a /retry past the budget leaves the failure parked where it was', async () => {
    // Spending the budget used to *move* the state: the signal was applied
    // first and the ceiling checked a step later, so the give-up notice posted
    // `EXECUTION_PLAN` with `resumeFrom` cleared — a handler phase that
    // `/retry` (which needs FAILED) and a plain comment (which needs a waiting
    // phase) both refuse. Only `/cancel` could reach the issue after that.
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Retry budget exhausted')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('EXECUTION_PLAN')
    expect(state?.attempts).toBe(3)
  })

  test('reports the spent budget on the issue without paying for a model turn', async () => {
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)

    await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(harness.io.posted).toHaveLength(1)
    expect(harness.io.posted[0]).toContain('### Giving up')
    expect(harness.io.posted[0]).toContain('3 of 3 attempts')
    // The notice may only offer what the machine will actually take. Bare
    // "reply `/retry`" is not that: the budget is spent, so the next `/retry`
    // lands straight back here. Raising the ceiling is the remedy that works.
    expect(harness.io.posted[0]).toContain('AGENT_MAX_ATTEMPTS')
    // Refused before the cascade, so no handler and no session was ever opened.
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.gitCalls).toEqual([])
  })

  test('a second /retry is still answered by the budget, not by the transition table', async () => {
    // The tell that the first one moved nothing. Against the moved state this
    // came back as `/retry is not valid in EXECUTION_PLAN`, which is a true
    // sentence about a phase the maintainer never asked to be in.
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)
    await runPipeline({ event: comment('/retry'), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Retry budget exhausted')
    expect(result.reason).not.toContain('not valid in')
    expect(harness.io.posted[0]).toContain('### Giving up')
    expect(latestPostedState(harness)?.resumeFrom).toBe('EXECUTION_PLAN')
  })

  test('raising the ceiling resumes the parked phase, which is what makes the notice honest', async () => {
    // The notice names `AGENT_MAX_ATTEMPTS` as the way out, so the way out has
    // to still exist: the resume point survives the refusal, and the same
    // `/retry` picks the failed phase back up once the ceiling allows it.
    const harness = makeHarness({ maxAttempts: 3 })
    seedState(harness, { phase: 'FAILED', resumeFrom: 'INIT_OR_CLARIFY', attempts: 3 })
    await runPipeline({ event: comment('/retry'), deps: harness.deps })
    harness.io.posted.length = 0

    harness.deps.config = config({ maxAttempts: 4 })
    harness.io.replies = [SPEC_REPLY]
    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted.at(-1)).toContain('### Design spec')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('/ask still answers a failure whose budget is spent', async () => {
    // Answering is not retrying: it spends no attempt and moves nothing, so the
    // retry ceiling has no business stopping it. The check inside the cascade
    // sat in front of the answer handler too, so this replied "Giving up" — in
    // the one phase a maintainer most wants to ask "why did this fail?" in.
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)
    harness.io.replies = ['The planning prompt exceeded the model’s context.']

    const result = await runPipeline({ event: comment('/ask why did this fail?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('The planning prompt exceeded the model’s context.')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('EXECUTION_PLAN')
  })
})

describe('the token budget', () => {
  /** A prior job's state block, carrying what that job spent. */
  const seedSpend = (harness: Harness, tokensSpent: number): void => {
    const prior: AgentState = { ...initialState(ISSUE), phase: 'DESIGN_SPEC', tokensSpent }
    harness.io.thread.push({ id: 900, body: `earlier\n\n${serializeState(prior)}`, authorLogin: AGENT_LOGIN })
  }

  test('records what the run spent, so the next job can see it', async () => {
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 41_200

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(latestPostedState(harness)?.tokensSpent).toBe(41_200)
  })

  test('adds this job’s spend to what earlier jobs already spent', async () => {
    // The runaway this bounds is not one job — it is an issue bouncing through
    // retries and CI-fix rounds, each on a fresh runner with no memory.
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 1_000
    await runPipeline({ event: issueEvent(), deps: harness.deps })

    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 2_500
    await runPipeline({ event: comment('/changes tighten it up'), deps: harness.deps })

    expect(latestPostedState(harness)?.tokensSpent).toBe(3_500)
  })

  test('counts one job’s spend once, however many phases it cascades through', async () => {
    // The session total is cumulative across the phases of a job, so adding it
    // to each phase's own figure would count the earlier phases again. Approving
    // the plan runs implement *and* deliver in a single job, which is the case
    // that tells the two apart.
    const harness = makeHarness()
    harness.io.tokensUsed = 900
    harness.io.replies = [SPEC_REPLY]
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.replies = [PLAN_REPLY]
    const planned = await runPipeline({ event: comment('/approve'), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    // Two handlers ran in this one job, which is what makes the case.
    expect(headings(harness)).toEqual(['### Implementation report', '### Pull request ready'])
    expect(result.state?.tokensSpent).toBe(spentIn(planned) + 900)
  })

  test('stops the issue once an earlier job has spent the budget', async () => {
    // The whole point of persisting it: this job's own session has spent
    // nothing, and it still must not start.
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 60_000)

    const result = await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Token budget spent')
    expect(harness.io.posted[0]).toContain('### Token budget spent')
  })

  test('says why a bare /retry will not help, and names what makes it help', async () => {
    // The spend is persisted, so a retry against the same ceiling re-reads the
    // same total and stops again — but it is no longer a dead end, because the
    // stop parks a resume point. So the notice has to name both halves in
    // order: raise AGENT_MAX_TOKENS, *then* `/retry`.
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 60_000)

    await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('AGENT_MAX_TOKENS')
    expect(harness.io.posted[0]).toContain('stops right back here')
    expect(harness.io.posted[0]).toContain('/retry')
  })

  test('checks before the phase runs, not after it has spent more', async () => {
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 60_000)

    await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(harness.io.prompts).toHaveLength(0)
  })

  test('stops at exactly the budget, not only past it', async () => {
    // "Spent 5,000,000 of 5,000,000" is spent. Asserting the *reason*, not just
    // the status: with the budget check relaxed to `>` this run still fails,
    // because the triage handler it then reaches has no reply to parse.
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 50_000)

    const result = await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(result.reason).toContain('Token budget spent')
  })

  test('lets a run under the budget through', async () => {
    const harness = makeHarness({ maxTokens: 5_000_000 })
    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 41_200

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
  })

  test('parks the stop in FAILED, resuming from the phase it refused to start', async () => {
    // Trigger point one: the budget runs out on the *first* phase of a run,
    // right after a trigger moved the state. The stop used to leave the state
    // exactly where the trigger had put it — `EXECUTION_PLAN`, a phase with a
    // handler — so the issue was parked somewhere `/retry` (needs FAILED) and a
    // plain comment (needs a waiting phase) both refuse, and only `/cancel`
    // reached it. Reachable on a first approval with no failure involved.
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### Token budget spent')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('EXECUTION_PLAN')
    expect(state?.tokensSpent).toBe(500)
  })

  test('parks a mid-cascade stop too, where no trigger moved the state', async () => {
    // Trigger point two, which no trigger-layer refusal can reach: the earlier
    // phase legitimately did its work and posted, and the cascade stops before
    // the next one. Stopping in `PR_DELIVERY` is the same dead end as stopping
    // in `EXECUTION_PLAN` above — worse, in fact, since the branch is already
    // pushed and only delivery is left.
    const harness = makeHarness({ maxTokens: 50_000 })
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    harness.deps.runReview = (): Promise<ReviewRunResult> => {
      harness.io.tokensUsed = 60_000
      return Promise.resolve(harness.io.reviewResult)
    }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(headings(harness)).toEqual(['### Implementation report', '### Token budget spent'])

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('PR_DELIVERY')
    expect(state?.tokensSpent).toBe(60_000)
  })

  test('names the phase it parked in, so the notice and the state block agree', async () => {
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('AGENT_MAX_TOKENS')
    expect(harness.io.posted[0]).toContain('/retry')
    expect(harness.io.posted[0]).toContain(`\`${String(latestPostedState(harness)?.resumeFrom)}\``)
  })

  test('raising the ceiling and replying /retry resumes the phase it stopped before', async () => {
    // What makes the notice honest. It names `AGENT_MAX_TOKENS` and `/retry`,
    // so both together have to actually finish the work — before, raising the
    // ceiling left the issue in `PR_DELIVERY` with no event able to re-enter it.
    const harness = makeHarness({ maxTokens: 50_000 })
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    harness.deps.runReview = (): Promise<ReviewRunResult> => {
      harness.io.tokensUsed = 60_000
      return Promise.resolve(harness.io.reviewResult)
    }
    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    harness.io.posted.length = 0

    // A fresh runner: a new session that has spent nothing, under a raised ceiling.
    harness.io.tokensUsed = 0
    harness.deps.config = config({ maxTokens: 500_000 })
    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.at(-1)).toContain('### Pull request ready')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('an over-budget stop does not eat the retry budget', async () => {
    // A stop for want of tokens is not a failed attempt, so it must not spend
    // one — otherwise the two budgets collide: the token notice says to raise
    // `AGENT_MAX_TOKENS` and reply `/retry`, and that `/retry` is then turned
    // down by the *retry* gate in `triggers.ts` for a ceiling nobody mentioned.
    const harness = makeHarness({ maxAttempts: 3 })
    await toDesignSpec(harness)
    seedState(harness, { phase: 'FAILED', resumeFrom: 'EXECUTION_PLAN', attempts: 2, tokensSpent: 500 })

    harness.deps.config = config({ maxAttempts: 3, maxTokens: 100 })
    await runPipeline({ event: comment('/retry'), deps: harness.deps })
    expect(latestPostedState(harness)?.attempts).toBe(2)
    harness.io.posted.length = 0

    harness.deps.config = config({ maxAttempts: 3, maxTokens: 500_000 })
    harness.io.replies = [PLAN_REPLY]
    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.reason).not.toContain('Retry budget exhausted')
    expect(harness.io.posted.at(-1)).toContain('### Execution plan')
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
  })

  test('an over-budget /ask leaves the phase alone rather than parking a question', async () => {
    // Answering is a side conversation about work that lives elsewhere, so the
    // park above must not apply to it. `resumeFrom` may never name a waiting
    // phase — a `/retry` into `DESIGN_SPEC` finds no handler and re-parks with
    // "Parked in `DESIGN_SPEC`", one round trip for nothing — and the phase the
    // question was asked in is one a trigger can already re-enter.
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.posted[0]).toContain('AGENT_MAX_TOKENS')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('DESIGN_SPEC')
    expect(state?.resumeFrom).toBeNull()
    expect(state?.tokensSpent).toBe(500)
  })

  test('an over-budget /ask in COMPLETE reports instead of crashing the runner', async () => {
    // `COMPLETE` accepts neither FAILED nor CANCELLED, so parking a question
    // there would throw `InvalidTransitionError` straight out of the pipeline —
    // the runner exits 1 and the issue hears nothing, which is the failure the
    // answer path has already been burned by twice.
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'COMPLETE', tokensSpent: 500, prUrl: 'https://example.test/pull/7' })

    const result = await runPipeline({ event: comment('/ask what did you change?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### Token budget spent')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })
})
