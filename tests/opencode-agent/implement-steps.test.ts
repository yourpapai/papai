// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import { mintEnvelope } from '../../opencode-agent/src/phases/envelope.js'
import { walkPlanSteps } from '../../opencode-agent/src/phases/implement-steps.js'
import { checkBoxText, planBoxes } from '../../opencode-agent/src/plan-steps.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * Design D5 — `REVIEW_AND_MUTATE` walks `tasks.md` checkboxes.
 *
 * Each step is one model turn; the step's commit checks its box (`- [ ]` →
 * `- [x]`) in the **same** commit as the work. The cursor (`state.stepsDone`)
 * counts into the unchecked list, and a cursor past the end walks from the top.
 */

const TASKS_PATH = '/repo/openspec/changes/add-retries/tasks.md'
const AGENT_LOGIN = 'agent-bot'

const reviewState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'REVIEW_AND_MUTATE',
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  ciBlockedPaths: [],
  changedLines: 0,
  stepsDone: 0,
  changeName: 'add-retries',
  planRevision: 1,
  tokensSpent: 0,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

const issueTrigger = (): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'someone',
  senderType: 'User',
  authorAssociation: 'OWNER',
  issueNumber: 42,
  issueTitle: 'Add retries',
  issueBody: 'b',
  isPullRequest: false,
  commentBody: null,
  commentId: null,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

const TASKS_MD = ['- [ ] 1.1 Write tests', '- [ ] 1.2 Implement', '- [x] 1.0 scaffold (done)'].join('\n') + '\n'

const makeWalk = (
  replies: string[],
  from: number,
): { run: () => ReturnType<typeof walkPlanSteps>; io: ReturnType<typeof stubPhaseDeps>['io'] } => {
  const built = stubPhaseDeps({ replies, selfLogin: AGENT_LOGIN })
  built.io.readContents[TASKS_PATH] = TASKS_MD
  const steps = planBoxes(TASKS_MD)
  const input: PhaseInput = {
    state: reviewState({ stepsDone: from }),
    issue: { number: 42, title: 'Add retries', body: 'b' },
    trigger: issueTrigger(),
    command: null,
    thread: built.io.thread,
    deps: built.deps,
  }
  const envelope = mintEnvelope()
  return {
    io: built.io,
    run: () =>
      walkPlanSteps({
        input,
        branch: 'agent/issue-42',
        plan: TASKS_MD,
        steps,
        from,
        envelope,
        system: 'system prompt',
        handoff: null,
        note: null,
        tasksPath: TASKS_PATH,
      }),
  }
}

describe('walkPlanSteps · tasks.md checkboxes (D5)', () => {
  it('walks each unchecked box: one turn, checks the box, commits, pushes — per step', async () => {
    const { run, io } = makeWalk(['did tests', 'did impl'], 0)

    const walk = await run()

    expect(walk.kind).toBe('finished')
    // Two model turns, two commits, two pushes (the checked box is skipped).
    expect(io.prompts).toHaveLength(2)
    expect(io.gitCalls.filter((c) => c.startsWith('commit:'))).toHaveLength(2)
    expect(io.gitCalls.filter((c) => c.startsWith('push:'))).toHaveLength(2)
    // The box-check: the last tasks.md write has both walked boxes ticked.
    const lastTasksWrite = [...io.writes].reverse().find((w) => w.path === TASKS_PATH)
    expect(lastTasksWrite?.content).toContain('- [x] 1.1 Write tests')
    expect(lastTasksWrite?.content).toContain('- [x] 1.2 Implement')
  })

  it('checks exactly one box per step — the first write ticks only the first box', async () => {
    const { run, io } = makeWalk(['did tests', 'did impl'], 0)

    await run()

    const firstWrite = io.writes.find((w) => w.path === TASKS_PATH)
    expect(firstWrite?.content).toContain('- [x] 1.1 Write tests')
    expect(firstWrite?.content).toContain('- [ ] 1.2 Implement')
  })

  it('resumes from the cursor — a run starting at step 2 walks only the remaining box', async () => {
    const { run, io } = makeWalk(['did impl'], 1)

    const walk = await run()

    expect(walk.kind).toBe('finished')
    // Only one box was worked this run: the second real step. The pre-checked
    // 'scaffold' box is skipped without a turn, and the cursor (from = 1) started
    // the walk at the second box rather than re-walking the first.
    expect(io.prompts).toHaveLength(1)
    expect(walk.commits).toBe(1)
  })

  it('the box-check uses checkBoxText (indented sub-items keep their indentation)', () => {
    expect(checkBoxText('  - [ ] sub-task')).toBe('  - [x] sub-task')
    expect(checkBoxText('- [ ] top')).toBe('- [x] top')
  })
})
