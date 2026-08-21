// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { turnDeadlineError, turnStallError } from '../../opencode-agent/src/errors.js'
import { GitError } from '../../opencode-agent/src/git.js'
import type { OpenCodeAgent, AgentPromptRequest } from '../../opencode-agent/src/opencode-adapter.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import { mintEnvelope } from '../../opencode-agent/src/phases/envelope.js'
import { walkPlanSteps } from '../../opencode-agent/src/phases/implement-steps.js'
import { planBoxes } from '../../opencode-agent/src/plan-steps.js'
import type { ProgressSnapshot } from '../../opencode-agent/src/progress.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { TurnStall } from '../../opencode-agent/src/turn-stall.js'
import { stopPartWayThrough } from '../../opencode-agent/src/turn-stop.js'
import type { PartWayInput } from '../../opencode-agent/src/turn-stop.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * What a provider stall costs the stop machinery, beside what a deadline costs.
 *
 * Salvage is shared: a stall abort may land mid-file exactly as a deadline
 * does, and the tree is worth the same. The wrap-up ask is not, and the
 * difference is the whole point of this suite — the soft stop's second prompt
 * presumes an idle session that can still answer, and a stall abort happens
 * *because* the model cannot answer. Asking would burn the wrap-up window on a
 * prompt the provider will refuse, and delay the salvage behind it.
 *
 * The park differs too, and in the other direction: a deadline is a ceiling
 * reached in a run where nothing broke (`OUT_OF_TIME` → `INCOMPLETE`,
 * `/continue`), while a stall is the provider down — an ordinary failure whose
 * remedy is the `/retry` that waits out the wave, so after the salvage the
 * stall error is rethrown and `failRun` parks `FAILED` with the resume point
 * intact, exactly as a stall in any other phase already does.
 */

const TASKS_PATH = '/repo/openspec/changes/add-retries/tasks.md'
const TASKS_MD = ['- [ ] 1.1 Write tests', '- [ ] 1.2 Implement'].join('\n') + '\n'

const PROGRESS: ProgressSnapshot = { lastAction: 'read (running)', toolCalls: 44, tokens: 531_000, cost: 12.4 }

const STALL: TurnStall = { retries: 78, failure: { name: 'APIError', statusCode: 429 }, lastProgressAt: 0 }

