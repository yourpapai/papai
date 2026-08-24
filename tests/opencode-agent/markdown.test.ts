// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  renderAnswerOverBudget,
  renderCiExhausted,
  renderExhausted,
  renderFixExhausted,
  renderOverBudget,
  renderReviewsExhausted,
} from '../../opencode-agent/src/budget-notices.js'
import { formatFailures } from '../../opencode-agent/src/check-loop.js'
import { acceptedCommands, SLASH_COMMANDS } from '../../opencode-agent/src/commands.js'
import { modelResponseError } from '../../opencode-agent/src/errors.js'
import { fence } from '../../opencode-agent/src/markdown.js'
import { OUTCOME_GLYPHS } from '../../opencode-agent/src/outcomes.js'
import type { OutcomeKey } from '../../opencode-agent/src/outcomes.js'
import { PRESENTATION, presentationFor } from '../../opencode-agent/src/presentation.js'
import {
  renderAnswerFailure,
  renderClosing,
  renderFailure,
  renderRefusedCommand,
  renderSettled,
} from '../../opencode-agent/src/run-report.js'
import { initialState } from '../../opencode-agent/src/state-manager.js'
import {
  renderAnswerOutOfTime,
  renderOutOfTime,
  renderStoppedBetweenSteps,
  renderStoppedPartWay,
} from '../../opencode-agent/src/time-notices.js'
import type { BetweenStepsStop, PartWayStop } from '../../opencode-agent/src/time-notices.js'
import { transition } from '../../opencode-agent/src/transitions.js'
import type { AgentState, Phase } from '../../opencode-agent/src/types.js'

/**
 * Everything this pipeline fences is written by something else — a model reply,
 * a check's stdout, a review-loop summary — and all three routinely contain
 * fences. A fixed ``` lets the first inner one close the block early, at which
 * point the trailing prose renders as code and vice versa.
 */

interface Span {
  text: string
  inCode: boolean
}

/**
 * Splits a document into code and prose spans the way CommonMark does: a fence
 * of N backticks is closed only by a run of at least N with no info string.
 * Deliberately a real model rather than a backtick count — counting says the
 * broken rendering is fine, because its fences balance while pairing wrongly.
 */
const spans = (document: string): { rows: Span[]; unclosed: boolean } => {
  let open: number | null = null
  const rows: Span[] = []

  for (const line of document.split('\n')) {
    const match = /^(`{3,})(.*)$/u.exec(line)
    const ticks = match === null ? 0 : (match[1] ?? '').length
    const info = match === null ? '' : (match[2] ?? '').trim()

    if (open === null) {
      rows.push({ text: line, inCode: false })
      if (match !== null) open = ticks
      continue
    }
    if (match !== null && ticks >= open && info === '') {
      rows.push({ text: line, inCode: false })
      open = null
      continue
    }
    rows.push({ text: line, inCode: true })
  }

  return { rows, unclosed: open !== null }
}

const prose = (document: string): string =>
  spans(document)
    .rows.filter((row) => !row.inCode)
    .map((row) => row.text)
    .join('\n')

const code = (document: string): string =>
  spans(document)
    .rows.filter((row) => row.inCode)
    .map((row) => row.text)
    .join('\n')

const FENCED_REPLY = 'Sure! Here is the spec:\n\n```json\n{"status":"spec"}\n```\n\nHope that helps.'

describe('fence', () => {
  test('leaves ordinary content in a plain fence', () => {
    expect(fence('hello')).toBe('```\nhello\n```')
  })

  test('outgrows any fence the content carries', () => {
    expect(fence('a\n```\nb')).toBe('````\na\n```\nb\n````')
    expect(fence('a\n`````\nb')).toBe('``````\na\n`````\nb\n``````')
  })

  test('keeps the content whole, whatever it contains', () => {
    expect(code(fence(FENCED_REPLY))).toContain('Hope that helps.')
    expect(spans(fence(FENCED_REPLY)).unclosed).toBe(false)
  })

  test('accepts an info string', () => {
    expect(fence('x', 'json').startsWith('```json\n')).toBe(true)
  })

  test('an inline backtick run does not inflate the fence needlessly', () => {
    expect(fence('use `--flag` here')).toBe('```\nuse `--flag` here\n```')
  })
})

