// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import type { CheckSpec } from '../../opencode-agent/src/check-loop.js'
import type { MachineInput } from '../../opencode-agent/src/phase-context.js'
import { runFollowUp } from '../../opencode-agent/src/phases/follow-up.js'
import type { ReportSection } from '../../opencode-agent/src/reply-comment.js'
import type { ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'
import { serializeState } from '../../opencode-agent/src/state-manager.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'
import type { StubIo } from './test-helpers.js'

/**
 * The `/follow-up` handler (issue #441) — the `/sync` shape with teeth.
 *
 * The dispatch (side-operations.ts) has already decided this command applies:
 * delivery reached, pull request named, argument present. What the handler
 * owns is the size gate **before any write** — one `plan`-profile assessment
 * turn whose zod verdict `{size, reason}` is stated in the reply on both
 * paths — and the two outcomes it can reach:
 *
 *  - **too-big**: zero commits, zero pushes, the branch left exactly as it
 *    was found, and a decline that carries the reason plus a ready-to-paste
 *    issue draft referencing the pull request.
 *  - **small**: the apply turn, the pipeline's own checks (the model-named
 *    commands plus `AGENT_CHECK_COMMAND`) judged by exit status, a follow-up
 *    commit under commit-repair, the reconcile-merge **before** the push
 *    (merge, never rebase/force — the branch is shared with humans), and a
 *    reply naming files, checks and the pushed sha.
 *
 * The non-moving contract rides every outcome: phase, `attempts`, `resumeFrom`
 * and every per-PR budget byte-identical, the review loop never entered, the
 * spend the turns paid rewritten in place, and the reply a plain comment
 * carrying no state block.
 */

const AGENT_LOGIN = 'agent-bot'
const PR_URL = 'https://example.test/pull/7'

const baseState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'COMPLETE',
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 0,
  changeName: 'add-retry-backoff',
  planRevision: 1,
  tokenScale: TOKEN_SCALE,
  tokensSpent: 1_000,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: PR_URL,
  prNumber: 7,
  ...over,
})

const ASSESSMENT_SMALL = '{"size":"small","reason":"A one-line constant change in a file the change already touched."}'
const ASSESSMENT_TOO_BIG = '{"size":"too-big","reason":"This asks for a new capability, not a tweak."}'
const APPLY_REPLY =
  '{"summary":"Tightened the retry backoff.","files":["src/http/retry.ts"],"testCommands":["bun test tests/http/retry.test.ts"]}'

interface FollowUpFixture {
  input: MachineInput
  io: StubIo
  sections: ReportSection[]
  seedState: string
  /** CheckSpecs the pipeline asked the runner to run, in order. */
  checks: CheckSpec[]
  /** How many times the review loop was entered — always zero. */
  reviews: number
}

