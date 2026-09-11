// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { CheckSpec } from '../../opencode-agent/src/check-loop.js'
import type { Applied } from '../../opencode-agent/src/follow-up-prompts.js'
import type { MachineInput } from '../../opencode-agent/src/phase-context.js'
import { applyAndPush } from '../../opencode-agent/src/phases/follow-up-commit.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The pipeline's git half of a small verdict, in its own right.
 *
 * `follow-up.test.ts` drives the happy path end to end; this file pins the
 * branches the handler's own tests only reach through the whole run — the
 * checks-red verdict (nothing pushed, branch as found), the workflows-permission
 * push refusal (the update-branch remedy), and the blocked commit (the drop
 * report with the by-hand remedy) — with the ordering guarantee the module
 * exists to keep: reconcile before push, and no push at all when anything
 * before it fails.
 */

const AGENT_LOGIN = 'agent-bot'

const state = (over: Partial<AgentState> = {}): AgentState => ({
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
  tokensSpent: 0,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: 'https://example.test/pull/7',
  prNumber: 7,
  ...over,
})

interface CommitFixture {
  input: MachineInput
  io: ReturnType<typeof stubPhaseDeps>['io']
  checks: CheckSpec[]
  sections: { body: string; blocks: readonly string[] }[]
}

const APPLIED: Applied = {
  summary: 'Tightened the retry backoff.',
  files: ['src/http/retry.ts'],
  testCommands: ['bun test tests/http/retry.test.ts'],
}

const fixture = (
  over: {
    checkExitCode?: number
    failCheck?: string
    pushError?: Error
    commitOutcome?: 'committed' | 'blocked' | 'clean'
    dropped?: readonly string[]
  } = {},
): CommitFixture => {
  const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
  recording.deps.config.checkCommand = 'bun check:full'

  const checks: CheckSpec[] = []
  recording.deps.runCheck = (check: CheckSpec): Promise<CommandResult> => {
    checks.push(check)
    const failed = over.failCheck !== undefined && check.name === over.failCheck
    return Promise.resolve({
      command: check.argv.join(' '),
      stdout: '',
      stderr: failed ? '1 failure' : '',
      exitCode: failed ? (over.checkExitCode ?? 1) : 0,
    })
  }

  recording.deps.git.commitAll = (
    message: string,
  ): Promise<import('../../opencode-agent/src/git-commit.js').CommitOutcome> => {
    recording.io.gitCalls.push(`commit:${message.split('\n')[0]}`)
    const kind = over.commitOutcome ?? 'committed'
    return Promise.resolve({
      kind,
      totals: { files: 1, lines: 4 },
      // Dropped paths come only from what the test seeds: the blocked test
      // seeds its own, so the clean path proves the drop line's absence rather
      // than inheriting one.
      dropped: [...(over.dropped ?? [])],
    })
  }
  recording.deps.git.push = (branch: string): Promise<void> => {
    recording.io.gitCalls.push(`push:${branch}`)
    if (over.pushError !== undefined) return Promise.reject(over.pushError)
    return Promise.resolve()
  }

  const sections: { body: string; blocks: readonly string[] }[] = []
  recording.deps.reply = {
    begin: (): void => {},
    section: (_state, section): void => {
      sections.push({ body: section.body, blocks: section.blocks })
    },
    flush: (): Promise<null> => Promise.resolve(null),
  }

  const input: MachineInput = {
    state: state(),
    issue: { number: 42, title: 't', body: 'b' },
    trigger: {
      kind: 'pull-request',
      eventName: 'issue_comment',
      action: 'created',
      senderLogin: 'maintainer',
      senderType: 'User',
      authorAssociation: 'OWNER',
      prNumber: 7,
      commentBody: '/follow-up tighten the backoff',
      commentId: 99,
      defaultBranch: 'main',
      issueNumber: 42,
    },
    command: { command: '/follow-up', argument: 'tighten the backoff' },
    thread: recording.io.thread,
    deps: recording.deps,
    answer: false,
    posted: false,
    carriedTokens: 0,
    carriedUsd: 0,
    carriedUnpriced: false,
    followUp: true,
  }

  return {
    input,
    io: recording.io,
    checks,
    sections,
  }
}