describe('renderFailure', () => {
  const failed = transition(initialState(1), 'FAILED', { lastError: 'x' })

  const render = (message: string): string => renderFailure('INIT_OR_CLARIFY', message, failed, 3, null, false)

  const renderFutile = (message: string): string => renderFailure('INIT_OR_CLARIFY', message, failed, 3, null, true)

  test('keeps the recovery instruction readable when the error carries a fence', () => {
    // This is the line the maintainer has to act on; a broken fence buries it
    // inside a code block, which is precisely where it is useless.
    const rendered = render(modelResponseError('no JSON object', FENCED_REPLY).message)

    expect(prose(rendered)).toContain('/retry')
    expect(prose(rendered)).toContain('### ❌ Run failed in INIT_OR_CLARIFY')
  })

  test('keeps the whole error inside the block', () => {
    const rendered = render(modelResponseError('no JSON object', FENCED_REPLY).message)

    expect(code(rendered)).toContain('Hope that helps.')
    expect(code(rendered)).toContain('{"status":"spec"}')
  })

  test('always reports the attempt against the budget', () => {
    // The count is always at least one, so the branch that read "attempt 0"
    // could never render and is gone.
    expect(render('boom')).toContain('Attempt 1 of 3')
  })

  test('leaves no unclosed fence', () => {
    expect(spans(render(modelResponseError('no JSON', FENCED_REPLY).message)).unclosed).toBe(false)
  })

  test('a failure /retry cannot fix invites no bare /retry — issue #323', () => {
    // The drift footer once said "Reply /retry to resume" under a message whose
    // first remedy line said /retry could not change the condition, and the
    // blind retries spent the budget the remedies needed.
    const rendered = renderFutile('a condition no retry can change')

    expect(rendered).toContain('A plain `/retry` will reproduce this failure')
    expect(rendered).not.toContain('Reply **`/retry`** to resume')
    // The count is deliberately absent rather than carried: a drift refusal
    // spends no attempt, so there is no honest count to show.
    expect(rendered).not.toContain('Attempt ')
    expect(rendered).toContain('`/cancel`')
  })

  test('a futile failure keeps the whole error inside the block', () => {
    const rendered = renderFutile(modelResponseError('no JSON object', FENCED_REPLY).message)

    expect(code(rendered)).toContain('Hope that helps.')
    expect(spans(rendered).unclosed).toBe(false)
  })
})

