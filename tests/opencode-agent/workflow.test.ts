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

/**
 * The door: the first-pass filter and the issue number every later step reads.
 * It holds no credentials, so every field here is required — a resolve job that
 * loses its `if:` or its outputs fails at the parse rather than in a test that
 * quietly reads `undefined`.
 */
const resolveJobSchema = z.object({
  if: z.string(),
  permissions: z.record(z.string(), z.string()),
  outputs: z.record(z.string(), z.string()),
  steps: z.array(stepSchema),
})

/** The job that holds the credentials, and the only one with a concurrency group. */
const agentJobSchema = z.object({
  needs: z.string(),
  if: z.string(),
  // A string, not a number: the ceiling is a repository variable read by this
  // field *and* forwarded to the pipeline, which is what makes it one value rather
  // than two kept in step by hand. `vars` is available here and workflow `env` is
  // not, which is the whole reason it is a repository variable.
  'timeout-minutes': z.string(),
  concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.boolean() }),
  steps: z.array(stepSchema),
})

const workflowSchema = z.object({
  name: z.string(),
  on: z.object({
    issues: triggerSchema,
    issue_comment: triggerSchema,
    workflow_run: triggerSchema.extend({ workflows: z.array(z.string()) }),
  }),
  permissions: z.record(z.string(), z.string()),
  env: z.record(z.string(), z.string()),
  jobs: z.object({ resolve: resolveJobSchema, agent: agentJobSchema }),
})

const source = await Bun.file(WORKFLOW_PATH).text()

// Parsing through the schema is itself an assertion: a workflow that loses a
// trigger, a permission or the job condition fails here rather than silently
// skipping the tests that read those fields.
const workflow = workflowSchema.parse(Bun.YAML.parse(source))
/** The same document with nothing required, for asserting a key is *absent*. */
const rawWorkflow = z.record(z.string(), z.unknown()).parse(Bun.YAML.parse(source))

const resolveJob = workflow.jobs.resolve
const agentJob = workflow.jobs.agent
// The filter lives on the resolve job, which is the door: `agent` is reached
// only through it, so a condition in one place gates both.
const condition = resolveJob.if
const steps = agentJob.steps

/**
 * The condition's top-level `||` arms, split on parenthesis depth.
 *
 * Three arms now answer for three different events, and an assertion against the
 * whole string can no longer tell them apart — the pull-request arm *does* filter
 * on the comment body, and the issue arm still must not. Splitting is what keeps
 * "no body filter" a statement about the arm it would break.
 */
const topLevelArms = (expression: string): string[] => {
  const arms: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression.charAt(index)
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (depth === 0 && char === '|' && expression.charAt(index + 1) === '|') {
      arms.push(expression.slice(start, index))
      start = index + 2
    }
  }
  arms.push(expression.slice(start))

  return arms.map((arm) => arm.trim())
}

/** One arm, found by a clause only it carries. `''` when the arm is gone, so the
 *  assertion that reads it fails rather than the lookup. */
const arm = (marker: string): string => topLevelArms(condition).find((candidate) => candidate.includes(marker)) ?? ''

const ciArm = arm('github.event.workflow_run.conclusion')
const issueArm = arm('github.event.issue.pull_request == null')
const pullRequestArm = arm('github.event.issue.pull_request != null')

/** An arm's `&&` clauses, unwrapped and whitespace-normalised, so a list of them
 *  can be compared to the events they admit and refuse. */
