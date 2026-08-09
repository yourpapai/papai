// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { readBlock } from '../../opencode-agent/src/blocks.js'
import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import { DEFAULT_CHECKS } from '../../opencode-agent/src/config.js'
import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { PostedComment } from '../../opencode-agent/src/github.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { ProgressSnapshot } from '../../opencode-agent/src/progress.js'
import type { RunResult } from '../../opencode-agent/src/run-result.js'
import {
  extractState,
  findLatestState,
  findLatestStateComment,
  initialState,
  serializeState,
} from '../../opencode-agent/src/state-manager.js'
import { persistState } from '../../opencode-agent/src/state-persist.js'
import type { StatePersistDeps } from '../../opencode-agent/src/state-persist.js'
import { renderStatus, STATUS_MARKER } from '../../opencode-agent/src/status-comment.js'
import type { StatusView } from '../../opencode-agent/src/status-comment.js'
import { createStatusReporter, MIN_EDIT_INTERVAL_MS } from '../../opencode-agent/src/status-reporter.js'
import type { StatusDeps } from '../../opencode-agent/src/status-reporter.js'
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
  selfLoginOverride: AGENT_LOGIN,
  selfWorkflowName: 'OpenCode Issue Agent',
  openai: { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5' },
  commitAuthorName: 'agent',
  commitAuthorEmail: 'agent@example.com',
  checkCommand: 'bun test',
  reviewCommand: null,
  checks: DEFAULT_CHECKS,
  reviewMaxRounds: 2,
  reviewPoolSize: 1,
  agentTimeoutMs: 1000,
  jobDeadlineMs: null,
  teardownReserveMs: 180_000,
  wrapUpMs: 120_000,
  ciFixMaxRounds: 2,
  commitRepairMaxRounds: 3,
  maxCiAttempts: 3,
  maxReviewAttempts: 3,
  reviewHintLines: 200,
  maxAttempts: 3,
  maxTokens: 5_000_000,
  diffLimits: { maxFiles: 100, maxLines: 20_000 },
  gitRemoteBase: 'https://github.com/',
  runUrl: RUN_URL,
  labelPrefix: 'agent:',
  skillRoots: [],
  ...overrides,
})

const state = (patch: Partial<AgentState> = {}): AgentState => ({ ...initialState(ISSUE), ...patch })

const view = (overrides: Partial<StatusView> = {}): StatusView => ({
  state: state({ phase: 'REVIEW_AND_MUTATE' }),
  progress: null,
  live: true,
  runUrl: RUN_URL,
  startedMs: STARTED,
  carriedTokens: 0,
  config: config(),
  ...overrides,
})

/** The row for one step of the progress table, whatever it currently says. */
const rowFor = (body: string, title: string): string =>
  body.split('\n').find((line) => line.includes(`${title} |`)) ?? '(no such row)'