const reviewState = (): AgentState => ({
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

/** An agent that records prompts and aborts, and answers prompts from a script. */
interface ScriptedAgent {
  agent: OpenCodeAgent
  prompts: AgentPromptRequest[]
  aborts: number
}

const scriptedAgent = (outcomeFor: (index: number) => Promise<string>): ScriptedAgent => {
  const prompts: AgentPromptRequest[] = []
  const state = { aborts: 0 }
  return {
    prompts,
    get aborts(): number {
      return state.aborts
    },
    agent: {
      sessionId: 's',
      prompt: (request: AgentPromptRequest): Promise<{ text: string; sessionId: string }> => {
        prompts.push(request)
        return outcomeFor(prompts.length - 1).then((text) => ({ text, sessionId: 's' }))
      },
      tokensUsed: (): Promise<number> => Promise.resolve(0),
      abort: (): Promise<boolean> => {
        state.aborts += 1
        return Promise.resolve(true)
      },
      close: (): Promise<void> => Promise.resolve(),
    },
  }
}

const stoppedInput = (agent: OpenCodeAgent): { input: PhaseInput; io: ReturnType<typeof stubPhaseDeps>['io'] } => {
  const built = stubPhaseDeps({ agent })
  built.io.readContents[TASKS_PATH] = TASKS_MD
  const input: PhaseInput = {
    state: reviewState(),
    issue: { number: 42, title: 'Add retries', body: 'b' },
    trigger: issueTrigger(),
    command: null,
    thread: built.io.thread,
    deps: built.deps,
  }
  return { input, io: built.io }
}

const CONTEXT = (input: PhaseInput, stopped: PartWayInput['stopped']): PartWayInput => ({
  input,
  branch: 'agent/issue-42',
  stopped,
  system: 'system prompt',
  step: { number: 1, total: 2, title: '1.1 Write tests' },
  committedLines: 0,
  committed: 0,
  done: 0,
})

/**
 * An outcome script that answers every prompt normally except the one at
 * `at`, which rejects — built at module level so the branch lives in the
 * helper rather than in a test body.
 */
const rejectAt = (at: number, error: Error, otherwise: string): ((index: number) => Promise<string>) => {
  const script = (index: number): Promise<string> => (index === at ? Promise.reject(error) : Promise.resolve(otherwise))
  return script
}

describe('stopPartWayThrough', () => {
  test('a deadline keeps the soft stop: abort, wrap-up ask, hard abort, salvage, park INCOMPLETE', async () => {
    const scripted = scriptedAgent((): Promise<string> => Promise.resolve('where it stopped'))
    const { input, io } = stoppedInput(scripted.agent)

    const outcome = await stopPartWayThrough(CONTEXT(input, turnDeadlineError(1_800_000, PROGRESS)))

    expect(scripted.aborts).toBe(2)
    // The wrap-up was asked, and it is the one prompt this stop makes.
    expect(scripted.prompts).toHaveLength(1)
    expect(scripted.prompts[0]?.prompt).toContain('Start nothing new')
    expect(io.gitCalls.some((call) => call.startsWith('salvage:'))).toBe(true)
    expect(outcome.signal).toBe('OUT_OF_TIME')
  })

  test('a stall skips the soft ask and goes straight to the hard abort and the salvage', async () => {
    const scripted = scriptedAgent((): Promise<string> => Promise.resolve('never asked'))
    const { input, io } = stoppedInput(scripted.agent)
    const stall = turnStallError(300_000, STALL, PROGRESS)

    const stopped = stopPartWayThrough(CONTEXT(input, stall))

    // No wrap-up prompt, ever: the premise of a second prompt is an idle
    // session that can answer, and a stall abort happens because it cannot.
    //
    // Rethrown rather than returned as an outcome, and this is the park
    // decision: `failRun` turns it into the same park a stall in any other
    // phase already is — FAILED with `resumeFrom` intact, the stall text as
    // `lastError`, `/retry` the remedy — where an `OUT_OF_TIME` outcome would
    // park `INCOMPLETE` and invite the `/continue` that resumes an implement
    // phase on a wave that has not passed.
    await expect(stopped).rejects.toBe(stall)
    expect(scripted.prompts).toHaveLength(0)
    // One abort — the hard stop — and it is the one the salvage fence reads.
    expect(scripted.aborts).toBe(1)
    expect(io.gitCalls.some((call) => call.startsWith('salvage:'))).toBe(true)
  })
})

describe('the implement-phase branch sites accept a stall beside a deadline', () => {
  const makeWalk = (
    agent: OpenCodeAgent,
  ): { run: () => ReturnType<typeof walkPlanSteps>; io: ReturnType<typeof stubPhaseDeps>['io'] } => {
    const built = stubPhaseDeps({ agent })
    built.io.readContents[TASKS_PATH] = TASKS_MD
    const steps = planBoxes(TASKS_MD)
    const input: PhaseInput = {
      state: reviewState(),
      issue: { number: 42, title: 'Add retries', body: 'b' },
      trigger: issueTrigger(),
      command: null,
      thread: built.io.thread,
      deps: built.deps,
    }
    return {
      io: built.io,
      run: () =>
        walkPlanSteps({
          input,
          branch: 'agent/issue-42',
          plan: TASKS_MD,
          steps,
          from: 0,
          envelope: mintEnvelope(),
          system: 'system prompt',
          handoff: null,
          tasksPath: TASKS_PATH,
        }),
    }
  }

  test("a step's own turn rejecting with a stall interrupts the walk rather than throwing", async () => {
    const scripted = scriptedAgent(rejectAt(0, turnStallError(300_000, STALL, PROGRESS), 'done'))
    const { run, io } = makeWalk(scripted.agent)

    const walk = await run()

    expect(walk.kind).toBe('interrupted')
    expect(walk.stopped?.code).toBe('TURN_STALL')
    // Nothing was committed: the interrupted step leaves by the stop door, and
    // the salvage (driven by the handler above this walk) is what commits.
    expect(io.gitCalls.filter((call) => call.startsWith('commit:'))).toHaveLength(0)
  })

  test('a repair turn rejecting with a stall interrupts the walk the same way', async () => {
    // The commit is refused by the repository's own hook, the repair turn is
    // what the provider then stalls on — and a stall there must leave by the
    // same door a stopped step leaves by, or a run whose tree was worth
    // salvaging would fail as though the work had broken. The step's own turn
    // (prompt 0) succeeds; the repair turn (prompt 1) stalls.
    const scripted = scriptedAgent(rejectAt(1, turnStallError(300_000, STALL, PROGRESS), 'did the step'))
    const built = stubPhaseDeps({ agent: scripted.agent })
    built.io.readContents[TASKS_PATH] = TASKS_MD
    built.deps.git.commitAll = (message: string): Promise<never> => {
      built.io.gitCalls.push(`commit:${message.split('\n')[0]}`)
      return Promise.reject(new GitError({ command: 'git commit', stdout: '', stderr: 'lint failed', exitCode: 1 }))
    }
    const steps = planBoxes(TASKS_MD)
    const input: PhaseInput = {
      state: reviewState(),
      issue: { number: 42, title: 'Add retries', body: 'b' },
      trigger: issueTrigger(),
      command: null,
      thread: built.io.thread,
      deps: built.deps,
    }

    const walk = await walkPlanSteps({
      input,
      branch: 'agent/issue-42',
      plan: TASKS_MD,
      steps,
      from: 0,
      envelope: mintEnvelope(),
      system: 'system prompt',
      handoff: null,
      tasksPath: TASKS_PATH,
    })

    expect(walk.kind).toBe('interrupted')
    expect(walk.stopped?.code).toBe('TURN_STALL')
    expect(scripted.prompts).toHaveLength(2)
  })
})