describe('applyAndPush · the checks', () => {
  it('runs the model-named commands plus AGENT_CHECK_COMMAND, then reconcile before push', async () => {
    const fx = fixture()

    const end = await applyAndPush(
      fx.input,
      'agent/issue-42',
      'A one-line change.',
      APPLIED,
      { nonce: 'n', wrap: (l, b) => `[${l}] ${b}` },
      await fx.input.deps.agent(),
    )

    expect(end.status).toBe('completed')
    expect(end.reason).toContain('Applied the follow-up on agent/issue-42')
    const ran = fx.checks.map((check) => check.argv.join(' '))
    expect(ran).toContain('bun test tests/http/retry.test.ts')
    expect(ran).toContain('bun check:full')
    const reconcileAt = fx.io.gitCalls.indexOf('reconcile:agent/issue-42')
    const pushAt = fx.io.gitCalls.indexOf('push:agent/issue-42')
    expect(reconcileAt).toBeGreaterThanOrEqual(0)
    expect(pushAt).toBeGreaterThan(reconcileAt)
  })
})

describe('applyAndPush · the refusals', () => {
  it('pushes nothing when a check is red, and names what ran', async () => {
    const fx = fixture({ failCheck: 'bun check:full', checkExitCode: 1 })

    const end = await applyAndPush(
      fx.input,
      'agent/issue-42',
      'A one-line change.',
      APPLIED,
      { nonce: 'n', wrap: (l, b) => `[${l}] ${b}` },
      await fx.input.deps.agent(),
    )

    expect(end.status).toBe('failed')
    expect(end.reason).toContain('The follow-up failed its checks')
    expect(fx.io.gitCalls.filter((call) => /^(commit|push):/u.test(call))).toEqual([])
    // The comment rides the end; posting it is `finish`'s write (follow-up.ts).
    expect(end.comment).toContain('bun check:full')
    expect(end.comment).toContain('nothing was pushed')
  })

  it('translates a workflows-permission push refusal into the by-hand remedy', async () => {
    const fx = fixture({
      pushError: new Error(
        'git failed (1): git push origin agent/issue-42\n' +
          'remote: ERROR: refusing to allow a GitHub App to create or update workflow ' +
          '`.github/workflows/ci.yml` without `workflows` scope.',
      ),
    })

    const end = await applyAndPush(
      fx.input,
      'agent/issue-42',
      'A one-line change.',
      APPLIED,
      { nonce: 'n', wrap: (l, b) => `[${l}] ${b}` },
      await fx.input.deps.agent(),
    )

    expect(end.status).toBe('failed')
    expect(end.comment).toContain('Update branch')
    // The commit was made — only the push was refused.
    expect(fx.io.gitCalls.some((call) => call.startsWith('commit:'))).toBe(true)
  })

  it('reports a blocked commit through the drop report instead of pushing', async () => {
    const fx = fixture({ commitOutcome: 'blocked', dropped: ['.github/workflows/ci.yml'] })

    const end = await applyAndPush(
      fx.input,
      'agent/issue-42',
      'A one-line change.',
      APPLIED,
      { nonce: 'n', wrap: (l, b) => `[${l}] ${b}` },
      await fx.input.deps.agent(),
    )

    expect(end.status).toBe('completed')
    expect(fx.io.gitCalls.filter((call) => call.startsWith('push:'))).toEqual([])
    expect(end.comment).toContain('`.github/workflows/ci.yml`')
    expect(end.comment).toContain('by hand')
    // The blocked path still names what the apply turn edited — the drop is
    // the workflow file's alone, and the rest of the work is on the record.
    expect(end.comment).toContain('src/http/retry.ts')
    expect(end.comment).toContain('nothing to push')
  })

  it('reports a clean tree — the apply turn changed nothing — without pushing', async () => {
    const fx = fixture({ commitOutcome: 'clean' })

    const end = await applyAndPush(
      fx.input,
      'agent/issue-42',
      'A one-line change.',
      APPLIED,
      { nonce: 'n', wrap: (l, b) => `[${l}] ${b}` },
      await fx.input.deps.agent(),
    )

    expect(end.status).toBe('completed')
    expect(fx.io.gitCalls.filter((call) => call.startsWith('push:'))).toEqual([])
    expect(end.comment).toContain('No files changed.')
    expect(end.comment).toContain('nothing to push')
    // A clean tree drops nothing, so the by-hand remedy must not appear: the
    // drop line's absence is the fact a maintainer acts on.
    expect(end.comment).not.toContain('by hand')
  })

  it('rethrows a push refusal that is not the workflows-permission sentence', async () => {
    // The translation is matched on GitHub's own sentence, and only that one:
    // any other push error is an ordinary broken run, and swallowing it here
    // would report a remedy for a failure it does not describe.
    const fx = fixture({ pushError: new Error('git failed (1): remote hung up unexpectedly') })

    await expect(
      applyAndPush(
        fx.input,
        'agent/issue-42',
        'A one-line change.',
        APPLIED,
        { nonce: 'n', wrap: (l, b) => `[${l}] ${b}` },
        await fx.input.deps.agent(),
      ),
    ).rejects.toThrow('remote hung up unexpectedly')
  })
})