describe('renderSettled', () => {
  const parked = (phase: Phase): AgentState => ({ ...initialState(42), phase })

  /** Every phase the cascade can actually stop at without a handler. */
  const WAITING: readonly Phase[] = ['DESIGN_SPEC', 'PLAN_REVIEW', 'FAILED', 'INCOMPLETE']

  test.each([...WAITING])('%s names exactly the commands the transition table accepts', (phase) => {
    // The gap this closes: the comment used to be `### Waiting` over "Parked in
    // `PLAN_REVIEW`." and nothing else, while every other waiting comment in
    // the file carries a "what now". Derived from `acceptedCommands`, not
    // written out here, so the assertion cannot drift from the machine either.
    const rendered = renderSettled(parked(phase))
    const accepted = acceptedCommands(parked(phase))

    for (const command of accepted) expect(rendered).toContain(`\`${command}\``)
    for (const command of SLASH_COMMANDS.filter((name) => !accepted.includes(name))) {
      expect(rendered).not.toContain(`\`${command}\``)
    }
  })

  test.each([...WAITING])('%s leads with the headline the presentation table gives it', (phase) => {
    // `PLAN_REVIEW` means nothing to a maintainer who has not read the state
    // machine, which is why the phase name is no longer the whole comment.
    const { glyph, headline } = presentationFor(parked(phase), 'waiting')

    expect(renderSettled(parked(phase)).startsWith(`### ${glyph} ${headline}`)).toBe(true)
  })

  test('still says which phase it is parked in', () => {
    // The name is what a maintainer quotes into an issue when asking about it,
    // and what the hidden state block says a line below.
    expect(renderSettled(parked('PLAN_REVIEW'))).toContain('`PLAN_REVIEW`')
  })

  test('a finished issue keeps the closing comment, not the waiting one', () => {
    // COMPLETE accepts no command at all, so offering a list of them would be
    // an invitation the state machine refuses.
    const delivered: AgentState = { ...parked('COMPLETE'), prUrl: 'https://example.test/pull/7' }

    expect(renderSettled(delivered)).toContain('### ✅ Done')
    expect(renderSettled(parked('COMPLETE'))).toContain('### 🛑 Stopped')
  })

  test('a delivered issue offers the one command it now accepts; a cancelled one does not', () => {
    // `/review` is the first command `COMPLETE` has ever taken, and a command
    // nobody can discover is not a feature. The cancelled branch must stay
    // silent about it, and its "further comments will not restart me" stays
    // true because the applicability predicate refuses `/review` with no pull
    // request — the same rule, read by the comment and by the machine.
    const delivered: AgentState = { ...parked('COMPLETE'), prUrl: 'https://example.test/pull/7', prNumber: 7 }

    expect(renderClosing(delivered)).toContain('`/review`')
    expect(renderClosing(parked('COMPLETE'))).not.toContain('`/review`')
  })
})

describe('the wall-clock notice', () => {
  const notice = renderOutOfTime(45_000, 180_000, 'REVIEW_AND_MUTATE')

  test('offers both halves of the remedy, and the one that works alone first', () => {
    // The trap every notice in that module is written against: a comment about a
    // ceiling may only offer a remedy that works. Here there are two, and they are
    // not equivalent — `/continue` works on its own, because the next job gets a
    // fresh clock, which is exactly what a `/retry` under the token ceiling does
    // not get. So it is named, and the variable is named beside it for the phase
    // that cannot fit in a job at all.
    expect(notice).toContain('`/continue`')
    expect(notice).toContain('AGENT_JOB_TIMEOUT_MINUTES')
    expect(notice.indexOf('/continue')).toBeLessThan(notice.indexOf('AGENT_JOB_TIMEOUT_MINUTES'))
  })

  test('names the phase a continuation picks up, and the phase it parked in', () => {
    // The state block posted beside it says both; a notice that quoted neither
    // would leave a maintainer to guess how much of the work survived.
    expect(notice).toContain('`REVIEW_AND_MUTATE`')
    expect(notice).toContain('`INCOMPLETE`')
  })

  test('does not offer /retry, which the phase it parks in refuses', () => {
    // The other ceiling's notice offers it, and that is the whole reason these are
    // separate renderers: `/retry` needs `FAILED`, and this park is not one.
    expect(notice).not.toContain('/retry')
  })

  test('speaks in minutes, which is the unit both bounds are set in', () => {
    expect(notice).toContain('0.8 minutes')
    expect(notice).toContain('3.0 minutes')
    expect(notice).not.toContain('45000')
  })

  test('reads a job already past its deadline as no time left, not negative time', () => {
    expect(renderOutOfTime(-90_000, 180_000, 'CI_FIX')).toContain('0.0 minutes')
  })

  test('the answer notice promises no park, because it made none', () => {
    // `answerOutOfTime` moves nothing, so a `/continue` here would name a state
    // block that does not exist — the same reason the answer budget notice does
    // not offer `/retry`.
    const answer = renderAnswerOutOfTime(45_000, 180_000, 'COMPLETE')

    expect(answer).toContain('`COMPLETE`')
    expect(answer).not.toContain('/continue')
    expect(answer).toContain('AGENT_JOB_TIMEOUT_MINUTES')
  })
})