const clausesOf = (expression: string): string[] =>
  expression
    .replace(/^\(/u, '')
    .replace(/\)$/u, '')
    .split('&&')
    .map((clause) => clause.trim().replace(/\s+/gu, ' '))

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
  test('does not filter issue comments by body, so a plain reply reaches the pipeline', () => {
    // The agent holds a conversation: clarifying answers, questions and change
    // requests all arrive as ordinary comments. A `contains(comment.body, '/…')`
    // filter here would make every one of them reachable only by slash command
    // and silently strand the clarification loop — which is exactly what it did.
    //
    // Asserted on the arm rather than on the whole condition: the pull-request
    // arm is deliberately body-filtered, and a test that could not tell the two
    // apart would have to be deleted to admit it.
    expect(issueArm).not.toContain('comment.body')
    expect(issueArm).not.toContain('/approve')
    expect(issueArm).not.toContain('/changes')
    expect(issueArm).not.toContain('/ask')
  })

  test('reads the commenter rights, not the issue author rights', () => {
    // Order matters: `issue.author_association` first would let anyone comment
    // on a maintainer-opened issue and drive the agent.
    const commenter = issueArm.indexOf('github.event.comment.author_association')
    const author = issueArm.indexOf('github.event.issue.author_association')

    expect(commenter).toBeGreaterThan(-1)
    expect(author).toBeGreaterThan(commenter)
  })

  test('requires maintainer rights for human events', () => {
    expect(issueArm).toContain('"OWNER", "MEMBER", "COLLABORATOR"')
    expect(pullRequestArm).toContain('"OWNER", "MEMBER", "COLLABORATOR"')
  })

  test('drops bot senders, and keeps pull-request comments out of the issue arm', () => {
    // The issue arm's `== null` is what still drops a pull-request comment
    // carrying no `/review`; the arm below is the only way one gets in.
    expect(issueArm).toContain("github.event.sender.type != 'Bot'")
    expect(issueArm).toContain('github.event.issue.pull_request == null')
  })

  test('admits a maintainer /review typed on a pull request, and nothing else', () => {
    // The whole arm, clause by clause, because each clause refuses one thing and
    // a `toContain` per clause could not tell a missing one from a reordered one:
    //
    //   - `issue_comment` + `created` refuse an `issue_comment.edited` — an
    //     already-read command must not re-fire when its comment is edited;
    //   - `pull_request != null` is what makes this the pull-request door;
    //   - the `/review` `contains` refuses every ordinary code-review comment,
    //     and every pull request in a repository gets those. It is a first-pass
    //     filter only: `parseSlashCommand` re-parses, requires the command to
    //     start a line and ignores fenced blocks, and none of that is expressible
    //     here. The arm exists so an event that will be dropped anyway never
    //     boots a runner;
    //   - `sender.type` refuses a bot, and the association refuses a
    //     non-maintainer.
    //
    // Everything `resolvePullRequestTrigger` refuses — a fork, a closed or merged
    // pull request, a branch the agent does not own — needs an API call and is
    // deliberately not attempted here.
    expect(clausesOf(pullRequestArm)).toEqual([
      "github.event_name == 'issue_comment'",
      "github.event.action == 'created'",
      'github.event.issue.pull_request != null',
      "contains(github.event.comment.body, '/review')",
      "github.event.sender.type != 'Bot'",
      'contains(fromJSON(\'["OWNER", "MEMBER", "COLLABORATOR"]\'), github.event.comment.author_association)',
    ])
  })

  test('reads the commenter rights on a pull request, never the fallback the issue arm uses', () => {
    // `parsePullRequestEvent` takes `comment.author_association` outright, with
    // no `|| issue.author_association` — a pull request's own author has nothing
    // to do with who may command the agent from it, and on a payload that always
    // carries a comment the fallback can only ever widen the arm.
    expect(pullRequestArm).toContain('github.event.comment.author_association')
    expect(pullRequestArm).not.toContain('github.event.issue.author_association')
  })

  test('admits a CI event only when it is red and on an agent branch', () => {
    expect(ciArm).toContain("github.event.workflow_run.conclusion == 'failure'")
    expect(ciArm).toContain("startsWith(github.event.workflow_run.head_branch, 'agent/issue-')")
  })

  test('admits a CI event only from this repository, never a fork', () => {
    // `head_branch` carries a fork's branch name verbatim, so the branch test
    // above is not an ownership test on its own. Mirrored in `guardrails.ts`;
    // here it keeps the runner from booting with the API keys mounted at all.
    expect(ciArm).toContain('github.event.workflow_run.head_repository.full_name == github.repository')
  })

  test('does not demand an author association from machine events', () => {
    // workflow_run carries no author association; requiring one would disable
    // the CI-fix path entirely.
    expect(issueArm).toContain("github.event_name != 'workflow_run'")
  })

  test('gates the job that holds the credentials on a resolved issue', () => {
    // The filter is asked once, on the door. Duplicating it on both jobs is how
    // two copies drift; leaving `resolve` unconditional would boot a runner for
    // every comment in the repository and spend an API call reading the head of
    // a pull request for every ordinary code-review comment on it — the very
    // lookup `resolvePullRequestTrigger` orders its checks to avoid.
    expect(agentJob.if).toBe("needs.resolve.outputs.issue != ''")
  })
})

