// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import type { ParsedCommand } from '../../opencode-agent/src/commands.js'
import type { CommitOutcome } from '../../opencode-agent/src/git-commit.js'
import type { EnsureBranchOptions, MergeOutcome } from '../../opencode-agent/src/git.js'
import type { OpenCodeAgent, AgentPromptRequest } from '../../opencode-agent/src/opencode-adapter.js'
import type {
  InstructionsResult,
  OpenSpecDriver,
  StatusResult,
  ValidateResult,
} from '../../opencode-agent/src/openspec-driver.js'
import type { PhaseInput, MachineInput } from '../../opencode-agent/src/phase-context.js'
import { handleAnswer } from '../../opencode-agent/src/phases/answer.js'
import { handleImplement } from '../../opencode-agent/src/phases/implement.js'
import { handlePlan } from '../../opencode-agent/src/phases/plan.js'
import { handleReview } from '../../opencode-agent/src/phases/review.js'
import { runSync, SYNC_FORBIDDEN_GIT_RULE } from '../../opencode-agent/src/phases/sync.js'
import { handleTriage } from '../../opencode-agent/src/phases/triage.js'
import type { ReplyBuffer } from '../../opencode-agent/src/reply-buffer.js'
import type { ReportSection } from '../../opencode-agent/src/reply-comment.js'
import type { ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
import { serializeState } from '../../opencode-agent/src/state-manager.js'
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
  /** Change names the base branch's `openspec/changes/` already holds. */
  existing?: readonly string[]
}

const makeInput = (options: FakeOptions): { input: PhaseInput; io: StubIo } => {
  const recording = stubPhaseDeps({ replies: options.replies, thread: options.thread, selfLogin: AGENT_LOGIN })
  recording.io.existingChanges = [...(options.existing ?? [])]
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
      replies: [
        JSON.stringify({
          status: 'capture',
          changeName: 'add-retry-helper',
          spec: '# Goal\n\nAdd retries.',
          skipSpecs: false,
        }),
      ],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual([
      // The existence probe comes first: creating is what capture does when the
      // folder is *not* already there, and it cannot know that without asking.
      'listChangeNames',
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
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-thing', spec: 'spec', skipSpecs: false })],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual([
      'listChangeNames',
      `newChange:add-thing:spec-driven`,
      `instructions:proposal:add-thing`,
    ])
  })

  it('posts a consent comment and parks (NEEDS_CLARIFICATION) for an untrusted author', async () => {
    const { input, io } = makeInput({
      association: 'NONE',
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: 'spec', skipSpecs: false })],
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
        JSON.stringify({ status: 'capture', changeName: 'Add Retry Helper', spec: 'spec', skipSpecs: false }),
        JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: 'spec', skipSpecs: false }),
      ],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.openspecCalls).toEqual([
      'listChangeNames',
      'newChange:add-retry-helper:spec-driven',
      'instructions:proposal:add-retry-helper',
    ])
    // Two prompts: the rejected reply, then the repaired one.
    expect(io.prompts).toHaveLength(2)
  })

  it('renders the DESIGN_SPEC digest from the folder (D1): reads proposal.md back after writing it', async () => {
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [
        JSON.stringify({
          status: 'capture',
          changeName: 'add-retry-helper',
          spec: '# Goal\n\nAdd retries.',
          skipSpecs: false,
        }),
      ],
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

  it('resets agent/issue-<n> to base before the scaffold commit (D12 restart)', async () => {
    // A restart lands on an issue whose agent/issue-<n> branch already exists
    // (partial legacy work). The scaffold resets the branch to base so the new
    // capture starts from zero rather than adopting the old diff.
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [JSON.stringify({ status: 'capture', changeName: 'add-retry-helper', spec: 'spec', skipSpecs: false })],
    })

    await handleTriage(input)

    // resetBranchToBase, not ensureBranch — restart means from zero.
    expect(io.gitCalls).toContain('resetBranchToBase:agent/issue-42:main')
  })
})

/**
 * The skip_specs decision (change: opencode-agent-skip-specs-depth, design D1).
 *
 * Fix-class issues are the common case for an issue agent, and a zero-delta
 * change folder used to die at `validate --strict` with the retry loop handing
 * the complaint back to the model twice — pressuring it to invent deltas. So
 * `capture` carries a `skipSpecs` boolean the model decides under an explicit
 * rule, biased to `true` for fix-class issues; a recommending capture must
 * state the reason in the proposal's Capabilities section so a maintainer can
 * veto the call at the `DESIGN_SPEC` park.
 */
describe('handleTriage · the skip_specs decision', () => {
  it('rejects a capture reply that omits skipSpecs: the call is the model’s to make, not a default to inherit', async () => {
    // A silent default (missing → false) would send every fix-class issue down
    // the spec lane and back into the invent-deltas failure the flag exists to
    // end. The schema re-asks once, exactly as it does for a misspelled name.
    const { input, io } = makeInput({
      association: 'OWNER',
      replies: [
        JSON.stringify({ status: 'capture', changeName: 'fix-retry-bug', spec: 'spec' }),
        JSON.stringify({ status: 'capture', changeName: 'fix-retry-bug', spec: 'spec', skipSpecs: true }),
      ],
    })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(io.prompts).toHaveLength(2)
    // The validated flag rides the scaffold call itself (design D2): the folder
    // is flag-complete before anything reads status about it.
    expect(io.openspecCalls).toContain('newChange:fix-retry-bug:spec-driven:skip-specs')
  })

  it('briefs the decision rule, the fix-class bias and the mandatory Capabilities-section rationale', async () => {
    const { input, io } = makeInput({ replies: [JSON.stringify({ status: 'answer', reply: 'ok' })] })

    await handleTriage(input)

    const system = io.prompts[0]?.system
    // The rule: what makes a change spec-level is observable from the contract.
    expect(system).toContain('downstream observer')
    // The bias: fix-class issues take the skip lane unless the fix changes the contract.
    expect(system).toContain('fix-class')
    // The rationale sentence a maintainer vets at the DESIGN_SPEC park.
    expect(system).toContain('None — skip_specs proposed because ⟨reason⟩')
    // The reply shape names the field, so the model knows it must answer it.
    expect(system).toContain('skipSpecs')
  })

  it('briefs capability granularity: feature-domain names, new-capabilities-only while the corpus is empty', async () => {
    // The archive door feeds agent-captured proposals into `openspec/specs/`;
    // issue-sized micro-capabilities would pollute the corpus. Granularity is
    // prompt doctrine enforced at the park (design D4), so the capture prompt
    // must carry both halves of the rule.
    const { input, io } = makeInput({ replies: [JSON.stringify({ status: 'answer', reply: 'ok' })] })

    await handleTriage(input)

    const system = io.prompts[0]?.system
    expect(system).toContain('feature-domain granularity')
    expect(system).toContain('new capabilities only')
  })
})

