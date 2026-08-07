// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { z } from 'zod'

/**
 * The workflow is the one part of this pipeline no other test reaches: its
 * trigger surface and job condition are GitHub expression language, evaluated
 * on GitHub, and a mistake there silently disables behaviour the TypeScript
 * side implements and tests perfectly well.
 *
 * These assertions pin the properties that were wrong before, or that a
 * well-meaning change would plausibly break.
 */

const WORKFLOW_PATH = path.join(import.meta.dir, '..', '..', '.github', 'workflows', 'agent-pipeline.yml')

const stepSchema = z.object({
  name: z.string().default(''),
  if: z.string().default(''),
  uses: z.string().default(''),
  with: z.record(z.string(), z.unknown()).default({}),
  env: z.record(z.string(), z.string()).default({}),
  run: z.string().default(''),
})

type WorkflowStep = z.infer<typeof stepSchema>

const triggerSchema = z.object({ types: z.array(z.string()) })

const workflowSchema = z.object({
  name: z.string(),
  on: z.object({
    issues: triggerSchema,
    issue_comment: triggerSchema,
    workflow_run: triggerSchema.extend({ workflows: z.array(z.string()) }),
  }),
  permissions: z.record(z.string(), z.string()),
  env: z.record(z.string(), z.string()),
  concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.boolean() }),
  jobs: z.object({
    agent: z.object({ if: z.string(), 'timeout-minutes': z.number(), steps: z.array(stepSchema) }),
  }),
})

// Parsing through the schema is itself an assertion: a workflow that loses a
// trigger, a permission or the job condition fails here rather than silently
// skipping the tests that read those fields.
const workflow = workflowSchema.parse(Bun.YAML.parse(await Bun.file(WORKFLOW_PATH).text()))
const condition = workflow.jobs.agent.if
const steps = workflow.jobs.agent.steps

describe('trigger surface', () => {
  test('listens for opened issues and created comments', () => {
    expect(workflow.on.issues.types).toEqual(['opened'])
    expect(workflow.on.issue_comment.types).toEqual(['created'])
  })

  test('listens for a completed CI run, so a red pull request comes back', () => {
    expect(workflow.on.workflow_run.types).toEqual(['completed'])
    expect(workflow.on.workflow_run.workflows).toEqual(['CI'])
  })
})

describe('the job condition', () => {
  test('does not filter comments by body, so a plain reply reaches the pipeline', () => {
    // The agent holds a conversation: clarifying answers, questions and change
    // requests all arrive as ordinary comments. A `contains(comment.body, '/…')`
    // filter here would make every one of them reachable only by slash command
    // and silently strand the clarification loop — which is exactly what it did.
    expect(condition).not.toContain('comment.body')
    expect(condition).not.toContain('/approve')
    expect(condition).not.toContain('/changes')
    expect(condition).not.toContain('/ask')
  })

  test('reads the commenter rights, not the issue author rights', () => {
    // Order matters: `issue.author_association` first would let anyone comment
    // on a maintainer-opened issue and drive the agent.
    const commenter = condition.indexOf('github.event.comment.author_association')
    const author = condition.indexOf('github.event.issue.author_association')

    expect(commenter).toBeGreaterThan(-1)
    expect(author).toBeGreaterThan(commenter)
  })

  test('requires maintainer rights for human events', () => {
    expect(condition).toContain('"OWNER", "MEMBER", "COLLABORATOR"')
  })

  test('drops bot senders and pull-request comments', () => {
    expect(condition).toContain("github.event.sender.type != 'Bot'")
    expect(condition).toContain('github.event.issue.pull_request == null')
  })

  test('admits a CI event only when it is red and on an agent branch', () => {
    expect(condition).toContain("github.event.workflow_run.conclusion == 'failure'")
    expect(condition).toContain("startsWith(github.event.workflow_run.head_branch, 'agent/issue-')")
  })

  test('does not demand an author association from machine events', () => {
    // workflow_run carries no author association; requiring one would disable
    // the CI-fix path entirely.
    expect(condition).toContain("github.event_name != 'workflow_run'")
  })
})

