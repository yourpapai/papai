// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { readBlock } from '../../opencode-agent/src/blocks.js'
import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { PostedComment } from '../../opencode-agent/src/github.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import { renderThread } from '../../opencode-agent/src/prompt-budget.js'
import { createEnvelope } from '../../opencode-agent/src/prompts.js'
import { createReplyBuffer } from '../../opencode-agent/src/reply-buffer.js'
import type { ReplyDeps, ReplyBuffer } from '../../opencode-agent/src/reply-buffer.js'
import { BODY_BUDGET, renderReply, STATUS_MARKER } from '../../opencode-agent/src/reply-comment.js'
import type { ReportSection, ReplyView } from '../../opencode-agent/src/reply-comment.js'
import {
  extractState,
  findLatestState,
  findLatestStateComment,
  initialState,
  serializeState,
} from '../../opencode-agent/src/state-manager.js'
import { persistState } from '../../opencode-agent/src/state-persist.js'
import type { StatePersistDeps } from '../../opencode-agent/src/state-persist.js'
import type { AgentState } from '../../opencode-agent/src/types.js'

const AGENT_LOGIN = 'agent-bot'
const ISSUE = 42
const RUN_URL = 'https://github.test/acme/widgets/actions/runs/1482'
const STARTED = Date.UTC(2026, 7, 7, 14, 2)

const silentLogger = (): Logger => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})

