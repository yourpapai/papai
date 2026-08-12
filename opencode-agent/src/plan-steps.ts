// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * What a plan is, as **data** rather than as prose.
 *
 * The planning phase has always asked the model for JSON — `promptForJson`, one
 * re-ask on a validation complaint — and then thrown the structure away, keeping
 * only the markdown it rendered from it. That was fine while the implementation was
 * one turn for the whole plan; it is not fine now that the unit of work is a step,
 * because the alternative to carrying the steps is recovering them from the
 * markdown. Scraping prose to recover an artefact is the oldest rule in this
 * workspace and it exists because heading-and-trailer scraping silently truncated
 * specs at their first `---` rule.
 *
 * So the steps travel in the plan block beside the text (`artifacts.ts`), and the
 * text a maintainer reads is **rendered from them** ({@link renderPlanMarkdown}).
 * One value feeds the comment and the block, so the plan somebody approved and the
 * steps the implementation walks cannot disagree.
 *
 * A leaf on purpose: this module imports nothing but zod, so `artifacts.ts` can own
 * the block round trip without either file importing the other.
 */

export const planStepSchema = z.object({
  title: z.string().min(1),
  files: z.array(z.string()).default([]),
  verification: z.string().default(''),
})

export type PlanStep = z.infer<typeof planStepSchema>

/**
 * Most steps one plan may declare, and what happens past it.
 *
 * A cap because every step is a model turn plus a commit plus a push: a plan of two
 * hundred "steps" is not a finer plan, it is a plan whose steps are single edits,
 * and walking it would spend a whole job's clock on the overhead between them.
 * Enforced on the **ask** rather than on the read, which is what makes it cheap:
 * `promptForJson` re-asks once with zod's own complaint attached ("expected array to
 * have <=25 items"), so the ordinary outcome is a coarser breakdown from the same
 * planning turn. A planner that will not coarsen twice fails the phase, where a
 * maintainer's `/changes` is the remedy — deliberately louder than truncating the
 * list, which would post a plan whose second half nobody would ever implement.
 *
 * Twenty-five because it is comfortably more than any plan this pipeline has
 * produced and comfortably fewer than a job can walk: at the observed few minutes a
 * step, past this the run is parking and continuing rather than finishing, which is
 * a plan that wanted splitting into issues.
 */
export const MAX_PLAN_STEPS = 25

/**
 * The plan the planner is asked for.
 *
 * `min(1)` is a decision and not a formality: a planning turn that reports no steps
 * has not planned, and the phase must say so rather than fall through to a one-shot
 * implementation of a document with nothing in it. That is the opposite reading from
 * a plan *block* with no steps, which is a legacy record and runs as one turn — the
 * difference being that one is a model failing now and the other is a maintainer
 * having approved something before steps existed.
 */
export const executionPlanSchema = z.object({
  steps: z.array(planStepSchema).min(1).max(MAX_PLAN_STEPS),
  summary: z.string().default(''),
})

export type ExecutionPlan = z.infer<typeof executionPlanSchema>

/**
 * Where in a plan a run was, for the two readers that have to be told.
 *
 * One-based and carrying the total, because both readers count from one: the notice a
 * maintainer reads ("step 3 of 5") and the wrap-up prompt the interrupted model
 * answers. The title rides along for the comment only — the model already has the
 * plan in its own session.
 *
 * `null` everywhere this is optional means "a plan with no steps", which is a real
 * and permanent case rather than a missing value: an invented "step 1 of 1" would
 * tell a maintainer the plan had a structure it does not.
 */
export interface StepMarker {
  number: number
  total: number
  title: string
}

const filesLine = (step: PlanStep): string =>
  step.files.length === 0 ? '_(no files declared)_' : step.files.map((file) => `\`${file}\``).join(', ')

const verificationLine = (step: PlanStep): string =>
  step.verification.trim() === '' ? '_(not stated)_' : step.verification.trim()

/** The plan as markdown: the comment a maintainer approves, rendered from the steps. */
export const renderPlanMarkdown = (plan: ExecutionPlan): string => {
  const steps = plan.steps.map(
    (step, index) =>
      `${index + 1}. **${step.title}**\n   - Files: ${filesLine(step)}\n   - Verified by: ${verificationLine(step)}`,
  )

  const sections: string[] = []
  if (plan.summary.trim() !== '') sections.push(plan.summary.trim())
  sections.push(steps.join('\n'))
  return sections.join('\n\n')
}

/**
 * One step, as the prompt that implements it states it.
 *
 * Deliberately the same three facts the comment shows, in a flatter shape: the model
 * is being told what to do now, not shown a numbered list to choose from.
 */
export const describeStep = (step: PlanStep): string =>
  [
    `Title: ${step.title}`,
    `Files: ${step.files.length === 0 ? '(none declared — decide from the plan)' : step.files.join(', ')}`,
    `Verified by: ${step.verification.trim() === '' ? '(not stated — verify it yourself)' : step.verification.trim()}`,
  ].join('\n')

/** Longest a commit subject may be, which is git's own convention rather than a rule. */
const SUBJECT_LIMIT = 72

/**
 * One `tasks.md` checkbox, as `REVIEW_AND_MUTATE` walks it (design D5).
 *
 * `line` is the 1-based line number in the file, so the box-check edit (`- [ ]`
 * → `- [x]`) targets the exact line. `checked` is the state the parser read —
 * the walk checks each box in the same commit as the step's work.
 */
export interface TaskCheckbox {
  line: number
  text: string
  checked: boolean
}

const CHECKBOX = /^(\s*)- \[([ x])\] (.*)$/u

/**
 * Parses a `tasks.md` body into its ordered checkbox list.
 *
 * The walk reads the unchecked boxes from `state.stepsDone`; everything else
 * (prose, headings, `---` rules) is ignored. Indented sub-item checkboxes are
 * included — they are real steps a maintainer can break work into — and keep
 * their indentation in the edit because {@link checkBoxText} rewrites only the
 * `[ ]` marker.
 */
export const parseTaskCheckboxes = (markdown: string): TaskCheckbox[] => {
  const boxes: TaskCheckbox[] = []
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = CHECKBOX.exec(lines[index] ?? '')
    if (match === null) continue
    const checked = match[2] === 'x'
    boxes.push({ line: index + 1, text: match[3]?.trim() ?? '', checked })
  }
  return boxes
}

/**
 * The box-check edit for a line: `[ ]` → `[x] on its way into the step's commit.
 * Rewrites only the marker, so an indented sub-item keeps its indentation and
 * the text after the marker is untouched.
 */
export const checkBoxText = (line: string): string => line.replace(/^(\s*- \[) \]/u, '$1x]')

/**
 * A step's title, safe to put in a commit subject.
 *
 * One line and clamped. Not a safety boundary — commits are spawned as an argv
 * vector with `shell: false`, so a title cannot become a command — but a model-written
 * title is free to be a paragraph, and `git log --oneline` is how a maintainer reads
 * a step-wise branch.
 */
export const stepSubject = (title: string): string => (title.split('\n')[0] ?? '').trim().slice(0, SUBJECT_LIMIT)