/**
 * The stop the finding is actually about: a turn interrupted mid-file, with the
 * work kept. Shared by the notice's own tests and by the heading table below.
 */
const PART_WAY: PartWayStop = {
  remainingMs: 150_000,
  reserveMs: 180_000,
  progress: { lastAction: 'ran bash', toolCalls: 355, tokens: 112_084, cost: 0 },
  branch: 'agent/issue-42',
  resumeFrom: 'REVIEW_AND_MUTATE',
  kept: { files: 9, lines: 1_402 },
  note: null,
  handoff: '**Done** — the retry wrapper.\n**Tried and rejected** — a decorator, which broke typing.',
  step: { number: 3, total: 5, title: 'Wire the wrapper into the client' },
}

/** The stop stage 3 makes the ordinary one: the clock runs out *between* two steps. */
const BETWEEN_STEPS: BetweenStepsStop = {
  remainingMs: 240_000,
  reserveMs: 180_000,
  branch: 'agent/issue-42',
  resumeFrom: 'REVIEW_AND_MUTATE',
  done: 2,
  total: 5,
  lines: 640,
  next: 'Wire the wrapper into the client',
}

describe('the notice for a turn stopped part-way through', () => {
  const notice = renderStoppedPartWay(PART_WAY)

  test('says what the turn had done, because "it did not answer" was the original defect', () => {
    // The comment a maintainer reads has to make the same correction the error
    // message does: this turn worked for half an hour and was cut off, it did not
    // hang. The figures are the heartbeat's own, already in hand.
    expect(notice).toContain('355 tool calls')
    expect(notice).toContain('112,084 tokens')
    expect(notice).not.toContain('did not answer')
  })

  test('states what the branch now carries, with the figure rather than a claim', () => {
    expect(notice).toContain('9 files')
    expect(notice).toContain('1,402 lines')
    expect(notice).toContain('`agent/issue-42`')
  })

  test('carries the handoff where a human reads it, as well as in the block', () => {
    // The block is for the next prompt; this is for the person deciding whether to
    // type `/continue` at all. Same text, two readers.
    expect(notice).toContain('Tried and rejected')
    expect(notice).toContain('a decorator, which broke typing')
  })

  test('offers `/continue`, and never `/retry`, which the park refuses', () => {
    expect(notice).toContain('`/continue`')
    expect(notice).toContain('`REVIEW_AND_MUTATE`')
    expect(notice).not.toContain('/retry')
  })

  test('says plainly that nothing was pushed, and why, rather than implying work survived', () => {
    // The one thing this comment must never do is claim a branch carries work it
    // does not. Every degradation of the salvage lands here.
    const lost = renderStoppedPartWay({ ...PART_WAY, kept: null, note: 'the staged changes contain a credential' })

    expect(lost).toContain('Nothing was pushed')
    expect(lost).toContain('contain a credential')
    expect(lost).not.toContain('1,402 lines')
  })

  test('reports a commit that was over a size cap without pretending it was refused', () => {
    const large = renderStoppedPartWay({ ...PART_WAY, note: '3000 lines changed, over the limit of 2000' })

    expect(large).toContain('over the limit of 2000')
    expect(large).toContain('1,402 lines')
  })

  test('says a clean tree is a clean tree rather than reporting a failure', () => {
    const clean = renderStoppedPartWay({ ...PART_WAY, kept: null, note: 'nothing had been written yet', handoff: null })

    expect(clean).toContain('nothing had been written yet')
    expect(clean).toContain('`/continue`')
  })

  test('admits it has no handoff rather than leaving an empty section', () => {
    // A missing note is the ordinary consequence of a wrap-up window that expired
    // or a model that ignored it, and the continuation reads the comment: an empty
    // heading would read as "it finished and had nothing to say".
    const silent = renderStoppedPartWay({ ...PART_WAY, handoff: null })

    expect(silent).toContain('no account of where it stopped')
  })

  test('speaks in minutes, like every other notice about a clock', () => {
    expect(notice).toContain('2.5 minutes')
    expect(notice).not.toContain('150000')
  })

  test('names the step it was interrupted on, not merely the phase', () => {
    // With one turn per step, "part-way through the work" is not specific enough to
    // act on: the branch carries the finished steps, so what a maintainer needs is
    // which one was cut off — and the model's own handoff is about that step alone.
    expect(notice).toContain('step 3 of 5')
    expect(notice).toContain('Wire the wrapper into the client')
  })

  test('says nothing about steps for a plan that has none', () => {
    // A plan approved before steps existed runs as one turn, and there is no step
    // number to print. An invented "step 1 of 1" would tell a maintainer the plan
    // had a structure it does not.
    const oneShot = renderStoppedPartWay({ ...PART_WAY, step: null })

    expect(oneShot).not.toContain('step 1')
    expect(oneShot).toContain('`/continue`')
  })
})