/** The machine input a dispatched `/follow-up` produces, over a delivered state. */
const followUpFixture = (
  over: {
    state?: Partial<AgentState>
    /** The model's replies in order: the assessment verdict, then the apply reply. */
    replies?: readonly string[]
    /** What this job's session spent, on top of the carried total. */
    tokensUsed?: number
    /** The exit code every fake check answers with. */
    checkExitCode?: number
    /** Paths the fake `commitAll` reports as dropped protected paths. */
    dropped?: readonly string[]
    argument?: string
  } = {},
): FollowUpFixture => {
  const state = baseState(over.state)
  const seedState = serializeState(state)
  const thread: IssueComment[] = [{ id: 55, body: seedState, authorLogin: AGENT_LOGIN }]

  const recording = stubPhaseDeps({
    selfLogin: AGENT_LOGIN,
    thread,
    replies: [...(over.replies ?? [ASSESSMENT_SMALL, APPLY_REPLY])],
  })
  recording.deps.tokensUsed = (): Promise<number> => Promise.resolve(over.tokensUsed ?? 0)
  // The production default of `AGENT_CHECK_COMMAND`, set explicitly: the stub's
  // `bun test` would make "the model-named command plus the repo's check
  // command" indistinguishable from one command being run twice.
  recording.deps.config.checkCommand = 'bun check:full'

  const sections: ReportSection[] = []
  recording.deps.reply = {
    begin: (): void => {},
    section: (_state, section): void => {
      sections.push(section)
    },
    flush: (): Promise<null> => Promise.resolve(null),
  }

  const checks: CheckSpec[] = []
  recording.deps.runCheck = (check: CheckSpec): Promise<CommandResult> => {
    checks.push(check)
    return Promise.resolve({ command: check.argv.join(' '), stdout: '', stderr: '', exitCode: over.checkExitCode ?? 0 })
  }

  let reviews = 0
  const runReview = (): Promise<ReviewRunResult> => {
    reviews += 1
    return Promise.resolve({ outcome: 'passed', summary: '', exitCode: 0, failure: null })
  }
  recording.deps.runReview = runReview

  const base = recording.deps.git
  recording.deps.git = {
    ...base,
    // Recorded with the drift-lift marker exactly as the sync fixture does, so
    // the standard-guard expectation ("no :allowDrift") is pinned, not assumed.
    ensureBranch: (branch: string, main: string, options?: { allowDependencyDrift?: boolean }): Promise<void> => {
      recording.io.gitCalls.push(
        `ensureBranch:${branch}:${main}${options?.allowDependencyDrift === true ? ':allowDrift' : ''}`,
      )
      return Promise.resolve()
    },
    commitAll: (message: string): Promise<import('../../opencode-agent/src/git-commit.js').CommitOutcome> => {
      recording.io.gitCalls.push(`commit:${message.split('\n')[0]}`)
      return Promise.resolve({
        kind: 'committed',
        totals: { files: 1, lines: 4 },
        dropped: [...(over.dropped ?? [])],
      })
    },
    diffSince: (sha: string, paths: readonly string[]): Promise<string> => {
      recording.io.gitCalls.push(`diffSince:${sha}:${paths.join(',')}`)
      return Promise.resolve(' src/http/retry.ts | 2 +-')
    },
  }

  return {
    input: {
      state,
      issue: { number: 42, title: 't', body: 'b' },
      trigger: {
        kind: 'pull-request',
        eventName: 'issue_comment',
        action: 'created',
        senderLogin: 'maintainer',
        senderType: 'User',
        authorAssociation: 'OWNER',
        prNumber: 7,
        commentBody: '/follow-up tighten the retry backoff',
        commentId: 99,
        defaultBranch: 'main',
        issueNumber: 42,
      },
      command: { command: '/follow-up', argument: over.argument ?? 'tighten the retry backoff' },
      thread: recording.io.thread,
      deps: recording.deps,
      answer: false,
      posted: false,
      carriedTokens: state.tokensSpent,
      carriedUsd: 0,
      carriedUnpriced: false,
      followUp: true,
    },
    io: recording.io,
    sections,
    seedState,
    checks,
    reviews: 0,
  }
}

const writes = (io: StubIo): string[] =>
  io.gitCalls.filter(
    (call) =>
      call.startsWith('commit:') ||
      call.startsWith('push:') ||
      call.startsWith('completeMerge:') ||
      call.startsWith('revertPaths:'),
  )

describe('runFollowUp · the size gate', () => {
  it('assesses first, on the read-only plan profile, over the enveloped request', async () => {
    const fixture = followUpFixture()

    const result = await runFollowUp(fixture.input)

    expect(result.status).toBe('completed')
    // One assessment turn before anything else the model is asked, on the
    // read-only profile: the verdict must not be able to edit.
    expect(fixture.io.prompts).toHaveLength(2)
    expect(fixture.io.prompts[0]?.agent).toBe('plan')
    const assessmentPrompt = String(fixture.io.prompts[0]?.prompt)
    // The maintainer's request rides the assessment, enveloped.
    expect(assessmentPrompt).toContain('tighten the retry backoff')
    // The context the size judgment reads: the change folder and the branch's diff.
    expect(assessmentPrompt).toContain('add-retry-backoff')
    expect(assessmentPrompt).toContain('src/http/retry.ts')
  })

  it('stops a too-big verdict before any write: zero commits, zero pushes, branch as found', async () => {
    const fixture = followUpFixture({
      replies: [ASSESSMENT_TOO_BIG, APPLY_REPLY],
      tokensUsed: 1_000,
    })

    const result = await runFollowUp(fixture.input)

    // A deliberate outcome, not a failure: nothing broke, the gate worked.
    expect(result.status).toBe('completed')
    // The apply turn never started — the gate answered first.
    expect(fixture.io.prompts).toHaveLength(1)
    // Zero writes: no commit, no push, no merge, no revert.
    expect(writes(fixture.io)).toEqual([])
    expect(fixture.io.gitCalls.filter((call) => call.startsWith('reconcile:'))).toEqual([])
  })

  it('declines a too-big request with the reason and a ready-to-paste issue draft referencing the PR', async () => {
    const fixture = followUpFixture({ replies: [ASSESSMENT_TOO_BIG, APPLY_REPLY] })

    await runFollowUp(fixture.input)

    const body = String(fixture.sections.at(-1)?.body)
    // The verdict's reason is stated, not buried.
    expect(body).toContain('This asks for a new capability, not a tweak.')
    // A ready-to-paste draft: a title and a description that reference the PR.
    expect(body).toContain('Title')
    expect(body).toContain(PR_URL)
  })

  it('states the verdict and reason on the applied path too', async () => {
    const fixture = followUpFixture()

    await runFollowUp(fixture.input)

    const body = String(fixture.sections.at(-1)?.body)
    expect(body).toContain('small')
    expect(body).toContain('A one-line constant change in a file the change already touched.')
  })
})

