// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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

  test('admits a CI event only from this repository, never a fork', () => {
    // `head_branch` carries a fork's branch name verbatim, so the branch test
    // above is not an ownership test on its own. Mirrored in `guardrails.ts`;
    // here it keeps the runner from booting with the API keys mounted at all.
    expect(condition).toContain('github.event.workflow_run.head_repository.full_name == github.repository')
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

/**
 * Knobs the workflow deliberately does not forward, each with a reason a reader
 * can check. Anything else the README documents has to be passed through.
 */
const DELIBERATELY_ABSENT: ReadonlySet<string> = new Set([
  // Read from the payload's `repository.default_branch`; forwarding it would
  // mask that resolution path and let it rot untested. See S2-5.
  'AGENT_BASE_BRANCH',
])

/** Documented knobs the workflow neither forwards nor excuses. The filtering
 *  lives out here so no test body carries a conditional. */
const notForwarded = (documented: readonly string[], passed: readonly string[]): string[] => {
  const forwarded = new Set(passed)
  return documented.filter((name) => !forwarded.has(name) && !DELIBERATELY_ABSENT.has(name))
}

/** Every `AGENT_*` name in the README's environment table, including the cells
 *  that document two at once. */
const documentedKnobs = (): string[] => {
  const readme = readFileSync(path.join(import.meta.dir, '..', '..', 'opencode-agent', 'README.md'), 'utf8')
  const names = new Set<string>()
  for (const line of readme.split('\n')) {
    if (!line.startsWith('| `')) continue
    const cell = line.split('|')[1] ?? ''
    for (const match of cell.matchAll(/`(AGENT_[A-Z_]+)`/gu)) names.add(match[1] ?? '')
  }
  return [...names].sort()
}

describe('steps', () => {
  test('checks out the default branch and lets the pipeline switch branches', () => {
    // Never `ref: <the branch that went red>`. `agent/issue-N` is a branch the
    // agent writes to, so checking it out here would have `bun install` and the
    // pipeline's own source come from a branch the model influences, in a job
    // holding every repository secret. `ensureBranch` switches to it after
    // install, which is what the issue-triggered path already did.
    expect(checkoutStep.with).not.toHaveProperty('ref')
    // The switch depends on this: `fetch-depth: 0` fetches every head, so the
    // remote-tracking ref for an existing agent branch is already present.
    expect(checkoutStep.with['fetch-depth']).toBe(0)
  })

  test('never persists the token into .git/config', () => {
    // `persist-credentials: true` writes it there as an
    // `http.<remote>.extraheader`, and the model's `build` profile can read any
    // file in the checkout. The pipeline supplies the credential per git
    // invocation through GIT_CONFIG_* instead.
    for (const candidate of steps.filter((entry) => entry.uses.startsWith('actions/checkout'))) {
      expect(candidate.with['persist-credentials']).toBe(false)
    }
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

  test('passes only the single LLM endpoint credentials to the pipeline', () => {
    const env = step('agent pipeline').env

    expect(Object.keys(env)).toContain('LLM_API_KEY')
    expect(Object.keys(env)).toContain('LLM_BASE_URL')
    expect(Object.keys(env)).toContain('LLM_MODEL')
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

  test('passes every knob the README documents, or names it as deliberately absent', () => {
    // The finding named two missing vars; there were five, two of which this
    // workspace added itself while fixing something else. A list that has to be
    // kept in step by hand does not stay in step — so the README table is the
    // source of truth and the gap is a test failure.
    const documented = documentedKnobs()
    const missing = notForwarded(documented, Object.keys(step('agent pipeline').env))

    expect(documented.length).toBeGreaterThan(10)
    expect(missing).toEqual([])
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