describe('renderStatus', () => {
  test('heads the comment with the phase’s own glyph and headline', () => {
    // Not "Implementing": that is the label suffix, and a third name per phase
    // is exactly what one presentation table exists to prevent.
    const body = renderStatus(view())

    expect(body.split('\n')[0]).toBe('### 🛠️ Writing the code — run in progress')
  })

  test('links the job that is doing the work, and says when it started', () => {
    // The one question a maintainer has during the silence: is something
    // actually running, and where do I look. Not an elapsed figure — a minute
    // counter would change the body every minute and defeat the suppression
    // that makes a quiet stretch free.
    const body = renderStatus(view())

    expect(body).toBe(renderStatus(view()))
    expect(body).toContain(`**Job:** [this run](${RUN_URL}) · started 14:02 UTC`)
    expect(body).not.toContain('elapsed')
  })

  test('names the branch and says plainly that there is no pull request yet', () => {
    expect(renderStatus(view())).toContain('**Branch:** `agent/issue-42` · **Pull request:** _not opened yet_')
  })

  test('marks the phases behind, the phase in flight, and the ones still ahead', () => {
    const body = renderStatus(view())

    expect(rowFor(body, 'Triage')).toBe('| 🔍 Triage | ✅ |')
    expect(rowFor(body, 'Implementation')).toBe('| 🛠️ Implementation | ⏳ **now** |')
    expect(rowFor(body, 'Pull request')).toBe('| 📦 Pull request | ⬜ |')
  })

  test('reads each artefact’s revision rather than recounting it', () => {
    // The two counters were split apart because one number could not honestly
    // label two artefacts; this table is the second place that would go wrong.
    const body = renderStatus(view({ state: state({ phase: 'REVIEW_AND_MUTATE', specRevision: 3, planRevision: 1 }) }))

    expect(rowFor(body, 'Design spec')).toContain('· revision 3')
    expect(rowFor(body, 'Planning')).toContain('· revision 1')
  })

  test('the plan waiting for approval is the planning row, not a sixth one', () => {
    const body = renderStatus(view({ state: state({ phase: 'PLAN_REVIEW' }) }))

    expect(rowFor(body, 'Planning')).toContain('⏳ **now**')
    expect(body.split('\n').filter((line) => line.startsWith('| ')).length).toBe(7)
  })

  test('says what the model is doing, in names and counts only', () => {
    const progress: ProgressSnapshot = { lastAction: 'bash (running)', toolCalls: 34, tokens: 218_000, cost: 0 }

    const body = renderStatus(view({ progress }))

    expect(body).toContain('**Doing:** bash (running) · 34 tool calls')
    // The live figure, from the heartbeat, while the persisted one is still
    // whatever the last posted comment recorded.
    expect(body).toContain('**Budget:** 218,000 of 5,000,000 tokens')
  })

  test('never claims a smaller total than the state block already carries', () => {
    // The persisted figure comes from the provider's usage block; the
    // heartbeat's is summed from events that have arrived so far. A phase that
    // has already posted therefore knows more than the tick does, and the line
    // must not walk the total backwards when it ticks again.
    const progress: ProgressSnapshot = { lastAction: 'starting', toolCalls: 0, tokens: 10, cost: 0 }

    const body = renderStatus(view({ state: state({ tokensSpent: 900_000 }), carriedTokens: 0, progress }))

    expect(body).toContain('**Budget:** 900,000 of 5,000,000 tokens')
  })

  test('the attempt in flight is the one a failure here would report', () => {
    expect(renderStatus(view({ state: state({ phase: 'PLANNING', attempts: 1 }) }))).toContain('attempt 2 of 3')
  })

  test('a CI round says it is counted per pull request', () => {
    // `ciAttempts` is per pull request, so the same "2 of 3" on the next one
    // would be two different attempts.
    const body = renderStatus(view({ state: state({ phase: 'CI_FIX', ciAttempts: 2, prUrl: 'https://p/1' }) }))

    expect(body).toContain('attempt 2 of 3 on this pull request')
  })

  test('a finished run drops the progress line and wears the state it ended in', () => {
    const progress: ProgressSnapshot = { lastAction: 'bash (running)', toolCalls: 34, tokens: 5, cost: 0 }
    const ended = state({ phase: 'COMPLETE', prUrl: 'https://example.test/pull/7' })

    const body = renderStatus(view({ state: ended, live: false, progress }))

    expect(body.split('\n')[0]).toBe('### ✅ Delivered')
    expect(body).not.toContain('**Doing:**')
    expect(rowFor(body, 'Pull request')).toBe('| 📦 Pull request | ✅ |')
  })

  test('a failed run marks the step it broke on with the failure’s own glyph', () => {
    const broken = state({ phase: 'FAILED', resumeFrom: 'PLANNING' })

    const body = renderStatus(view({ state: broken, live: false }))

    expect(rowFor(body, 'Planning')).toBe('| 🗺️ Planning | ❌ |')
    expect(rowFor(body, 'Implementation')).toBe('| 🛠️ Implementation | ⬜ |')
  })

  test('a cancelled issue stops where its artefacts say it got to', () => {
    // `COMPLETE` alone says only that the conversation is over. Claiming every
    // step finished on an issue cancelled during spec review would be a lie the
    // table tells about work nobody did.
    const cancelled = state({ phase: 'COMPLETE', specRevision: 1 })

    const body = renderStatus(view({ state: cancelled, live: false }))

    expect(rowFor(body, 'Design spec')).toContain('🛑')
    expect(rowFor(body, 'Implementation')).toBe('| 🛠️ Implementation | ⬜ |')
  })

  test('carries no state block, whatever it is rendering', () => {
    // Rule 4, at the renderer: `findLatestState` restores from the newest agent
    // comment carrying one, so a second writer of that block is a second source
    // of truth.
    const body = renderStatus(view())

    expect(body).not.toContain('AGENT_STATE')
    expect(extractState(body)).toBeNull()
  })

  test('carries a marker of its own, so the prompt layer can leave it out', () => {
    // The comment has to be findable without being believable. A marker is
    // matched exactly, so `AGENT_STATUS` cannot be read as `AGENT_STATE` by the
    // restore scan — and `renderThread` drops what carries it, because one
    // progress table per run would otherwise eat the window the model reads the
    // conversation through.
    expect(readBlock(renderStatus(view()), STATUS_MARKER)).toEqual({ run: RUN_URL })
  })

  test('the two markers do not read as each other', () => {
    expect(readBlock(renderStatus(view()), 'AGENT_STATE')).toBeUndefined()
    expect(readBlock(`prose\n\n${serializeState(state())}`, STATUS_MARKER)).toBeUndefined()
  })

  test('a thread carrying status comments restores the same state as one without', () => {
    // The rule-4 invariant at the scan itself, with the marked comment newest —
    // which is where a marker that collided would do its damage.
    const conversation = [withState(1, { phase: 'PLAN_REVIEW', planRevision: 2 })]
    const interleaved = [...conversation, agentComment(2, renderStatus(view()))]

    expect(findLatestState(interleaved, AGENT_LOGIN, ISSUE)).toEqual(findLatestState(conversation, AGENT_LOGIN, ISSUE))
    expect(findLatestStateComment(interleaved, AGENT_LOGIN, ISSUE)?.comment.id).toBe(1)
  })
})

