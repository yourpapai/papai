// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { applyClarifyIntent } from '../../opencode-agent/src/comment-intent.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import type { PrMergedTriggerEvent, TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import { applyArchiveTrigger, applyTrigger } from '../../opencode-agent/src/triggers.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'

/**
 * The consent half of D9.
 *
 * An untrusted author whose issue triage wanted to capture is parked behind a
 * consent comment. The capture completes when a maintainer replies
 * affirmatively — and that reply arrives as a plain comment in
 * `INIT_OR_CLARIFY`, which `applyClarifyIntent` reads. Anything the classifier
 * does not positively call chatter (`none`) re-runs triage; the re-run sees the
 * maintainer's trusted association and captures. So the contract this file
 * pins is that the consent reply is **not** skipped: it must reach triage.
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
  tokensSpent: 0,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

const commentTrigger = (body: string, association: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: association,
  issueNumber: 42,
  issueTitle: 'Add a retry helper',
  issueBody: 'Please add a retry helper.',
  isPullRequest: false,
  commentBody: body,
  commentId: 99,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

describe('applyClarifyIntent · consent completion (D9)', () => {
  it('re-runs triage for an affirmative maintainer reply — the channel that completes capture', async () => {
    // The maintainer confirmed the capture the agent asked consent for. The
    // classifier reads this as a real reply (not chatter), so the outcome must
    // hand control back to triage rather than skipping.
    const recording = stubPhaseDeps({
      replies: [JSON.stringify({ intent: 'approve' })],
      selfLogin: AGENT_LOGIN,
    })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('Yes, go ahead and capture this.', 'OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyClarifyIntent(input)

    // `halt: null` means "do not skip — run the phase handler", which is the
    // triage re-run that captures on a trusted association.
    expect(outcome.halt).toBeNull()
    expect(outcome.answer).toBe(false)
    expect(recording.io.prompts).toHaveLength(1)
    expect(String(recording.io.prompts[0]?.prompt)).toContain('Classify this comment')
  })

  it('skips chatter so a 👍 does not re-run triage', async () => {
    const recording = stubPhaseDeps({
      replies: [JSON.stringify({ intent: 'none' })],
      selfLogin: AGENT_LOGIN,
    })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('👍', 'OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyClarifyIntent(input)

    expect(outcome.halt).not.toBeNull()
    expect(outcome.halt?.status).toBe('skipped')
  })

  it('falls through to triage on a blank body (the issue-opened shape), never skipping', async () => {
    // The consent comment's sibling is the original `issues.opened` event that
    // starts every issue: a blank body must reach triage, not be classified.
    const recording = stubPhaseDeps({
      replies: [JSON.stringify({ intent: 'none' })],
      selfLogin: AGENT_LOGIN,
    })
    const input: PhaseInput = {
      state: baseState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('', 'OWNER'),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyClarifyIntent(input)

    // halt: null → triage runs. No classifier prompt was spent.
    expect(outcome.halt).toBeNull()
    expect(recording.io.prompts).toHaveLength(0)
  })
})

describe('applyArchiveTrigger · the merged-PR door (D7)', () => {
  const archiveState = (over: Partial<AgentState> = {}): AgentState => ({
    ...baseState(),
    phase: 'COMPLETE',
    changeName: 'add-retries',
    prNumber: 7,
    ...over,
  })

  const mergedPrTrigger = (): PrMergedTriggerEvent => ({
    kind: 'pr-merged',
    eventName: 'pull_request',
    prNumber: 7,
    issueNumber: 42,
    baseBranch: 'main',
    fromThisRepository: true,
    defaultBranch: 'main',
  })

  it('moves COMPLETE → ARCHIVE for a merged agent-branch pull request', () => {
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: archiveState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: mergedPrTrigger(),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = applyArchiveTrigger(input)

    expect(outcome.state.phase).toBe('ARCHIVE')
    expect(outcome.halt).toBeNull()
  })

  it('skips a merge event that arrives anywhere but COMPLETE', () => {
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: archiveState({ phase: 'PLAN_REVIEW' }),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: mergedPrTrigger(),
      command: null,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = applyArchiveTrigger(input)

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.state.phase).toBe('PLAN_REVIEW')
  })
})

describe('applyTrigger · /sync dispatch (the /ask shape)', () => {
  const syncCommand = { command: '/sync' as const, argument: '' }

  it('refuses /sync before capture through the wrong-command refusal', async () => {
    // No change captured, no branch cut: the refusal is the wrong-command one,
    // offering the commands that do apply — the same door every misplaced
    // command takes. The state is deliberately the pre-capture shape
    // (`changeName: null`); the drift-park shape one test down is the one
    // /sync now exists to reach.
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState({ phase: 'FAILED', resumeFrom: 'INIT_OR_CLARIFY' }),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('/sync', 'OWNER'),
      command: syncCommand,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyTrigger(input)

    expect(outcome.halt?.status).toBe('skipped')
    // The refusal comment itself is buffered, not posted at this layer; the
    // reason is what the skip carries and what the refusal renderer said.
    expect(outcome.halt?.reason).toContain('/sync does not apply to this issue')
    // The persisted state is untouched — a refusal moves nothing.
    expect(outcome.state.phase).toBe('FAILED')
    expect(outcome.state.resumeFrom).toBe('INIT_OR_CLARIFY')
    expect(outcome.sync).toBeFalsy()
  })

  it('dispatches /sync on the drift-parked issue — FAILED, no pull request, work on the branch', async () => {
    // Issue #323's shape exactly: the run refused on drifted manifests and
    // parked in FAILED before any pull request existed, and a /sync gated on
    // `prNumber` was a remedy the state it was prescribed for could not take.
    // The command arrives as an ordinary issue comment; the state has a
    // captured change and therefore a branch to merge base into.
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState({
        phase: 'FAILED',
        resumeFrom: 'REVIEW_AND_MUTATE',
        changeName: 'localized-release-announcements',
      }),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('/sync', 'OWNER'),
      command: syncCommand,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyTrigger(input)

    expect(outcome.halt).toBeNull()
    expect(outcome.answer).toBe(false)
    // The side-operation flag: the machine runs the sync handler, no phase.
    expect(outcome.sync).toBe(true)
    // The state the cascade is handed is the state the command arrived on.
    expect(outcome.state).toEqual(input.state)
  })

  it('dispatches /sync as a side operation whenever a pull request exists, without consulting the transition table', async () => {
    // Typed on the pull request — `commandSurface` refuses issue commands once
    // one exists — and COMPLETE is the strongest witness: the phase has no
    // transition out and /sync is still accepted there, because it moves
    // nothing. The handler itself is task 3; this layer's contract is that the
    // outcome hands the sync flag to the machine with the state unchanged.
    const prTrigger: TriggerEvent = {
      kind: 'pull-request',
      eventName: 'issue_comment',
      action: 'created',
      senderLogin: 'maintainer',
      senderType: 'User',
      authorAssociation: 'OWNER',
      prNumber: 7,
      commentBody: '/sync',
      commentId: 99,
      defaultBranch: 'main',
      issueNumber: 42,
    }
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState({ phase: 'COMPLETE', prNumber: 7, prUrl: 'https://example.test/pull/7' }),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: prTrigger,
      command: syncCommand,
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyTrigger(input)

    expect(outcome.halt).toBeNull()
    expect(outcome.answer).toBe(false)
    // The side-operation flag: the machine runs the sync handler, no phase.
    expect(outcome.sync).toBe(true)
    // The state the cascade is handed is the state the command arrived on.
    expect(outcome.state).toEqual(input.state)
  })
})

describe('applyTrigger · /fix (the red-run door, bought by a command)', () => {
  /** A `/fix` typed on the agent's pull request — the only surface that accepts it. */
  const fixOnPullRequest = (phase: 'COMPLETE' | 'PR_DELIVERY'): PhaseInput => {
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    return {
      state: baseState({
        phase,
        prNumber: 7,
        prUrl: 'https://example.test/pull/7',
        ciAttempts: 1,
      }),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: {
        kind: 'pull-request',
        eventName: 'issue_comment',
        action: 'created',
        senderLogin: 'maintainer',
        senderType: 'User',
        authorAssociation: 'OWNER',
        prNumber: 7,
        commentBody: '/fix',
        commentId: 99,
        defaultBranch: 'main',
        issueNumber: 42,
      },
      command: { command: '/fix', argument: '' },
      thread: recording.io.thread,
      deps: recording.deps,
    }
  }

  it.each(['COMPLETE', 'PR_DELIVERY'] as const)(
    '%s → CI_FIX with ciAttempts spent — the same move the red-run door makes',
    async (phase) => {
      // D4: one transition, one increment site. The command injects CI_FAILED
      // through applyCommand → moveOrSkip, and forwardTransition is the only
      // place ciAttempts moves — so a command-bought round spends the same
      // budget a red-run round would, by construction rather than by a second
      // counter kept in step.
      const outcome = await applyTrigger(fixOnPullRequest(phase))

      expect(outcome.halt).toBeNull()
      expect(outcome.state.phase).toBe('CI_FIX')
      expect(outcome.state.ciAttempts).toBe(2)
    },
  )
})

