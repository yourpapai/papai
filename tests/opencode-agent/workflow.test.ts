// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { DEFAULT_LABEL_PREFIX } from '../../opencode-agent/src/config.js'
import { issueNumberFromBranch } from '../../opencode-agent/src/git.js'
import { WORKING_LABEL } from '../../opencode-agent/src/presentation.js'
import { REPORTED_OUTPUT } from '../../opencode-agent/src/step-output.js'

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
  id: z.string().default(''),
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

/** The two steps whose bodies are executed below, rather than only read. */
const resolveStep = step('resolve the issue number')
const cleanupStep = step('working label')

interface StepRun {
  /** What the runner would colour the step by — and, for a best-effort step, the assertion. */
  exitCode: number
  /** `$GITHUB_OUTPUT` as the runner reads it back, so a later step's `if:` can be reasoned about. */
  outputs: Record<string, string>
  /** Every `gh` invocation the body made, argv joined: the whole of what it wrote to GitHub. */
  gh: readonly string[]
}

const parseOutputs = (raw: string): Record<string, string> =>
  Object.fromEntries(
    raw
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )

/**
 * Runs a step's `run:` body the way the runner would.
 *
 * Reading the YAML is enough for a condition — an `if:` is a value, and a test
 * can compare it. It is not enough for a body: "resolves the same issue number
 * the pipeline does", "no-ops under `AGENT_LABEL_PREFIX: none`" and "cannot fail
 * the job" are all claims about what a shell script *does*, and a test that only
 * greps the script for `none` passes against a script that reads the variable
 * and ignores it. So the body is extracted from the workflow and executed:
 * `bash -e` (the runner's default shell on Linux), `$GITHUB_OUTPUT` pointed
 * somewhere readable, and `gh` replaced by a stub on `PATH` that records its
 * argv and nothing else — no network, per this workspace's rule, and no way for
 * a body under test to reach GitHub even if it tried.
 */