describe('runFollowUp · the applied path', () => {
  it('re-runs the model-named commands plus AGENT_CHECK_COMMAND and judges by exit status', async () => {
    const fixture = followUpFixture()

    await runFollowUp(fixture.input)

    const ran = fixture.checks.map((check) => check.argv.join(' '))
    // The commands the apply turn said it ran, re-run by the pipeline —
    // trusting the model's green is exactly what run 31779566286 punished.
    expect(ran).toContain('bun test tests/http/retry.test.ts')
    // Plus the repository's own check command.
    expect(ran).toContain('bun check:full')
  })

  it('commits on the agent branch and reconciles with the remote before pushing, never rebasing', async () => {
    const fixture = followUpFixture()

    const result = await runFollowUp(fixture.input)

    expect(result.status).toBe('completed')
    expect(fixture.io.gitCalls.filter((call) => call.startsWith('commit:')).length).toBeGreaterThanOrEqual(1)
    const reconcileAt = fixture.io.gitCalls.indexOf('reconcile:agent/issue-42')
    const pushAt = fixture.io.gitCalls.indexOf('push:agent/issue-42')
    // Merge, never rebase/force: the reconcile-merge runs, and it runs before
    // the push — the branch is shared with humans.
    expect(reconcileAt).toBeGreaterThanOrEqual(0)
    expect(pushAt).toBeGreaterThan(reconcileAt)
  })

  it('names the files, the checks and the pushed sha in the reply', async () => {
    const fixture = followUpFixture()

    await runFollowUp(fixture.input)

    const body = String(fixture.sections.at(-1)?.body)
    expect(body).toContain('src/http/retry.ts')
    expect(body).toContain('bun test tests/http/retry.test.ts')
    expect(body).toContain('head-sha')
  })

  it('reports a protected-path drop instead of letting it pass silently', async () => {
    const fixture = followUpFixture({ dropped: ['.github/workflows/ci.yml'] })

    const result = await runFollowUp(fixture.input)

    expect(result.status).toBe('completed')
    const body = String(fixture.sections.at(-1)?.body)
    expect(body).toContain('.github/workflows/ci.yml')
    // The remedy is a maintainer's hand — the agent cannot push it, and /retry
    // cannot reach it.
    expect(body).toContain('by hand')
  })

  it('never enters the review loop and leaves every per-PR budget untouched', async () => {
    const fixture = followUpFixture({ state: { reviewAttempts: 1, ciAttempts: 1 } })

    const result = await runFollowUp(fixture.input)

    expect(fixture.reviews).toBe(0)
    // Byte-identical budgets: a follow-up is not a review round and not a CI
    // round, and nothing may reset the ceilings a delivered pull request owns.
    expect(result.state).toMatchObject({
      reviewAttempts: 1,
      ciAttempts: 1,
      attempts: 0,
      phase: 'COMPLETE',
      resumeFrom: null,
    })
  })
})

describe('runFollowUp · the non-moving contract', () => {
  it('rewrites the spend in place and posts a plain comment carrying no state block', async () => {
    const fixture = followUpFixture({ tokensUsed: 1_000 })

    const result = await runFollowUp(fixture.input)

    // The reply is postAnswer's write: no block appended, ever.
    expect(fixture.sections.at(-1)?.blocks).toEqual([])
    // The spend the turns paid is the one thing that changed: the newest state
    // block was rewritten in place — phase and budgets intact.
    const edit = fixture.io.edits.at(-1)
    expect(edit?.body).toContain('"tokensSpent": 2000')
    expect(edit?.body).toContain('"phase": "COMPLETE"')
    expect(edit?.body).toContain('"reviewAttempts": 0')
    expect(result.state?.tokensSpent).toBe(2_000)
  })
})