describe('applyTrigger · /fix past the CI-fix ceiling (D3)', () => {
  /** A stub whose reply buffer records the refusal notices a run buffers. */
  const withRecordingReply = (): { sections: string[]; recording: ReturnType<typeof stubPhaseDeps> } => {
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const sections: string[] = []
    recording.deps.reply = {
      begin: (): void => {},
      section: (_state, section): void => {
        sections.push(section.body)
      },
      flush: (): Promise<null> => Promise.resolve(null),
    }
    return { sections, recording }
  }

  /** `/fix` typed on the pull request of the given state. */
  const fixInput = (state: AgentState, sections: string[], recording: ReturnType<typeof stubPhaseDeps>): PhaseInput => {
    void sections
    return {
      state,
      issue: { number: 42, title: 't', body: 'b' },
      trigger: prTrigger('/fix'),
      command: { command: '/fix', argument: '' },
      thread: recording.io.thread,
      deps: recording.deps,
    }
  }

  const prTrigger = (body: string): TriggerEvent => ({
    kind: 'pull-request',
    eventName: 'issue_comment',
    action: 'created',
    senderLogin: 'maintainer',
    senderType: 'User',
    authorAssociation: 'OWNER',
    prNumber: 7,
    commentBody: body,
    commentId: 99,
    defaultBranch: 'main',
    issueNumber: 42,
  })

  // stubConfig pins maxCiAttempts at 2: this state has spent it.
  const spent = (): AgentState =>
    baseState({
      phase: 'COMPLETE',
      prNumber: 7,
      prUrl: 'https://example.test/pull/7',
      ciAttempts: 2,
      ciBudgetReported: false,
    })

  it('refuses before the signal is applied, with the persisted state byte-identical', async () => {
    const { sections, recording } = withRecordingReply()
    const before = spent()

    const outcome = await applyTrigger(fixInput(before, sections, recording))

    expect(outcome.halt?.status).toBe('failed')
    expect(outcome.halt?.reported).toBe(true)
    // Refused, not applied-then-regretted: applying CI_FAILED here would move
    // COMPLETE → CI_FIX and increment ciAttempts past the ceiling, parking the
    // issue where raising the ceiling and replying /fix could no longer reach
    // the state the maintainer is looking at.
    expect(outcome.state).toEqual(before)
    expect(outcome.state.phase).toBe('COMPLETE')
    expect(outcome.state.ciAttempts).toBe(2)
    expect(outcome.state.prNumber).toBe(7)
    expect(outcome.state.ciBudgetReported).toBe(false)
  })

  it('names the ceiling and the remedies that actually hold', async () => {
    const { sections, recording } = withRecordingReply()

    await applyTrigger(fixInput(spent(), sections, recording))

    const notice = sections.join()
    expect(notice).toContain('AGENT_MAX_CI_ATTEMPTS')
    expect(notice).toContain('2 of 2')
    // The fresh CI budget a new pull request earns — the second remedy, which
    // works without touching the workflow.
    expect(notice).toContain('new pull request')
  })

  it('posts the notice again every time the command is typed — no once-per-PR guard', async () => {
    // The automatic door's ciBudgetReported silence belongs to an event nobody
    // typed; this refusal answers a command somebody asked, so it repeats with
    // the question.
    const { sections, recording } = withRecordingReply()

    await applyTrigger(fixInput(spent(), sections, recording))
    await applyTrigger(fixInput(spent(), sections, recording))

    expect(sections.filter((body) => body.includes('AGENT_MAX_CI_ATTEMPTS'))).toHaveLength(2)
  })

  it('raising the ceiling makes the very same /fix work', async () => {
    // The spec's remedy scenario: because the refusal left the state
    // byte-identical, a bigger AGENT_MAX_CI_ATTEMPTS and the same command is
    // the whole recovery — no re-arming, no new pull request required.
    const { sections, recording } = withRecordingReply()

    const refused = await applyTrigger(fixInput(spent(), sections, recording))
    expect(refused.halt?.status).toBe('failed')

    recording.deps.config.maxCiAttempts = 5
    const accepted = await applyTrigger(fixInput(spent(), sections, recording))

    expect(accepted.halt).toBeNull()
    expect(accepted.state.phase).toBe('CI_FIX')
    expect(accepted.state.ciAttempts).toBe(3)
  })

  it('a /fix with no pull request is a wrong-command refusal, never a spent one', async () => {
    const { sections, recording } = withRecordingReply()
    const noPr = baseState({ phase: 'COMPLETE', ciAttempts: 2 })

    const outcome = await applyTrigger(fixInput(noPr, sections, recording))

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.halt?.reason).toContain('/fix does not apply to this issue')
  })

  it('a /fix in a phase that refuses CI_FAILED is a wrong-command refusal, never a spent one', async () => {
    // The exact REVIEW_REQUESTED ordering: the ceiling is asked of the
    // transition table first, so a command the phase would refuse anyway is
    // answered with what does apply — not with a budget it never reached.
    const { sections, recording } = withRecordingReply()
    const failed = baseState({
      phase: 'FAILED',
      resumeFrom: 'REVIEW_AND_MUTATE',
      prNumber: 7,
      prUrl: 'https://example.test/pull/7',
      ciAttempts: 2,
    })

    const outcome = await applyTrigger(fixInput(failed, sections, recording))

    expect(outcome.halt?.status).toBe('skipped')
    expect(outcome.halt?.reason).toContain('/fix')
  })
})