/**
 * Capture meets a change that is already there.
 *
 * A job starts on the base branch, so the folder a capture can collide with is
 * one the base branch already carries — a change somebody proposed and never
 * implemented. Run 31929516607 is what that used to cost: issue #281 asked for
 * "the most valuable unimplemented spec", triage answered
 * `prompt-injection-defense`, and `openspec new change` exited 1 with "already
 * exists". The folder is truth (D1), so an existing one is work to adopt, and
 * whatever it is missing PLANNING drafts through the ordinary artifact loop.
 */

const ADOPTED = 'prompt-injection-defense'

const PROPOSAL_PATH = '/repo/x.md'

/**
 * Re-answers the driver the way a folder that already holds artifacts does:
 * `instructions` reports the proposal as present when `proposal` is true, and
 * `status` reports whatever the change still owes. Decorates the recording stub
 * rather than replacing it, so `io.openspecCalls` still sees every call.
 */
const withExistingFolder = (input: PhaseInput, folder: { proposal: boolean; pending: readonly string[] }): void => {
  const driver = input.deps.openspec
  const artifacts: Record<string, string> = { proposal: 'done', specs: 'done', design: 'done', tasks: 'done' }
  for (const artifactId of folder.pending) artifacts[artifactId] = 'ready'

  input.deps.openspec = {
    ...driver,
    instructions: async (artifactId: string, changeName: string): Promise<InstructionsResult> => ({
      ...(await driver.instructions(artifactId, changeName)),
      existingOutputPaths: folder.proposal ? [PROPOSAL_PATH] : [],
    }),
    status: async (changeName: string): Promise<StatusResult> => ({
      ...(await driver.status(changeName)),
      artifacts,
      isPlanningComplete: folder.pending.length === 0,
    }),
  }
}

const adoptInput = (
  folder: { proposal: boolean; pending: readonly string[] },
  options: Partial<FakeOptions> = {},
): { input: PhaseInput; io: StubIo } => {
  const built = makeInput({
    association: 'OWNER',
    existing: [ADOPTED, 'user-profile-memory'],
    replies: [
      JSON.stringify({
        status: 'capture',
        changeName: ADOPTED,
        spec: '# Goal\n\nDefend the prompt.',
        skipSpecs: false,
      }),
    ],
    ...options,
  })
  built.io.readContents[PROPOSAL_PATH] = '# Why\n\nThe proposal a human already wrote.'
  withExistingFolder(built.input, folder)
  return built
}