/** Records what the status channel sent, and can be told to refuse. */
interface StatusIo {
  created: string[]
  edits: { id: number; body: string }[]
  createError: Error | null
  editError: Error | null
  nowMs: number
}

const statusHarness = (overrides: Partial<PipelineConfig> = {}): { io: StatusIo; deps: StatusDeps } => {
  const io: StatusIo = { created: [], edits: [], createError: null, editError: null, nowMs: STARTED }

  const deps: StatusDeps = {
    github: {
      createComment: (_issueNumber, body): Promise<PostedComment> => {
        if (io.createError !== null) return Promise.reject(io.createError)
        io.created.push(body)
        return Promise.resolve({ id: 900, url: 'https://example.test/c/900', authorLogin: AGENT_LOGIN })
      },
      updateComment: (id, body): Promise<void> => {
        io.edits.push({ id, body })
        return io.editError === null ? Promise.resolve() : Promise.reject(io.editError)
      },
    },
    log: silentLogger(),
    config: config(overrides),
    now: () => io.nowMs,
  }

  return { io, deps }
}

const done: RunResult = {
  status: 'completed',
  reason: 'Pipeline finished',
  state: { ...initialState(ISSUE), phase: 'COMPLETE', prUrl: 'https://example.test/pull/7' },
  reported: true,
}