describe('applyTrigger · /cancel cleanup (D9)', () => {
  it('deletes the remote agent branch when /cancel succeeds', async () => {
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState({ phase: 'PLAN_REVIEW', changeName: 'add-x' }),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('/cancel', 'OWNER'),
      command: { command: '/cancel', argument: '' },
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyTrigger(input)

    expect(outcome.state.phase).toBe('COMPLETE')
    // The branch + its change folder are the work of a mis-capture; /cancel
    // removes them rather than leaving an orphaned agent branch behind.
    expect(recording.io.gitCalls).toContain('deleteRemoteBranch:agent/issue-42')
  })

  it('cancels cleanly when there is no branch to delete (pre-capture)', async () => {
    const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN })
    const input: PhaseInput = {
      state: baseState({ phase: 'INIT_OR_CLARIFY', changeName: null }),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: commentTrigger('/cancel', 'OWNER'),
      command: { command: '/cancel', argument: '' },
      thread: recording.io.thread,
      deps: recording.deps,
    }

    const outcome = await applyTrigger(input)

    expect(outcome.state.phase).toBe('COMPLETE')
    // No branch was ever created, so no deletion is attempted.
    expect(recording.io.gitCalls).not.toContain('deleteRemoteBranch:agent/issue-42')
  })
})