/** Every `if:` the document carries, job conditions and step conditions alike. */
const everyCondition: Array<[where: string, expression: string]> = Object.entries(workflow.jobs).flatMap(
  ([id, job]) => [
    [`jobs.${id}.if`, job.if] as [string, string],
    ...job.steps.map((step, index): [string, string] => [`jobs.${id}.steps[${index}].if`, step.if]),
  ],
)

describe('a condition is expression text, not YAML', () => {
  test('no `if:` folds a `#` comment line into its expression', () => {
    // `if: >-` opens a folded block scalar, and inside one a `#` line is not a
    // comment — it folds into the expression. GitHub then fails to lex the
    // condition and rejects the *whole file*: run 31602129342 died that way,
    // with zero jobs, `failure` a second after it started, and the file path
    // where the workflow name should have been. Every other assertion here
    // stayed green through it, because `Bun.YAML.parse` reads that `#` as
    // ordinary text and so does every YAML parser. Commentary about an arm goes
    // above the `if:` key, where `#` means what it looks like it means.
    const folded = everyCondition.filter(([, expression]) => expression.includes('#')).map(([where]) => where)

    expect(folded).toEqual([])
  })
})

/** The group the workflow computes for a resolved issue number: the agent job's
 *  template, with `needs.resolve.outputs.branch` filled in the way the resolve
 *  job's own `branch` output fills it. */
const groupFor = (number: string): string =>
  agentJob.concurrency.group.replace('${{ needs.resolve.outputs.branch }}', `agent/issue-${number}`)

describe('concurrency', () => {
  test('is declared on the job, keyed on the branch the resolve job named', () => {
    // It cannot be declared on the workflow any more. On a pull-request comment
    // `github.event.issue.number` is the *pull request*, so a workflow-level
    // `format('agent/issue-{0}', …)` resolves to a group nothing else uses — and
    // a `/review` job and a `/retry` job for one issue would not serialize while
    // both push the same branch. `jobs.<id>.concurrency` may read `needs`, which
    // is the whole reason the resolve is a job.
    expect(Object.keys(rawWorkflow)).not.toContain('concurrency')
    expect(agentJob.concurrency.group).toBe('opencode-agent-${{ needs.resolve.outputs.branch }}')
    expect(resolveJob.outputs['issue']).toBe('${{ steps.issue.outputs.number }}')
    expect(resolveJob.outputs['branch']).toContain("format('agent/issue-{0}', steps.issue.outputs.number)")
  })

  test('a pull-request comment and an issue comment for one issue land in the same group', async () => {
    // The property the whole resolve job exists for. Both are run through the
    // real script: an issue comment carries the number outright, a pull-request
    // comment carries only the head branch the lookup step read — and the two
    // have to arrive at one key, or two jobs push the same branch at once.
    const fromIssue = await resolvedNumber({ ISSUE_NUMBER: '42', HEAD_BRANCH: '' })
    const fromPullRequest = await resolvedNumber({ ISSUE_NUMBER: '', HEAD_BRANCH: 'agent/issue-42' })

    expect(groupFor(fromIssue)).toBe('opencode-agent-agent/issue-42')
    expect(groupFor(fromPullRequest)).toBe(groupFor(fromIssue))
  })

  test('never cancels a run in flight', () => {
    // A half-finished run must still post its state comment, or the next
    // trigger restores stale state.
    expect(agentJob.concurrency['cancel-in-progress']).toBe(false)
  })
})

const NO_STEP: WorkflowStep = stepSchema.parse({})

/** Named-step lookup, defaulting to an empty step so no test branches on undefined. */
const stepOf = (jobSteps: readonly WorkflowStep[], fragment: string): WorkflowStep =>
  jobSteps.find((candidate) => candidate.name.toLowerCase().includes(fragment)) ?? NO_STEP

const step = (fragment: string): WorkflowStep => stepOf(steps, fragment)

const checkoutStep = steps.find((candidate) => candidate.uses.startsWith('actions/checkout')) ?? NO_STEP

/** The two steps whose bodies are executed below, rather than only read. */
const resolveStep = stepOf(resolveJob.steps, 'resolve the issue number')
const cleanupStep = step('working label')

/** The lookup that gives a pull-request comment the one thing its payload lacks. */
const headStep = stepOf(resolveJob.steps, 'head branch')

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
 * The cleanup step's `run:` uses bash 4 parameter expansion (`${prefix,,}`),
 * which the workflow ships because GitHub Actions runs it under Linux bash 5.
 * macOS ships bash 3.2 as `/bin/bash`, which rejects that substitution, so the
 * execution assertions on the cleanup step can only run where the host bash
 * matches the runner the workflow targets. Probed directly rather than by
 * version string: the feature the script depends on is the thing under test.
 */
