// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { commitAll } from '../../opencode-agent/src/git-commit.js'
import type { GitFn } from '../../opencode-agent/src/git-commit.js'
import type { GitOptions } from '../../opencode-agent/src/git.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import { handleTriage } from '../../opencode-agent/src/phases/triage.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import { TOKEN_SCALE } from '../../opencode-agent/src/types.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { silentLogger, stubPhaseDeps } from './test-helpers.js'

/**
 * Design D2 — branch from first spec.
 *
 * The branch `agent/issue-<n>` is created the moment triage converges on a
 * capture, and the scaffolded `openspec/changes/<name>/` folder is commit #1 —
 * pushed immediately, so planning artefacts are durable across Actions jobs
 * without travelling in hidden blocks. These tests drive the triage handler
 * through `PhaseDeps` and assert the git calls happen in the right order with
 * the right branch, on a trusted auto-capture.
 */

const AGENT_LOGIN = 'agent-bot'

const baseState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'INIT_OR_CLARIFY',
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 0,
  changeName: null,
  planRevision: 0,
  tokenScale: TOKEN_SCALE,
  tokensSpent: 0,
  usdSpent: 0,
  usdUnpriced: false,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

const issueTrigger = (association: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'someone',
  senderType: 'User',
  authorAssociation: association,
  issueNumber: 42,
  issueTitle: 'Add a retry helper',
  issueBody: 'Please add a retry helper.',
  isPullRequest: false,
  commentBody: null,
  commentId: null,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

const captureReply = JSON.stringify({
  status: 'capture',
  changeName: 'add-retry-helper',
  spec: '# Goal\n\nAdd retries.',
  skipSpecs: false,
})

describe('handleTriage · capture · branch-from-first-spec (D2)', () => {
  it('creates agent/issue-<n>, commits the scaffold as #1, and pushes — in that order', async () => {
    const recording = stubPhaseDeps({ replies: [captureReply], selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 'Add a retry helper', body: 'Please add a retry helper.' },
      trigger: issueTrigger('OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    // The scaffold is durable: reset-to-base → commit → push, in that order, on
    // the agent's own branch off the configured base. `resetBranchToBase` (D12)
    // rather than `ensureBranch`: a restarted issue's branch may carry partial
    // legacy work, and the new capture starts from zero.
    expect(recording.io.gitCalls).toEqual([
      'resetBranchToBase:agent/issue-42:main',
      'commit:chore(openspec): scaffold add-retry-helper',
      'push:agent/issue-42',
    ])
  })

  it('does not branch, commit or push when capture awaits consent (untrusted author)', async () => {
    const recording = stubPhaseDeps({ replies: [captureReply], selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: issueTrigger('NONE'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('NEEDS_CLARIFICATION')
    expect(recording.io.gitCalls).toEqual([])
  })
})

const ok = (stdout: string): CommandResult => ({ command: 'git', exitCode: 0, stdout, stderr: '' })

const COMMIT_MESSAGE = 'chore(openspec): scaffold add-retry-helper'

const options: GitOptions = {
  run: (): Promise<CommandResult> => Promise.resolve(ok('')),
  cwd: '/repo',
  authorName: 'agent',
  authorEmail: 'agent@example.com',
  limits: { maxFiles: 100, maxLines: 20_000 },
  secrets: [],
  log: silentLogger(),
  credential: null,
}

const scriptedGit = (status: string, numstat: string): { calls: string[][]; git: GitFn } => {
  const calls: string[][] = []
  const git: GitFn = (...argv: readonly string[]): Promise<CommandResult> => {
    calls.push([...argv])
    const [sub, ...rest] = argv
    if (sub === 'status') return Promise.resolve(ok(status))
    if (sub === 'add') return Promise.resolve(ok(''))
    if (sub === 'diff' && rest.includes('--numstat')) return Promise.resolve(ok(numstat))
    if (sub === 'diff') return Promise.resolve(ok(''))
    if (sub === 'commit') return Promise.resolve(ok(''))
    return Promise.reject(new Error(`unexpected git call: ${argv.join(' ')}`))
  }
  return { calls, git }
}

describe('commitAll · the direct commit path this file is named after', () => {
  it('answers clean on an empty tree, asking git only the status probe', async () => {
    const { calls, git } = scriptedGit('', '')

    const outcome = await commitAll(git, options, COMMIT_MESSAGE)

    expect(outcome).toEqual({ kind: 'clean' })
    expect(calls.map((argv) => argv.join(' '))).toEqual(['status --porcelain'])
  })

  it('stages, guards and commits as one: message carried, identity riding the environment', async () => {
    const { calls, git } = scriptedGit(' M src/a.ts\n', '3\t1\tsrc/a.ts')

    const outcome = await commitAll(git, options, COMMIT_MESSAGE)

    expect(outcome).toEqual({ kind: 'committed', totals: { files: 1, lines: 4 }, dropped: [] })
    expect(calls.map((argv) => argv.join(' '))).toEqual([
      'status --porcelain',
      'add --all',
      'diff --cached --numstat',
      'diff --cached',
      'commit -m chore(openspec): scaffold add-retry-helper',
    ])
  })
})