describe('concurrency', () => {
  test('both event kinds resolve to the same key for one issue', () => {
    const { group } = workflow.concurrency

    // Keying issue events on the number and CI events on the branch would put
    // them in different groups, so a CI-fix run and a maintainer-triggered run
    // for one issue would not serialize — and both push the same branch.
    expect(group).toContain('github.event.workflow_run.head_branch')
    expect(group).toContain("format('agent/issue-{0}', github.event.issue.number)")
  })

  test('never cancels a run in flight', () => {
    // A half-finished run must still post its state comment, or the next
    // trigger restores stale state.
    expect(workflow.concurrency['cancel-in-progress']).toBe(false)
  })
})

const NO_STEP: WorkflowStep = stepSchema.parse({})

/** Named-step lookup, defaulting to an empty step so no test branches on undefined. */
const step = (fragment: string): WorkflowStep =>
  steps.find((candidate) => candidate.name.toLowerCase().includes(fragment)) ?? NO_STEP

const checkoutStep = steps.find((candidate) => candidate.uses.startsWith('actions/checkout')) ?? NO_STEP

describe('steps', () => {
  test('checks out the branch whose checks went red, not the base', () => {
    expect(checkoutStep.with['ref']).toContain('github.event.workflow_run.head_branch')
    expect(checkoutStep.with['fetch-depth']).toBe(0)
  })

  test('fetches the superpowers skills from a pinned commit, not a branch', () => {
    // Third-party markdown that goes straight into the system prompt. A moving
    // ref would let it change without review.
    expect(step('superpowers').with['repository']).toBe('obra/superpowers')
    expect(workflow.env['SUPERPOWERS_REF']).toMatch(/^[\da-f]{40}$/u)
  })

  test('verifies the skills with the production loader, before using credentials', () => {
    // A bash reimplementation would drift from PHASE_SKILLS; this runs the real
    // loader. Ordering matters: a bad checkout should cost nothing.
    expect(step('skills landed').run).toContain('opencode-agent:verify-skills')

    const names = steps.map((candidate) => candidate.name.toLowerCase())
    expect(names.findIndex((name) => name.includes('skills landed'))).toBeLessThan(
      names.findIndex((name) => name.includes('agent pipeline')),
    )
  })

  test('installs the opencode CLI the review-loop workspace shells out to', () => {
    expect(step('opencode cli').run).toContain('opencode-ai')
  })

  test('passes only OpenAI credentials to the pipeline', () => {
    const env = step('agent pipeline').env

    expect(Object.keys(env)).toContain('OPENAI_API_KEY')
    expect(Object.keys(env)).toContain('OPENAI_BASE_URL')
    expect(Object.keys(env)).toContain('OPENAI_MODEL')
    expect(Object.keys(env).join(' ')).not.toContain('ANTHROPIC')
    expect(Object.keys(env).join(' ')).not.toContain('OPENCODE_API_KEY')
  })

  test('tells the pipeline its own workflow name, for the CI recursion guard', () => {
    // If these drift, the agent treats its own red runs as work to fix.
    expect(step('agent pipeline').env['AGENT_WORKFLOW_NAME']).toBe(workflow.name)

    // Passing the default branch through would mask the pipeline's own
    // resolution chain and let it rot untested; the payload already carries it.
    expect(Object.keys(step('agent pipeline').env)).not.toContain('AGENT_BASE_BRANCH')
  })

  test('reports an infrastructure failure only when there is an issue to post to', () => {
    expect(step('infrastructure failure').if).toContain('failure()')
    expect(step('infrastructure failure').if).toContain('github.event.issue.number')
  })
})

describe('permissions', () => {
  test('grants exactly what the pipeline writes, and nothing more', () => {
    expect(workflow.permissions).toEqual({
      contents: 'write',
      issues: 'write',
      'pull-requests': 'write',
    })
  })
})
