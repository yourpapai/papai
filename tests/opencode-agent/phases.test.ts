// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import type { ParsedCommand } from '../../opencode-agent/src/commands.js'
import type { OpenSpecDriver } from '../../opencode-agent/src/openspec-driver.js'
import type { PhaseInput } from '../../opencode-agent/src/phase-context.js'
import { handleAnswer } from '../../opencode-agent/src/phases/answer.js'
import { handlePlan } from '../../opencode-agent/src/phases/plan.js'
import { handleReview } from '../../opencode-agent/src/phases/review.js'
import { handleTriage } from '../../opencode-agent/src/phases/triage.js'
import type { ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState } from '../../opencode-agent/src/types.js'
import { stubPhaseDeps } from './test-helpers.js'
import type { StubIo } from './test-helpers.js'

/**
 * Design D9 — the triage capture model.
 *
 * Triage ends with a structured `clarify | capture | answer` outcome parsed via
 * `promptForJson`. On `capture` the handler scaffolds a real
 * `openspec/changes/<name>/` folder via the driver and sets `state.changeName`;
 * the D9 association gate auto-captures for OWNER/MEMBER/COLLABORATOR and posts
 * a consent comment for everybody else. These tests drive the handler through
 * `PhaseDeps` directly (per the slice plan) rather than spinning the whole
 * orchestrator harness — that sweep is the final step, not the guiding signal.
 *
 * Bridge note (slice A): `capture` still carries `spec` text and posts the
 * `AGENT_SPEC` block, because PLANNING has not been reworked onto the folder
 * yet. Slice B retires the SPEC block and drops `spec` from the schema.
 */

const AGENT_LOGIN = 'agent-bot'