const config = (overrides: Partial<PipelineConfig> = {}): PipelineConfig => ({
  repoRoot: '/repo',
  owner: 'acme',
  repo: 'widgets',
  githubToken: 'token',
  backend: 'opencode',
  claudeCredential: null,
  selfLoginOverride: AGENT_LOGIN,
  selfWorkflowName: 'OpenCode Issue Agent',
  openai: { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', provider: 'openai' },
  commitAuthorName: 'agent',
  commitAuthorEmail: 'agent@example.com',
  checkCommand: 'bun test',
  reviewCommand: null,
  reviewMaxRounds: 2,
  reviewPoolSize: 1,
  agentTimeoutMs: 1000,
  stallTimeoutMs: 300_000,
  jobDeadlineMs: null,
  teardownReserveMs: 180_000,
  wrapUpMs: 120_000,
  ciFixMaxRounds: 2,
  commitRepairMaxRounds: 3,
  syncRepairMaxRounds: 3,
  maxCiAttempts: 3,
  maxReviewAttempts: 3,
  reviewHintLines: 200,
  maxAttempts: 3,
  maxTokens: 5_000_000,
  diffLimits: { maxFiles: 100, maxLines: 20_000 },
  gitRemoteBase: 'https://github.com/',
  runUrl: RUN_URL,
  labelPrefix: 'agent:',
  logKey: null,
  skillRoots: [],
  ...overrides,
})

const state = (patch: Partial<AgentState> = {}): AgentState => ({ ...initialState(ISSUE), ...patch })

const view = (overrides: Partial<ReplyView> = {}): ReplyView => ({
  state: state({ phase: 'REVIEW_AND_MUTATE' }),
  sections: [],
  runUrl: RUN_URL,
  startedMs: STARTED,
  config: config(),
  ...overrides,
})

const section = (summary: string, body: string, blocks: readonly string[] = []): ReportSection => ({
  summary,
  body,
  blocks,
})

/** The row for one step of the progress table, whatever it currently says. */
const rowFor = (body: string, title: string): string =>
  body.split('\n').find((line) => line.includes(`${title} |`)) ?? '(no such row)'

/** Where each landmark of the body sits, so ordering is asserted as ordering. */
const at = (body: string, needle: string): number => body.indexOf(needle)

describe('renderReply', () => {
  test('heads the comment with the phase’s own glyph and headline', () => {
    // Not "Implementing": that is the label suffix, and a third name per phase
    // is exactly what one presentation table exists to prevent. And never
    // "— run in progress": the comment is written once, when the run is over.
    const body = renderReply(view())

    expect(body.split('\n')[0]).toBe('### 🛠️ Writing the code')
    expect(body).not.toContain('run in progress')
  })

  test('links the job that is doing the work, and says when it started', () => {
    // The one question a maintainer has during the silence: is something
    // actually running, and where do I look. Not an elapsed figure — a minute
    // counter would change the body every minute and defeat the suppression
    // that makes a quiet stretch free.
    const body = renderReply(view())

    expect(body).toBe(renderReply(view()))
    expect(body).toContain(`**Job:** [this run](${RUN_URL}) · started 14:02 UTC`)
    expect(body).not.toContain('elapsed')
  })

  test('names the branch and says plainly that there is no pull request yet', () => {
    expect(renderReply(view())).toContain('**Branch:** `agent/issue-42` · **Pull request:** _not opened yet_')
  })

  test('marks the phases behind, the phase it stopped on, and the ones still ahead', () => {
    // The row it stopped on wears the waiting phase's own glyph. There is no
    // "⏳ now" any more — a comment posted after the run cannot have one.
    const body = renderReply(view())

    expect(body).not.toContain('⏳')
    expect(rowFor(body, 'Triage')).toBe('| 🔍 Triage | ✅ |')
    expect(rowFor(body, 'Implementation')).toBe('| 🛠️ Implementation | 🛠️ |')
    expect(rowFor(body, 'Pull request')).toBe('| 📦 Pull request | ⬜ |')
  })

  test('the plan row carries the plan-identity token; the design row carries no counter', () => {
    // Under the OpenSpec rework the proposal lives in the folder whose history
    // *is* its revision, so the "Design spec" row reports no counter and only
    // the plan row carries the machine's plan-identity token (`planRevision`).
    const body = renderReply(view({ state: state({ phase: 'REVIEW_AND_MUTATE', planRevision: 1 }) }))

    expect(rowFor(body, 'Design spec')).not.toContain('· revision')
    expect(rowFor(body, 'Planning')).toContain('· revision 1')
  })

  test('the plan waiting for approval is the planning row, not a sixth one', () => {
    const body = renderReply(view({ state: state({ phase: 'PLAN_REVIEW' }) }))

    expect(rowFor(body, 'Planning')).toContain('🧭')
    expect(body.split('\n').filter((line) => line.startsWith('| ')).length).toBe(7)
  })

  test('the budget line is the state’s own total, with no live arithmetic left', () => {
    // `tokensSpent` is authoritative at the moment this renders, because the
    // comment is written after the run. The heartbeat's running total, and the
    // `max()` that reconciled the two while a comment was being edited mid-run,
    // went with the live channel — a second figure that can only disagree.
    const body = renderReply(view({ state: state({ tokensSpent: 900_000 }) }))

    expect(body).toContain('**Budget:** 900,000 of 5,000,000 tokens')
    expect(body).not.toContain('**Doing:**')
  })

  test('the attempt in flight is the one a failure here would report', () => {
    expect(renderReply(view({ state: state({ phase: 'PLANNING', attempts: 1 }) }))).toContain('attempt 2 of 3')
  })

  test('a CI round says it is counted per pull request', () => {
    // `ciAttempts` is per pull request, so the same "2 of 3" on the next one
    // would be two different attempts.
    const body = renderReply(view({ state: state({ phase: 'CI_FIX', ciAttempts: 2, prUrl: 'https://p/1' }) }))

    expect(body).toContain('attempt 2 of 3 on this pull request')
  })

  test('a finished run wears the state it ended in', () => {
    const ended = state({ phase: 'COMPLETE', prUrl: 'https://example.test/pull/7' })

    const body = renderReply(view({ state: ended }))

    expect(body.split('\n')[0]).toBe('### ✅ Delivered')
    expect(body).not.toContain('**Doing:**')
    expect(rowFor(body, 'Pull request')).toBe('| 📦 Pull request | ✅ |')
  })

  test('a failed run marks the step it broke on with the failure’s own glyph', () => {
    const broken = state({ phase: 'FAILED', resumeFrom: 'PLANNING' })

    const body = renderReply(view({ state: broken }))

    expect(rowFor(body, 'Planning')).toBe('| 🗺️ Planning | ❌ |')
    expect(rowFor(body, 'Implementation')).toBe('| 🛠️ Implementation | ⬜ |')
  })

  test('a cancelled issue stops where its artefacts say it got to', () => {
    // `COMPLETE` alone says only that the conversation is over. Claiming every
    // step finished on an issue cancelled during spec review would be a lie the
    // table tells about work nobody did.
    const cancelled = state({ phase: 'COMPLETE', changeName: 'captured-but-unplanned' })

    const body = renderReply(view({ state: cancelled }))

    expect(rowFor(body, 'Design spec')).toContain('🛑')
    expect(rowFor(body, 'Implementation')).toBe('| 🛠️ Implementation | ⬜ |')
  })

  test('carries no state block, whatever it is rendering', () => {
    // Rule 4, at the renderer: `findLatestState` restores from the newest agent
    // comment carrying one, so a second writer of that block is a second source
    // of truth.
    const body = renderReply(view())

    expect(body).not.toContain('AGENT_STATE')
    expect(extractState(body)).toBeNull()
  })

  test('carries a marker of its own, so the prompt layer can leave it out', () => {
    // The comment has to be findable without being believable. A marker is
    // matched exactly, so `AGENT_STATUS` cannot be read as `AGENT_STATE` by the
    // restore scan — and `renderThread` drops what carries it, because one
    // progress table per run would otherwise eat the window the model reads the
    // conversation through.
    expect(readBlock(renderReply(view()), STATUS_MARKER)).toEqual({ run: RUN_URL })
  })

  test('with no sections it is a header, the collapsed run detail and its marker', () => {
    // The shape a run that reported nothing lands in, and the base every
    // section is added to. The run detail is collapsed because it is the
    // summary of a finished run, not the thing the maintainer came to read.
    const body = renderReply(view())

    expect(body).toContain('<details><summary>Run detail</summary>')
    expect(at(body, '<details><summary>Run detail</summary>')).toBeGreaterThan(at(body, '###'))
    expect(at(body, '| Phase | |')).toBeGreaterThan(at(body, '<details><summary>Run detail</summary>'))
  })

  test('renders every section in order, the newest open and the rest collapsed', () => {
    // Latest last, and latest *open*: a job crossing three phases still reads as
    // one reply whose bottom is what just happened.
    const sections = [
      section('Reading the issue', 'Adopted `prompt-injection-defense`.'),
      section('Drafting the plan', '### Plan (revision 1)'),
    ]

    const body = renderReply(view({ sections }))

    expect(at(body, 'Adopted `prompt-injection-defense`.')).toBeLessThan(at(body, '### Plan (revision 1)'))
    expect(body).toContain('<details><summary>Reading the issue</summary>')
    // The newest is not wrapped: it is the answer, not an appendix.
    expect(body).not.toContain('<details><summary>Drafting the plan</summary>')
  })

  test('the marker opens the bookkeeping, and the run detail is inside it', () => {
    // The contract with `renderThread`, which cuts the body at the marker: every
    // section is above it and the run detail is below, because a progress table
    // is bookkeeping — it is the original reason the marker exists. The marker
    // is an HTML comment, so a human still sees the disclosure in place.
    const body = renderReply(view({ sections: [section('Drafting the plan', '### Plan (revision 1)')] }))

    expect(at(body, '### Plan (revision 1)')).toBeLessThan(at(body, STATUS_MARKER))
    expect(at(body, STATUS_MARKER)).toBeLessThan(at(body, '<details><summary>Run detail</summary>'))
    expect(at(body, STATUS_MARKER)).toBeLessThan(at(body, '**Budget:**'))
  })

  test('heads the whole comment once, however many sections it carries', () => {
    // Where the `### ❌ Run failed` / `### ❌ Run failed in INIT_OR_CLARIFY`
    // duplication goes: one heading for the run, and the sections speak for
    // their own phases.
    const sections = [section('Reading the issue', 'first'), section('Drafting the plan', 'second')]

    const body = renderReply(view({ state: state({ phase: 'PLAN_REVIEW' }), sections }))

    expect(body.split('\n').filter((line) => line.startsWith('### ')).length).toBe(1)
    expect(body.split('\n')[0]).toBe('### 🧭 Plan is waiting for you')
  })

  test('a section carrying its own markdown is never reflowed', () => {
    // Sections are model-written reports: headings, fences and `---` rules are
    // ordinary in them, and the renderer's job is to place them, not parse them.
    const report = '## Answer\n\n```ts\nconst x = 1\n```\n\n---\n\nDone.'

    expect(renderReply(view({ sections: [section('Answering', report)] }))).toContain(report)
  })

  test('carries every section’s blocks, oldest first, below the marker', () => {
    // Newest-wins across a run is "last block in the body" — the property
    // `readBlock` already has — so the order sections were appended in is the
    // order their blocks have to appear in.
    const sections = [
      section('Reading the issue', 'first', [serializeState(state({ phase: 'DESIGN_SPEC' }))]),
      section('Drafting the plan', 'second', [serializeState(state({ phase: 'PLAN_REVIEW', planRevision: 2 }))]),
    ]

    const body = renderReply(view({ sections }))

    expect(at(body, STATUS_MARKER)).toBeLessThan(at(body, 'AGENT_STATE'))
    expect(extractState(body)?.phase).toBe('PLAN_REVIEW')
    expect(extractState(body)?.planRevision).toBe(2)
  })

  test('a body over budget sheds the oldest sections and says how many', () => {
    const long = (marker: string): string => `${marker} ${'x'.repeat(20_000)}`
    const sections = [
      section('Reading the issue', long('OLDEST')),
      section('Drafting the plan', long('MIDDLE')),
      section('Writing the code', long('NEWEST')),
    ]

    const body = renderReply(view({ sections }))

    expect(body.length).toBeLessThanOrEqual(BODY_BUDGET)
    expect(body).toContain('NEWEST')
    expect(body).not.toContain('OLDEST')
    expect(body).toContain('_(1 earlier section in this run was trimmed — see the run log.)_')
  })

  test('shedding a section never sheds its blocks', () => {
    // The invariant that keeps a trimmed comment from stranding an issue: the
    // visible prose is the budget's to spend, the run's memory is not.
    const oldest = serializeState(state({ phase: 'DESIGN_SPEC' }))
    const sections = [
      section('Reading the issue', `OLDEST ${'x'.repeat(40_000)}`, [oldest]),
      section('Writing the code', `NEWEST ${'x'.repeat(40_000)}`, []),
    ]

    const body = renderReply(view({ sections }))

    expect(body).not.toContain('OLDEST')
    expect(body).toContain(oldest)
    expect(extractState(body)?.phase).toBe('DESIGN_SPEC')
  })

  test('a newest section that alone exceeds the budget keeps its conclusion', () => {
    // Truncated from the top: a maintainer reading a report wants how it ended,
    // and the tail is where a report puts it.
    const body = renderReply(view({ sections: [section('Answering', `HEAD ${'x'.repeat(80_000)} TAIL`)] }))

    expect(body.length).toBeLessThanOrEqual(BODY_BUDGET)
    expect(body).toContain('TAIL')
    expect(body).not.toContain('HEAD')
    expect(body).toContain('…(truncated)…')
  })

  test('the run detail and the marker survive any amount of shedding', () => {
    // Everything below the sections is what the next job and the prompt layer
    // read; a budget that could eat it would be trading memory for prose.
    const body = renderReply(view({ sections: [section('Answering', 'y'.repeat(90_000))] }))

    expect(body).toContain('<details><summary>Run detail</summary>')
    expect(body).toContain('**Budget:**')
    expect(readBlock(body, STATUS_MARKER)).toEqual({ run: RUN_URL })
  })

  test('everything the model must read survives the prompt layer’s cut', () => {
    // The join between the two halves of this change, asserted against a body
    // this renderer actually produced rather than one hand-written to match:
    // `renderReply` puts the run detail last of the visible body *because*
    // `renderThread` cuts there, and a test built from a literal would keep
    // passing after one of them moved.
    const sections = [section('Reading the issue', 'Adopted the change.'), section('Answering', '## Answer\n\nYes.')]
    const comment: IssueComment = { id: 1, body: renderReply(view({ sections })), authorLogin: AGENT_LOGIN }

    const rendered = renderThread(createEnvelope('abc123'), [comment])

    expect(rendered).toContain('Adopted the change.')
    expect(rendered).toContain('## Answer')
    expect(rendered).not.toContain('| Phase | |')
    expect(rendered).not.toContain('**Budget:**')
    expect(rendered).not.toContain('AGENT_STATUS')
  })

  test('a body inside the budget is left exactly as it was', () => {
    const sections = [section('Reading the issue', 'first'), section('Drafting the plan', 'second')]

    expect(renderReply(view({ sections }))).not.toContain('trimmed')
  })

  test('the two markers do not read as each other', () => {
    expect(readBlock(renderReply(view()), 'AGENT_STATE')).toBeUndefined()
    expect(readBlock(`prose\n\n${serializeState(state())}`, STATUS_MARKER)).toBeUndefined()
  })

  test('a thread carrying status comments restores the same state as one without', () => {
    // The rule-4 invariant at the scan itself, with the marked comment newest —
    // which is where a marker that collided would do its damage.
    const conversation = [withState(1, { phase: 'PLAN_REVIEW', planRevision: 2 })]
    const interleaved = [...conversation, agentComment(2, renderReply(view()))]

    expect(findLatestState(interleaved, AGENT_LOGIN, ISSUE)).toEqual(findLatestState(conversation, AGENT_LOGIN, ISSUE))
    expect(findLatestStateComment(interleaved, AGENT_LOGIN, ISSUE)?.comment.id).toBe(1)
  })
})

const agentComment = (id: number, body: string): IssueComment => ({ id, body, authorLogin: AGENT_LOGIN })

const withState = (id: number, patch: Partial<AgentState>, prose = 'earlier'): IssueComment =>
  agentComment(id, `${prose}\n\n${serializeState(state(patch))}`)

const persistDeps = (edits: { id: number; body: string }[], error: Error | null = null): StatePersistDeps => ({
  github: {
    updateComment: (id, body): Promise<void> => {
      edits.push({ id, body })
      return error === null ? Promise.resolve() : Promise.reject(error)
    },
  },
  log: silentLogger(),
  selfLogin: (): Promise<string> => Promise.resolve(AGENT_LOGIN),
})

/** Records what the reply channel sent, and can be told to refuse. */
interface ReplyIo {
  created: string[]
  /** Which issue or pull request each comment was opened against. */
  createdOn: number[]
  createError: Error | null
  postedAs: string
  errors: string[]
}

const replyHarness = (overrides: Partial<PipelineConfig> = {}): { io: ReplyIo; deps: ReplyDeps } => {
  const io: ReplyIo = { created: [], createdOn: [], createError: null, postedAs: AGENT_LOGIN, errors: [] }

  const deps: ReplyDeps = {
    github: {
      createComment: (issueNumber, body): Promise<PostedComment> => {
        if (io.createError !== null) return Promise.reject(io.createError)
        io.createdOn.push(issueNumber)
        io.created.push(body)
        return Promise.resolve({ id: 900, url: 'https://example.test/c/900', authorLogin: io.postedAs })
      },
    },
    log: { ...silentLogger(), error: (_meta, message): void => void io.errors.push(message ?? '') },
    config: config(overrides),
    selfLogin: (): Promise<string> => Promise.resolve(AGENT_LOGIN),
  }

  return { io, deps }
}

const reporterFor = (overrides: Partial<PipelineConfig> = {}): { io: ReplyIo; reporter: ReplyBuffer } => {
  const { io, deps } = replyHarness(overrides)
  return { io, reporter: createReplyBuffer(deps, STARTED) }
}

const report = (body: string, blocks: readonly string[] = []): ReportSection =>
  section('Writing the code', body, blocks)

describe('createReplyBuffer', () => {
  test('says nothing at all until the run is flushed', async () => {
    // The property that buys the notification back: a create at the end tells
    // GitHub to notify when the answer lands, where an edit tells it nothing.
    const { io, reporter } = reporterFor()
    reporter.begin(state({ phase: 'PLANNING' }))

    reporter.section(state({ phase: 'PLAN_REVIEW' }), report('### Plan (revision 1)'))
    expect(io.created).toEqual([])

    await reporter.flush()
    expect(io.created).toHaveLength(1)
  })

  test('one comment for the run, however many sections it collected', async () => {
    const { io, reporter } = reporterFor()
    reporter.begin(state({ phase: 'REVIEW_AND_MUTATE' }))

    reporter.section(state({ phase: 'PR_DELIVERY' }), section('Writing the code', 'Implemented.'))
    reporter.section(state({ phase: 'COMPLETE', prUrl: 'https://p/7' }), section('Opening the pull request', 'Ready.'))
    await reporter.flush()

    expect(io.created).toHaveLength(1)
    expect(String(io.created[0])).toContain('Implemented.')
    expect(String(io.created[0])).toContain('Ready.')
  })

  test('wears the state of the newest section, not the one it began on', async () => {
    const { io, reporter } = reporterFor()
    reporter.begin(state({ phase: 'PLANNING' }))

    reporter.section(state({ phase: 'PLAN_REVIEW' }), report('### Plan (revision 1)'))
    await reporter.flush()

    expect(String(io.created[0]).split('\n')[0]).toBe('### 🧭 Plan is waiting for you')
    expect(String(io.created[0])).not.toContain('run in progress')
  })

  test('a run that collected nothing posts nothing', async () => {
    // A guardrail denial, a `/cancel` that settles without a handler, and the
    // classifier's `none` branch all reach the flush with an empty buffer.
    const { io, reporter } = reporterFor()
    reporter.begin(state())

    expect(await reporter.flush()).toBeNull()
    expect(io.created).toEqual([])
  })

  test('a refused create is a warning, and answers null so nothing claims it reported', async () => {
    // The one narrowing of "feedback never fails a run": still swallowed, but
    // the caller must not mark an issue as carrying a report GitHub refused.
    const { io, reporter } = reporterFor()
    io.createError = new Error('Resource not accessible by integration')
    reporter.begin(state({ phase: 'PLANNING' }))
    reporter.section(state({ phase: 'PLAN_REVIEW' }), report('### Plan (revision 1)'))

    expect(await reporter.flush()).toBeNull()
  })

  test('a run with no job to link to still posts, saying so', async () => {
    // This used to be the no-op reporter's case. The comment now carries the
    // report, so it posts and drops the link rather than staying silent.
    const { io, reporter } = reporterFor({ runUrl: null })
    reporter.begin(state({ phase: 'PLANNING' }))
    reporter.section(state({ phase: 'PLAN_REVIEW' }), report('### Plan (revision 1)'))

    await reporter.flush()

    expect(io.created).toHaveLength(1)
    expect(String(io.created[0])).toContain('**Job:** local run')
  })

  test('begins each run clean, so a finished run’s sections are never posted twice', async () => {
    // A process drives one run, so in production this clears nothing — but a
    // buffer that quietly kept a previous run's sections would post them again
    // under the next run's heading.
    const { io, reporter } = reporterFor()
    reporter.begin(state({ phase: 'PLANNING' }))
    reporter.section(state({ phase: 'PLAN_REVIEW' }), report('first run'))
    await reporter.flush()

    reporter.begin(state({ phase: 'PLAN_REVIEW' }))
    reporter.section(state({ phase: 'REVIEW_AND_MUTATE' }), report('second run'))
    await reporter.flush()

    expect(String(io.created[1])).toContain('second run')
    expect(String(io.created[1])).not.toContain('first run')
  })

  test('reports an identity drift on the run that caused it', async () => {
    // The next job reads real authors back from the API, so a run posting as an
    // account it does not identify as leaves its own comments invisible to it.
    const { io, reporter } = reporterFor()
    io.postedAs = 'github-actions[bot]'
    reporter.begin(state({ phase: 'PLANNING' }))
    reporter.section(state({ phase: 'PLAN_REVIEW' }), report('### Plan (revision 1)'))

    await reporter.flush()

    expect(io.errors.join(' ')).toContain('posted as a different account')
  })
})

/**
 * Which page the run's reply lands on.
 *
 * Resolved once, from the state the run *entered* on — so the delivery that
 * first records `prNumber` still lands on the issue, which is where a reader
 * wants the handover, and every later run lands on the pull request.
 */
describe('createReplyBuffer · where the comment lives', () => {
  test('posts on the issue while there is no pull request', async () => {
    const { io, reporter } = reporterFor()
    reporter.begin(state({ phase: 'PLANNING' }))
    reporter.section(state({ phase: 'PLAN_REVIEW' }), report('x'))

    await reporter.flush()

    expect(io.createdOn).toEqual([ISSUE])
  })

  test('posts on the pull request once the run began with one', async () => {
    const { io, reporter } = reporterFor()
    reporter.begin(state({ phase: 'CI_FIX', prNumber: 7, prUrl: 'https://x.test/pull/7' }))
    reporter.section(state({ phase: 'COMPLETE', prNumber: 7, prUrl: 'https://x.test/pull/7' }), report('x'))

    await reporter.flush()

    expect(io.createdOn).toEqual([7])
  })

  test('a run that opens the pull request still lands on the issue', async () => {
    const { io, reporter } = reporterFor()
    reporter.begin(state({ phase: 'PR_DELIVERY' }))
    reporter.section(state({ phase: 'COMPLETE', prNumber: 7, prUrl: 'https://x.test/pull/7' }), report('Ready.'))

    await reporter.flush()

    expect(io.createdOn).toEqual([ISSUE])
  })
})

/** The thread as GitHub would hold it after an in-place rewrite. */
const applyEdits = (thread: readonly IssueComment[], edits: { id: number; body: string }[]): IssueComment[] =>
  thread.map((comment) => {
    const edit = edits.find((candidate) => candidate.id === comment.id)
    return edit === undefined ? comment : { ...comment, body: edit.body }
  })

describe('persistState', () => {
  test('rewrites the comment the restore scan selected, not the last in the thread', async () => {
    // The failure mode of an in-place update. The newest comment here is a
    // status comment carrying no block, and the one before it is a bystander's
    // — so "the last comment" and "the comment the reader will look at" are
    // three apart.
    const thread: IssueComment[] = [
      withState(1, { phase: 'DESIGN_SPEC' }),
      withState(2, { phase: 'PLAN_REVIEW', tokensSpent: 100 }),
      { id: 3, body: 'looks good to me', authorLogin: 'maintainer' },
      agentComment(4, '### 🛠️ Writing the code — run in progress'),
    ]
    const edits: { id: number; body: string }[] = []

    await persistState(persistDeps(edits), thread, state({ phase: 'PLAN_REVIEW', tokensSpent: 40_100 }))

    expect(edits).toHaveLength(1)
    expect(edits[0]?.id).toBe(2)
    expect(findLatestStateComment(thread, AGENT_LOGIN, ISSUE)?.comment.id).toBe(2)
  })

  test('the state restored afterwards is the state that was written', async () => {
    const thread = [withState(1, { phase: 'PLAN_REVIEW', tokensSpent: 100 })]
    const edits: { id: number; body: string }[] = []
    const recorded = state({ phase: 'PLAN_REVIEW', tokensSpent: 40_100, planRevision: 2 })

    expect(await persistState(persistDeps(edits), thread, recorded)).toEqual(recorded)
    expect(findLatestState(applyEdits(thread, edits), AGENT_LOGIN, ISSUE)).toEqual(recorded)
  })

  test('leaves the visible prose of the comment it rewrites alone', async () => {
    const thread = [withState(1, { phase: 'PLAN_REVIEW' }, '### 🧭 Plan is waiting for you\n\nHere it is.')]
    const edits: { id: number; body: string }[] = []

    await persistState(persistDeps(edits), thread, state({ phase: 'PLAN_REVIEW', tokensSpent: 7 }))

    expect(edits[0]?.body).toContain('### 🧭 Plan is waiting for you\n\nHere it is.')
  })

  test('a payload that could forge the block’s terminator survives the round trip', async () => {
    // `renderBlock` escapes every `<` and `>` so a payload cannot end its own
    // block, and `lastError` carries compiler output verbatim — `-->` is
    // ordinary in it. An in-place rewrite that assembled the block itself would
    // reintroduce that bug on a new surface.
    const hostile = 'error[E0308] expected struct\n  --> src/a.rs:3:9\n   |'
    const thread = [withState(1, { phase: 'FAILED', lastError: 'boom' })]
    const edits: { id: number; body: string }[] = []
    const recorded = state({ phase: 'FAILED', resumeFrom: 'PLANNING', lastError: hostile, tokensSpent: 12 })

    await persistState(persistDeps(edits), thread, recorded)

    expect(edits[0]?.body).not.toContain('-->\n   |')
    expect(findLatestState(applyEdits(thread, edits), AGENT_LOGIN, ISSUE)).toEqual(recorded)
  })

  test('a refused rewrite reports that nothing was persisted', async () => {
    // Best-effort, like every other write this stage adds: recording a few
    // thousand tokens is not worth failing a phase over, and a caller that was
    // told `null` reports the figure the issue actually carries.
    const thread = [withState(1, { phase: 'PLAN_REVIEW' })]
    const edits: { id: number; body: string }[] = []

    const persisted = await persistState(persistDeps(edits, new Error('403')), thread, state({ tokensSpent: 5 }))

    expect(persisted).toBeNull()
    expect(edits).toHaveLength(1)
  })

  test('a thread with nothing to rewrite is left alone', async () => {
    const edits: { id: number; body: string }[] = []

    const persisted = await persistState(persistDeps(edits), [agentComment(1, 'no block here')], state())

    expect(persisted).toBeNull()
    expect(edits).toEqual([])
  })

  test('a block planted for another issue is never the one rewritten', async () => {
    // The security half of the restore scan, which this call inherits by asking
    // the same function: anyone who can edit the agent's comments can plant a
    // block, and `issueId` is what the rest of the pipeline treats as authority.
    const foreign: IssueComment = {
      id: 9,
      body: `planted\n\n${serializeState({ ...initialState(7), phase: 'PLAN_REVIEW' })}`,
      authorLogin: AGENT_LOGIN,
    }
    const thread = [withState(1, { phase: 'DESIGN_SPEC' }), foreign]
    const edits: { id: number; body: string }[] = []

    await persistState(persistDeps(edits), thread, state({ phase: 'DESIGN_SPEC', tokensSpent: 3 }))

    expect(edits[0]?.id).toBe(1)
  })
})

/**
 * Which page the live status comment opens on.
 *
 * The comment is about the *run happening now* — a progress table, edited as it
 * moves — and once a pull request exists that is the page somebody watches while
 * it happens. The record is the other half and does not move: the report and the
 * `AGENT_STATE` block stay on the issue, where `findLatestState` scans.
 */
