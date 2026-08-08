// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  findPlan,
  PLAN_MARKER,
  renderArtifact,
  renderPlanArtifact,
  requirePlan,
} from '../../opencode-agent/src/artifacts.js'
import { renderBlock } from '../../opencode-agent/src/blocks.js'
import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import {
  executionPlanSchema,
  MAX_PLAN_STEPS,
  renderPlanMarkdown,
  stepSubject,
} from '../../opencode-agent/src/plan-steps.js'
import type { ExecutionPlan, PlanStep } from '../../opencode-agent/src/plan-steps.js'

const AGENT = 'agent-bot'

const step = (title: string, overrides: Partial<PlanStep> = {}): PlanStep => ({
  title,
  files: ['src/retry.ts'],
  verification: 'bun test',
  ...overrides,
})

const PLAN: ExecutionPlan = {
  summary: 'Add retries.',
  steps: [step('Write the retry tests'), step('Implement the wrapper')],
}

const comment = (body: string, authorLogin = AGENT): IssueComment => ({ id: 1, body, authorLogin })

const thread = (plan: ExecutionPlan, revision = 1): IssueComment[] => [
  comment(renderPlanArtifact(renderPlanMarkdown(plan), revision, plan.steps)),
]

describe('the plan block', () => {
  test('carries the steps as data and reads them back verbatim', () => {
    // The whole of stage 3 rests on this: the implementation walks the steps the
    // planner declared, and it must never recover them by parsing the markdown
    // above them — the oldest rule in this workspace, and the one heading-scraping
    // broke by truncating a spec at its first `---`.
    const found = findPlan(thread(PLAN), AGENT)

    expect(found?.steps).toEqual(PLAN.steps)
    expect(found?.revision).toBe(1)
  })

  test('renders the comment from the same steps the block carries', () => {
    // Two spellings of one plan is how the comment a maintainer approved and the
    // steps the implementation walks come to disagree. One value feeds both.
    const found = findPlan(thread(PLAN), AGENT)

    expect(found?.text).toBe(renderPlanMarkdown(PLAN))
    expect(found?.text).toContain('Write the retry tests')
    expect(found?.text).toContain('Implement the wrapper')
  })

  test('a plan written before steps existed reads back as a one-shot', () => {
    // Live issues carry plans with no steps in them, and they are not migrated:
    // the fallback is permanent, because an old block is a *record* of what a
    // maintainer approved and nothing may invent steps it never saw.
    const older = [comment(renderArtifact(PLAN_MARKER, 'the plan, as prose', 2))]

    expect(findPlan(older, AGENT)).toEqual({ text: 'the plan, as prose', revision: 2, steps: [] })
  })

  test('an unusable steps field degrades to a one-shot rather than losing the plan', () => {
    // A hand-edited block is attacker-editable text like every other one. Losing
    // the *plan* over a malformed step list would fail the phase outright, where
    // falling back runs exactly what a pre-steps plan runs.
    const hostile = renderBlock(PLAN_MARKER, { text: 'the plan', revision: 1, steps: 'all of them' })

    expect(findPlan([comment(hostile)], AGENT)).toMatchObject({ text: 'the plan', steps: [] })
  })

  test('one malformed step drops the whole list, never a truncated plan', () => {
    // The failure mode this workspace refuses: half a plan read as a whole one.
    // A step list the schema cannot vouch for is no step list at all.
    const half = renderPlanArtifact('the plan', 1, [step('good'), { title: '', files: [], verification: '' }])

    expect(findPlan([comment(half)], AGENT)?.steps).toEqual([])
  })

  test('only the agent’s own plan is read, as with every other artefact', () => {
    const planted = thread(PLAN).map((entry) => ({ ...entry, authorLogin: 'drive-by' }))

    expect(findPlan(planted, AGENT)).toBeNull()
  })

  test('requirePlan throws through the caller’s own error when there is none', () => {
    const boom = new Error('no plan')

    expect(() => requirePlan([], AGENT, () => boom)).toThrow(boom)
  })
})

describe('the plan the planner is asked for', () => {
  test('refuses a plan with no steps at all', () => {
    // A planner that produced no steps has not planned. `promptForJson` re-asks
    // once with this complaint attached, which recovers most of them; twice is a
    // model that cannot produce the shape, and the phase says so.
    const empty = executionPlanSchema.safeParse({ steps: [], summary: 'nothing' })

    expect(empty.success).toBe(false)
    expect(empty.error?.message).toContain('>=1')
  })

  test('refuses more steps than one plan may declare, naming the ceiling', () => {
    const many = { steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, (_v, index) => step(`step ${index}`)) }
    const parsed = executionPlanSchema.safeParse(many)

    expect(parsed.success).toBe(false)
    expect(parsed.error?.message).toContain(`<=${MAX_PLAN_STEPS}`)
  })

  test('accepts a plan at exactly the ceiling', () => {
    const exact = { steps: Array.from({ length: MAX_PLAN_STEPS }, (_v, index) => step(`step ${index}`)) }

    expect(executionPlanSchema.safeParse(exact).success).toBe(true)
  })

  test('defaults the parts of a step a planner left out', () => {
    const sparse = executionPlanSchema.parse({ steps: [{ title: 'just a title' }] })

    expect(sparse.steps[0]).toEqual({ title: 'just a title', files: [], verification: '' })
    expect(sparse.summary).toBe('')
  })
})

describe('the commit subject a step earns', () => {
  test('is one line, however many the title had', () => {
    // The title is model-written text on its way into a commit message. It is
    // passed as argv rather than through a shell, so nothing here is a safety
    // boundary — this is about a readable `git log`.
    expect(stepSubject('first line\nsecond line')).toBe('first line')
  })

  test('is clamped, so one runaway title does not become the whole subject', () => {
    const long = stepSubject('x'.repeat(200))

    expect(long.length).toBeLessThanOrEqual(72)
  })
})