const HOST_BASH_RUNS_CLEANUP_SCRIPT =
  Bun.spawnSync(['bash', '-c', 'prefix=NoNe; [ "${prefix,,}" = none ]']).exitCode === 0

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

  test('reads the job ceiling from one place, and the pipeline is told the same value', () => {
    // The finding this closes, D3: `AGENT_TIMEOUT_MS` defaulted to 30 minutes while
    // this job's ceiling was a literal 90, two numbers in two files kept in step by
    // hand — and a live run died 30 minutes into a healthy turn with 59 minutes of
    // runner it was never allowed to use. Byte-for-byte the same expression, so a
    // change to one is a change to both.
    expect(agentJob['timeout-minutes']).toBe('${{ vars.AGENT_JOB_TIMEOUT_MINUTES || 300 }}')
    expect(step('agent pipeline').env['AGENT_JOB_TIMEOUT_MINUTES']).toBe(agentJob['timeout-minutes'])
  })

  test('the fallback ceiling leaves room under the runner’s own six-hour cap', () => {
    // GitHub kills a hosted job at 360 minutes and `timeout-minutes` can only
    // *lower* that — a larger value is ignored, and the job dies with nothing
    // posted. So the fallback has to be a number this pipeline can stop inside of,
    // and "inside" means more than the teardown reserve: the derived deadline is
    // built from a step that runs a few seconds after the job did, so at 360 the
    // pipeline's own clock would sit *behind* the runner's and the stop would be
    // cut off doing the one thing it exists to do.
    const fallback = Number(/\|\|\s*(\d+)\s*\}\}/u.exec(agentJob['timeout-minutes'])?.[1])

    expect(fallback).toBeGreaterThan(0)
    expect(fallback).toBeLessThanOrEqual(330)
  })

  test('records the job’s start before anything that takes time', () => {
    // `timeout-minutes` counts from when the *job* started, and no event payload
    // says when that was — so a step has to record it, and every step in front of
    // it is time the derived deadline is wrong by. First, therefore, ahead of the
    // checkout and the install.
    const started = step('when this job started')

    expect(steps[0]?.name).toBe(started.name)
    expect(started.run).toContain('$GITHUB_OUTPUT')
    expect(step('agent pipeline').env['AGENT_JOB_STARTED_MS']).toBe(`\${{ steps.${started.id}.outputs.epoch }}`)
  })

  test('records the start in milliseconds, which is the unit the config reads', () => {
    // `date +%s` would be seconds, and seconds read as milliseconds put the derived
    // deadline in 1970 — permanently behind the clock, so every run would park
    // before it started. `EPOCH_MS_RANGE` rejects that value rather than acting on
    // it, but the workflow is where it would be introduced.
    expect(step('when this job started').run).toContain('%s%3N')
  })

  test('reports an infrastructure failure only when there is an issue to post to', () => {
    // The issue number comes from the resolve job, never from the payload field
    // directly: `github.event.issue.number` is empty on a `workflow_run` event
    // and is the *pull request* on a pull-request comment, so gating on it here
    // both excluded every CI-fix run — a runner that died mid-repair posted
    // nothing anywhere at all — and would now post a review's obituary onto the
    // pull request instead of the issue that carries the state.
    expect(step('infrastructure failure').if).toContain('failure()')
    expect(step('infrastructure failure').if).toContain('needs.resolve.outputs.issue')
    expect(step('infrastructure failure').if).not.toContain('github.event.issue.number')
    expect(step('infrastructure failure').env['ISSUE_NUMBER']).toBe('${{ needs.resolve.outputs.issue }}')
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
  test('resolves in a job of its own, before anything that can fail', () => {
    // The whole point of the resolve: a job that dies in `bun install`, or is
    // cancelled while the model is thinking, still has to know where to post. It
    // used to be the agent job's first step, which made that a property of step
    // order — true only for as long as nobody inserted a step above it. A
    // separate job makes it structural: the agent job cannot start until this
    // one has answered, and this one runs nothing that the agent job's failures
    // come from.
    expect(agentJob.needs).toBe('resolve')
    // No action, so nothing here can fail for a reason the agent job's steps
    // fail for: no checkout, no toolchain, no install.
    expect(resolveJob.steps.filter((candidate) => candidate.uses !== '')).toEqual([])
  })

  test('resolves with no model credentials and no more rights than reading a pull request', () => {
    // The door is not the place any secret is mounted. It reads one pull
    // request and prints two strings; the workflow-level `write` permissions
    // stay with the job that writes.
    const names = resolveJob.steps.flatMap((candidate) => Object.keys(candidate.env)).join(' ')

    expect(resolveJob.permissions).toEqual({ 'pull-requests': 'read' })
    expect(names).not.toContain('LLM_')
  })

  test('never mistakes a pull request number for an issue number', () => {
    // `github.event.issue.number` on a pull-request comment is the pull request,
    // so feeding it to the parse below would resolve the run to a number no
    // state block lives under and key its concurrency group on a branch nothing
    // else uses. The branch is the one link back, exactly as it is for CI, and
    // it costs the lookup step above.
    expect(resolveStep.env['ISSUE_NUMBER']).toContain('github.event.issue.pull_request == null')
    expect(resolveStep.env['HEAD_BRANCH']).toContain('steps.head.outputs.branch')
    expect(headStep.if).toBe('github.event.issue.pull_request != null')
    expect(headStep.run).toContain('.head.ref')
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
    expect(cleanupStep.env['ISSUE_NUMBER']).toBe('${{ needs.resolve.outputs.issue }}')
  })

  test.if(HOST_BASH_RUNS_CLEANUP_SCRIPT)('removes the working label and touches nothing else', async () => {
    const run = await runStepScript(cleanupStep.run, { ISSUE_NUMBER: '42', LABEL_PREFIX: '' })

    // Not a clear-and-reapply: every other agent label names the state the issue
    // is parked in, and this step has no idea which that is.
    expect(run.gh).toEqual([`issue edit 42 --remove-label ${DEFAULT_LABEL_PREFIX}${WORKING_LABEL.suffix}`])
    expect(run.exitCode).toBe(0)
  })

  test.if(HOST_BASH_RUNS_CLEANUP_SCRIPT)('applies the operator prefix rather than a hardcoded namespace', async () => {
    const run = await runStepScript(cleanupStep.run, { ISSUE_NUMBER: '42', LABEL_PREFIX: 'bot/' })

    expect(run.gh).toEqual([`issue edit 42 --remove-label bot/${WORKING_LABEL.suffix}`])
  })

  test.if(HOST_BASH_RUNS_CLEANUP_SCRIPT)('touches no label at all when labelling is switched off', async () => {
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

  test.if(HOST_BASH_RUNS_CLEANUP_SCRIPT)('does nothing when no issue number could be resolved', async () => {
    const run = await runStepScript(cleanupStep.run, { ISSUE_NUMBER: '', LABEL_PREFIX: '' })

    expect(run.gh).toEqual([])
    expect(run.exitCode).toBe(0)
  })

  test.if(HOST_BASH_RUNS_CLEANUP_SCRIPT)('never fails the job when the label write fails', async () => {
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

/**
 * The debug transcript's two workflow steps, which are the only part of that
 * feature no TypeScript test can reach.
 *
 * Both are gated, and both gates are the feature: a repository with no
 * `AGENT_LOG_KEY` — the ordinary case — must upload nothing and say nothing,
 * and a run that died must still upload what it wrote.
 */
const transcriptStep = step('encrypted debug transcript')
const transcriptComment = step('link the transcript')

describe('the encrypted debug transcript', () => {
  test('is passed a key from the secret store, never from a repository variable', () => {
    // `vars` are world-readable on a public repository, and this value is what
    // decides whether the transcript is readable at all.
    expect(step('agent pipeline').env['AGENT_LOG_KEY']).toBe('${{ secrets.AGENT_LOG_KEY }}')
  })

  test('uploads on any outcome, because the run worth reading is the one that died', () => {
    // The writer creates the file up front and encrypts one envelope per line,
    // so a runner killed mid-turn leaves a truncated file that still reads.
    expect(transcriptStep.if).toContain('always()')
    expect(transcriptStep.with['path']).toBe('.opencode-agent/debug-transcript.enc')
  })

  test('skips a keyless run through the file, not through a second key test', () => {
    // No key means no file. Gating on `hashFiles` rather than on
    // `secrets.AGENT_LOG_KEY != ''` keeps one source of truth — the pipeline
    // decides whether to write, and the workflow only reports what it found.
    expect(transcriptStep.if).toContain("hashFiles('.opencode-agent/debug-transcript.enc') != ''")
  })

  test('names the artefact after the run, and lets it expire', () => {
    expect(transcriptStep.with['name']).toBe('debug-transcript-${{ github.run_id }}')
    expect(transcriptStep.with['retention-days']).toBe(7)
  })

  test('pins the upload action to the same commit the rest of the repository uses', () => {
    expect(transcriptStep.uses).toMatch(/^actions\/upload-artifact@[\da-f]{40}$/u)
  })

  test('comments only when there is an artefact to link', () => {
    // Gated on the artefact id rather than on the run's outcome: a transcript is
    // worth reading after a green run too, and a keyless run must stay silent —
    // which an empty id is exactly.
    expect(transcriptComment.if).toContain("steps.transcript.outputs.artifact-id != ''")
    expect(transcriptComment.if).toContain('needs.resolve.outputs.issue')
    expect(transcriptStep.id).toBe('transcript')
  })

  test('links the artefact and the viewer, and carries no key', () => {
    // The split is the containment: the artefact is behind repository access,
    // the key behind the secret store, and the page brings them together in a
    // tab that talks to neither. A key in the comment, or in a URL parameter,
    // would undo all of it in one line.
    const { env, run } = transcriptComment

    expect(env['ARTIFACT_URL']).toBe('${{ steps.transcript.outputs.artifact-url }}')
    expect(env['VIEWER_URL']).toContain('github.io')
    expect(Object.keys(env)).not.toContain('AGENT_LOG_KEY')
    expect(run).not.toContain('secrets.')
    expect(`${JSON.stringify(env)} ${run}`).not.toContain('AGENT_LOG_KEY=')
  })

  test('derives the viewer URL from the repository, so a fork reads its own page', () => {
    expect(transcriptComment.env['VIEWER_URL']).toContain('github.repository_owner')
    expect(transcriptComment.env['VIEWER_URL']).toContain('github.event.repository.name')
  })
})

const PAGES_PATH = path.join(import.meta.dir, '..', '..', '.github', 'workflows', 'transcript-viewer-pages.yml')

const pagesSchema = z.object({
  on: z.object({ push: z.object({ branches: z.array(z.string()), paths: z.array(z.string()) }) }),
  permissions: z.record(z.string(), z.string()),
  concurrency: z.object({ group: z.string(), 'cancel-in-progress': z.boolean() }),
  jobs: z.object({ deploy: z.object({ steps: z.array(stepSchema) }) }),
})

const pages = pagesSchema.parse(Bun.YAML.parse(await Bun.file(PAGES_PATH).text()))
const pagesStep = (fragment: string): WorkflowStep => stepOf(pages.jobs.deploy.steps, fragment)

describe('the transcript viewer deployment', () => {
  test('keeps the Pages grants out of the job that holds the agent secrets', () => {
    // Pages needs `pages: write` and `id-token: write`; the agent job holds
    // every repository secret and runs model-authored code. Two grants, two
    // files, and this one is triggered only by a push a human merged.
    expect(pages.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
    expect(workflow.permissions['pages']).toBeUndefined()
    expect(workflow.permissions['id-token']).toBeUndefined()
  })

  test('publishes from master, and only when the viewer changed', () => {
    expect(pages.on.push.branches).toEqual(['master'])
    expect(pages.on.push.paths).toContain('opencode-agent/viewer/**')
  })

  test('never cancels a deployment in flight', () => {
    // A cancelled Pages deploy can leave the site on the previous build with no
    // run saying so, and this page is read during an incident.
    expect(pages.concurrency['cancel-in-progress']).toBe(false)
  })

  test('uploads the directory as it sits in the repository, with no build step', () => {
    // The page's guarantee is that what a maintainer runs against a decryption
    // key is the source that was reviewed. A bundler sits between those two.
    expect(pagesStep('upload the viewer').with['path']).toBe('opencode-agent/viewer')
    expect(pages.jobs.deploy.steps.map((entry) => entry.run).join(' ')).not.toContain('build')
  })

  test('pins every action to a commit, not a tag', () => {
    // The YAML parser drops the `# vN` comment beside each pin, so the assertion
    // is on the 40-hex sha alone — which is the half that is load-bearing.
    for (const entry of pages.jobs.deploy.steps.filter((candidate) => candidate.uses.length > 0)) {
      expect(entry.uses).toMatch(/@[\da-f]{40}$/u)
    }
  })

  test('never persists a token into the checkout it publishes', () => {
    expect(pagesStep('check out').with['persist-credentials']).toBe(false)
  })
})