describe('the notice for a stop between two plan steps', () => {
  const notice = renderStoppedBetweenSteps(BETWEEN_STEPS)

  test('states how much of the plan is done and where it will pick up', () => {
    expect(notice).toContain('2 of 5')
    expect(notice).toContain('640 lines')
    expect(notice).toContain('`agent/issue-42`')
    expect(notice).toContain('Wire the wrapper into the client')
  })

  test('claims nothing was lost, which is only true because the step never started', () => {
    // The claim `renderStoppedPartWay` may never make and this one may: every
    // finished step is committed and pushed, the tree is clean, and the cursor is in
    // the state block — so this stop costs the run nothing at all. That is the whole
    // prize of walking the plan a step at a time.
    expect(notice).toContain('Nothing is lost')
    expect(notice).not.toContain('Nothing was pushed')
  })

  test('offers `/continue` and never `/retry`, like every other wall-clock notice', () => {
    expect(notice).toContain('`/continue`')
    expect(notice).toContain('`REVIEW_AND_MUTATE`')
    expect(notice).not.toContain('/retry')
    expect(notice).toContain('AGENT_JOB_TIMEOUT_MINUTES')
  })

  test('credits this job with what this job did, not with what the branch carries', () => {
    // A continuation refused at its very first step: two steps are done and none of
    // them by this job. Reporting "2 of 5 done, 0 lines committed" would read as a job
    // that finished two steps and wrote nothing.
    const refused = renderStoppedBetweenSteps({ ...BETWEEN_STEPS, lines: 0 })

    expect(refused).toContain('2 of 5')
    expect(refused).toContain('did not have the clock left')
    expect(refused).not.toContain('0 lines')
  })

  test('reads as a stop before any step ran, rather than as a stop that did nothing', () => {
    // The gate sits in front of every step including the first, so `done: 0` is
    // reachable — and it is still a clean stop with a clean tree.
    const none = renderStoppedBetweenSteps({ ...BETWEEN_STEPS, done: 0, lines: 0, next: 'Write the retry tests' })

    expect(none).toContain('0 of 5')
    expect(none).toContain('Write the retry tests')
    expect(none).not.toContain('640 lines')
  })

  test('speaks in minutes, like every other notice about a clock', () => {
    expect(notice).toContain('4.0 minutes')
    expect(notice).not.toContain('240000')
  })
})