const baseState = (issueId = 42, over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'INIT_OR_CLARIFY',
  issueId,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
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

const issueTrigger = (association: string): TriggerEvent => ({
  kind: 'issue',
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'someone',
  senderType: 'User',
  authorAssociation: association,
  issueNumber: 42,
  issueTitle: 'Add a retry helper',
  issueBody: 'Please add a retry helper to the HTTP client.',
  isPullRequest: false,
  commentBody: null,
  commentId: null,
  repositoryOwner: 'acme',
  defaultBranch: 'main',
})

interface FakeOptions {
  /** Model JSON replies, consumed in order by successive prompts. */
  replies: string[]
  /** Author association carried on the trigger event (the D9 gate input). */
  association?: string
  /** Pre-existing thread (oldest first). */
  thread?: IssueComment[]
  /** State to seed the input with. */
  state?: Partial<AgentState>
  command?: ParsedCommand | null
}

const makeInput = (options: FakeOptions): { input: PhaseInput; io: StubIo } => {
  const recording = stubPhaseDeps({ replies: options.replies, thread: options.thread, selfLogin: AGENT_LOGIN })
  const input: PhaseInput = {
    state: baseState(42, options.state),
    issue: { number: 42, title: 'Add a retry helper', body: 'Please add a retry helper to the HTTP client.' },
    trigger: issueTrigger(options.association ?? 'OWNER'),
    command: options.command ?? null,
    thread: recording.io.thread,
    deps: recording.deps,
  }
  return { input, io: recording.io }
}

describe('handleTriage · outcome: clarify', () => {
  it('returns NEEDS_CLARIFICATION with the rendered questions and posts nothing', async () => {
    const { input } = makeInput({
      replies: [JSON.stringify({ status: 'clarify', questions: ['Which client?', 'How many retries?'] })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('NEEDS_CLARIFICATION')
    expect(outcome.comment).toContain('Which client?')
    expect(outcome.comment).toContain('How many retries?')
    expect(outcome.blocks).toBeUndefined()
  })
})

describe('handleTriage · outcome: answer', () => {
  it('returns ANSWERED with the model reply and stays phase-neutral', async () => {
    const { input } = makeInput({
      replies: [JSON.stringify({ status: 'answer', reply: 'The HTTP client already retries once.' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('ANSWERED')
    expect(outcome.comment).toContain('The HTTP client already retries once.')
  })
})

describe('handleTriage · outcome: capture · D9 association gate', () => {
  it('auto-captures for OWNER: scaffolds the folder, sets changeName, emits CAPTURED', async () => {
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: '# Goal\n\nAdd retries.' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual([
      'newChange:add-retry-helper:spec-driven',
      'instructions:proposal:add-retry-helper',
    ])
    expect(outcome.patch?.changeName).toBe('add-retry-helper')
    // The spec is the proposal now: written into the folder, not a SPEC block.
    expect(outcome.blocks).toBeUndefined()
    expect(io.writes.some((w) => w.content.includes('Add retries.'))).toBe(true)
  })

  it.each(['MEMBER', 'COLLABORATOR'])('auto-captures for %s', async (association) => {
    const { input, io } = makeInput({
      association,
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-thing', spec: 'spec' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual([`newChange:add-thing:spec-driven`, `instructions:proposal:add-thing`])
  })

  it('posts a consent comment and parks (NEEDS_CLARIFICATION) for an untrusted author', async () => {
    const { input, io } = makeInput({
      association: 'NONE',
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: 'spec' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('NEEDS_CLARIFICATION')
    // The untrusted path does not scaffold: consent has not been given yet.
    expect(io.openspecCalls).toEqual([])
    expect(outcome.patch?.changeName).toBeUndefined()
    expect(outcome.comment).toContain('add-retry-helper')
    expect(outcome.comment.toLowerCase()).toContain('confirm')
  })

  it('rejects a non-kebab changeName (the schema re-asks once, then captures on the repair)', async () => {
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [
        JSON.stringify({ status: 'capture', changeName: 'Add Retry Helper', spec: 'spec' }),
        JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: 'spec' }),
      ],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual([
      'newChange:add-retry-helper:spec-driven',
      'instructions:proposal:add-retry-helper',
    ])
    // Two prompts: the rejected reply, then the repaired one.
    expect(io.prompts).toHaveLength(2)
  })

  it('renders the DESIGN_SPEC digest from the folder (D1): reads proposal.md back after writing it', async () => {
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: '# Goal\n\nAdd retries.' })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    // The comment is a render of the folder, not a memory of the model reply:
    // the proposal is read back after being written, and the digest carries the
    // branch as the history of record (D1).
    expect(io.reads).toEqual(['/repo/x.md'])
    expect(outcome.comment).toContain('Add retries.')
    expect(outcome.comment).toContain('agent/issue-42')
  })
})

/**
 * Design D3 — the PLANNING drafter loop, and D1 — the folder is truth.
 *
 * PLANNING reads the change's status from the folder, drafts each pending
 * artifact (typed instruction → model composes → write → `validate --strict`
 * → retry ≤2 with the complaint), commits confined to the folder, and signals
 * `PLAN_POSTED`. The retired `AGENT_PLAN` block is gone — the plan lives in
 * `tasks.md` on the branch.
 */

const CHANGE = 'add-retry-helper'

/** A driver whose status evolves as the drafter writes each artifact. */
const evolvingDriver = (drafted: Set<string>): OpenSpecDriver => ({
  newChange: (n: string): Promise<{ changeName: string }> => Promise.resolve({ changeName: n }),
  archive: (): Promise<void> => Promise.resolve(),
  validateStrict: (): Promise<{ ok: boolean; output: string }> => Promise.resolve({ ok: true, output: '' }),
  instructions: (
    artifactId: string,
  ): Promise<import('../../opencode-agent/src/openspec-driver.js').InstructionsResult> =>
    Promise.resolve({
      instruction: `Draft the ${artifactId}.`,
      template: undefined,
      rules: [],
      resolvedOutputPath: `/repo/openspec/changes/${CHANGE}/${artifactId}.md`,
      existingOutputPaths: [],
      dependencies: [],
    }),
  status: (): Promise<import('../../opencode-agent/src/openspec-driver.js').StatusResult> => {
    const artifacts: Record<string, string> = {
      proposal: 'done',
      design: drafted.has('design') ? 'done' : 'ready',
      tasks: drafted.has('tasks') ? 'done' : drafted.has('design') ? 'ready' : 'blocked',
    }
    return Promise.resolve({
      schemaName: 'spec-driven',
      artifacts,
      isPlanningComplete: drafted.has('design') && drafted.has('tasks'),
    })
  },
})

const planningState = (over: Partial<AgentState> = {}): AgentState => ({
  v: 3,
  phase: 'PLANNING',
  issueId: 42,
  resumeFrom: null,
  attempts: 0,
  ciAttempts: 0,
  ciBudgetReported: false,
  reviewAttempts: 0,
  changedLines: 0,
  stepsDone: 0,
  changeName: CHANGE,
  planRevision: 0,
  tokensSpent: 0,
  lastError: null,
  prUrl: null,
  prNumber: null,
  ...over,
})

/** The artifact id a write path points at (`/x/design.md` → `design`). Module-level so the `?.`/`??` is not "in test". */
const artifactIdOf = (path: string): string => {
  const base = path.split('/').pop() ?? ''
  return base.replace(/\.md$/u, '')
}

interface WireOptions {
  validate?: (call: number) => { ok: boolean; output: string }
  done?: string[]
}

/** Wires a drafter input whose driver status evolves as the model writes each artifact. */
const wireDrafterInput = (replies: string[], opts: WireOptions = {}): { input: PhaseInput; io: StubIo } => {
  const tracked = new Set<string>(['proposal', ...(opts.done ?? [])])
  const built = stubPhaseDeps({ replies, selfLogin: AGENT_LOGIN })
  const base = evolvingDriver(tracked)
  const driver: OpenSpecDriver =
    opts.validate === undefined
      ? base
      : (() => {
          let calls = 0
          return { ...base, validateStrict: () => Promise.resolve(opts.validate!(calls++)) }
        })()
  built.deps.openspec = driver
  built.deps.writeFile = (path: string, content: string): Promise<void> => {
    built.io.writes.push({ path, content })
    // The folder is truth (D1): a write lands in the folder, and a later read
    // of the same path returns what landed. Mirror the default stub's contract
    // so the drafter's writes are what the digest reads back.
    built.io.readContents[path] = content
    tracked.add(artifactIdOf(path))
    return Promise.resolve()
  }
  return {
    input: {
      state: planningState(),
      issue: { number: 42, title: 't', body: 'b' },
      trigger: issueTrigger('OWNER'),
      command: null,
      thread: built.io.thread,
      deps: built.deps,
    },
    io: built.io,
  }
}

const validateFailsOnce = (call: number): { ok: boolean; output: string } =>
  call === 0 ? { ok: false, output: 'design.md: missing Deltas section' } : { ok: true, output: '' }

describe('handlePlan · drafter loop (D3)', () => {
  it('drafts each pending artifact, writes it to the folder, and signals PLAN_POSTED', async () => {
    const { input, io } = wireDrafterInput([
      JSON.stringify({ content: 'design body' }),
      JSON.stringify({ content: 'tasks body' }),
    ])

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    // The drafter wrote design then tasks, in dependency order.
    expect(io.writes.map((w) => w.path)).toEqual([
      `/repo/openspec/changes/${CHANGE}/design.md`,
      `/repo/openspec/changes/${CHANGE}/tasks.md`,
    ])
    // The plan lives in the folder now — no AGENT_PLAN block rides on the
    // issue, and the handler posts nothing to the thread itself.
    expect(outcome.blocks).toBeUndefined()
    expect(io.thread).toEqual([])
    // A new plan bumps the plan-identity token.
    expect(outcome.patch?.planRevision).toBe(1)
  })

  it('retries once when validate --strict fails, attaching the complaint', async () => {
    // Only design pending (tasks already done) so the loop drafts one artifact.
    const { input, io } = wireDrafterInput(
      [JSON.stringify({ content: 'first attempt' }), JSON.stringify({ content: 'repaired attempt' })],
      { done: ['tasks'], validate: validateFailsOnce },
    )

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    // First validate failed → re-asked with the complaint. Two model turns, two
    // writes (validate reads the folder, so each attempt is written before it).
    expect(io.prompts).toHaveLength(2)
    expect(io.writes).toHaveLength(2)
    expect(io.writes.at(-1)?.content).toBe('repaired attempt')
  })

  it('renders the PLAN_REVIEW digest from the folder (D1): includes tasks.md read back', async () => {
    const { input, io } = wireDrafterInput([
      JSON.stringify({ content: 'design body' }),
      JSON.stringify({ content: '- [ ] Write retry tests\n- [ ] Add the wrapper\n' }),
    ])

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    // The plan digest is a render of the folder's tasks.md, read back after the
    // drafter wrote it (D1) — not a memory of the model reply. The revision
    // token (the machine's plan identity) and the branch ride out as metadata.
    expect(outcome.comment).toContain('Write retry tests')
    expect(outcome.comment).toContain('Add the wrapper')
    expect(outcome.comment).toContain('agent/issue-42')
    expect(io.reads).toContain(`/repo/openspec/changes/${CHANGE}/tasks.md`)
  })
})

/**
 * Design D1 — the folder is truth. `/ask` and `/review` no longer read a
 * `AGENT_SPEC`/`AGENT_PLAN` block off the thread; they read the artifact the
 * review is parked on straight out of `openspec/changes/<name>/`. These drive
 * the two readers through `PhaseDeps` directly and pin the folder read.
 */

const folderDriver = (change: string): OpenSpecDriver => ({
  newChange: (n: string): Promise<{ changeName: string }> => Promise.resolve({ changeName: n }),
  archive: (): Promise<void> => Promise.resolve(),
  validateStrict: (): Promise<{ ok: boolean; output: string }> => Promise.resolve({ ok: true, output: '' }),
  status: (): Promise<import('../../opencode-agent/src/openspec-driver.js').StatusResult> =>
    Promise.resolve({ schemaName: 'spec-driven', artifacts: {}, isPlanningComplete: true }),
  instructions: (
    artifactId: string,
  ): Promise<import('../../opencode-agent/src/openspec-driver.js').InstructionsResult> =>
    Promise.resolve({
      instruction: `Draft the ${artifactId}.`,
      template: undefined,
      rules: [],
      resolvedOutputPath: `/repo/openspec/changes/${change}/${artifactId}.md`,
      existingOutputPaths: [],
      dependencies: [],
    }),
})

interface FolderReadOptions {
  phase: 'DESIGN_SPEC' | 'PLAN_REVIEW' | 'CODE_REVIEW'
  /** Content the folder read returns, keyed by artifact id (`proposal`, `tasks`). */
  folder?: Record<string, string>
  replies?: string[]
  thread?: IssueComment[]
}

const folderReadInput = (options: FolderReadOptions): { input: PhaseInput; io: StubIo } => {
  const built = stubPhaseDeps({ replies: options.replies ?? [''], selfLogin: AGENT_LOGIN, thread: options.thread })
  built.deps.openspec = folderDriver(CHANGE)
  built.io.readContents = {}
  for (const [artifactId, content] of Object.entries(options.folder ?? {})) {
    built.io.readContents[`/repo/openspec/changes/${CHANGE}/${artifactId}.md`] = content
  }
  const state = planningState({ phase: options.phase, changeName: CHANGE })
  const trigger: TriggerEvent = {
    kind: 'issue',
    eventName: 'issue_comment',
    action: 'created',
    senderLogin: 'maintainer',
    senderType: 'User',
    authorAssociation: 'OWNER',
    issueNumber: 42,
    issueTitle: 'Add a retry helper',
    issueBody: 'Please add a retry helper.',
    isPullRequest: false,
    commentBody: '/ask what is the plan?',
    commentId: 1,
    repositoryOwner: 'acme',
    defaultBranch: 'main',
  }
  return {
    input: {
      state,
      issue: { number: 42, title: 'Add a retry helper', body: 'Please add a retry helper.' },
      trigger,
      command: { command: '/ask', argument: 'what is the plan?' } as ParsedCommand,
      thread: built.io.thread,
      deps: built.deps,
    },
    io: built.io,
  }
}

describe('handleAnswer · reads the artefact under review from the folder (D1)', () => {
  it('at DESIGN_SPEC, reads proposal.md and grounds the answer in it', async () => {
    const { input, io } = folderReadInput({
      phase: 'DESIGN_SPEC',
      folder: { proposal: '# Goal\n\nAdd a retry helper with exponential backoff.' },
      replies: ['It will back off exponentially.'],
    })

    const outcome = await handleAnswer(input)

    expect(outcome.signal).toBe('ANSWERED')
    // The proposal content reached the prompt; no SPEC block read occurs.
    expect(io.prompts[0]?.prompt).toContain('exponential backoff')
    expect(io.reads).toEqual([`/repo/openspec/changes/${CHANGE}/proposal.md`])
  })

  it('at PLAN_REVIEW, reads tasks.md and grounds the answer in it', async () => {
    const { input, io } = folderReadInput({
      phase: 'PLAN_REVIEW',
      folder: { tasks: '- [ ] Write retry tests\n- [ ] Add the wrapper\n' },
      replies: ['Two steps.'],
    })

    const outcome = await handleAnswer(input)

    expect(outcome.signal).toBe('ANSWERED')
    expect(io.prompts[0]?.prompt).toContain('Add the wrapper')
    expect(io.reads).toEqual([`/repo/openspec/changes/${CHANGE}/tasks.md`])
  })
})

describe('handleReview · reads the plan from the folder (D1)', () => {
  it('hands the loop the tasks.md content, not a block on the thread', async () => {
    const tasks = '- [ ] Write retry tests\n- [ ] Add the wrapper\n'
    const { input, io } = folderReadInput({ phase: 'CODE_REVIEW', folder: { tasks } })
    const handed: string[] = []
    input.deps.runReview = (plan: string): Promise<ReviewRunResult> => {
      handed.push(plan)
      return Promise.resolve({ outcome: 'passed', summary: '', exitCode: 0 })
    }

    const outcome = await handleReview(input)

    expect(outcome.signal).toBe('REVIEW_DONE')
    // The review loop was handed the folder's tasks.md verbatim.
    expect(handed).toEqual([tasks])
    expect(io.reads).toEqual([`/repo/openspec/changes/${CHANGE}/tasks.md`])
  })
})