describe('handleTriage · outcome: capture · adopting a change that already exists', () => {
  it('picks the existing folder up instead of asking `openspec new change` to recreate it', async () => {
    const { input, io } = adoptInput({ proposal: true, pending: [] })

    const outcome = await handleTriage(input)

    expect(outcome.signal).toBe('CAPTURED')
    expect(outcome.patch?.changeName).toBe(ADOPTED)
    // The call that used to fail the run is not made at all.
    expect(io.openspecCalls).not.toContain(`newChange:${ADOPTED}:spec-driven`)
    expect(io.openspecCalls[0]).toBe('listChangeNames')
    expect(outcome.comment).toContain(`Adopted: ${ADOPTED}`)
  })

  it('keeps the proposal the folder already carries rather than overwriting it with a fresh spec', async () => {
    const { input, io } = adoptInput({ proposal: true, pending: [] })

    const outcome = await handleTriage(input)

    // Nothing written: the human-authored proposal is what every other artifact
    // in that folder was drafted against, and this turn's spec read one issue.
    expect(io.writes).toEqual([])
    expect(outcome.comment).toContain('The proposal a human already wrote.')
  })

  it('writes the proposal into an adopted folder that never got one', async () => {
    // `openspec new change` interrupted after the scaffold leaves a folder with
    // `.openspec.yaml` and nothing else. `list` still reports it, so capture
    // adopts — and the artifact it is missing is exactly what this turn composed.
    const { input, io } = adoptInput({ proposal: false, pending: ['proposal'] })

    await handleTriage(input)

    expect(io.writes.map((write) => write.path)).toEqual([PROPOSAL_PATH])
    expect(io.writes[0]?.content).toContain('Defend the prompt.')
  })

  it("rewrites an adopted proposal when a maintainer's `/changes` asked for one", async () => {
    const { input, io } = adoptInput(
      { proposal: true, pending: [] },
      { command: { command: '/changes', argument: 'scope it to the chat surface' } },
    )

    await handleTriage(input)

    expect(io.writes.map((write) => write.path)).toEqual([PROPOSAL_PATH])
  })

  it('names the artifacts the adopted change still owes, so `/approve` is a known quantity', async () => {
    const { input } = adoptInput({ proposal: true, pending: ['design', 'tasks'] })

    const outcome = await handleTriage(input)

    expect(outcome.comment).toContain('`design`')
    expect(outcome.comment).toContain('`tasks`')
    expect(outcome.comment).not.toContain('`specs`')
  })

  it('says so when the adopted change is fully drafted and only wants implementing', async () => {
    const { input } = adoptInput({ proposal: true, pending: [] })

    const outcome = await handleTriage(input)

    expect(outcome.comment).toContain('Every planning artifact is already drafted')
  })

  it('commits the adoption under its own verb, so the branch history does not claim a scaffold', async () => {
    const { input, io } = adoptInput({ proposal: true, pending: [] })

    await handleTriage(input)

    expect(io.gitCalls).toContain(`commit:chore(openspec): adopt ${ADOPTED}`)
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

const CHANGE_DIR = `/repo/openspec/changes/${CHANGE}`

/**
 * What `openspec instructions <id> --change <name> --json` answers, recorded
 * from the pinned 1.8.0 for the `spec-driven` schema.
 *
 * `specs` is the one that is not a file: a change carries one delta spec per
 * capability, so its `resolvedOutputPath` is the pattern `specs/**\/*.md`. The
 * fake said `specs.md` like every other artifact, which is why nothing here
 * noticed the drafter writing the pattern verbatim until run 31664928683 died on
 * `ENOENT ... /specs/**\/*.md` at PLANNING.
 */
const instructionsFor = (
  artifactId: string,
): import('../../opencode-agent/src/openspec-driver.js').InstructionsResult => ({
  instruction: `Draft the ${artifactId}.`,
  template: undefined,
  // Non-empty on purpose: a project's `rules` reach the drafter through this
  // payload and through no other route, so a fake answering `[]` leaves the one
  // seam that carries them untested. Two entries, because the section renders
  // them as a list and one would not catch a builder that kept only the first.
  rules: [`rule for ${artifactId}`, `second rule for ${artifactId}`],
  resolvedOutputPath: artifactId === 'specs' ? `${CHANGE_DIR}/specs/**/*.md` : `${CHANGE_DIR}/${artifactId}.md`,
  changeDir: CHANGE_DIR,
  existingOutputPaths: [],
  dependencies: [],
})

/** A driver whose status evolves as the drafter writes each artifact. */
const evolvingDriver = (drafted: Set<string>): OpenSpecDriver => ({
  listChangeNames: (): Promise<readonly string[]> => Promise.resolve([]),
  newChange: (n: string): Promise<{ changeName: string }> => Promise.resolve({ changeName: n }),
  archive: (): Promise<void> => Promise.resolve(),
  validateStrict: (): Promise<{ ok: boolean; output: string }> => Promise.resolve({ ok: true, output: '' }),
  instructions: (
    artifactId: string,
  ): Promise<import('../../opencode-agent/src/openspec-driver.js').InstructionsResult> =>
    Promise.resolve(instructionsFor(artifactId)),
  status: (): Promise<import('../../opencode-agent/src/openspec-driver.js').StatusResult> => {
    // The real schema's dependency order: proposal → specs → design → tasks.
    const artifacts: Record<string, string> = {
      proposal: 'done',
      specs: drafted.has('specs') ? 'done' : 'ready',
      design: drafted.has('design') ? 'done' : drafted.has('specs') ? 'ready' : 'blocked',
      tasks: drafted.has('tasks') ? 'done' : drafted.has('design') ? 'ready' : 'blocked',
    }
    return Promise.resolve({
      schemaName: 'spec-driven',
      artifacts,
      isPlanningComplete: drafted.has('specs') && drafted.has('design') && drafted.has('tasks'),
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
  ciBlockedPaths: [],
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

/**
 * The artifact id a write path points at (`/x/design.md` → `design`).
 *
 * A delta spec lands at `specs/<capability-path>/spec.md`, so the id is the
 * folder there rather than the filename — the glob artifact is the one whose
 * files are not named after it. Module-level so the `?.`/`??` is not "in test".
 */
const artifactIdOf = (path: string): string => {
  if (path.startsWith(`${CHANGE_DIR}/specs/`)) return 'specs'
  const base = path.split('/').pop() ?? ''
  return base.replace(/\.md$/u, '')
}

interface WireOptions {
  validate?: (call: number) => { ok: boolean; output: string }
  done?: string[]
  /**
   * The folder carries `skip_specs: true` (design D3 of
   * opencode-agent-skip-specs-depth): the CLI reports `specs` as `skipped`,
   * `tasks` stops owing it, and the drafter composes design + tasks only.
   */
  skipSpecs?: boolean
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
  const skipDriver: OpenSpecDriver =
    opts.skipSpecs === true
      ? {
          ...driver,
          status: (): Promise<StatusResult> =>
            Promise.resolve({
              schemaName: 'spec-driven',
              artifacts: {
                proposal: 'done',
                specs: 'skipped',
                design: tracked.has('design') ? 'done' : 'ready',
                tasks: tracked.has('tasks') ? 'done' : tracked.has('design') ? 'ready' : 'blocked',
              },
              isPlanningComplete: tracked.has('design') && tracked.has('tasks'),
            }),
        }
      : driver
  built.deps.openspec = skipDriver
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
      JSON.stringify({ files: [{ path: 'specs/retry/spec.md', content: 'spec body' }] }),
      JSON.stringify({ content: 'design body' }),
      JSON.stringify({ content: 'tasks body' }),
    ])

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    // The drafter wrote specs, design then tasks, in dependency order — and the
    // glob artifact landed at the concrete per-capability path it chose, not at
    // the pattern the driver resolved.
    expect(io.writes.map((w) => w.path)).toEqual([
      `/repo/openspec/changes/${CHANGE}/specs/retry/spec.md`,
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
    // Only design pending (specs and tasks already done) so the loop drafts one artifact.
    const { input, io } = wireDrafterInput(
      [JSON.stringify({ content: 'first attempt' }), JSON.stringify({ content: 'repaired attempt' })],
      { done: ['specs', 'tasks'], validate: validateFailsOnce },
    )

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    // First validate failed → re-asked with the complaint. Two model turns, two
    // writes (validate reads the folder, so each attempt is written before it).
    expect(io.prompts).toHaveLength(2)
    expect(io.writes).toHaveLength(2)
    expect(io.writes.at(-1)?.content).toBe('repaired attempt')
  })

  it('writes one file per capability for the glob artifact, never the pattern itself', async () => {
    // The failure of run 31664928683: `specs` resolves to `specs/**\/*.md`, the
    // drafter wrote that string, and PLANNING died on ENOENT after paying for
    // the turn that composed the content. The paths are the model's to choose
    // here — one per capability — and TypeScript's to judge and write.
    const { input, io } = wireDrafterInput(
      [
        JSON.stringify({
          files: [
            { path: 'specs/retry-helper/spec.md', content: '## ADDED Requirements' },
            { path: 'specs/identity/user-auth/spec.md', content: '## MODIFIED Requirements' },
          ],
        }),
      ],
      { done: ['design', 'tasks'] },
    )

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    expect(io.writes.map((w) => w.path)).toEqual([
      `/repo/openspec/changes/${CHANGE}/specs/retry-helper/spec.md`,
      `/repo/openspec/changes/${CHANGE}/specs/identity/user-auth/spec.md`,
    ])
  })

  it('re-asks with a complaint when a drafted spec path escapes the change folder, writing nothing', async () => {
    // A path is the other thing a draft can get wrong, and it takes the same one
    // retry the validate-strict verdict takes. All-or-nothing: the first
    // attempt's good file is not written either, or the retry's complaint would
    // be about a folder that had already half-landed.
    const { input, io } = wireDrafterInput(
      [
        JSON.stringify({
          files: [
            { path: 'specs/retry-helper/spec.md', content: 'fine' },
            { path: '../../../../etc/passwd', content: 'not fine' },
          ],
        }),
        JSON.stringify({ files: [{ path: 'specs/retry-helper/spec.md', content: 'repaired' }] }),
      ],
      { done: ['design', 'tasks'] },
    )

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    expect(io.prompts).toHaveLength(2)
    expect(io.prompts.at(-1)?.prompt).toContain('../../../../etc/passwd')
    expect(io.writes.map((w) => w.path)).toEqual([`/repo/openspec/changes/${CHANGE}/specs/retry-helper/spec.md`])
    expect(io.writes.at(-1)?.content).toBe('repaired')
  })

  it('renders the PLAN_REVIEW digest from the folder (D1): includes tasks.md read back', async () => {
    const { input, io } = wireDrafterInput([
      JSON.stringify({ files: [{ path: 'specs/retry/spec.md', content: 'spec body' }] }),
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

  it('threads a steering comment into the artifact-update turn (D6)', async () => {
    // Re-entering PLANNING from a steering comment in REVIEW_AND_MUTATE: the
    // maintainer's scope-affecting prose reaches the drafter prompt so the model
    // revises the artifacts rather than re-drafting them blind. The folder cannot
    // rot relative to the conversation.
    const built = wireDrafterInput(
      [JSON.stringify({ content: '- [ ] Write retry tests\n- [ ] Also add structured logging\n' })],
      { done: ['specs', 'tasks'] },
    )
    const steerTrigger: TriggerEvent = {
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
      commentBody: 'Also add structured logging to each retry.',
      commentId: 7,
      repositoryOwner: 'acme',
      defaultBranch: 'main',
    }
    const { io } = built
    const outcome = await handlePlan({ ...built.input, trigger: steerTrigger, command: null })

    expect(outcome.signal).toBe('PLAN_POSTED')
    // The steering feedback reached the drafter's prompt — the artifact-update
    // turn is grounded in the maintainer's scope change, not a blind re-draft.
    expect(io.prompts.some((p) => p.prompt.includes('structured logging'))).toBe(true)
  })

  it("forwards each artifact's project rules to its drafter verbatim", async () => {
    // `openspec/config.yaml`'s `rules` are how a project shapes what its agents
    // draft — a scope rule added there has to reach this drafter with no code
    // change here. `plan-draft.ts` builds that section, but the fake driver used
    // to answer `rules: []`, so the forwarding was never exercised: a refactor
    // that dropped the section would have kept every test in this file green.
    // Asserted across all three artifacts because the glob artifact (`specs`)
    // takes the second prompt shape and would otherwise go uncovered.
    const { input, io } = wireDrafterInput([
      JSON.stringify({ files: [{ path: 'specs/retry/spec.md', content: 'spec body' }] }),
      JSON.stringify({ content: 'design body' }),
      JSON.stringify({ content: 'tasks body' }),
    ])

    await handlePlan(input)

    const promptFor = (artifact: string): string =>
      io.prompts
        .map((p) => p.prompt)
        .filter((p) => p.includes(`Draft the ${artifact}.`))
        .join('\n')

    for (const artifact of ['specs', 'design', 'tasks']) {
      expect(promptFor(artifact)).toContain('Rules:')
      for (const rule of instructionsFor(artifact).rules) expect(promptFor(artifact)).toContain(`- ${rule}`)
    }
  })
})

/**
 * Design D3 of opencode-agent-skip-specs-depth: a `skip_specs: true` folder is
 * a planning input, not an error. The CLI's own status graph reports `specs` as
 * `skipped` (probe 1.1), so the drafter composes design — recording the
 * deliberate skip — plus tasks, and never requests spec deltas; the retry loop's
 * complaint-driven repair survives untouched for genuine validation failures.
 */
describe('handlePlan · skip_specs changes compose design + tasks without spec deltas', () => {
  it('never drafts specs, tells the drafter the skip is recorded, and still signals PLAN_POSTED', async () => {
    const { input, io } = wireDrafterInput(
      [JSON.stringify({ content: 'design body' }), JSON.stringify({ content: 'tasks body' })],
      { skipSpecs: true },
    )

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    // Design then tasks — the CLI never reports `specs` as `ready`, so the glob
    // prompt shape (and its delta drafting) never happens at all.
    expect(io.writes.map((w) => w.path)).toEqual([
      `/repo/openspec/changes/${CHANGE}/design.md`,
      `/repo/openspec/changes/${CHANGE}/tasks.md`,
    ])
    expect(io.writes.some((w) => w.path.includes('/specs/'))).toBe(false)
    expect(io.prompts).toHaveLength(2)
    // Both artifact turns know the change is on the recorded-skip lane: the
    // model is told not to invent deltas rather than left to guess why the
    // specs artifact never arrives.
    for (const prompt of io.prompts) {
      expect(prompt.prompt).toContain('skip_specs')
      expect(prompt.prompt).toContain('no spec deltas')
    }
  })

  it('keeps the validate-retry loop for genuine failures under skip_specs', async () => {
    const { input, io } = wireDrafterInput(
      [JSON.stringify({ content: 'first attempt' }), JSON.stringify({ content: 'repaired attempt' })],
      { skipSpecs: true, done: ['design'], validate: validateFailsOnce },
    )

    const outcome = await handlePlan(input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    expect(io.prompts).toHaveLength(2)
    expect(io.writes.at(-1)?.content).toBe('repaired attempt')
  })

  it('briefs capability granularity in the specs drafter turn (design D4)', async () => {
    // The specs artifact is where the planning turn names capabilities — one
    // delta spec per capability — so the granularity doctrine reaches the
    // drafter there: feature-domain names, new-capabilities-only while the
    // corpus is empty. Enforced at the park, carried by the prompt.
    const { input, io } = wireDrafterInput([
      JSON.stringify({ files: [{ path: 'specs/retry/spec.md', content: 'spec body' }] }),
      JSON.stringify({ content: 'design body' }),
      JSON.stringify({ content: 'tasks body' }),
    ])

    await handlePlan(input)

    const specsPrompt = io.prompts.find((p) => p.prompt.includes('Write the files under:'))
    expect(specsPrompt?.system).toContain('feature-domain granularity')
    expect(specsPrompt?.system).toContain('new capabilities only')
  })
})

/**
 * Design D1 — the folder is truth. `/ask` and `/review` no longer read a
 * `AGENT_SPEC`/`AGENT_PLAN` block off the thread; they read the artifact the
 * review is parked on straight out of `openspec/changes/<name>/`. These drive
 * the two readers through `PhaseDeps` directly and pin the folder read.
 */

const folderDriver = (change: string): OpenSpecDriver => ({
  listChangeNames: (): Promise<readonly string[]> => Promise.resolve([]),
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
      changeDir: `/repo/openspec/changes/${change}`,
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
      return Promise.resolve({ outcome: 'passed', summary: '', exitCode: 0, failure: null })
    }

    const outcome = await handleReview(input)

    expect(outcome.signal).toBe('REVIEW_DONE')
    // The review loop was handed the folder's tasks.md verbatim.
    expect(handed).toEqual([tasks])
    expect(io.reads).toEqual([`/repo/openspec/changes/${CHANGE}/tasks.md`])
  })
})

/**
 * The findings are commits, and a commit on an Actions runner is worth nothing
 * until it is pushed.
 *
 * The loop merges its own branch into the checkout itself, so by the time this
 * handler runs the tree is *clean* and the work is in `HEAD` — which is why
 * asking `commitAll` whether anything changed answered "no" and the push was
 * skipped, on every review that found something. The branch, and the pull
 * request, showed the implementation and nothing else.
 */
/** Successive answers, repeating the last one — a `??` outside any test body. */
const queued = (values: readonly string[]): (() => string) => {
  const remaining = [...values]
  let last = values.at(-1) ?? ''
  return (): string => {
    last = remaining.shift() ?? last
    return last
  }
}

describe('handleReview · pushes what the loop merged', () => {
  const reviewInput = (
    passing: boolean,
    failure: string | null = null,
  ): ReturnType<typeof folderReadInput> & { pushes: () => string[] } => {
    const built = folderReadInput({ phase: 'CODE_REVIEW', folder: { tasks: '- [ ] one\n' } })
    built.input.state = { ...built.input.state, prNumber: 7, prUrl: 'https://example.invalid/pull/7' }
    built.input.deps.runReview = (): Promise<ReviewRunResult> =>
      Promise.resolve({
        outcome: passing ? 'passed' : 'failed',
        summary: 'summary',
        exitCode: passing ? 0 : 1,
        failure,
      })
    return { ...built, pushes: (): string[] => built.io.gitCalls.filter((call) => call.startsWith('push:')) }
  }

  it('pushes when the loop advanced the branch and left a clean tree', async () => {
    const built = reviewInput(true)
    // What the loop actually leaves behind: its merge is already committed, so
    // there is nothing for `commitAll` to stage.
    built.input.deps.git.commitAll = (): Promise<CommitOutcome> => Promise.resolve({ kind: 'clean' })
    const heads = queued(['before', 'after'])
    built.input.deps.git.headSha = (): Promise<string> => Promise.resolve(heads())

    const outcome = await handleReview(built.input)

    expect(built.pushes()).toEqual(['push:agent/issue-42'])
    expect(outcome.comment).toContain('pushed')
  })

  it('pushes nothing when the loop changed nothing at all', async () => {
    const built = reviewInput(true)
    built.input.deps.git.commitAll = (): Promise<CommitOutcome> => Promise.resolve({ kind: 'clean' })
    built.input.deps.git.headSha = (): Promise<string> => Promise.resolve('same')

    await handleReview(built.input)

    expect(built.pushes()).toEqual([])
  })

  it('pushes each fix as the loop publishes it, not only at the end', async () => {
    const built = reviewInput(true)
    built.input.deps.git.commitAll = (): Promise<CommitOutcome> => Promise.resolve({ kind: 'clean' })
    const heads = queued(['start', 'fix-1', 'fix-2', 'fix-2'])
    built.input.deps.git.headSha = (): Promise<string> => Promise.resolve(heads())
    built.input.deps.runReview = async (_plan: string, onFixMerged?: () => void): Promise<ReviewRunResult> => {
      onFixMerged?.()
      onFixMerged?.()
      // The loop is still running here; the pushes must already have happened by
      // the time it returns, which is what makes them survive a killed runner.
      await Promise.resolve()
      return { outcome: 'passed', summary: '', exitCode: 0, failure: null }
    }

    await handleReview(built.input)

    expect(built.pushes()).toEqual(['push:agent/issue-42', 'push:agent/issue-42'])
  })

  it('reconciles with the remote before reverting what a push cannot carry', async () => {
    // Run 32374999214's remedy, one layer up: the reconciling merge brings the
    // maintainer's line into the checkout, and only after it lands can
    // `dropUnpushable` see — and revert — a protected path that line carried.
    // The other order lets a workflow file ride the merge into a push GitHub
    // refuses whole, the issue #240 failure class.
    const built = reviewInput(true)
    built.input.deps.git.commitAll = (): Promise<CommitOutcome> => Promise.resolve({ kind: 'clean' })
    const heads = queued(['before', 'after'])
    built.input.deps.git.headSha = (): Promise<string> => Promise.resolve(heads())

    await handleReview(built.input)

    const reconciled = built.io.gitCalls.indexOf('reconcile:agent/issue-42')
    const changedSince = built.io.gitCalls.findIndex((call) => call.startsWith('changedSince:'))
    expect(reconciled).toBeGreaterThanOrEqual(0)
    expect(changedSince).toBeGreaterThanOrEqual(0)
    expect(reconciled).toBeLessThan(changedSince)
  })

  it('reports a loop that stopped at its budget as stopped, not as a failure', async () => {
    const built = reviewInput(true)
    built.input.deps.git.commitAll = (): Promise<CommitOutcome> => Promise.resolve({ kind: 'clean' })
    const heads = queued(['before', 'after'])
    built.input.deps.git.headSha = (): Promise<string> => Promise.resolve(heads())
    built.input.deps.runReview = (): Promise<ReviewRunResult> =>
      Promise.resolve({ outcome: 'stopped', summary: 'summary', exitCode: 75, failure: null })

    const outcome = await handleReview(built.input)

    // The old report for this run said "❌ … timed out and was killed", which is
    // wrong twice: nothing was killed, and its findings are on the branch.
    expect(outcome.comment).not.toContain('❌')
    expect(outcome.comment).toContain('stopped early')
    expect(outcome.comment).toContain('pushed')
    // The implementation's own out-of-time notice names the command that picks
    // the work back up; a review that stopped has to do the same, or the only
    // move a maintainer is left with is guessing.
    expect(outcome.comment).toContain('/review')
  })

  it('names why a failed loop failed, in the report and on the pull request', async () => {
    const built = reviewInput(false, "the loop's own build gate failed at the end of the run")

    const outcome = await handleReview(built.input)

    expect(outcome.comment).toContain('build gate')
    const updated = built.io.pullRequestUpdates.at(-1)
    expect(updated?.body).toContain('build gate')
  })
})

/**
 * Design D1 again, from the other side: the folder is truth, and a job that has
 * not checked out the branch carrying it holds no truth at all.
 *
 * `actions/checkout` in `agent-pipeline.yml` takes no ref on purpose — the
 * workspace starts on the base branch and `ensureBranch` is what moves it onto
 * `agent/issue-<n>`. So `openspec/changes/<name>/` is *absent* until that call,
 * and every phase after the capture that scaffolded it runs in a different job:
 * capture parks at `DESIGN_SPEC`, and the `/approve` that enters `PLANNING`
 * arrives whenever a maintainer types it, on a fresh runner.
 *
 * The stub deps cannot show that on their own — their driver answers the same
 * whatever the workspace is checked out at — which is exactly how three handlers
 * came to read the folder one line before switching to it. Run 31630109348 is
 * what that costs: `openspec status` exited 1 with "Change 'context-vault-plugin'
 * not found. Available changes: …", listing master's folders, and the run died
 * with the plan undrafted.
 */
const startedOnBaseBranch = (input: PhaseInput): void => {
  const { deps } = input
  const { git, openspec, readFile } = deps
  let onBranch = false

  // What the OpenSpec CLI says about a change folder that is on another branch,
  // and what `readFile` says about a path that is not in the tree: both are the
  // absence of the same folder, so both refuse until the branch is checked out.
  const refuse = (command: string): never => {
    throw new Error(`${command} failed (exit 1): Change '${CHANGE}' not found.`)
  }

  deps.git = {
    ...git,
    ensureBranch: (branch: string, base: string): Promise<void> => {
      onBranch = true
      return git.ensureBranch(branch, base)
    },
  }
  deps.openspec = {
    ...openspec,
    status: (changeName: string): Promise<StatusResult> =>
      onBranch ? openspec.status(changeName) : refuse('openspec status'),
    instructions: (artifactId: string, changeName: string): Promise<InstructionsResult> =>
      onBranch ? openspec.instructions(artifactId, changeName) : refuse('openspec instructions'),
    validateStrict: (changeName: string): Promise<ValidateResult> =>
      onBranch ? openspec.validateStrict(changeName) : refuse('openspec validate --strict'),
  }
  deps.readFile = (filePath: string): Promise<string> => (onBranch ? readFile(filePath) : refuse(`reading ${filePath}`))
}

/** An input parked where `REVIEW_AND_MUTATE` is entered: an approved plan in the folder. */
const implementInput = (tasks: string): { input: PhaseInput; io: StubIo } => {
  const built = stubPhaseDeps({ replies: ['Implemented.'], selfLogin: AGENT_LOGIN })
  built.deps.openspec = folderDriver(CHANGE)
  built.io.readContents = { [`/repo/openspec/changes/${CHANGE}/tasks.md`]: tasks }
  return {
    input: {
      state: planningState({ phase: 'REVIEW_AND_MUTATE' }),
      issue: { number: 42, title: 'Add a retry helper', body: 'Please add a retry helper.' },
      trigger: issueTrigger('OWNER'),
      command: null,
      thread: built.io.thread,
      deps: built.deps,
    },
    io: built.io,
  }
}

describe('a phase checks out the branch carrying the folder before it reads the folder', () => {
  it('handlePlan drafts after ensureBranch, not before (run 31630109348)', async () => {
    const built = wireDrafterInput([
      JSON.stringify({ files: [{ path: 'specs/retry/spec.md', content: 'spec body' }] }),
      JSON.stringify({ content: 'design body' }),
      JSON.stringify({ content: 'tasks body' }),
    ])
    startedOnBaseBranch(built.input)

    const outcome = await handlePlan(built.input)

    expect(outcome.signal).toBe('PLAN_POSTED')
    // Not merely "ensureBranch was called": it was called *first*, before the
    // drafter asked the driver anything. That order is the whole fix.
    expect(built.io.gitCalls[0]).toBe('ensureBranch:agent/issue-42:main')
  })

  it('handleImplement reads the plan after ensureBranch, not before', async () => {
    const built = implementInput('- [ ] Add the wrapper\n')
    startedOnBaseBranch(built.input)

    const outcome = await handleImplement(built.input)

    expect(outcome.signal).toBe('CHANGES_COMMITTED')
    expect(built.io.gitCalls[0]).toBe('ensureBranch:agent/issue-42:main')
  })

  it('handleReview reads the plan after ensureBranch, not before', async () => {
    const tasks = '- [ ] Write retry tests\n- [ ] Add the wrapper\n'
    const built = folderReadInput({ phase: 'CODE_REVIEW', folder: { tasks } })
    startedOnBaseBranch(built.input)
    const handed: string[] = []
    built.input.deps.runReview = (plan: string): Promise<ReviewRunResult> => {
      handed.push(plan)
      return Promise.resolve({ outcome: 'passed', summary: '', exitCode: 0, failure: null })
    }

    const outcome = await handleReview(built.input)

    expect(outcome.signal).toBe('REVIEW_DONE')
    // The loop still gets the folder's plan — the read moved behind the
    // checkout, it did not become a read of something else.
    expect(handed).toEqual([tasks])
    expect(built.io.gitCalls[0]).toBe('ensureBranch:agent/issue-42:main')
  })

  it('handleAnswer reads the artefact after ensureBranch, not before (issue #331)', async () => {
    // The fourth reader to acquire the defect: `/ask` and every plain comment
    // classified as a question ground the answer in the folder, and the answer
    // job starts on the base branch like every other. The permissive
    // `folderDriver` could not show it — this gate is what the run showed.
    const built = folderReadInput({
      phase: 'DESIGN_SPEC',
      folder: { proposal: '# Goal\n\nAdd a retry helper with exponential backoff.' },
      replies: ['It will back off exponentially.'],
    })
    startedOnBaseBranch(built.input)

    const outcome = await handleAnswer(built.input)

    expect(outcome.signal).toBe('ANSWERED')
    expect(built.io.prompts[0]?.prompt).toContain('exponential backoff')
    expect(built.io.gitCalls[0]).toBe('ensureBranch:agent/issue-42:main')
  })
})

/**
 * The `/sync` side operation — a handler that is not a phase, the `answer.ts`
 * precedent. It merges base into the agent branch from any PR-bearing state,
 * moves nothing, and reports on the trigger surface through `postAnswer`'s
 * write. The workspace rule applies throughout: assert the **persisted state**,
 * not the returned status — the state block the run leaves behind is the only
 * thing the next job can read.
 */

/** A reply buffer that records sections instead of posting them. */
const recordingReply = (): { reply: ReplyBuffer; sections: ReportSection[] } => {
  const sections: ReportSection[] = []
  return {
    reply: {
      begin: (): void => {},
      section: (_state, section): void => {
        sections.push(section)
      },
      flush: (): Promise<null> => Promise.resolve(null),
    },
    sections,
  }
}

const CONFLICTED_CONTENT = [
  'ours',
  '<<<<<<< HEAD',
  'agent version',
  '=======',
  'base version',
  '>>>>>>> origin/main',
  '',
].join('\n')

interface SyncFixture {
  input: MachineInput
  io: StubIo
  sections: ReportSection[]
  seedState: string
}

/** The machine input a dispatched `/sync` produces, over a PR-bearing state. */
const syncFixture = (over: {
  merge: MergeOutcome
  state?: Partial<AgentState>
  /** The model's edit during a repair turn: content the conflicted file ends up holding. */
  repair?: string
  tokensUsed?: number
  pushError?: Error
}): SyncFixture => {
  const state = baseState(42, {
    phase: 'COMPLETE',
    changeName: 'add-x',
    prNumber: 7,
    prUrl: 'https://example.test/pull/7',
    ...over.state,
  })
  // The thread the restore scan reads: one agent comment carrying the block.
  const seedState = serializeState(state)
  const thread: IssueComment[] = [{ id: 55, body: seedState, authorLogin: AGENT_LOGIN }]

  const recording = stubPhaseDeps({ selfLogin: AGENT_LOGIN, thread })
  recording.io.readContents['/repo/src/same.txt'] = CONFLICTED_CONTENT
  const reply = recordingReply()
  recording.deps.reply = reply.reply

  // The repair turn's edit, simulated at the moment the prompt is answered:
  // the model edits the marked file in the working tree and nothing else.
  const inner: OpenCodeAgent = {
    sessionId: 's',
    prompt: (request: AgentPromptRequest): Promise<{ text: string; sessionId: string }> => {
      recording.io.prompts.push(request)
      if (over.repair !== undefined) recording.io.readContents['/repo/src/same.txt'] = over.repair
      return Promise.resolve({ text: 'resolved', sessionId: 's' })
    },
    tokensUsed: (): Promise<number> => Promise.resolve(0),
    abort: (): Promise<boolean> => Promise.resolve(true),
    close: (): Promise<void> => Promise.resolve(),
  }
  recording.deps.agent = (): Promise<OpenCodeAgent> => Promise.resolve(inner)
  recording.deps.tokensUsed = (): Promise<number> => Promise.resolve(over.tokensUsed ?? 0)

  const base = recording.deps.git
  recording.deps.git = {
    ...base,
    // The lift is recorded in the call string so the sync expectations pin it:
    // `/sync` is the one caller allowed onto a dependency-drifted branch, and
    // losing that option would make the remedy refuse its own condition.
    ensureBranch: (branch: string, main: string, options?: EnsureBranchOptions): Promise<void> => {
      recording.io.gitCalls.push(
        `ensureBranch:${branch}:${main}${options?.allowDependencyDrift === true ? ':allowDrift' : ''}`,
      )
      return Promise.resolve()
    },
    mergeBase: (branch: string): Promise<MergeOutcome> => {
      recording.io.gitCalls.push(`mergeBase:${branch}`)
      return Promise.resolve(over.merge)
    },
    push: (branch: string): Promise<void> => {
      recording.io.gitCalls.push(`push:${branch}`)
      if (over.pushError !== undefined) return Promise.reject(over.pushError)
      return Promise.resolve()
    },
  }

  return {
    input: {
      state,
      issue: { number: 42, title: 't', body: 'b' },
      trigger: issueTrigger('OWNER'),
      command: { command: '/sync', argument: '' },
      thread: recording.io.thread,
      deps: recording.deps,
      answer: false,
      posted: false,
      carriedTokens: state.tokensSpent,
      sync: true,
    },
    io: recording.io,
    sections: reply.sections,
    seedState,
  }
}

describe('runSync · the clean paths', () => {
  it('merges, pushes and reports — zero model turns, persisted state byte-identical', async () => {
    const fixture = syncFixture({ merge: { kind: 'clean', commits: 2 } })

    const result = await runSync(fixture.input)

    expect(result.status).toBe('completed')
    expect(fixture.io.gitCalls).toEqual([
      'ensureBranch:agent/issue-42:main:allowDrift',
      'mergeBase:main',
      'push:agent/issue-42',
    ])
    // Zero model turns: the clean path spends nothing.
    expect(fixture.io.prompts).toEqual([])
    // The reply reports the commits merged and from which branch.
    const body = String(fixture.sections.at(-1)?.body)
    expect(body).toContain('2 commits')
    expect(body).toContain('`main`')
    // The workspace rule: the persisted state is byte-identical. The in-place
    // spend write (postAnswer's) is content-identical when nothing was spent —
    // the block the thread carries reads exactly the one it started with.
    expect(fixture.io.edits.at(-1)?.body).toBe(fixture.seedState)
  })

  it('reports up to date, pushes nothing, spends no turn', async () => {
    const fixture = syncFixture({ merge: { kind: 'up-to-date' } })

    const result = await runSync(fixture.input)

    expect(result.status).toBe('completed')
    expect(fixture.io.gitCalls).toEqual(['ensureBranch:agent/issue-42:main:allowDrift', 'mergeBase:main'])
    expect(fixture.io.prompts).toEqual([])
    expect(fixture.sections.at(-1)?.body).toContain('up to date')
    expect(fixture.io.edits.at(-1)?.body).toBe(fixture.seedState)
  })

  it('translates a workflows-permission push refusal instead of posting the raw error', async () => {
    const fixture = syncFixture({
      merge: { kind: 'clean', commits: 1 },
      pushError: new Error(
        'git failed (1): git push origin agent/issue-42\n' +
          'remote: ERROR: refusing to allow a GitHub App to create or update workflow ' +
          '`.github/workflows/ci.yml` without `workflows` scope.',
      ),
    })

    const result = await runSync(fixture.input)

    expect(result.status).toBe('failed')
    const body = String(fixture.sections.at(-1)?.body)
    expect(body).toContain('workflow')
    // The remedy names the code host's own update-branch control, not /retry.
    expect(body).toContain('update-branch')
    expect(body).not.toContain('/retry')
    // Nothing moved and nothing was stranded elsewhere.
    expect(fixture.io.edits.at(-1)?.body).toBe(fixture.seedState)
    expect(result.state).toEqual(fixture.input.state)
  })
})

describe('runSync · the conflicted path', () => {
  it('repairs in bounded rounds and completes the merge itself', async () => {
    const fixture = syncFixture({
      merge: { kind: 'conflicted', paths: ['src/same.txt'] },
      repair: 'resolved version\n',
      tokensUsed: 1_234,
    })

    const result = await runSync(fixture.input)

    expect(result.status).toBe('completed')
    expect(fixture.io.gitCalls).toEqual([
      'ensureBranch:agent/issue-42:main:allowDrift',
      'mergeBase:main',
      'completeMerge:chore(agent): sync with main',
      'push:agent/issue-42',
    ])
    // One repair turn: the prompt names the conflicted path, carries the
    // markers, and pins the forbidden-git rule.
    expect(fixture.io.prompts).toHaveLength(1)
    const prompt = String(fixture.io.prompts[0]?.prompt)
    expect(prompt).toContain('src/same.txt')
    expect(prompt).toContain('<<<<<<<')
    expect(prompt).toContain(SYNC_FORBIDDEN_GIT_RULE)
    // The reply says resolved and is honest that checks have not run on it.
    const body = String(fixture.sections.at(-1)?.body)
    expect(body.toLowerCase()).toContain('resolved')
    expect(body).toContain('checks')
    // The reply is postAnswer's write: a plain comment, no state block.
    expect(fixture.sections.at(-1)?.blocks).toEqual([])
    // The repair turn's spend is the one thing that changed: the newest state
    // block was rewritten in place with the new total, everything else intact.
    const edit = fixture.io.edits.at(-1)
    expect(edit?.body).toContain('"tokensSpent": 1234')
    expect(edit?.body).toContain('"phase": "COMPLETE"')
    expect(edit?.body).not.toContain('"phase": "FAILED"')
  })

  it('aborts when every round ends with markers still present', async () => {
    // No repair: the file keeps its markers through all rounds.
    const fixture = syncFixture({ merge: { kind: 'conflicted', paths: ['src/same.txt'] }, tokensUsed: 100 })

    const result = await runSync(fixture.input)

    expect(result.status).toBe('failed')
    // Exactly syncRepairMaxRounds turns — the stub config's 3.
    expect(fixture.io.prompts).toHaveLength(3)
    expect(fixture.io.gitCalls).toContain('abortMerge')
    expect(fixture.io.gitCalls.filter((call) => call.startsWith('push:'))).toEqual([])
    expect(fixture.sections.at(-1)?.body).toContain('update-branch')
    // State untouched but for the spend the failed rounds paid.
    const edit = fixture.io.edits.at(-1)
    expect(edit?.body).toContain('"phase": "COMPLETE"')
    expect(edit?.body).toContain('"tokensSpent": 100')
  })

  it('starts no repair turn at the token ceiling, and names the ceiling and the remedy', async () => {
    const fixture = syncFixture({
      merge: { kind: 'conflicted', paths: ['src/same.txt'] },
      // At the ceiling the ordinary way: everything before this job spent it,
      // and this job's session has paid for nothing at all.
      state: { tokensSpent: 5_000_000 },
    })

    const result = await runSync(fixture.input)

    expect(result.status).toBe('failed')
    expect(fixture.io.prompts).toEqual([])
    expect(fixture.io.gitCalls).toContain('abortMerge')
    expect(fixture.sections.at(-1)?.body).toContain('AGENT_MAX_TOKENS')
    expect(fixture.sections.at(-1)?.body).toContain('update-branch')
    expect(fixture.io.edits.at(-1)?.body).toBe(fixture.seedState)
  })
})

/**
 * Steering notes (design D1): `/retry <note>` and `/continue <note>` arguments
 * reach the resumed handler's prompt as enveloped maintainer guidance. The
 * note's lifetime is the prompt it rode in — no state block, no handoff change,
 * nothing persisted — and an argument-less command produces a byte-identical
 * prompt to today's.
 */

/** An implement-phase input with the command the run was re-entered by. */
const resumedInput = (command: ParsedCommand | null): { input: PhaseInput; io: StubIo } => {
  const built = implementInput('- [ ] Add the wrapper\n')
  return { input: { ...built.input, command }, io: built.io }
}

describe('handleImplement · steering notes', () => {
  it('threads a /retry note into the resumed step prompt, enveloped and framed', async () => {
    const { input, io } = resumedInput({ command: '/retry', argument: 'pull master and resolve the conflicts first' })

    const outcome = await handleImplement(input)

    expect(outcome.signal).toBe('CHANGES_COMMITTED')
    const prompt = String(io.prompts[0]?.prompt)
    expect(prompt).toContain('pull master and resolve the conflicts first')
    expect(prompt).toContain('maintainer-note')
  })

  it('threads a /continue note the same way — both doors of the resume', async () => {
    const { input, io } = resumedInput({
      command: '/continue',
      argument: 'start from the failing test, not the whole file',
    })

    await handleImplement(input)

    expect(String(io.prompts[0]?.prompt)).toContain('start from the failing test, not the whole file')
  })

  /**
   * Each run mints its own envelope nonce, so "byte-identical" is asserted
   * after normalizing the nonce out — everything else in the prompt must be
   * exactly the argument-less shape, which is what "argument-less commands are
   * unchanged" means observably.
   */
  const nonceFree = (prompt: unknown): string =>
    String(prompt)
      .replace(/id="[^"]+"/gu, 'id="N"')
      .replace(/<\/untrusted_input:[^>]+>/gu, '</untrusted_input:N>')

  it('an argument-less /retry produces the identical prompt to no command at all', async () => {
    const plain = resumedInput(null)
    const bare = resumedInput({ command: '/retry', argument: '' })

    await handleImplement(plain.input)
    await handleImplement(bare.input)

    expect(nonceFree(bare.io.prompts[0]?.prompt)).toBe(nonceFree(plain.io.prompts[0]?.prompt))
  })

  it('persists no note: the state patch and blocks are exactly the argument-less shape', async () => {
    const noted = resumedInput({ command: '/retry', argument: 'resolve the conflicts first' })
    const plain = resumedInput(null)

    const withNote = await handleImplement(noted.input)
    const without = await handleImplement(plain.input)

    expect(withNote.patch).toEqual(without.patch)
    expect(withNote.blocks).toEqual(without.blocks)
    expect(String(noted.io.prompts[0]?.prompt)).not.toContain(String(plain.io.prompts[0]?.prompt))
  })
})