describe('createStatusReporter', () => {
  test('opens exactly one comment for the run and edits it thereafter', () => {
    const { io, deps } = statusHarness()
    const reporter = createStatusReporter(deps)

    return (async (): Promise<void> => {
      await reporter.start(state({ phase: 'PLANNING' }))
      io.nowMs += MIN_EDIT_INTERVAL_MS
      await reporter.enter(state({ phase: 'REVIEW_AND_MUTATE' }))

      expect(io.created).toHaveLength(1)
      expect(io.edits).toHaveLength(1)
      expect(io.edits[0]?.id).toBe(900)
      expect(io.edits[0]?.body).toContain('Writing the code')
    })()
  })

  test('a second tick inside the window issues no request', async () => {
    // The clock is injected precisely so this is provable without waiting a
    // minute for it, and the bound is what keeps a 90-minute run inside the
    // secondary rate limit on content-mutating requests.
    const { io, deps } = statusHarness()
    const reporter = createStatusReporter(deps)
    await reporter.start(state({ phase: 'REVIEW_AND_MUTATE' }))

    io.nowMs += MIN_EDIT_INTERVAL_MS
    await reporter.tick({ lastAction: 'bash (running)', toolCalls: 1, tokens: 10, cost: 0 })
    io.nowMs += 1_000
    await reporter.tick({ lastAction: 'read (running)', toolCalls: 2, tokens: 20, cost: 0 })

    expect(io.edits).toHaveLength(1)
    expect(io.edits[0]?.body).toContain('bash (running)')
  })

  test('an unchanged body issues nothing, however long the run has been quiet', async () => {
    // The other half of the cost bound, and the one that makes a twenty-minute
    // model call with no tool use free rather than twenty edits saying the same
    // thing. The window is long past, so only the body is holding this back.
    const { io, deps } = statusHarness()
    const reporter = createStatusReporter(deps)
    await reporter.start(state({ phase: 'REVIEW_AND_MUTATE' }))
    const quiet: ProgressSnapshot = { lastAction: 'thinking', toolCalls: 0, tokens: 0, cost: 0 }

    io.nowMs += 10 * MIN_EDIT_INTERVAL_MS
    await reporter.enter(state({ phase: 'REVIEW_AND_MUTATE' }))
    await reporter.tick(quiet)
    io.nowMs += 10 * MIN_EDIT_INTERVAL_MS
    await reporter.tick(quiet)

    // One edit, for the tick that actually said something new.
    expect(io.edits).toHaveLength(1)
    expect(io.edits[0]?.body).toContain('**Doing:** thinking · 0 tool calls')
  })

  test('the final edit is not held back by the window', async () => {
    // A run that ends inside the minute would otherwise leave "run in progress"
    // on the issue for ever.
    const { io, deps } = statusHarness()
    const reporter = createStatusReporter(deps)
    await reporter.start(state({ phase: 'PR_DELIVERY' }))

    io.nowMs += 2_000
    await reporter.finish(done)

    expect(io.edits).toHaveLength(1)
    expect(io.edits[0]?.body.split('\n')[0]).toBe('### ✅ Delivered')
    expect(io.edits[0]?.body).not.toContain('run in progress')
  })

  test('a refused edit is a warning, and the next one retries it', async () => {
    const { io, deps } = statusHarness()
    const reporter = createStatusReporter(deps)
    await reporter.start(state({ phase: 'REVIEW_AND_MUTATE' }))
    io.editError = new Error('Resource not accessible by integration')

    io.nowMs += MIN_EDIT_INTERVAL_MS
    await expect(reporter.enter(state({ phase: 'PR_DELIVERY' }))).resolves.toBeUndefined()
    io.editError = null
    io.nowMs += MIN_EDIT_INTERVAL_MS
    await reporter.enter(state({ phase: 'PR_DELIVERY' }))

    // The body it failed to write is not remembered as written, so the retry
    // actually carries it.
    expect(io.edits).toHaveLength(2)
    expect(io.edits[1]?.body).toContain('Opening the pull request')
  })

  test('a refused create leaves every later call a no-op', async () => {
    // The degradation this channel is allowed: back to exactly the behaviour of
    // a pipeline that never had a status comment.
    const { io, deps } = statusHarness()
    io.createError = new Error('403')
    const reporter = createStatusReporter(deps)

    await expect(reporter.start(state())).resolves.toBeUndefined()
    await reporter.enter(state({ phase: 'REVIEW_AND_MUTATE' }))
    await reporter.tick({ lastAction: 'bash (running)', toolCalls: 1, tokens: 1, cost: 0 })
    await reporter.finish(done)

    expect(io.edits).toEqual([])
  })

  test('a run with no job to link to says nothing at all', async () => {
    // A local `--event-path` run is an ordinary way to drive this CLI, and the
    // comment's first line is a link to the job doing the work.
    const { io, deps } = statusHarness({ runUrl: null })
    const reporter = createStatusReporter(deps)

    await reporter.start(state())
    await reporter.finish(done)

    expect(io.created).toEqual([])
    expect(io.edits).toEqual([])
  })

  test('finish returns nothing, so a status comment cannot report', async () => {
    // Rule 7 in the type system rather than in a convention: `RunResult` never
    // comes back out of this channel, so the flag the workflow's fallback
    // comment is gated on is unreachable from here.
    const { deps } = statusHarness()
    const reporter = createStatusReporter(deps)
    await reporter.start(state({ phase: 'REVIEW_AND_MUTATE' }))

    expect(await reporter.finish(done)).toBeUndefined()
    expect(done.reported).toBe(true)
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