describe('comment headings', () => {
  const failed = transition(initialState(42), 'FAILED', { lastError: 'x' })

  /** One entry per renderer that speaks about an outcome, with its key. */
  const OUTCOME_COMMENTS: readonly (readonly [OutcomeKey, string])[] = [
    ['RUN_FAILED', renderFailure('PLANNING', 'boom', failed, 3, null, false)],
    ['ANSWER_FAILED', renderAnswerFailure('DESIGN_SPEC', 'boom')],
    ['RETRIES_SPENT', renderExhausted('Retry budget exhausted')],
    ['TOKENS_SPENT', renderOverBudget(1, 2, 'PLANNING')],
    ['ANSWER_TOKENS_SPENT', renderAnswerOverBudget(1, 2, 'DESIGN_SPEC')],
    ['TIME_SPENT', renderOutOfTime(60_000, 180_000, 'REVIEW_AND_MUTATE')],
    ['TIME_SPENT_PART_WAY', renderStoppedPartWay(PART_WAY)],
    ['TIME_SPENT_BETWEEN_STEPS', renderStoppedBetweenSteps(BETWEEN_STEPS)],
    ['ANSWER_TIME_SPENT', renderAnswerOutOfTime(60_000, 180_000, 'DESIGN_SPEC')],
    ['CI_GAVE_UP', renderCiExhausted('spent', null)],
    ['CI_SPENT', renderFixExhausted('spent', null)],
    ['REVIEWS_SPENT', renderReviewsExhausted('spent', null)],
    ['COMMAND_REFUSED', renderRefusedCommand('/approve', 'COMPLETE', [])],
  ]

  test.each(OUTCOME_COMMENTS)('%s leads with the glyph the outcome table gives it', (key, rendered) => {
    // Read from the table rather than written out here: the point of the table
    // is that no renderer picks its own glyph, and a test that hardcoded them
    // would be a second place to change.
    expect(rendered.startsWith(`### ${OUTCOME_GLYPHS[key]} `)).toBe(true)
  })

  test('the closing comment reads from the phase table, not the outcome one', () => {
    // "Delivered" and "Stopped" are states, not outcomes — the same two the
    // label reconciler names on this very comment, so they share one source.
    const delivered: AgentState = { ...initialState(42), phase: 'COMPLETE', prUrl: 'https://example.test/pull/7' }
    const cancelled: AgentState = { ...initialState(42), phase: 'COMPLETE' }

    expect(renderClosing(delivered).startsWith(`### ${PRESENTATION['COMPLETE:delivered'].glyph} Done`)).toBe(true)
    expect(renderClosing(cancelled).startsWith(`### ${PRESENTATION['COMPLETE:cancelled'].glyph} Stopped`)).toBe(true)
  })

  test.each(['run-report.ts', 'budget-notices.ts', 'time-notices.ts'])(
    'no renderer in %s writes a heading of its own',
    (file) => {
      // The class, not the instance. Nine renderers each picking a glyph by hand
      // is the defect the tables exist to prevent, and it comes back the moment
      // somebody adds a tenth with a literal `### ` — which every one of these
      // renderers had until this stage. Comments are stripped first: several of
      // them quote the old headings on purpose.
      //
      // Both files, because the guard is on the *class* and the budget notices
      // moved into their own module when a third one would not fit beside them.
      // A rule enforced on the file the renderers used to live in is a rule that
      // stops being enforced the moment they move.
      const source = readFileSync(path.join(import.meta.dir, '..', '..', 'opencode-agent', 'src', file), 'utf8')
      const stripped = source.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/^\s*\/\/.*$/gmu, '')

      expect(stripped).not.toMatch(/['"`]### /u)
    },
  )
})

describe('formatFailures', () => {
  test('survives check output that contains a fence', () => {
    const rendered = formatFailures([{ name: 'test', exitCode: 1, output: `FAIL\n${FENCED_REPLY}` }])

    expect(code(rendered)).toContain('Hope that helps.')
    expect(spans(rendered).unclosed).toBe(false)
  })

  test('keeps each check name out of the code block', () => {
    const rendered = formatFailures([
      { name: 'lint', exitCode: 2, output: '```\nboom\n```' },
      { name: 'test', exitCode: 1, output: 'plain' },
    ])

    expect(prose(rendered)).toContain('**lint** (exit 2)')
    expect(prose(rendered)).toContain('**test** (exit 1)')
  })
})