const runStepScript = async (script: string, env: Record<string, string>, ghExitCode = 0): Promise<StepRun> => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-workflow-'))

  try {
    const ghLog = path.join(dir, 'gh.log')
    const stub = path.join(dir, 'gh')
    writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> '${ghLog}'\nexit ${ghExitCode}\n`)
    chmodSync(stub, 0o755)

    const outputPath = path.join(dir, 'github-output')
    writeFileSync(outputPath, '')
    const scriptPath = path.join(dir, 'step.sh')
    writeFileSync(scriptPath, script)

    const child = Bun.spawn(['bash', '-e', scriptPath], {
      env: { PATH: `${dir}:${process.env['PATH'] ?? ''}`, GITHUB_OUTPUT: outputPath, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await child.exited

    return {
      exitCode,
      outputs: parseOutputs(readFileSync(outputPath, 'utf8')),
      gh: existsSync(ghLog)
        ? readFileSync(ghLog, 'utf8')
            .split('\n')
            .filter((line) => line.length > 0)
        : [],
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

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

  test('leaves an unset AGENT_SELF_LOGIN unset instead of guessing the owner', () => {
    // `AGENT_SELF_LOGIN` is an override that wins outright in identity.ts, so a
    // `|| github.repository_owner` default here is not a default at all — it is
    // an operator pinning the wrong login, and it silences the resolution
    // ladder and its warning. The agent posts as `github-actions[bot]`, stops
    // recognising its own state comments, and restarts every issue at phase one
    // on every event, so `/approve` and `/changes` are refused as invalid in
    // INIT_OR_CLARIFY.
    const pinned = step('agent pipeline').env['AGENT_SELF_LOGIN']

    expect(pinned).toBe('${{ vars.AGENT_SELF_LOGIN }}')
    expect(pinned).not.toContain('repository_owner')
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
    // The issue number comes from the resolve step, never from the payload
    // field directly: `github.event.issue.number` is empty on a `workflow_run`
    // event, so gating on it here excluded every CI-fix run — a runner that died
    // mid-repair posted nothing anywhere at all.
    expect(step('infrastructure failure').if).toContain('failure()')
    expect(step('infrastructure failure').if).toContain(`steps.${resolveStep.id}.outputs.number`)
    expect(step('infrastructure failure').if).not.toContain('github.event.issue.number')
    expect(step('infrastructure failure').env['ISSUE_NUMBER']).toBe(`\${{ steps.${resolveStep.id}.outputs.number }}`)
  })

  test('covers a cancelled job, which failure() does not select', () => {
    // A run that looks hung is a run somebody cancels, and that is precisely
    // when the issue must not fall silent. `failure()` is false for a cancelled
    // job, so before this the maintainer who cancelled got nothing.
    expect(step('infrastructure failure').if).toContain('cancelled()')
  })

  test('keeps the widened status test parenthesised, inside the reported gate', () => {
    // `&&` binds tighter than `||` in GitHub expressions, so an unbracketed
    // `failure() || cancelled() && …` reads as `failure() || (cancelled() && …)`
    // — which restores the unconditional `if: failure()` this step spent a
    // commit getting away from, double comment and all.
    expect(step('infrastructure failure').if).toContain('(failure() || cancelled())')
  })

  test('falls back only when the pipeline did not report on the issue itself', () => {
    // `failure()` selects every red job, and six pipeline paths exit 1 only
    // after posting their own report — so this step used to append "The issue
    // state is unchanged; reply `/retry`" to every genuine failure, beside a
    // state block that had just moved to FAILED and a notice explaining why
    // that `/retry` would be refused. The run step marks what it posted through
    // $GITHUB_OUTPUT; this gate is the half that reads it, and a marker written
    // by a step nothing can name is no marker at all.
    expect(step('agent pipeline').id).toBe('pipeline')
    expect(step('infrastructure failure').if).toContain(
      `steps.${step('agent pipeline').id}.outputs.${REPORTED_OUTPUT} != 'true'`,
    )
  })
})

/**
 * Branch names the resolve step and `issueNumberFromBranch` must agree on.
 *
 * The realistic ones prove the CI-fix path resolves at all; the rest are the
 * shapes a hand-written shell parse gets wrong — a nested path under the prefix,
 * a suffix that is not digits, a branch that merely contains the prefix, issue
 * zero, and a suffix large enough to wrap 64-bit arithmetic into a number that
 * looks like somebody's issue.
 */
const BRANCH_CORPUS = [
  'agent/issue-42',
  'agent/issue-7',
  'agent/issue-007',
  'agent/issue-0',
  'agent/issue-',
  'agent/issue-x',
  'agent/issue-12a',
  'agent/issue-12/nested',
  'feature/agent/issue-3',
  'main',
  'agent/issue-9007199254740991',
  'agent/issue-9007199254740993',
  'agent/issue-99999999999999999999',
] as const

/** What the resolve step printed to `$GITHUB_OUTPUT`, empty when it resolved nothing. */
const resolvedNumber = async (env: Record<string, string>): Promise<string> => {
  const run = await runStepScript(resolveStep.run, env)
  return run.outputs['number'] ?? ''
}

/** The same answer from the pipeline's parser, in the shape a step output takes. */
const parsedNumber = (branch: string): string => String(issueNumberFromBranch(branch) ?? '')

describe('the issue number both feedback steps read', () => {
  test('resolves before anything that can fail', () => {
    // The whole point of the step: a job that dies in `bun install`, or is
    // cancelled while the model is thinking, still has to know where to post. A
    // resolve that depends on the checkout is a resolve that is absent in the
    // cases it exists for.
    expect(steps[0]?.name.toLowerCase()).toContain('resolve the issue number')
    expect(steps[0]?.uses).toBe('')
  })

  test('agrees with issueNumberFromBranch on every branch shape', async () => {
    // The workflow cannot import the pipeline's parser — GitHub expressions have
    // no regular expressions and the checkout may not have happened yet — so the
    // two parses exist twice and this is what keeps them one behaviour. Reading
    // the script for the string `agent/issue-` would not: the interesting half
    // is which suffixes it rejects.
    const resolved = await Promise.all(
      BRANCH_CORPUS.map(
        async (branch) => `${branch} -> ${await resolvedNumber({ ISSUE_NUMBER: '', HEAD_BRANCH: branch })}`,
      ),
    )

    expect(resolved).toEqual(BRANCH_CORPUS.map((branch) => `${branch} -> ${parsedNumber(branch)}`))
  })

  test('takes the issue event number when there is one, the branch when there is not', async () => {
    const issueEvent = await resolvedNumber({ ISSUE_NUMBER: '42', HEAD_BRANCH: '' })
    const ciEvent = await resolvedNumber({ ISSUE_NUMBER: '', HEAD_BRANCH: 'agent/issue-42' })
    // No real payload carries both; pinning the precedence anyway, because the
    // payload field is the direct answer and the branch is the inference.
    const both = await resolvedNumber({ ISSUE_NUMBER: '17', HEAD_BRANCH: 'agent/issue-42' })

    expect(issueEvent).toBe('42')
    expect(ciEvent).toBe('42')
    expect(both).toBe('17')
  })
})

describe('the working-label cleanup', () => {
  test('runs whatever the job did', () => {
    // `agent:working` has exactly one failure mode: a runner killed mid-flight
    // leaves it on. Every condition narrower than `always()` is a condition the
    // kill can land outside of.
    expect(cleanupStep.if).toBe('always()')
    expect(cleanupStep.env['ISSUE_NUMBER']).toBe(`\${{ steps.${resolveStep.id}.outputs.number }}`)
  })

  test('removes the working label and touches nothing else', async () => {
    const run = await runStepScript(cleanupStep.run, { ISSUE_NUMBER: '42', LABEL_PREFIX: '' })

    // Not a clear-and-reapply: every other agent label names the state the issue
    // is parked in, and this step has no idea which that is.
    expect(run.gh).toEqual([`issue edit 42 --remove-label ${DEFAULT_LABEL_PREFIX}${WORKING_LABEL.suffix}`])
    expect(run.exitCode).toBe(0)
  })

  test('applies the operator prefix rather than a hardcoded namespace', async () => {
    const run = await runStepScript(cleanupStep.run, { ISSUE_NUMBER: '42', LABEL_PREFIX: 'bot/' })

    expect(run.gh).toEqual([`issue edit 42 --remove-label bot/${WORKING_LABEL.suffix}`])
  })

  test('touches no label at all when labelling is switched off', async () => {
    // A repository that opted out of the channel opted out of every writer on
    // it. `labelPrefix()` trims and compares case-insensitively, so this does.
    const runs = await Promise.all(
      ['none', 'None', '  none  '].map((prefix) =>
        runStepScript(cleanupStep.run, { ISSUE_NUMBER: '42', LABEL_PREFIX: prefix }),
      ),
    )

    expect(runs.map((run) => run.gh)).toEqual([[], [], []])
    expect(runs.map((run) => run.exitCode)).toEqual([0, 0, 0])
  })

  test('does nothing when no issue number could be resolved', async () => {
    const run = await runStepScript(cleanupStep.run, { ISSUE_NUMBER: '', LABEL_PREFIX: '' })

    expect(run.gh).toEqual([])
    expect(run.exitCode).toBe(0)
  })

  test('never fails the job when the label write fails', async () => {
    // The rule labels.ts states, on the one writer that is not in labels.ts. A
    // rejected removal is the *ordinary* case on a healthy run — the in-run
    // reconcile already took the label off, and removing a label an issue does
    // not carry is a 404 — so a step that propagated it would paint most green
    // runs red.
    const run = await runStepScript(cleanupStep.run, { ISSUE_NUMBER: '42', LABEL_PREFIX: '' }, 1)

    expect(run.gh).toHaveLength(1)
    expect(run.exitCode).toBe(0)
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
