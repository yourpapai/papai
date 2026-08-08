// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  findArtifact,
  findHandoff,
  HANDOFF_MARKER,
  PLAN_MARKER,
  renderArtifact,
  SPEC_MARKER,
} from '../../opencode-agent/src/artifacts.js'
import { readBlock } from '../../opencode-agent/src/blocks.js'
import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import { DEFAULT_CHECKS } from '../../opencode-agent/src/config.js'
import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { StagedTotals } from '../../opencode-agent/src/diff-guard.js'
import { turnDeadlineError } from '../../opencode-agent/src/errors.js'
import type { Git, Salvage } from '../../opencode-agent/src/git.js'
import type { PullRequestHead, PullRequestRef, PullRequestStatus } from '../../opencode-agent/src/github-pulls.js'
import type { ReactionContent, ReactionRef, ReactionTarget } from '../../opencode-agent/src/github-reactions.js'
import type { GitHubApi } from '../../opencode-agent/src/github.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { AgentPromptRequest, OpenCodeAgent } from '../../opencode-agent/src/opencode-adapter.js'
import { runPipeline } from '../../opencode-agent/src/orchestrator.js'
import type { PhaseDeps } from '../../opencode-agent/src/phase-context.js'
import type { PullRequestTriggerEvent } from '../../opencode-agent/src/pr-trigger.js'
import type { ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
import type { RunResult } from '../../opencode-agent/src/run-result.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'
import {
  extractState,
  findLatestState,
  initialState,
  serializeState,
  STATE_MARKER,
} from '../../opencode-agent/src/state-manager.js'
import { STATUS_MARKER } from '../../opencode-agent/src/status-comment.js'
import { createStatusReporter } from '../../opencode-agent/src/status-reporter.js'
import type { CiTriggerEvent, IssueTriggerEvent } from '../../opencode-agent/src/trigger-events.js'
import type { AgentState, Phase } from '../../opencode-agent/src/types.js'

const AGENT_LOGIN = 'agent-bot'
const ISSUE = 42
/**
 * The clock every fake in a harness reads, so a job deadline can be expressed
 * relative to it. A constant rather than the real clock: the whole point of the
 * wall-clock bound is being able to stand on either side of it.
 */
const RUN_NOW_MS = Date.UTC(2026, 7, 7, 14, 2)
const BASE_BRANCH = 'trunk'
const OPENING_TAG = /<untrusted_input source="[^"]*" id="([^"]+)">/u

/** A newer state block for a different issue, as a comment edit could plant. */
const PLANTED_STATE: AgentState = { ...initialState(7), phase: 'PLAN_REVIEW' }

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
  reviewCommand: ['bun', 'run', 'review-loop/src/cli.ts'],
  checks: DEFAULT_CHECKS,
  reviewMaxRounds: 2,
  reviewPoolSize: 1,
  agentTimeoutMs: 1000,
  // No job deadline by default, which is what every run had before it existed:
  // the wall-clock stop is off unless a test switches it on.
  jobDeadlineMs: null,
  teardownReserveMs: 180_000,
  wrapUpMs: 120_000,
  ciFixMaxRounds: 2,
  maxCiAttempts: 2,
  maxAttempts: 3,
  maxReviewAttempts: 2,
  reviewHintLines: 200,
  maxTokens: 5_000_000,
  diffLimits: { maxFiles: 100, maxLines: 20_000 },
  gitRemoteBase: 'https://github.com/',
  runUrl: null,
  labelPrefix: 'agent:',
  skillRoots: ['.superpowers/skills'],
  ...overrides,
})

const issueEvent = (overrides: Partial<IssueTriggerEvent> = {}): IssueTriggerEvent => ({
  kind: 'issue',
  eventName: 'issues',
  action: 'opened',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  issueNumber: ISSUE,
  issueTitle: 'Add retries',
  issueBody: 'Please add retries to the HTTP client.',
  isPullRequest: false,
  commentBody: null,
  commentId: null,
  repositoryOwner: 'acme',
  defaultBranch: BASE_BRANCH,
  ...overrides,
})

/** The comment a maintainer typed, which feedback lands on rather than the issue. */
const COMMENT_ID = 555

const comment = (body: string): IssueTriggerEvent =>
  issueEvent({ eventName: 'issue_comment', action: 'created', commentBody: body, commentId: COMMENT_ID })

/** The pull request the agent delivers this issue into, and a comment on it. */
const PR_NUMBER = 7
const PR_COMMENT_ID = 777

/**
 * A `/review` typed where the diff is, already resolved back to its issue.
 *
 * The resolution itself is `pr-trigger.ts`'s and is tested there; what these
 * exercise is everything downstream of it, where a third `kind` either had to be
 * decided or would have been bucketed with the issue events by an `!== 'issue'`.
 */
const prComment = (body: string, overrides: Partial<PullRequestTriggerEvent> = {}): PullRequestTriggerEvent => ({
  kind: 'pull-request',
  eventName: 'issue_comment',
  action: 'created',
  senderLogin: 'maintainer',
  senderType: 'User',
  authorAssociation: 'COLLABORATOR',
  issueNumber: ISSUE,
  prNumber: PR_NUMBER,
  commentBody: body,
  commentId: PR_COMMENT_ID,
  defaultBranch: BASE_BRANCH,
  ...overrides,
})

const ciEvent = (overrides: Partial<CiTriggerEvent> = {}): CiTriggerEvent => ({
  kind: 'ci',
  eventName: 'workflow_run',
  action: 'completed',
  branch: `agent/issue-${ISSUE}`,
  issueNumber: ISSUE,
  conclusion: 'failure',
  workflowName: 'CI',
  runUrl: 'https://example.test/run/1',
  fromThisRepository: true,
  defaultBranch: BASE_BRANCH,
  ...overrides,
})

/** Mutable recording surface shared by every fake in a harness. */
interface PipelineIo {
  thread: IssueComment[]
  posted: string[]
  /**
   * Comments this run put on the **pull request**, kept apart from `posted`.
   *
   * Not a nicety: `listIssueComments(ISSUE)` never returns a pull request's own
   * thread, so folding the two would let a note pass for a comment on the issue
   * — and "typed there, answered here" is the entire shape of this path.
   */
  prNotes: string[]
  /** What a create addressed at the pull request rejects with, when set. */
  noteError: Error | null
  prompts: AgentPromptRequest[]
  /**
   * What successive prompts reject with, consumed in order; `null` or a short list
   * means the rest answer normally.
   *
   * Per prompt rather than one flag, because the wall-clock stop is exactly the case
   * where the first turn fails and a second one in the same session still runs: the
   * implementation turn runs out of time and the wrap-up prompt is what recovers the
   * handoff from it. Both halves have to be scriptable independently.
   */
  promptFailures: (Error | null)[]
  /** Aborts the run asked for, and whether the fake server accepted them. */
  aborts: number
  abortAccepted: boolean
  /**
   * Whether the session has been closed.
   *
   * Recorded because the ordering it protects is silent when it is wrong: the fake
   * `tokensUsed` degrades to `0` once closed, exactly as the real one does when the
   * server cannot answer, so a stop that tore the server down before recording its
   * spend persists a total with this whole job missing from it.
   */
  agentClosed: boolean
  gitCalls: string[]
  checkResults: Map<string, CommandResult>
  /** Model replies, consumed in order by successive prompts. */
  replies: string[]
  /** Tokens the fake session reports as spent this job. */
  tokensUsed: number
  reviewResult: ReviewRunResult
  /** Every plan the review loop was handed, in order — `/review` is now a phase. */
  reviewCalls: string[]
  /** What `runReview` rejects with, when set: the loop crashing rather than exiting red. */
  reviewError: Error | null
  /** What `git` would report as the remote's default branch. */
  detectedBranch: string | null
  /**
   * What the diff guard measured for the commit `commitAll` made.
   *
   * The default sits under the harness config's `reviewHintLines`, so the
   * ordinary delivery is the one that names `/review` without pressing it.
   */
  committedTotals: StagedTotals | null
  /** What the salvage commit reports, and what it rejects with when set. */
  salvaged: Salvage
  salvageError: Error | null
  createdPr: PullRequestRef | null
  /** What the branch's pull request lookup reports, whatever became of it. */
  existingPr: PullRequestStatus | null
  /**
   * Times the run asked the API for the issue's own title and body.
   *
   * Counted rather than inferred from what was posted: a pull-request comment
   * carries the *pull request's* title, so "did this run read the issue?" is the
   * whole reason `pull-request` is a third kind and not a flag on the issue one.
   */
  getIssueCalls: number
  /** What `createPullRequest` rejects with, when set. */
  createPrError: Error | null
  prBodies: string[]
  prTitles: string[]
  /** The account GitHub records as the author of the agent's comments. */
  postedAs: string
  /** Every reaction the run placed, in order, with what it landed on. */
  reactions: { target: ReactionTarget; content: ReactionContent }[]
  /**
   * Every reaction the run took back off, by the id it was created with.
   *
   * Kept apart from `reactions` rather than modelled as a set that ends up
   * right: the 👀 is placed and removed by the same run, so a set would show an
   * empty comment either way and could not tell a run that cleared its
   * acknowledgement from one that never placed it.
   */
  reactionRemovals: { target: ReactionTarget; id: number }[]
  /**
   * Both reaction writes in one array, in the order they were made.
   *
   * The two arrays above cannot answer the one question that matters about
   * ordering — whether the outcome went on before the 👀 came off — because the
   * order *between* them is exactly what they throw away. Recorded here rather
   * than reconstructed by wrapping the fake, which would have a test reach past
   * the harness into the interface it is meant to exercise.
   */
  reactionLog: string[]
  /**
   * What `addReaction` rejects with, when set.
   *
   * A token without `issues: write`, a fork run and an org policy all produce
   * exactly this, and the rule is that none of them may change a single thing
   * about the run.
   */
  reactionError: Error | null
  /**
   * Labels the issue carries, as GitHub holds them — including any this
   * pipeline did not put there.
   */
  labels: string[]
  /**
   * Every label *write*, in order, and deliberately not folded into `labels`:
   * the point of a diff is what it did not ask for, and a set that ends up
   * right cannot tell a single add from a clear-and-reapply.
   */
  labelWrites: string[]
  /** Repository labels created on demand, by name and colour. */
  labelsCreated: { name: string; color: string }[]
  /** Reads attempted, so a run that is refused everything can still be shown to have asked. */
  labelReads: number
  /** What every label call rejects with, when set. */
  labelError: Error | null
  /** Every comment edit, in order — the status comment's and the state rewrites'. */
  edits: { id: number; body: string }[]
  /**
   * What the status channel rejects with, when set.
   *
   * Turns down every edit, and the one *create* that carries no `AGENT_STATE`
   * block. That is not a trick: the status comment is the only comment this
   * pipeline posts without one — rule 4 — so the discriminator is the invariant
   * itself, and a status comment that ever grew a block would take this harness
   * down with it rather than quietly passing.
   */
  statusError: Error | null
  /**
   * The mirror image: what a *report* create rejects with, when set.
   *
   * A 502 on the comment that carries the state block is how a run dies
   * mid-phase with its status comment already on the issue.
   */
  postError: Error | null
  /** The clock the status reporter reads, so its rate limit is provable. */
  nowMs: number
}

interface Harness {
  deps: PhaseDeps
  io: PipelineIo
}

const SPEC_REPLY = JSON.stringify({ status: 'spec', spec: 'Add a retry wrapper around fetch.' })
const PLAN_REPLY = JSON.stringify({
  steps: [{ title: 'Write retry tests', files: ['tests/retry.test.ts'], verification: 'bun test' }],
  summary: 'One step.',
})
const OK_CHECK: CommandResult = { command: 'check', exitCode: 0, stdout: '', stderr: '' }

const makeHarness = (overrides: Partial<PipelineConfig> = {}): Harness => {
  const io: PipelineIo = {
    thread: [],
    posted: [],
    prNotes: [],
    noteError: null,
    prompts: [],
    promptFailures: [],
    aborts: 0,
    abortAccepted: true,
    agentClosed: false,
    gitCalls: [],
    checkResults: new Map(),
    replies: [],
    tokensUsed: 0,
    reviewResult: { outcome: 'passed', summary: 'no issues found', exitCode: 0 },
    reviewCalls: [],
    reviewError: null,
    detectedBranch: BASE_BRANCH,
    committedTotals: { files: 2, lines: 12 },
    salvaged: { kind: 'committed', totals: { files: 3, lines: 140 }, overCap: null },
    salvageError: null,
    createdPr: null,
    existingPr: null,
    getIssueCalls: 0,
    createPrError: null,
    prBodies: [],
    prTitles: [],
    postedAs: AGENT_LOGIN,
    reactions: [],
    reactionRemovals: [],
    reactionLog: [],
    reactionError: null,
    labels: [],
    labelWrites: [],
    labelsCreated: [],
    labelReads: 0,
    labelError: null,
    edits: [],
    statusError: null,
    postError: null,
    nowMs: RUN_NOW_MS,
  }

  let nextCommentId = 100

  /** Records the ask, then answers the way `io.labelError` says to. */
  const label = (write: string, apply: () => void): Promise<void> => {
    io.labelWrites.push(write)
    if (io.labelError !== null) return Promise.reject(io.labelError)
    apply()
    return Promise.resolve()
  }

  /** True for the status comment and for nothing else — see `io.statusError`. */
  const isStatus = (body: string): boolean => !body.includes(STATE_MARKER)

  const github: GitHubApi = {
    listIssueComments: () => Promise.resolve([...io.thread]),
    createComment: (issueNumber, body) => {
      // The pull request's thread is a different thread, and the fake keeps it
      // that way: nothing addressed there is ever read back by the restore scan.
      if (issueNumber !== ISSUE) {
        io.prNotes.push(body)
        if (io.noteError !== null) return Promise.reject(io.noteError)
        nextCommentId += 1
        return Promise.resolve({
          id: nextCommentId,
          url: `https://example.test/c/${nextCommentId}`,
          authorLogin: io.postedAs,
        })
      }
      if (io.statusError !== null && isStatus(body)) return Promise.reject(io.statusError)
      if (io.postError !== null && !isStatus(body)) return Promise.reject(io.postError)
      nextCommentId += 1
      io.posted.push(body)
      io.thread.push({ id: nextCommentId, body, authorLogin: io.postedAs })
      return Promise.resolve({
        id: nextCommentId,
        url: `https://example.test/c/${nextCommentId}`,
        authorLogin: io.postedAs,
      })
    },
    // Edits land on the thread the way GitHub's do, so a rewritten state block
    // is read back by the next `findLatestState` rather than only recorded.
    updateComment: (commentId, body) => {
      io.edits.push({ id: commentId, body })
      if (io.statusError !== null) return Promise.reject(io.statusError)

      const index = io.thread.findIndex((existing) => existing.id === commentId)
      const target = io.thread[index]
      if (target !== undefined) io.thread[index] = { ...target, body }
      // A status comment is not one of the run's *posts*; folding the two would
      // let an edit read as a comment, which is the distinction the whole
      // one-comment budget rests on.
      return Promise.resolve()
    },
    getIssue: () => {
      io.getIssueCalls += 1
      return Promise.resolve({ number: ISSUE, title: 'Add retries', body: 'Please add retries.' })
    },
    getAuthenticatedLogin: () => Promise.resolve(AGENT_LOGIN),
    findPullRequest: () => Promise.resolve(io.existingPr),
    // Only `pr-trigger.ts` reads this, and it runs before `runPipeline` is
    // called at all — so a pipeline test that reaches it has resolved a
    // pull-request comment twice.
    getPullRequestHead: (): Promise<PullRequestHead> => {
      throw new Error('the head is resolved before the pipeline runs')
    },
    createPullRequest: (input) => {
      if (io.createPrError !== null) return Promise.reject(io.createPrError)
      io.prBodies.push(input.body)
      io.prTitles.push(input.title)
      io.createdPr = { number: 7, url: 'https://example.test/pull/7' }
      // A pull request that has been opened is findable, as GitHub's is.
      io.existingPr = { ...io.createdPr, state: 'open' }
      return Promise.resolve(io.createdPr)
    },
    updatePullRequest: (_number, patch) => {
      io.prBodies.push(patch.body)
      io.prTitles.push(patch.title)
      return Promise.resolve()
    },
    addReaction: (target, content) => {
      // Recorded before the refusal, so a test can prove the pipeline *asked*
      // even in the run where every ask is turned down.
      io.reactions.push({ target, content })
      io.reactionLog.push(`add:${content}`)
      if (io.reactionError !== null) return Promise.reject(io.reactionError)
      // Ids climb from the number of reactions placed, so a removal can be
      // matched to the reaction it undoes rather than to a constant every
      // reaction in the run would satisfy.
      return Promise.resolve({ id: io.reactions.length })
    },
    removeReaction: (target, reaction) => {
      io.reactionRemovals.push({ target, id: reaction.id })
      io.reactionLog.push('remove')
      return io.reactionError === null ? Promise.resolve() : Promise.reject(io.reactionError)
    },
    // Reading is not a write, so it is not recorded as one — but it does fail
    // when the token cannot see the issue at all, which is a real 403 and the
    // one that reaches the reconcile before it has decided anything.
    listLabels: () => {
      io.labelReads += 1
      return io.labelError === null ? Promise.resolve([...io.labels]) : Promise.reject(io.labelError)
    },
    addLabels: (_issueNumber, names) =>
      label(`+${names.join(',')}`, () => {
        io.labels.push(...names.filter((name) => !io.labels.includes(name)))
      }),
    removeLabel: (_issueNumber, name) =>
      label(`-${name}`, () => {
        io.labels = io.labels.filter((existing) => existing !== name)
      }),
    createLabel: (name, color) =>
      label(`create:${name}`, () => {
        io.labelsCreated.push({ name, color })
      }),
  }

  const git: Git = {
    ensureBranch: (branch, base) => {
      io.gitCalls.push(`ensureBranch:${branch}:${base}`)
      return Promise.resolve()
    },
    commitAll: (message) => {
      io.gitCalls.push(`commit:${message.split('\n')[0]}`)
      return Promise.resolve(io.committedTotals)
    },
    salvageAll: (message) => {
      io.gitCalls.push(`salvage:${message.split('\n')[0]}`)
      return io.salvageError === null ? Promise.resolve(io.salvaged) : Promise.reject(io.salvageError)
    },
    push: (branch, options) => {
      io.gitCalls.push(`push:${branch}${options?.noVerify === true ? ':no-verify' : ''}`)
      return Promise.resolve()
    },
    defaultBranch: () => Promise.resolve(io.detectedBranch),
  }

  const agent: OpenCodeAgent = {
    sessionId: 'session-1',
    prompt: (request) => {
      io.prompts.push(request)
      const failure = io.promptFailures.shift()
      if (failure !== undefined && failure !== null) return Promise.reject(failure)
      return Promise.resolve({ text: io.replies.shift() ?? '', sessionId: 'session-1' })
    },
    // Degrades to zero once closed, exactly as the real one does when the server
    // cannot answer — which is what makes "record the spend before anything closes
    // the server" a testable claim rather than a comment.
    tokensUsed: () => Promise.resolve(io.agentClosed ? 0 : io.tokensUsed),
    abort: () => {
      io.aborts += 1
      return Promise.resolve(io.abortAccepted)
    },
    close: () => {
      io.agentClosed = true
      return Promise.resolve()
    },
  }

  const pipelineConfig = config(overrides)
  const log = silentLogger()

  const deps: PhaseDeps = {
    github,
    // The real reporter, built the way `contain` builds it — which for the
    // default config (`runUrl: null`) hands back the no-op, so every test that
    // is not about this channel drives exactly what it drove before.
    status: createStatusReporter({ github, log, config: pipelineConfig, now: () => io.nowMs }),
    git,
    runCheck: (check) => Promise.resolve(io.checkResults.get(check.name) ?? OK_CHECK),
    runReview: (plan) => {
      io.reviewCalls.push(plan)
      return io.reviewError === null ? Promise.resolve(io.reviewResult) : Promise.reject(io.reviewError)
    },
    agent: () => Promise.resolve(agent),
    // Through the session, the way `memoizeAgent` wires it, so a run that closed
    // the server reads what a closed server answers.
    tokensUsed: () => agent.tokensUsed(),
    skills: () => Promise.resolve([]),
    baseBranch: () => Promise.resolve(BASE_BRANCH),
    selfLogin: () => Promise.resolve(AGENT_LOGIN),
    // The same clock the status reporter reads, so a test that moves time moves it
    // for the job deadline and for the status comment at once.
    now: () => io.nowMs,
    config: pipelineConfig,
    log,
  }

  return { deps, io }
}

/**
 * A Git that refuses every operation — the shape a fresh runner presents to a
 * phase that assumes a working tree it never created. `PR_DELIVERY` must be
 * able to run against this, because on a retry that is exactly what it gets.
 */
const hostileGit = (): Git => {
  const refuse = (operation: string): never => {
    throw new Error(`git ${operation} must not run on a fresh runner`)
  }

  return {
    ensureBranch: (): Promise<void> => refuse('ensureBranch'),
    commitAll: (): Promise<StagedTotals | null> => refuse('commit'),
    salvageAll: (): Promise<Salvage> => refuse('salvage'),
    push: (): Promise<void> => refuse('push'),
    defaultBranch: (): Promise<string | null> => refuse('symbolic-ref'),
  }
}

const latestPostedState = (harness: Harness): AgentState | null => {
  const last = harness.io.posted.at(-1)
  return last === undefined ? null : extractState(last)
}

/** A state block an earlier job left on the thread, as a later job reads it back. */
const seedState = (harness: Harness, patch: Partial<AgentState>): void => {
  const prior: AgentState = { ...initialState(ISSUE), ...patch }
  harness.io.thread.push({ id: 800, body: `earlier\n\n${serializeState(prior)}`, authorLogin: AGENT_LOGIN })
}

/**
 * An approved plan an earlier job left on the thread.
 *
 * `CODE_REVIEW` reads it back the same way `REVIEW_AND_MUTATE` does — the review
 * loop is handed the plan, not the issue — so a seeded state alone is not enough
 * to reach that handler.
 */
const seedPlan = (harness: Harness, text = 'Write retry tests'): void => {
  harness.io.thread.push({ id: 801, body: renderArtifact(PLAN_MARKER, text, 1), authorLogin: AGENT_LOGIN })
}

/** Keeps the "did a run return a state?" narrowing out of the test bodies. */
const spentIn = (result: { state: AgentState | null }): number => result.state?.tokensSpent ?? -1

const headings = (harness: Harness): string[] => harness.io.posted.map((body) => body.split('\n')[0] ?? '')

/**
 * The comments that carry a state block — every post except the run's status
 * comment, which by rule 4 carries none.
 *
 * `io.posted` stays the truthful count of comments created, because that is what
 * the one-comment budget is asserted against; a test about what the pipeline
 * *said* asks for the reports.
 */
const reportsOf = (harness: Harness): string[] => harness.io.posted.filter((body) => body.includes(STATE_MARKER))

/** Drives an issue as far as DESIGN_SPEC, ready for the review conversation. */
const toDesignSpec = async (harness: Harness): Promise<void> => {
  harness.io.replies = [SPEC_REPLY]
  await runPipeline({ event: issueEvent(), deps: harness.deps })
  harness.io.posted.length = 0
  // Reactions and status edits too: these helpers exist to put an issue in a
  // starting position, and what the setup runs acknowledged is not part of the
  // test that follows.
  harness.io.reactions.length = 0
  harness.io.reactionRemovals.length = 0
  harness.io.reactionLog.length = 0
  harness.io.edits.length = 0
}

/** Drives an issue as far as PLAN_REVIEW. */
const toPlanReview = async (harness: Harness): Promise<void> => {
  await toDesignSpec(harness)
  harness.io.replies = [PLAN_REPLY]
  await runPipeline({ event: comment('/approve'), deps: harness.deps })
  harness.io.posted.length = 0
  harness.io.reactions.length = 0
  harness.io.reactionRemovals.length = 0
  harness.io.reactionLog.length = 0
  harness.io.edits.length = 0
}

/**
 * Drives an issue all the way to a delivered pull request — the state `/review`
 * is typed against, and the only one it applies in.
 */
const toDelivered = async (harness: Harness): Promise<void> => {
  await toPlanReview(harness)
  harness.io.replies = ['Implemented.']
  await runPipeline({ event: comment('/approve'), deps: harness.deps })
  harness.io.posted.length = 0
  harness.io.gitCalls.length = 0
  harness.io.prompts.length = 0
  harness.io.prBodies.length = 0
  harness.io.prTitles.length = 0
  harness.io.reactions.length = 0
  harness.io.edits.length = 0
}

describe('guardrails', () => {
  test('skips a run raised by a Bot without touching the issue', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: issueEvent({ senderType: 'Bot' }), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('skips a non-maintainer', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: issueEvent({ authorAssociation: 'CONTRIBUTOR' }), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })
})

describe('phase 1 — triage', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('posts a design spec and parks in DESIGN_SPEC', async () => {
    harness.io.replies = [SPEC_REPLY]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Design spec')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('persists a spec whose markdown could forge the block delimiters', async () => {
    // Horizontal rules broke the original heading-scraping recovery; `-->`
    // broke the block channel that replaced it. A real design spec contains
    // both — a mermaid diagram is `A --> B`.
    const spec = [
      '## Goal',
      '',
      'Do it.',
      '',
      '---',
      '',
      '```mermaid',
      'graph TD',
      '  A --> B',
      '```',
      '',
      '## Files',
      '',
      '- `src/a.ts`',
    ].join('\n')
    harness.io.replies = [JSON.stringify({ status: 'spec', spec })]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    // Read it back the way a later job does, not by string surgery.
    expect(findArtifact(harness.io.thread, AGENT_LOGIN, SPEC_MARKER)?.text).toBe(spec)
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('a failure whose message forges the delimiter still persists its state', async () => {
    // The state block carries tool output verbatim in lastError. Losing it is
    // worse than losing an artefact: the next job restarts a live issue.
    harness.io.replies = ['error[E0308] expected struct\n  --> src/a.rs:3:9\n   |']

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(latestPostedState(harness)?.resumeFrom).toBe('INIT_OR_CLARIFY')
  })

  test('posts clarification questions and stays in INIT_OR_CLARIFY', async () => {
    harness.io.replies = [JSON.stringify({ status: 'clarify', questions: ['Which client?'] })]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('Which client?')
    expect(latestPostedState(harness)?.phase).toBe('INIT_OR_CLARIFY')
  })

  test('a plain reply while clarifying re-runs triage', async () => {
    // Three replies for three turns: the clarification, the classification of
    // the answer that comes back, and the triage that answer earns.
    harness.io.replies = [
      JSON.stringify({ status: 'clarify', questions: ['Which client?'] }),
      JSON.stringify({ intent: 'question' }),
      SPEC_REPLY,
    ]
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('The HTTP client.'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('parks in FAILED when the model returns unusable JSON', async () => {
    harness.io.replies = ['I could not decide.']

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('Run failed in INIT_OR_CLARIFY')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('INIT_OR_CLARIFY')
  })
})

/**
 * `INIT_OR_CLARIFY` used to skip classification altogether, so every comment
 * that landed while the agent waited for its clarifying questions to be answered
 * bought a full triage turn — a "thanks", a 👍 and a bystander's aside included.
 * Classifying it is the fix, but the classifier's documented bias points the
 * wrong way for this phase, so the branch inverts the default instead of
 * borrowing `applyIntent`'s: `none` skips, and everything else — including the
 * `question` a broken or unsure classifier falls back to — re-runs triage.
 */
describe('chatter while the agent is clarifying', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('a comment that needs no action runs no triage and posts nothing', async () => {
    seedState(harness, { phase: 'INIT_OR_CLARIFY' })
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    const result = await runPipeline({ event: comment('thanks! 👍'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('needs no action')
    expect(harness.io.posted).toEqual([])
    // The classification is the only turn paid for; triage never ran.
    expect(harness.io.prompts).toHaveLength(1)
    expect(String(harness.io.prompts[0]?.prompt)).toContain('Classify this comment')
    // State is persisted only by posting, so an untouched thread is itself the
    // assertion that the issue is still parked on its clarifying questions.
    expect(latestPostedState(harness)).toBeNull()
    expect(result.state?.phase).toBe('INIT_OR_CLARIFY')
  })

  test('an answer read as a question still re-runs triage rather than being answered', async () => {
    // `question` is the classifier's fallback bucket, not a verdict about this
    // phase, so acting on it would answer the maintainer's answer and leave the
    // issue parked on the same questions — the stall this branch exists to avoid.
    seedState(harness, { phase: 'INIT_OR_CLARIFY' })
    harness.io.replies = [JSON.stringify({ intent: 'question' }), SPEC_REPLY]

    const result = await runPipeline({ event: comment('The HTTP client.'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(String(harness.io.prompts[0]?.prompt)).toContain('Classify this comment')
    expect(harness.io.posted[0]).toContain('### Design spec')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('a classifier that fails re-runs triage rather than dropping a possible answer', async () => {
    // Two unusable replies exhaust `promptForJson`'s one re-ask, so
    // `classifyComment` swallows the throw and reports `question`. Only `none`
    // skips, so a classifier this run could not use costs the issue nothing.
    seedState(harness, { phase: 'INIT_OR_CLARIFY' })
    harness.io.replies = ['not json at all', 'still not json', SPEC_REPLY]

    const result = await runPipeline({ event: comment('The HTTP client.'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Design spec')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('an over-budget comment is reported without paying to classify it', async () => {
    // The ceiling is asked before the classifier, not after: classification is
    // the one turn whose spend can never be written down. The queued verdict is
    // the tell — reaching for it would consume the reply, skip in silence, and
    // leave the maintainer with no notice at all.
    harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'INIT_OR_CLARIFY', tokensSpent: 500 })
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    const result = await runPipeline({ event: comment('The HTTP client.'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.posted[0]).toContain('### ⛔ Token budget spent')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('INIT_OR_CLARIFY')
    expect(state?.tokensSpent).toBe(500)
  })
})

describe('review conversation', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toDesignSpec(harness)
  })

  test('/ask answers without moving the state machine', async () => {
    harness.io.replies = ['Because the retry helper already exists there.']

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Answer')
    expect(harness.io.posted[0]).toContain('Because the retry helper already exists there.')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('/ask passes the question through to the model', async () => {
    harness.io.replies = ['an answer']
    await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(String(harness.io.prompts.at(-1)?.prompt)).toContain('why that file?')
  })

  test('/changes revises the spec and reports a new revision', async () => {
    harness.io.replies = [JSON.stringify({ status: 'spec', spec: 'Use the existing helper.' })]

    const result = await runPipeline({ event: comment('/changes use the existing helper'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('Design spec (revision 2)')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('/changes threads the maintainer feedback into the rewrite prompt', async () => {
    harness.io.replies = [JSON.stringify({ status: 'spec', spec: 'revised' })]
    await runPipeline({ event: comment('/changes use the existing helper'), deps: harness.deps })

    expect(String(harness.io.prompts.at(-1)?.prompt)).toContain('use the existing helper')
  })

  test('a plain comment classified as a question gets answered', async () => {
    harness.io.replies = [JSON.stringify({ intent: 'question' }), 'Because it already exists.']

    const result = await runPipeline({ event: comment('why that file?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Answer')
  })

  test('a plain comment classified as a change request revises the spec', async () => {
    harness.io.replies = [JSON.stringify({ intent: 'changes' }), JSON.stringify({ status: 'spec', spec: 'revised' })]

    await runPipeline({ event: comment('please use the existing helper instead'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('Design spec (revision 2)')
  })

  test('a plain comment classified as approval proceeds to planning', async () => {
    harness.io.replies = [JSON.stringify({ intent: 'approve' }), PLAN_REPLY]

    await runPipeline({ event: comment('looks great, go ahead'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### Plan')
  })

  test('an unusable classification falls back to answering, never to re-planning', async () => {
    harness.io.replies = ['not json at all', 'an answer']

    const result = await runPipeline({ event: comment('hmm'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Answer')
    expect(latestPostedState(harness)?.specRevision).toBe(1)
  })
})

describe('answering outside the review gates', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test.each<Phase>(['COMPLETE', 'REVIEW_AND_MUTATE', 'PR_DELIVERY', 'CI_FIX'])(
    '/ask in %s is answered and leaves the phase exactly there',
    async (phase) => {
      // `/ask` has always been accepted in every phase, but ANSWERED lived in
      // three rows of the transition table, so each of these crashed the runner
      // with an InvalidTransitionError after the model turn was paid for —
      // nothing posted, exit code 1, the maintainer left staring at an issue.
      seedState(harness, { phase })
      harness.io.replies = ['Because the retry helper already exists there.']

      const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

      expect(result.status).toBe('waiting')
      expect(harness.io.posted[0]).toContain('### Answer')
      expect(harness.io.posted[0]).toContain('Because the retry helper already exists there.')
      expect(latestPostedState(harness)?.phase).toBe(phase)
    },
  )

  test('/ask in FAILED answers without disturbing the parked failure', async () => {
    // The phase a maintainer most wants to ask a question in, and the one the
    // crash hurt most: the run had already failed, so this was the only thing
    // left to try.
    seedState(harness, { phase: 'FAILED', resumeFrom: 'REVIEW_AND_MUTATE', attempts: 1, lastError: 'tests exploded' })
    harness.io.replies = ['The check runner could not find bun on the PATH.']

    const result = await runPipeline({ event: comment('/ask why did this fail?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('The check runner could not find bun on the PATH.')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    // Still resumable: a question must not cost the maintainer the `/retry`.
    expect(state?.resumeFrom).toBe('REVIEW_AND_MUTATE')
  })

  test('a failed /ask in COMPLETE reports without dragging a delivered issue backwards', async () => {
    // Two crashes on one path: the answer's own ANSWERED was refused, and when
    // the model call failed instead, the failure path's `transition(FAILED)`
    // was refused too, because COMPLETE deliberately accepts neither.
    seedState(harness, { phase: 'COMPLETE', prUrl: 'https://example.test/pull/7' })
    harness.deps.agent = (): Promise<OpenCodeAgent> => Promise.reject(new Error('the model endpoint rejected it'))

    const result = await runPipeline({ event: comment('/ask what did you change?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### ⚠️ I could not answer that')
    expect(harness.io.posted[0]).toContain('the model endpoint rejected it')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('COMPLETE')
    expect(state?.resumeFrom).toBeNull()
    expect(state?.attempts).toBe(0)
  })

  test('a failed /ask spends no attempt and promises no retry', async () => {
    // The related defect: a failed answer used to park the state with
    // `resumeFrom: 'DESIGN_SPEC'` and invite `/retry`, which then resumed into a
    // waiting phase with no handler and re-parked with "Parked in DESIGN_SPEC",
    // one attempt poorer for a round trip that did nothing.
    await toDesignSpec(harness)
    harness.deps.agent = (): Promise<OpenCodeAgent> => Promise.reject(new Error('the model timed out'))

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).not.toContain('/retry')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('DESIGN_SPEC')
    expect(state?.resumeFrom).toBeNull()
    expect(state?.attempts).toBe(0)
  })
})

describe('plan review gate', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('/approve on the spec stops at the plan rather than implementing', async () => {
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(headings(harness)).toEqual(['### Plan (revision 1)'])
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
    expect(harness.io.gitCalls).toEqual([`ensureBranch:agent/issue-${ISSUE}:${BASE_BRANCH}`])
  })

  test('/changes on the plan re-plans without touching the spec', async () => {
    await toPlanReview(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/changes split step 1'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### Plan (revision 2)')
    expect(latestPostedState(harness)).toMatchObject({ phase: 'PLAN_REVIEW', specRevision: 1, planRevision: 2 })
  })

  test('/approve on the plan cascades through implementation and delivery', async () => {
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(headings(harness)).toEqual(['### Implementation report', '### Pull request ready'])
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })
})

/**
 * The spec and the plan used to share one `revision`, bumped by both
 * `SPEC_POSTED` and `PLAN_POSTED` and rendered into both headings, so the first
 * plan a maintainer ever saw was labelled revision 2 — revision 3 if
 * the spec had been revised once first. Nothing was corrupted; the numbers
 * simply counted something no reader could name.
 */
describe('artefact revision numbering', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('the first plan is revision 1', async () => {
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### Plan (revision 1)')
    expect(latestPostedState(harness)).toMatchObject({ specRevision: 1, planRevision: 1 })
  })

  test('revising the spec twice still leaves the first plan at revision 1', async () => {
    await toDesignSpec(harness)
    harness.io.replies = [JSON.stringify({ status: 'spec', spec: 'Second attempt.' })]
    await runPipeline({ event: comment('/changes use the existing helper'), deps: harness.deps })
    harness.io.replies = [JSON.stringify({ status: 'spec', spec: 'Third attempt.' })]
    await runPipeline({ event: comment('/changes name the helper'), deps: harness.deps })

    expect(harness.io.posted.at(-1)).toContain('### Design spec (revision 3)')

    harness.io.posted.length = 0
    harness.io.replies = [PLAN_REPLY]
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### Plan (revision 1)')
    expect(latestPostedState(harness)).toMatchObject({ specRevision: 3, planRevision: 1 })
  })

  test('revising the plan reaches revision 2 while the spec stays where it was', async () => {
    await toPlanReview(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/changes split step 1'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### Plan (revision 2)')
    // Read back the way the next job does: the hidden block's `revision` is
    // written from the same local as the heading, so they cannot disagree.
    expect(findArtifact(harness.io.thread, AGENT_LOGIN, PLAN_MARKER)?.revision).toBe(2)
    expect(findArtifact(harness.io.thread, AGENT_LOGIN, SPEC_MARKER)?.revision).toBe(1)
    expect(latestPostedState(harness)).toMatchObject({ specRevision: 1, planRevision: 2 })
  })

  test('a state block written before the counters split still drives the pipeline', async () => {
    // Both fields default, so the split needed no `STATE_VERSION` bump and this
    // issue is not stranded mid-conversation. What it loses is the old shared
    // count, which was a sum of two artefacts and never the count of either —
    // so its plan starts at 1, which is the number this change exists to make
    // true.
    const legacy = `<!-- ${STATE_MARKER}: {"v":2,"phase":"DESIGN_SPEC","issueId":${ISSUE},"revision":3} -->`
    harness.io.thread.push({
      id: 800,
      body: [`earlier`, legacy, renderArtifact(SPEC_MARKER, 'Add a retry wrapper around fetch.', 3)].join('\n\n'),
      authorLogin: AGENT_LOGIN,
    })
    harness.io.replies = [PLAN_REPLY]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Plan (revision 1)')
    expect(latestPostedState(harness)).toMatchObject({ phase: 'PLAN_REVIEW', specRevision: 0, planRevision: 1 })
  })
})

describe('implementation and delivery', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
  })

  test('pushes the branch in the phase that made the commit', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    // Delivery must not depend on a working tree; the push happens in phase 3.
    const pushIndex = harness.io.gitCalls.indexOf(`push:agent/issue-${ISSUE}`)
    expect(pushIndex).toBeGreaterThan(-1)
    // One commit, not two: the review loop's own commit belongs to `/review`
    // now, and this phase has nothing left between its commit and its push.
    expect(harness.io.gitCalls.filter((call) => call.startsWith('commit:'))).toHaveLength(1)
  })

  test('delivers without running the review loop at all', async () => {
    // The whole point of the split: a pull request after one model turn, with
    // the review loop still a decision nobody has taken. It used to sit between
    // the implementation commit and the push, so every task paid its wall clock
    // and a review that broke discarded an implementation that had not.
    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.reviewCalls).toEqual([])
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', prNumber: 7, reviewAttempts: 0 })
  })

  test('pushes before the phase ends, so the commit outlives the job', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    const calls = harness.io.gitCalls
    const push = calls.indexOf(`push:agent/issue-${ISSUE}`)
    const lastCommit = calls.map((call) => call.startsWith('commit:')).lastIndexOf(true)

    // An Actions working tree dies with the job: a commit that is not pushed by
    // the end of the phase that made it cannot be recovered by any later retry.
    expect(push).toBeGreaterThan(lastCommit)
  })

  test('resumes delivery on a fresh runner, touching git not at all', async () => {
    // The job that implemented the work pushed the branch, then died before the
    // pull request existed. This is the scenario that used to be unrecoverable:
    // delivery pushed a branch that a fresh checkout does not have locally.
    harness.deps.github.createPullRequest = (): Promise<PullRequestRef> => {
      throw new Error('GitHub was down')
    }

    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    expect(latestPostedState(harness)?.resumeFrom).toBe('PR_DELIVERY')
    expect(harness.io.gitCalls).toContain(`push:agent/issue-${ISSUE}`)

    // A brand-new runner: no branch checked out, no commit, no working tree.
    harness.io.posted.length = 0
    harness.deps.git = hostileGit()
    harness.deps.github.createPullRequest = (input): Promise<PullRequestRef> => {
      harness.io.prBodies.push(input.body)
      return Promise.resolve({ number: 7, url: 'https://example.test/pull/7' })
    }

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.at(-1)).toContain('https://example.test/pull/7')
    expect(harness.io.prBodies.at(-1)).toContain(`Closes #${ISSUE}`)
  })

  test('opens a pull request that closes the issue', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prBodies[0]).toContain(`Closes #${ISSUE}`)
    // The implementation report, which now says the review has not run and
    // names the command that runs it.
    expect(harness.io.prBodies[0]).toContain('/review')
  })

  test('the delivery comment names the review a maintainer can now ask for', async () => {
    // A command nobody can discover is not a feature, and `COMPLETE` had never
    // accepted one before this stage.
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted.at(-1)).toContain('### Pull request ready')
    expect(harness.io.posted.at(-1)).toContain('`/review`')
  })

  test('records the size of the diff it committed, not a verdict on it', async () => {
    // The raw count, never a `shouldReview` flag: the threshold is read from
    // config when the delivery comment is written, and a flag frozen at commit
    // time could only ever disagree with it.
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(latestPostedState(harness)?.changedLines).toBe(12)
  })

  test('states that /review exists without pressing it for a small diff', async () => {
    // 12 lines against the harness's 200-line threshold. Both halves matter:
    // the command has to be discoverable on every delivery, and a recommendation
    // attached to every delivery is not a recommendation.
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted.at(-1)).toContain('`/review`')
    expect(harness.io.posted.at(-1)).not.toContain('worth a second pass')
  })

  test('recommends the review when the diff it just committed is a big one', async () => {
    harness.io.committedTotals = { files: 30, lines: 900 }

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    // The figure is stated, so a maintainer can judge the recommendation rather
    // than take it on trust.
    expect(harness.io.posted.at(-1)).toContain('900 lines')
    expect(harness.io.posted.at(-1)).toContain('worth a second pass')
  })

  test('recommends nothing for an issue delivered before the count existed', async () => {
    // `changedLines` defaults to 0 on a state block written before this field,
    // and 0 is below every threshold the range allows — so an in-flight issue
    // reads as a small diff rather than as one nobody measured.
    harness.io.committedTotals = { files: 1, lines: 0 }

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted.at(-1)).not.toContain('worth a second pass')
  })

  test('records the pull request in the persisted state', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    const state = latestPostedState(harness)
    expect(state?.prUrl).toBe('https://example.test/pull/7')
    expect(state?.prNumber).toBe(7)
  })

  test('refreshes an already-open pull request rather than opening a second', async () => {
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'open' }

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prBodies).toHaveLength(1)
    expect(harness.io.posted.at(-1)).toContain('https://example.test/pull/3')
  })

  test('a reused pull request follows the issue as it reads now, not as it read when opened', async () => {
    // An earlier job opened the pull request under the old name. Refreshing
    // used to patch the body alone, so the title stayed frozen there forever.
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'open' }
    const renamed = issueEvent({
      eventName: 'issue_comment',
      action: 'created',
      commentBody: '/approve',
      issueTitle: 'Add retries and backoff',
    })

    await runPipeline({ event: renamed, deps: harness.deps })

    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prTitles).toEqual([`Add retries and backoff (#${ISSUE})`])
  })

  test('stands down instead of opening a second pull request once the first merged', async () => {
    // An open-only lookup reports a merged pull request as `[]` — identical to
    // one that never existed — so delivery used to open a twin from a branch
    // with nothing left to merge.
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'merged' }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prTitles).toEqual([])
    expect(harness.io.posted.at(-1)).toContain('already merged')
    expect(latestPostedState(harness)?.prNumber).toBe(3)
  })

  test('does not re-open work a maintainer closed', async () => {
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'closed' }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.createdPr).toBeNull()
    expect(harness.io.prTitles).toEqual([])
    expect(harness.io.posted.at(-1)).toContain('closed without merging')
  })

  test('fails when the agent produced no file changes', async () => {
    // A clean tree is what `commitAll` reports, not something asked separately.
    harness.deps.git.commitAll = (): Promise<StagedTotals | null> => Promise.resolve(null)

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(latestPostedState(harness)?.resumeFrom).toBe('REVIEW_AND_MUTATE')
  })

  test('every prompt states the envelope rule for the id that prompt actually uses', async () => {
    // The rule and the terminator are minted together; if a handler ever built
    // them from separate calls the model would be told to trust an id that
    // never appears, and every real delimiter would look forged.
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prompts.length).toBeGreaterThan(0)
    for (const request of harness.io.prompts) {
      const id = OPENING_TAG.exec(request.prompt)?.[1]
      expect(id).toBeDefined()
      expect(request.system).toContain(`</untrusted_input:${id}>`)
    }
  })

  test('a state block naming another issue never reaches git', async () => {
    // Maintainers can edit the agent's comments. `issueId` names the branch
    // through `branchNameFor`, the commit trailers, and the `Closes #n` the
    // pull request carries, so a planted number would have the agent push to
    // `agent/issue-7` and close a different issue.
    harness.io.thread.push({ id: 999, body: `planted\n\n${serializeState(PLANTED_STATE)}`, authorLogin: AGENT_LOGIN })

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.gitCalls.join(' ')).not.toContain('agent/issue-7')
    expect(harness.io.gitCalls.join(' ')).toContain(`agent/issue-${ISSUE}`)
  })

  test('a mismatched posting identity fails now, not one job later', async () => {
    // The in-job thread mirror carries the author GitHub *recorded*. If it
    // carried the assumed one instead, delivery would find the report this job
    // just wrote while the next job — reading real authors back from the API —
    // could not. Failing the same way in both places is what makes the
    // misconfiguration visible; `reportIdentityDrift` says why on the same run.
    harness.io.postedAs = 'github-actions[bot]'

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prBodies.at(-1)).toContain('No implementation report was recorded')
  })

  test('finds its own report when the identity matches', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prBodies.at(-1)).toContain('Implementation report')
  })

  test('persists the plan so a later job reads it back verbatim', async () => {
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.thread.some((entry) => entry.body.includes(PLAN_MARKER))).toBe(true)
  })
})

/**
 * The review loop used to sit inside phase 3, between the implementation commit
 * and the push, so a review that broke discarded an implementation that had
 * not, every task paid its wall clock whether or not the diff warranted it, and
 * `/retry` re-ran the model turn that had already succeeded. It is a phase of
 * its own now, entered by `/review` from `COMPLETE` and returning there.
 */
describe('/review — the review loop as a command', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toDelivered(harness)
  })

  test('runs the loop over the pushed branch and returns to COMPLETE', async () => {
    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.reviewCalls).toHaveLength(1)
    // `ensureBranch` first, and it is not optional: unlike the review that used
    // to run inside phase 3, this one usually runs in a job that implemented
    // nothing, so the remote branch is the only copy of the work.
    expect(harness.io.gitCalls).toEqual([
      `ensureBranch:agent/issue-${ISSUE}:${BASE_BRANCH}`,
      `commit:fix(agent): apply review-loop findings for issue #${ISSUE}`,
      `push:agent/issue-${ISSUE}`,
    ])
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', reviewAttempts: 1 })
  })

  test('draws no note on the pull request, because the report is already here', async () => {
    // Decided from the trigger kind and not from the phase: `CODE_REVIEW` is
    // reached identically through both doors, so a phase test would put a
    // pointer on the pull request for a maintainer already reading the report.
    await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(harness.io.prNotes).toEqual([])
  })

  test('hands the loop the approved plan, not the issue body', async () => {
    await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(harness.io.reviewCalls[0]).toContain('Write retry tests')
  })

  test('refreshes the pull request with what the review found', async () => {
    // One renderer for both, so a pull request refreshed after a review presents
    // exactly what a freshly opened one would. The handler passes the report it
    // has just built rather than reading it back: `postAndAppend` runs in the
    // orchestrator *after* the handler returns.
    await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(harness.io.prBodies.at(-1)).toContain(`Closes #${ISSUE}`)
    expect(harness.io.prBodies.at(-1)).toContain('Review report')
  })

  test('a pull request that will not take the refresh does not cost the review', async () => {
    // The refresh is decoration on work already pushed. Letting it throw parked
    // the issue in FAILED with `resumeFrom: CODE_REVIEW`, so the `/retry` that
    // followed re-ran the whole loop — every `opencode run` subprocess of it,
    // and another round off `AGENT_MAX_REVIEW_ATTEMPTS` — for a failed body edit.
    harness.deps.github.updatePullRequest = (): Promise<void> => Promise.reject(new Error('422 Unprocessable'))

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.at(-1)).toContain('Review report')
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', reviewAttempts: 1 })
  })

  test('a review that throws leaves the pull request open and parks in CODE_REVIEW', async () => {
    harness.io.reviewError = new Error('the review loop exploded')

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('failed')
    // The branch was pushed by phase 3 and the pull request opened by phase 4,
    // so a failed review costs the review and nothing else.
    expect(latestPostedState(harness)).toMatchObject({
      phase: 'FAILED',
      resumeFrom: 'CODE_REVIEW',
      prNumber: 7,
      prUrl: 'https://example.test/pull/7',
    })
  })

  test('/retry after a failed review re-runs the review and re-implements nothing', async () => {
    harness.io.reviewError = new Error('the review loop exploded')
    await runPipeline({ event: comment('/review'), deps: harness.deps })
    harness.io.reviewError = null
    harness.io.posted.length = 0

    const retried = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(retried.status).toBe('completed')
    expect(harness.io.reviewCalls).toHaveLength(2)
    // Not one model turn: the implementation is already pushed, and paying for
    // it twice is what the resume point exists to prevent.
    expect(harness.io.prompts).toEqual([])
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('a red review is reported and still reaches COMPLETE', async () => {
    // CI on the pull request is the gate, and the CI-fix loop is what acts on
    // it; a red review is a finding, not a blocker.
    harness.io.reviewResult = { outcome: 'failed', summary: 'two issues left open', exitCode: 1 }

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('❌ exited 1')
    expect(harness.io.posted[0]).toContain('two issues left open')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('reports a repository with no review loop as unconfigured, not as red', async () => {
    // A checkout without the workspace has no review configured; that is not a
    // review that failed, and calling it one made every run elsewhere red.
    harness.io.reviewResult = { outcome: 'unavailable', summary: 'No review loop is configured.', exitCode: 0 }

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('not configured for this repository')
    expect(harness.io.posted[0]).not.toContain('❌')
  })

  test('a clean tree is a result, not a failure', async () => {
    // The loop finding nothing to change is the outcome a reviewer most wants
    // to hear, so it is reported and the phase still completes.
    harness.deps.git.commitAll = (): Promise<StagedTotals | null> => Promise.resolve(null)

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.gitCalls).not.toContain(`push:agent/issue-${ISSUE}`)
    expect(harness.io.posted[0]).toContain('nothing to apply')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })
})

describe('/review — where it does not apply', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
  })

  test('a cancelled issue is refused, and the refusal does not offer it', async () => {
    // `COMPLETE` is where a delivered issue and a cancelled one both live, and
    // the transition table cannot tell them apart. The applicability predicate
    // can, and the comment a maintainer reads is derived from that same
    // predicate, so the offer and the gate cannot disagree.
    seedState(harness, { phase: 'COMPLETE' })

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.reviewCalls).toEqual([])
    expect(harness.io.posted[0]).toContain('does not apply right now')
    expect(harness.io.posted[0]).toContain('What works here: `/ask`.')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test.each<Phase>(['DESIGN_SPEC', 'PLAN_REVIEW', 'PR_DELIVERY', 'FAILED'])(
    'a review asked for in %s is refused without touching the branch',
    async (phase) => {
      seedState(harness, { phase, prUrl: 'https://example.test/pull/7', prNumber: 7 })

      const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

      expect(result.status).toBe('skipped')
      expect(harness.io.reviewCalls).toEqual([])
      expect(harness.io.gitCalls).toEqual([])
      expect(latestPostedState(harness)?.phase).toBe(phase)
    },
  )

  test('past the budget it is refused before the signal is applied', async () => {
    // The invariant `refuseExhausted` exists to protect, on the other budget: a
    // refusal after the move would park the issue in `CODE_REVIEW`, a handler
    // phase no trigger re-enters, under a notice suggesting a bigger ceiling
    // that could then never be used.
    harness = makeHarness({ maxReviewAttempts: 2 })
    seedState(harness, { phase: 'COMPLETE', prUrl: 'https://example.test/pull/7', prNumber: 7, reviewAttempts: 2 })

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.reviewCalls).toEqual([])
    expect(harness.io.posted[0]).toContain('AGENT_MAX_REVIEW_ATTEMPTS')
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', reviewAttempts: 2 })
  })

  test('raising the ceiling makes the refused review run, which is what makes the notice honest', async () => {
    harness = makeHarness({ maxReviewAttempts: 2 })
    seedState(harness, { phase: 'COMPLETE', prUrl: 'https://example.test/pull/7', prNumber: 7, reviewAttempts: 2 })
    seedPlan(harness)
    await runPipeline({ event: comment('/review'), deps: harness.deps })

    harness.deps.config.maxReviewAttempts = 3
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/review'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.reviewCalls).toHaveLength(1)
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', reviewAttempts: 3 })
  })
})

/**
 * The second door onto the same command: `/review` typed on the pull request,
 * where the diff is, rather than on the issue.
 *
 * The asymmetry below is deliberate and is the whole shape of this path — typed
 * on the pull request, answered on the **issue**. `findLatestState` scans the
 * issue thread, so a block posted on the pull request would be a second source
 * of truth the restore scan cannot see; what lands where the maintainer is
 * looking is the 👀 on their comment and the loop's findings as commits.
 */
describe('/review — typed on the pull request', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toDelivered(harness)
  })

  test('runs the loop and answers on the issue, not on the pull request', async () => {
    const result = await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.reviewCalls).toHaveLength(1)
    // Every comment this run posted went to the issue thread, which is the one
    // the restore scan reads.
    expect(harness.io.posted.at(-1)).toContain('Review report')
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', reviewAttempts: 1 })
  })

  test('leaves a note on the pull request pointing at the issue', async () => {
    // The other half of the acknowledgement. The 👀 says the command arrived and
    // the commits say something changed, but neither says what the loop
    // concluded — that account is on the issue, and without this the pull
    // request never names where to find it.
    await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(harness.io.prNotes).toHaveLength(1)
    expect(harness.io.prNotes[0]).toContain(`#${ISSUE}`)
    expect(harness.io.prNotes[0]).toContain('✅ clean')
    // A pointer, not a second report: the report itself stays on the issue.
    expect(harness.io.prNotes[0]).not.toContain('<details>')
    expect(harness.io.posted.at(-1)).toContain('Review report')
  })

  test('a red loop is what the note says it is', async () => {
    harness.io.reviewResult = { outcome: 'failed', summary: 'two issues left open', exitCode: 1 }

    await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(harness.io.prNotes[0]).toContain('❌ exited 1')
  })

  test('a note the pull request will not take costs the review nothing', async () => {
    // Asserted as a *write that was attempted*, not as the absence of a throw:
    // this door degrades a bug in itself to the same `warn` as a 403, so a test
    // that only watched the result would pass over a channel posting nothing.
    harness.io.noteError = new Error('403 Resource not accessible by integration')

    const result = await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(harness.io.prNotes).toHaveLength(1)
    expect(result.status).toBe('completed')
    expect(result.reported).toBe(true)
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', reviewAttempts: 1 })
  })

  test('the 👀 lands on the comment the maintainer typed', async () => {
    // On the pull request, not on the issue this run answers on: the whole
    // reaction channel exists to acknowledge the person waiting, and they are
    // looking at the diff. One REST endpoint addresses either id, so the target
    // is all that has to be right.
    await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(harness.io.reactions[0]).toEqual({ target: { kind: 'comment', id: PR_COMMENT_ID }, content: 'eyes' })
  })

  test('reads the issue’s own title and body from the API', async () => {
    // The payload carries the *pull request's*, which is why this is a third
    // kind rather than a flag on the issue one: handed straight through, every
    // phase would reason over the pull request as if it were the issue.
    await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(harness.io.getIssueCalls).toBe(1)
    expect(harness.io.prTitles.at(-1)).toContain('Add retries')
  })

  test.each([['/approve'], ['/cancel'], ['/retry'], ['/ask why that file?']])(
    'refuses %p, because a pull request accepts one command',
    async (body) => {
      // Unreachable through the resolver, which drops anything but `/review`
      // before it makes an API call — this is the door itself holding the same
      // line, so a second way in cannot widen the surface by accident.
      const result = await runPipeline({ event: prComment(body), deps: harness.deps })

      expect(result.status).toBe('skipped')
      expect(harness.io.reviewCalls).toEqual([])
      expect(harness.io.posted.at(-1)).toContain('does not apply right now')
      expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
    },
  )

  test('a comment carrying no command at all moves nothing and pays no classifier', async () => {
    // Also unreachable, and it must never reach `applyIntent`: that path reads
    // `commentBody` off the *issue* kind alone, so a pull-request comment
    // arriving there would be classified as an empty one — a model turn bought
    // to misread a comment the resolver had already declined to claim.
    const result = await runPipeline({ event: prComment('looks good to me'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.posted).toEqual([])
  })

  test('a cancelled issue is refused through the same predicate the issue door uses', async () => {
    // One rule with two doors, not two spellings of it: `commandApplies` is what
    // refuses `/review` without a pull request, and it is the same function that
    // builds the list the refusal comment offers.
    harness = makeHarness()
    seedState(harness, { phase: 'COMPLETE' })

    const result = await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.reviewCalls).toEqual([])
    expect(harness.io.posted[0]).toContain('What works here: `/ask`.')
  })

  test('past the budget it is refused before the signal is applied', async () => {
    harness = makeHarness({ maxReviewAttempts: 2 })
    seedState(harness, {
      phase: 'COMPLETE',
      prUrl: 'https://example.test/pull/7',
      prNumber: PR_NUMBER,
      reviewAttempts: 2,
    })

    const result = await runPipeline({ event: prComment('/review'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.reviewCalls).toEqual([])
    expect(harness.io.posted[0]).toContain('AGENT_MAX_REVIEW_ATTEMPTS')
    expect(latestPostedState(harness)).toMatchObject({ phase: 'COMPLETE', reviewAttempts: 2 })
  })

  test.each([
    ['a bot', { senderType: 'Bot' }],
    ['the agent itself', { senderLogin: AGENT_LOGIN }],
  ])('drops %s in silence', async (_label, overrides) => {
    const result = await runPipeline({ event: prComment('/review', overrides), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
    expect(harness.io.reactions).toEqual([])
  })

  test('answers a non-maintainer with the one reaction the issue path gives them', async () => {
    // The sender rules are shared verbatim, so the judgement call made for the
    // issue door — an outside contributor's comment must not vanish into a log
    // they cannot read — holds here without being made a second time.
    const result = await runPipeline({
      event: prComment('/review', { authorAssociation: 'CONTRIBUTOR' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('skipped')
    expect(result.reported).toBe(false)
    expect(harness.io.reactions).toEqual([{ target: { kind: 'comment', id: PR_COMMENT_ID }, content: 'confused' }])
    expect(harness.io.posted).toEqual([])
  })
})

describe('the review budget across pull requests', () => {
  test('a new pull request hands the review budget back', async () => {
    // The budget belongs to a pull request, exactly as the CI-fix one does: the
    // loop's spend is invisible to `AGENT_MAX_TOKENS`, so a genuinely new pull
    // request has to start with its rounds intact.
    const harness = makeHarness()
    seedState(harness, { phase: 'FAILED', resumeFrom: 'PR_DELIVERY', reviewAttempts: 2, ciAttempts: 2 })
    harness.io.existingPr = null

    await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(latestPostedState(harness)).toMatchObject({ prNumber: 7, reviewAttempts: 0, ciAttempts: 0 })
  })

  test('a refreshed pull request keeps the rounds its own reviews spent', async () => {
    const harness = makeHarness()
    seedState(harness, { phase: 'FAILED', resumeFrom: 'PR_DELIVERY', reviewAttempts: 2, ciAttempts: 2 })
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'open' }

    await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(harness.io.createdPr).toBeNull()
    expect(latestPostedState(harness)).toMatchObject({ reviewAttempts: 2, ciAttempts: 2 })
  })
})

describe('delivery refused by the repository settings', () => {
  /** GitHub's own words when Actions may not open pull requests. */
  const forbidden = (): Error =>
    new Error(
      'GitHub Actions is not permitted to create or approve pull requests. - ' +
        'https://docs.github.com/rest/pulls/pulls#create-a-pull-request',
    )

  test('says what to switch on rather than repeating the API', async () => {
    // The bare API message is the least useful failure this pipeline can post.
    // It names a setting without saying where it lives, reads like a bug in the
    // agent, and hides the one fact that changes what a maintainer does next:
    // the work is finished and pushed, so this is a click, not a rerun.
    const harness = makeHarness()
    harness.io.createPrError = forbidden()

    const result = await driveDelivery(harness)

    expect(result.status).toBe('failed')
    expect(harness.io.posted.at(-1)).toContain('Allow GitHub Actions to create and')
    expect(harness.io.posted.at(-1)).toContain('AGENT_GITHUB_TOKEN')
    // The greyed-out case matters on its own, and is the state the repository
    // this was written for was in: an organisation can lock the whole Workflow
    // permissions section, so "tick the box" sends a maintainer to a control
    // they cannot click, with nothing saying where the setting really lives.
    expect(harness.io.posted.at(-1)).toContain('greyed out')
  })

  test('offers the branch as a pull request anyone can open by hand', async () => {
    // The third way out and the only one needing no permissions at all: phase 3
    // pushed the branch, so the pull request exists in every sense but the API
    // call. Built from `gitRemoteBase`, because an Enterprise Server install
    // answers on its own host and a link into the wrong one is worse than none.
    const harness = makeHarness()
    harness.io.createPrError = forbidden()

    await driveDelivery(harness)

    expect(harness.io.posted.at(-1)).toContain(
      `https://github.com/acme/widgets/compare/${BASE_BRANCH}...agent/issue-${ISSUE}?expand=1`,
    )
  })

  test('parks in PR_DELIVERY so the fix and a /retry compose', async () => {
    // Everything before delivery is done and paid for. Resuming anywhere else
    // would re-run the model over work already on the branch.
    const harness = makeHarness()
    harness.io.createPrError = forbidden()

    await driveDelivery(harness)

    expect(latestPostedState(harness)?.phase).toBe('FAILED')
    expect(latestPostedState(harness)?.resumeFrom).toBe('PR_DELIVERY')
  })

  test('any other refusal is reported as GitHub worded it', async () => {
    // The substitution is worth having only because it names one cause and the
    // settings that undo it. A token merely missing `pull-requests: write` fails
    // with the same 403 and has a different remedy, so sending that maintainer
    // to tick a box that was never the problem is worse than saying nothing.
    const harness = makeHarness()
    harness.io.createPrError = new Error('Resource not accessible by integration')

    const result = await driveDelivery(harness)

    expect(result.status).toBe('failed')
    expect(harness.io.posted.at(-1)).toContain('Resource not accessible by integration')
    expect(harness.io.posted.at(-1)).not.toContain('AGENT_GITHUB_TOKEN')
  })
})

describe('CI fixing', () => {
  let harness: Harness

  beforeEach(async () => {
    harness = makeHarness()
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    harness.io.posted.length = 0
    harness.io.gitCalls.length = 0
  })

  test('a red run on the agent branch starts a fix round', async () => {
    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('### CI fix attempt 1 of 2')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('repairs failing checks and pushes the fix', async () => {
    harness.io.checkResults.set('lint', { command: 'lint', exitCode: 1, stdout: 'lint blew up', stderr: '' })
    harness.io.replies = ['Fixed the lint error.']

    await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(String(harness.io.prompts.at(-1)?.prompt)).toContain('lint blew up')
    expect(harness.io.gitCalls).toContain(`push:agent/issue-${ISSUE}`)
  })

  test('reports the remaining failures when it cannot get green', async () => {
    harness.io.checkResults.set('test', { command: 'test', exitCode: 1, stdout: 'still failing', stderr: '' })
    harness.io.replies = ['tried', 'tried again']

    await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('❌ still red')
    expect(harness.io.posted[0]).toContain('still failing')
  })

  test('a green run is ignored', async () => {
    const result = await runPipeline({ event: ciEvent({ conclusion: 'success' }), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('the agent pipeline failing does not feed itself', async () => {
    const result = await runPipeline({
      event: ciEvent({ workflowName: 'OpenCode Issue Agent' }),
      deps: harness.deps,
    })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('says so on the issue when it stops trying, rather than going quiet', async () => {
    // A red check arrives on its own schedule with nobody reading the Actions
    // log, so a silent give-up is indistinguishable from an agent still working.
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted).toHaveLength(1)
    expect(harness.io.posted[0]).toContain('I have stopped trying to fix CI')
    expect(harness.io.posted[0]).toContain('https://example.test/pull/7')
    expect(latestPostedState(harness)?.ciBudgetReported).toBe(true)
  })

  test('says it once, however many more red runs arrive', async () => {
    // CI fires on every push and re-run; repeating the notice would be spam.
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('Already reported')
    expect(harness.io.posted).toEqual([])
  })

  test.each(['merged', 'closed'] as const)('a red run on a %s pull request buys no fix round', async (state) => {
    // CI keeps firing on a branch after its pull request settles — a later
    // push, a re-run, a flake — and a fix round's commits would land somewhere
    // nobody will merge again.
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state }

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain(state)
    expect(harness.io.gitCalls).toEqual([])
    expect(harness.io.posted).toEqual([])
  })

  test('a settled pull request does not spend a CI-fix attempt', async () => {
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state: 'merged' }
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })

    // The budget is for repairing a live pull request; standing down must not
    // consume it, or a reopened one would arrive with nothing left to spend.
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state: 'open' }
    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.at(-1)).toContain('CI fix attempt 1 of 2')
  })

  test('a red run on a branch with no pull request has nowhere to go', async () => {
    harness.io.existingPr = null

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('nowhere to go')
    expect(harness.io.gitCalls).toEqual([])
  })

  test('the spent-budget notice is not posted to a merged pull request', async () => {
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.posted.length = 0
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state: 'merged' }

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    // "I have stopped trying to fix CI" is noise on work that already landed.
    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('does not touch the working tree once the budget is spent', async () => {
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    await runPipeline({ event: ciEvent(), deps: harness.deps })
    harness.io.gitCalls.length = 0

    await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(harness.io.gitCalls).toEqual([])
  })
})

describe('a red run away from COMPLETE', () => {
  let harness: Harness

  beforeEach(() => {
    harness = makeHarness()
    // Every case here starts from a live pull request on the agent's branch, so
    // the settled-pull-request guard is never what decides the outcome.
    harness.io.existingPr = { number: 7, url: 'https://example.test/pull/7', state: 'open' }
  })

  test('a red run in PR_DELIVERY buys a fix round rather than vanishing', async () => {
    // Phase 3 pushes the branch and posts a state block naming PR_DELIVERY
    // before phase 4 opens the pull request, so a job that died in that window
    // leaves this exact block behind a live branch. The transition table used to
    // name CI_FAILED in COMPLETE alone, so the run was refused as invalid and
    // ended `skipped` — nothing posted, nothing spent, nobody told.
    seedState(harness, { phase: 'PR_DELIVERY', prUrl: 'https://example.test/pull/7', prNumber: 7 })

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('### CI fix attempt 1 of 2')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('COMPLETE')
    expect(state?.ciAttempts).toBe(1)
  })

  test.each<Phase>(['INIT_OR_CLARIFY', 'DESIGN_SPEC', 'PLANNING', 'PLAN_REVIEW', 'FAILED'])(
    'a red run in %s posts nothing and spends no CI-fix attempt',
    async (phase) => {
      // Nothing is pushed before PR_DELIVERY, so a fix round would run the
      // checks against a branch cut fresh from the base; and FAILED is already
      // parked under a failure comment asking for `/retry`, which is the path a
      // forward move to CI_FIX would take away.
      seedState(harness, { phase })

      const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

      expect(result.status).toBe('skipped')
      expect(harness.io.posted).toEqual([])
      expect(harness.io.gitCalls).toEqual([])
      // State is persisted only by posting, so an untouched thread is itself the
      // assertion that no attempt was spent; the returned state agrees.
      expect(result.state?.ciAttempts).toBe(0)
    },
  )

  test('a red run leaves a FAILED issue the /retry path its failure comment promised', async () => {
    seedState(harness, { phase: 'FAILED', resumeFrom: 'PR_DELIVERY', attempts: 1 })

    await runPipeline({ event: ciEvent(), deps: harness.deps })
    const resumed = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(resumed.status).toBe('completed')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })
})

describe('the CI-fix budget across pull requests', () => {
  let harness: Harness

  /** An issue whose first pull request burned every CI-fix round it had. */
  const spentOnAnEarlierPullRequest = (): void => {
    seedState(harness, { phase: 'FAILED', resumeFrom: 'PR_DELIVERY', ciAttempts: 2, ciBudgetReported: true })
  }

  beforeEach(() => {
    harness = makeHarness()
  })

  test('a new pull request hands the CI-fix budget back', async () => {
    spentOnAnEarlierPullRequest()
    harness.io.existingPr = null

    await runPipeline({ event: comment('/retry'), deps: harness.deps })

    const state = latestPostedState(harness)
    expect(state?.prNumber).toBe(7)
    expect(state?.ciAttempts).toBe(0)
    expect(state?.ciBudgetReported).toBe(false)
  })

  test('a refreshed pull request keeps the budget its own checks spent', async () => {
    // The same pull request, on the same commits, whose red checks spent the
    // rounds. Handing it a clean slate is how one broken branch bounces off the
    // agent for as long as anyone keeps replying `/retry`.
    spentOnAnEarlierPullRequest()
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'open' }

    await runPipeline({ event: comment('/retry'), deps: harness.deps })

    const state = latestPostedState(harness)
    expect(harness.io.createdPr).toBeNull()
    expect(state?.ciAttempts).toBe(2)
    expect(state?.ciBudgetReported).toBe(true)
  })

  test('the returned budget is real — a red run on the new pull request buys a fix round', async () => {
    // `applyCiTrigger` short-circuits on `ciBudgetReported` before it even looks
    // the pull request up, so a flag that outlived the pull request that set it
    // meant no fix round *and* no notice explaining the silence.
    spentOnAnEarlierPullRequest()
    harness.io.existingPr = null
    await runPipeline({ event: comment('/retry'), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted[0]).toContain('### CI fix attempt 1 of 2')
  })
})

describe('commands and budgets', () => {
  test('/cancel is durable — a later /approve does not resurrect the issue', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)

    const cancelled = await runPipeline({ event: comment('/cancel'), deps: harness.deps })

    expect(cancelled.status).toBe('completed')
    expect(harness.io.posted).toHaveLength(1)
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')

    harness.io.posted.length = 0
    const after = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(after.status).toBe('skipped')
    expect(harness.io.gitCalls).toEqual([])
  })

  test('a cancelled issue stays cancelled when a maintainer keeps talking', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)
    await runPipeline({ event: comment('/cancel'), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('ok, can we revisit this?'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
  })

  test('the closing comment does not promise a restart the machine refuses', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)

    await runPipeline({ event: comment('/cancel'), deps: harness.deps })

    // COMPLETE accepts nothing; the wording has to match that, not soften it.
    const closing = String(harness.io.posted[0])
    expect(closing).toContain('will not restart me')
    expect(closing.toLowerCase()).not.toContain('comment again')
  })

  test('a delivered issue closes by pointing at the pull request', async () => {
    const harness = makeHarness()
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    // Delivery posts its own closing comment; no bare "Stopped" on a shipped issue.
    expect(harness.io.posted.at(-1)).toContain('https://example.test/pull/7')
    expect(harness.io.posted.join('\n')).not.toContain('### 🛑 Stopped')
  })

  test('rejects /approve arriving in a phase that cannot accept it', async () => {
    const harness = makeHarness()

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('not valid in INIT_OR_CLARIFY')
  })

  test('says so on the issue rather than only in the job log', async () => {
    // This used to skip in silence. A maintainer who types a command and sees
    // nothing has no way to tell a refusal from an agent that never woke up —
    // which is how a mis-set AGENT_SELF_LOGIN went unnoticed while every
    // `/changes` was refused against a state that had been restarted.
    const harness = makeHarness()

    await runPipeline({ event: comment('/changes do it differently'), deps: harness.deps })

    const refusal = String(harness.io.posted.at(-1))
    expect(refusal).toContain('/changes')
    expect(refusal).toContain('INIT_OR_CLARIFY')
    // Derived from the transition table, so it cannot promise a command the
    // machine would refuse in turn.
    expect(refusal).toContain('/cancel')
    expect(refusal).toContain('/ask')
    expect(refusal).not.toContain('`/approve`')
  })

  test('/changes is accepted once the agent can read back its own spec', async () => {
    // The regression this file exists for: with the wrong self-login the spec
    // comment is invisible, the state restores to INIT_OR_CLARIFY, and the
    // maintainer's `/changes` is refused. Reading it back is what makes the
    // command land in DESIGN_SPEC and send the issue round for a new spec.
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY, SPEC_REPLY]
    await runPipeline({ event: issueEvent(), deps: harness.deps })

    const result = await runPipeline({ event: comment('/changes narrow the scope'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(result.state?.phase).toBe('DESIGN_SPEC')
    expect(harness.io.posted.at(-1)).toContain('### Design spec')
  })

  test('a single malformed reply is repaired rather than failing the run', async () => {
    // This used to park the issue in FAILED and wait for a human `/retry` over
    // a stray sentence around an otherwise fine object.
    const harness = makeHarness()
    harness.io.replies = ['here you go: not json', SPEC_REPLY]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted.at(-1)).toContain('### Design spec')
    expect(harness.io.prompts).toHaveLength(2)
    expect(String(harness.io.prompts[1]?.prompt)).toContain('could not be used')
  })

  test('re-asks once, not until it works', async () => {
    const harness = makeHarness()
    harness.io.replies = ['not json', 'still not json', SPEC_REPLY]

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.prompts).toHaveLength(2)
    expect(latestPostedState(harness)?.resumeFrom).toBe('INIT_OR_CLARIFY')
  })

  test('/retry resumes the failed phase rather than replaying the pipeline', async () => {
    const harness = makeHarness()
    harness.io.replies = ['not json', 'still not json', SPEC_REPLY]
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### Design spec')
  })

  test('an exhausted retry budget is reported on the issue, not swallowed', async () => {
    const harness = makeHarness({ maxAttempts: 1 })
    harness.io.replies = ['not json', 'not json either']
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Retry budget exhausted')
    expect(harness.io.posted[0]).toContain('### ⛔ Giving up')
  })
})

describe('the retry budget', () => {
  /** A failure an earlier job parked, with the last attempt already spent on it. */
  const seedSpentBudget = (harness: Harness): void =>
    seedState(harness, {
      phase: 'FAILED',
      resumeFrom: 'PLANNING',
      attempts: 3,
      lastError: 'the planning turn returned no JSON',
    })

  test('a /retry past the budget leaves the failure parked where it was', async () => {
    // Spending the budget used to *move* the state: the signal was applied
    // first and the ceiling checked a step later, so the give-up notice posted
    // `PLANNING` with `resumeFrom` cleared — a handler phase that
    // `/retry` (which needs FAILED) and a plain comment (which needs a waiting
    // phase) both refuse. Only `/cancel` could reach the issue after that.
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Retry budget exhausted')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('PLANNING')
    expect(state?.attempts).toBe(3)
  })

  test('reports the spent budget on the issue without paying for a model turn', async () => {
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)

    await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(harness.io.posted).toHaveLength(1)
    expect(harness.io.posted[0]).toContain('### ⛔ Giving up')
    expect(harness.io.posted[0]).toContain('3 of 3 attempts')
    // The notice may only offer what the machine will actually take. Bare
    // "reply `/retry`" is not that: the budget is spent, so the next `/retry`
    // lands straight back here. Raising the ceiling is the remedy that works.
    expect(harness.io.posted[0]).toContain('AGENT_MAX_ATTEMPTS')
    // Refused before the cascade, so no handler and no session was ever opened.
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.gitCalls).toEqual([])
  })

  test('a second /retry is still answered by the budget, not by the transition table', async () => {
    // The tell that the first one moved nothing. Against the moved state this
    // came back as `/retry is not valid in PLANNING`, which is a true
    // sentence about a phase the maintainer never asked to be in.
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)
    await runPipeline({ event: comment('/retry'), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Retry budget exhausted')
    expect(result.reason).not.toContain('not valid in')
    expect(harness.io.posted[0]).toContain('### ⛔ Giving up')
    expect(latestPostedState(harness)?.resumeFrom).toBe('PLANNING')
  })

  test('raising the ceiling resumes the parked phase, which is what makes the notice honest', async () => {
    // The notice names `AGENT_MAX_ATTEMPTS` as the way out, so the way out has
    // to still exist: the resume point survives the refusal, and the same
    // `/retry` picks the failed phase back up once the ceiling allows it.
    const harness = makeHarness({ maxAttempts: 3 })
    seedState(harness, { phase: 'FAILED', resumeFrom: 'INIT_OR_CLARIFY', attempts: 3 })
    await runPipeline({ event: comment('/retry'), deps: harness.deps })
    harness.io.posted.length = 0

    harness.deps.config = config({ maxAttempts: 4 })
    harness.io.replies = [SPEC_REPLY]
    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted.at(-1)).toContain('### Design spec')
    expect(latestPostedState(harness)?.phase).toBe('DESIGN_SPEC')
  })

  test('/ask still answers a failure whose budget is spent', async () => {
    // Answering is not retrying: it spends no attempt and moves nothing, so the
    // retry ceiling has no business stopping it. The check inside the cascade
    // sat in front of the answer handler too, so this replied "Giving up" — in
    // the one phase a maintainer most wants to ask "why did this fail?" in.
    const harness = makeHarness({ maxAttempts: 3 })
    seedSpentBudget(harness)
    harness.io.replies = ['The planning prompt exceeded the model’s context.']

    const result = await runPipeline({ event: comment('/ask why did this fail?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('The planning prompt exceeded the model’s context.')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('PLANNING')
  })
})

describe('the token budget', () => {
  /** A prior job's state block, carrying what that job spent. */
  const seedSpend = (harness: Harness, tokensSpent: number): void => {
    const prior: AgentState = { ...initialState(ISSUE), phase: 'DESIGN_SPEC', tokensSpent }
    harness.io.thread.push({ id: 900, body: `earlier\n\n${serializeState(prior)}`, authorLogin: AGENT_LOGIN })
  }

  test('records what the run spent, so the next job can see it', async () => {
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 41_200

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(latestPostedState(harness)?.tokensSpent).toBe(41_200)
  })

  test('adds this job’s spend to what earlier jobs already spent', async () => {
    // The runaway this bounds is not one job — it is an issue bouncing through
    // retries and CI-fix rounds, each on a fresh runner with no memory.
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 1_000
    await runPipeline({ event: issueEvent(), deps: harness.deps })

    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 2_500
    await runPipeline({ event: comment('/changes tighten it up'), deps: harness.deps })

    expect(latestPostedState(harness)?.tokensSpent).toBe(3_500)
  })

  test('counts one job’s spend once, however many phases it cascades through', async () => {
    // The session total is cumulative across the phases of a job, so adding it
    // to each phase's own figure would count the earlier phases again. Approving
    // the plan runs implement *and* deliver in a single job, which is the case
    // that tells the two apart.
    const harness = makeHarness()
    harness.io.tokensUsed = 900
    harness.io.replies = [SPEC_REPLY]
    await runPipeline({ event: issueEvent(), deps: harness.deps })
    harness.io.replies = [PLAN_REPLY]
    const planned = await runPipeline({ event: comment('/approve'), deps: harness.deps })
    harness.io.posted.length = 0

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    // Two handlers ran in this one job, which is what makes the case.
    expect(headings(harness)).toEqual(['### Implementation report', '### Pull request ready'])
    expect(result.state?.tokensSpent).toBe(spentIn(planned) + 900)
  })

  test('a phase that fails records what it spent, so the next job does not start from zero', async () => {
    // The counter used to be blind exactly where the ceiling was meant to bite.
    // `runHandler` patched `tokensSpent` on the way out and `failRun` did not,
    // so a job that spent a quarter of a million tokens and then threw persisted
    // `0` — and retries *are* the failure path, so an issue could burn the
    // ceiling round after round and restore a clean slate every time.
    const harness = makeHarness()
    harness.io.replies = ['not json', 'still not json']
    harness.io.tokensUsed = 250_000

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.tokensSpent).toBe(250_000)
  })

  test('a failure adds this job’s spend to the earlier jobs’, counting neither twice', async () => {
    // The figure a failure writes has to be the one the success path writes: the
    // running total. 10,000 alone would drop everything the issue spent before
    // this job; 90,000 would be the carried figure counted once by the restored
    // state and again by the patch.
    const harness = makeHarness()
    seedSpend(harness, 40_000)
    harness.io.replies = ['not json', 'still not json']
    harness.io.tokensUsed = 10_000

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(latestPostedState(harness)?.tokensSpent).toBe(50_000)
  })

  test('a failed answer records what the question cost', async () => {
    // A model turn that fails still spent what it spent — a deadline or a
    // rejected request lands here with the provider's meter already run. The
    // answer path posts the state unchanged, so it dropped the whole figure.
    const harness = makeHarness()
    seedSpend(harness, 40_000)
    harness.io.tokensUsed = 10_000
    harness.deps.agent = (): Promise<OpenCodeAgent> =>
      Promise.resolve({
        sessionId: 'session-1',
        prompt: () => Promise.reject(new Error('the model timed out')),
        tokensUsed: () => Promise.resolve(harness.io.tokensUsed),
        abort: () => Promise.resolve(true),
        close: () => Promise.resolve(),
      })

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### ⚠️ I could not answer that')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('DESIGN_SPEC')
    expect(state?.tokensSpent).toBe(50_000)
  })

  test('stops the issue once an earlier job has spent the budget', async () => {
    // The whole point of persisting it: this job's own session has spent
    // nothing, and it still must not start.
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 60_000)

    const result = await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reason).toContain('Token budget spent')
    expect(harness.io.posted[0]).toContain('### ⛔ Token budget spent')
  })

  test('says why a bare /retry will not help, and names what makes it help', async () => {
    // The spend is persisted, so a retry against the same ceiling re-reads the
    // same total and stops again — but it is no longer a dead end, because the
    // stop parks a resume point. So the notice has to name both halves in
    // order: raise AGENT_MAX_TOKENS, *then* `/retry`.
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 60_000)

    await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('AGENT_MAX_TOKENS')
    expect(harness.io.posted[0]).toContain('stops right back here')
    expect(harness.io.posted[0]).toContain('/retry')
  })

  test('checks before the phase runs, not after it has spent more', async () => {
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 60_000)

    await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(harness.io.prompts).toHaveLength(0)
  })

  test('stops at exactly the budget, not only past it', async () => {
    // "Spent 5,000,000 of 5,000,000" is spent. Asserting the *reason*, not just
    // the status: with the budget check relaxed to `>` this run still fails,
    // because the triage handler it then reaches has no reply to parse.
    const harness = makeHarness({ maxTokens: 50_000 })
    seedSpend(harness, 50_000)

    const result = await runPipeline({ event: comment('/changes again'), deps: harness.deps })

    expect(result.reason).toContain('Token budget spent')
  })

  test('lets a run under the budget through', async () => {
    const harness = makeHarness({ maxTokens: 5_000_000 })
    harness.io.replies = [SPEC_REPLY]
    harness.io.tokensUsed = 41_200

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('waiting')
  })

  test('parks the stop in FAILED, resuming from the phase it refused to start', async () => {
    // Trigger point one: the budget runs out on the *first* phase of a run,
    // right after a trigger moved the state. The stop used to leave the state
    // exactly where the trigger had put it — `PLANNING`, a phase with a
    // handler — so the issue was parked somewhere `/retry` (needs FAILED) and a
    // plain comment (needs a waiting phase) both refuse, and only `/cancel`
    // reached it. Reachable on a first approval with no failure involved.
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### ⛔ Token budget spent')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('PLANNING')
    expect(state?.tokensSpent).toBe(500)
  })

  test('parks a mid-cascade stop too, where no trigger moved the state', async () => {
    // Trigger point two, which no trigger-layer refusal can reach: the earlier
    // phase legitimately did its work and posted, and the cascade stops before
    // the next one. Stopping in `PR_DELIVERY` is the same dead end as stopping
    // in `PLANNING` above — worse, in fact, since the branch is already
    // pushed and only delivery is left.
    const harness = makeHarness({ maxTokens: 50_000 })
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    // The counter reaches the ceiling as phase 3 finishes, so the stop lands
    // between two phases of one job — the firing no trigger-layer refusal can
    // reach. Hung on the push because that is the last thing phase 3 does; it
    // used to hang on the review loop, which phase 3 no longer runs.
    harness.deps.git.push = (branch): Promise<void> => {
      harness.io.gitCalls.push(`push:${branch}`)
      harness.io.tokensUsed = 60_000
      return Promise.resolve()
    }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(headings(harness)).toEqual(['### Implementation report', '### ⛔ Token budget spent'])

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('PR_DELIVERY')
    expect(state?.tokensSpent).toBe(60_000)
  })

  test('names the phase it parked in, so the notice and the state block agree', async () => {
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('AGENT_MAX_TOKENS')
    expect(harness.io.posted[0]).toContain('/retry')
    expect(harness.io.posted[0]).toContain(`\`${String(latestPostedState(harness)?.resumeFrom)}\``)
  })

  test('raising the ceiling and replying /retry resumes the phase it stopped before', async () => {
    // What makes the notice honest. It names `AGENT_MAX_TOKENS` and `/retry`,
    // so both together have to actually finish the work — before, raising the
    // ceiling left the issue in `PR_DELIVERY` with no event able to re-enter it.
    const harness = makeHarness({ maxTokens: 50_000 })
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    // The counter reaches the ceiling as phase 3 finishes, so the stop lands
    // between two phases of one job — the firing no trigger-layer refusal can
    // reach. Hung on the push because that is the last thing phase 3 does; it
    // used to hang on the review loop, which phase 3 no longer runs.
    harness.deps.git.push = (branch): Promise<void> => {
      harness.io.gitCalls.push(`push:${branch}`)
      harness.io.tokensUsed = 60_000
      return Promise.resolve()
    }
    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    harness.io.posted.length = 0

    // A fresh runner: a new session that has spent nothing, under a raised ceiling.
    harness.io.tokensUsed = 0
    harness.deps.config = config({ maxTokens: 500_000 })
    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.posted.at(-1)).toContain('### Pull request ready')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('an over-budget stop does not eat the retry budget', async () => {
    // A stop for want of tokens is not a failed attempt, so it must not spend
    // one — otherwise the two budgets collide: the token notice says to raise
    // `AGENT_MAX_TOKENS` and reply `/retry`, and that `/retry` is then turned
    // down by the *retry* gate in `triggers.ts` for a ceiling nobody mentioned.
    const harness = makeHarness({ maxAttempts: 3 })
    await toDesignSpec(harness)
    seedState(harness, { phase: 'FAILED', resumeFrom: 'PLANNING', attempts: 2, tokensSpent: 500 })

    harness.deps.config = config({ maxAttempts: 3, maxTokens: 100 })
    await runPipeline({ event: comment('/retry'), deps: harness.deps })
    expect(latestPostedState(harness)?.attempts).toBe(2)
    harness.io.posted.length = 0

    harness.deps.config = config({ maxAttempts: 3, maxTokens: 500_000 })
    harness.io.replies = [PLAN_REPLY]
    const result = await runPipeline({ event: comment('/retry'), deps: harness.deps })

    expect(result.reason).not.toContain('Retry budget exhausted')
    expect(harness.io.posted.at(-1)).toContain('### Plan')
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
  })

  test('an over-budget /ask leaves the phase alone rather than parking a question', async () => {
    // Answering is a side conversation about work that lives elsewhere, so the
    // park above must not apply to it. `resumeFrom` may never name a waiting
    // phase — a `/retry` into `DESIGN_SPEC` finds no handler and re-parks with
    // "Parked in `DESIGN_SPEC`", one round trip for nothing — and the phase the
    // question was asked in is one a trigger can already re-enter.
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.posted[0]).toContain('AGENT_MAX_TOKENS')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('DESIGN_SPEC')
    expect(state?.resumeFrom).toBeNull()
    expect(state?.tokensSpent).toBe(500)
  })

  test('stops paying the classifier once the issue is over budget', async () => {
    // Classifying a plain comment is the one model turn whose spend can never be
    // written down: when the classifier answers `none` the run skips without
    // posting, and this pipeline persists state only by posting a comment. Over
    // budget nothing any classification could ask for is affordable — every
    // branch below it leads to a handler the cascade will refuse — so the
    // ceiling is asked *before* the classifier rather than after paying it,
    // which is what stops a maxed-out issue paying a turn per comment for ever.
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    const result = await runPipeline({ event: comment('looks good to me'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.posted[0]).toContain('### ⛔ Token budget spent')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('DESIGN_SPEC')
    expect(state?.tokensSpent).toBe(500)
  })

  test('an over-budget /ask in COMPLETE reports instead of crashing the runner', async () => {
    // `COMPLETE` accepts neither FAILED nor CANCELLED, so parking a question
    // there would throw `InvalidTransitionError` straight out of the pipeline —
    // the runner exits 1 and the issue hears nothing, which is the failure the
    // answer path has already been burned by twice.
    const harness = makeHarness({ maxTokens: 100 })
    seedState(harness, { phase: 'COMPLETE', tokensSpent: 500, prUrl: 'https://example.test/pull/7' })

    const result = await runPipeline({ event: comment('/ask what did you change?'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### ⛔ Token budget spent')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })
})

describe('the job’s wall clock', () => {
  const MINUTE = 60_000

  /**
   * A job whose deadline is `left` from now, with the default three-minute reserve.
   *
   * Anything at or below the reserve is out of time; anything above it is not. The
   * two live side by side in most of these tests, because "it stopped" is only half
   * the assertion — the other half is that a run with room carries on.
   */
  const withClock = (left: number, overrides: Partial<PipelineConfig> = {}): Harness =>
    makeHarness({ jobDeadlineMs: RUN_NOW_MS + left, teardownReserveMs: 3 * MINUTE, ...overrides })

  test('parks in INCOMPLETE before starting a phase it cannot finish', async () => {
    // The stop the whole finding is about, in the shape it should have had: not a
    // runner killed at `timeout-minutes` with nothing on the issue, and not a
    // handler crash reported as ❌, but a bound reached and said out loud.
    const harness = withClock(MINUTE)
    seedState(harness, { phase: 'DESIGN_SPEC' })

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted[0]).toContain('### ⛔ Out of time for this job')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('INCOMPLETE')
    expect(state?.resumeFrom).toBe('PLANNING')
    expect(state?.lastError).toBeNull()
    expect(result.reported).toBe(true)
  })

  test('reports waiting rather than failed, so a job that behaved does not go red', async () => {
    // Deliberately unlike the token stop, which reports `failed`: that one starts
    // no work, and this one has finished some and stopped in order to hand it over.
    // `waiting` exits 0, so the Actions page stops showing red for runs that did
    // exactly the right thing.
    const harness = withClock(MINUTE)
    seedState(harness, { phase: 'DESIGN_SPEC' })

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
  })

  test('starts the phase when there is time over the reserve', async () => {
    const harness = withClock(40 * MINUTE)
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
  })

  test('checks before the phase runs, not after it has spent the time', async () => {
    const harness = withClock(MINUTE)
    seedState(harness, { phase: 'DESIGN_SPEC' })

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prompts).toHaveLength(0)
  })

  test('records what the job spent, because the next job reads it', async () => {
    // The rule this pipeline is emphatic about: every state block a job writes
    // carries the running total, a phase that succeeded, one that threw and one a
    // ceiling refused to start alike. This is the worst place to be blind, because
    // `INCOMPLETE` is exactly the state a `/continue` comes back out of.
    const harness = withClock(MINUTE)
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 40_000 })
    harness.io.tokensUsed = 10_000

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(latestPostedState(harness)?.tokensSpent).toBe(50_000)
  })

  test('spends no attempt, so the /continue it invites is never refused', async () => {
    // Entered through `/retry`, which is the one trigger that carries a non-zero
    // count into a handler phase — every forward move resets it. A stop that spent
    // one would collide the two bounds: the notice asks for `/continue`, and the
    // retry gate would eventually turn down the run it resumes over a ceiling this
    // comment never mentioned.
    const harness = withClock(MINUTE, { maxAttempts: 3 })
    seedState(harness, { phase: 'FAILED', resumeFrom: 'PLANNING', attempts: 2 })

    await runPipeline({ event: comment('/retry'), deps: harness.deps })

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('INCOMPLETE')
    expect(state?.attempts).toBe(2)
  })

  test('a /continue on a fresh job picks up the phase that ran out of time', async () => {
    // What makes the notice honest. It offers `/continue` with no variable to raise
    // first, which is only true because a new job gets a whole new clock — the
    // difference from the token ceiling, where the same `/retry` stops right back
    // where it was.
    const harness = withClock(60 * MINUTE)
    await toDesignSpec(harness)

    // The job the clock ran out on, and then a fresh one: same issue, same thread,
    // a new runner with its own deadline.
    harness.deps.config = config({ jobDeadlineMs: RUN_NOW_MS + MINUTE, teardownReserveMs: 3 * MINUTE })
    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
    harness.io.posted.length = 0

    harness.deps.config = config({ jobDeadlineMs: RUN_NOW_MS + 60 * MINUTE, teardownReserveMs: 3 * MINUTE })
    harness.io.replies = [PLAN_REPLY]
    const result = await runPipeline({ event: comment('/continue'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted.at(-1)).toContain('### Plan')
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
    expect(latestPostedState(harness)?.resumeFrom).toBeNull()
  })

  test('a /continue that runs out of time again parks again rather than failing', async () => {
    // The chain is bounded by the token budget and by a human typing the command,
    // not by `attempts` — which is why it must be able to happen twice without the
    // retry gate acquiring an opinion about it.
    const harness = withClock(MINUTE, { maxAttempts: 3 })
    seedState(harness, { phase: 'DESIGN_SPEC' })
    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    const again = await runPipeline({ event: comment('/continue'), deps: harness.deps })

    expect(again.status).toBe('waiting')
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
    expect(latestPostedState(harness)?.resumeFrom).toBe('PLANNING')
    expect(latestPostedState(harness)?.attempts).toBe(0)
  })

  test.each(['/approve', '/retry', '/review'])('%s is refused in INCOMPLETE, naming what does work', async (typed) => {
    // Through the same door a wrong-phase command has always been refused, so the
    // list a maintainer is shown comes from the transition table rather than from a
    // sentence somebody kept in step by hand.
    const harness = makeHarness()
    seedState(harness, { phase: 'INCOMPLETE', resumeFrom: 'REVIEW_AND_MUTATE' })

    const result = await runPipeline({ event: comment(typed), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted[0]).toContain('does not apply right now')
    expect(harness.io.posted[0]).toContain('`/continue`')
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
  })

  test('a /continue anywhere else is refused, and moves nothing', async () => {
    // `/continue` means "you were not finished", a claim only a wall-clock park can
    // make. In `FAILED` the command that resumes is `/retry`, and the two must not
    // become interchangeable — the state block is the assertion, because a state
    // that is never posted never happened.
    const harness = makeHarness()
    seedState(harness, { phase: 'FAILED', resumeFrom: 'PLANNING', lastError: 'boom' })

    const result = await runPipeline({ event: comment('/continue'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.prompts).toHaveLength(0)
    expect(latestPostedState(harness)?.phase).toBe('FAILED')
    expect(latestPostedState(harness)?.resumeFrom).toBe('PLANNING')
  })

  test('a plain comment in INCOMPLETE is read and set aside, exactly as in FAILED', async () => {
    // The two parked phases answer prose the same way, and neither classifies it:
    // nothing the classifier can report moves either phase on, so a triage turn
    // bought here buys nothing at all.
    const harness = makeHarness()
    seedState(harness, { phase: 'INCOMPLETE', resumeFrom: 'REVIEW_AND_MUTATE' })

    const result = await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reason).toContain('No actionable command while in INCOMPLETE')
    expect(harness.io.prompts).toHaveLength(0)
    expect(harness.io.posted).toEqual([])
    expect(reactionsOf(harness)).toContain('+1')
  })

  test('an out-of-time /ask leaves the phase alone rather than parking a question', async () => {
    // Answering is a side conversation about work that lives elsewhere, so the park
    // must not apply to it — `resumeFrom` may never name a waiting phase, and
    // `INCOMPLETE` would claim a delivered pull request was unfinished because
    // somebody asked what had changed.
    const harness = withClock(MINUTE)
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 500 })

    const result = await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.prompts).toEqual([])
    expect(harness.io.posted[0]).toContain('### ⛔ Out of time for this job')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('DESIGN_SPEC')
    expect(state?.resumeFrom).toBeNull()
    expect(state?.tokensSpent).toBe(500)
  })

  test('an out-of-time /ask in COMPLETE reports instead of crashing the runner', async () => {
    // `OUT_OF_TIME` is accepted only where a handler exists, so parking a question
    // asked in `COMPLETE` would throw `InvalidTransitionError` out of the pipeline
    // — the runner exits 1 and the issue hears nothing, which is the failure the
    // answer path has already been burned by twice.
    const harness = withClock(MINUTE)
    seedState(harness, { phase: 'COMPLETE', prUrl: 'https://example.test/pull/7' })

    const result = await runPipeline({ event: comment('/ask what changed?'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted[0]).toContain('### ⛔ Out of time for this job')
    expect(latestPostedState(harness)?.phase).toBe('COMPLETE')
  })

  test('the token ceiling is reported first when both bounds are reached at once', async () => {
    // The order between the two stops is a decision, not an accident. The token
    // budget spans jobs and the clock does not, so telling a maintainer to
    // `/continue` here would spend a whole job to learn that the real answer is
    // `AGENT_MAX_TOKENS`. Reported the other way round, the notice names the thing
    // that actually has to change.
    const harness = withClock(MINUTE, { maxTokens: 50_000 })
    seedState(harness, { phase: 'DESIGN_SPEC', tokensSpent: 60_000 })

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted[0]).toContain('### ⛔ Token budget spent')
    expect(latestPostedState(harness)?.phase).toBe('FAILED')
  })

  test('a mid-cascade stop parks too, where no trigger moved the state', async () => {
    // The firing no trigger-layer refusal could ever reach: the earlier phase
    // legitimately did its work and posted, and the clock runs out before the next
    // one. `PR_DELIVERY` is the worst place to be stranded, since the branch is
    // already pushed and only the pull request is left.
    const harness = withClock(40 * MINUTE)
    await toPlanReview(harness)
    harness.io.replies = ['Implemented.']
    harness.deps.git.push = (branch): Promise<void> => {
      harness.io.gitCalls.push(`push:${branch}`)
      harness.io.nowMs += 39 * MINUTE
      return Promise.resolve()
    }

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(headings(harness)).toEqual(['### Implementation report', '### ⛔ Out of time for this job'])

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('INCOMPLETE')
    expect(state?.resumeFrom).toBe('PR_DELIVERY')
  })

  test('a run with no job deadline is bounded by the per-turn cap alone, as before', async () => {
    // Every `--event-path` run, and every workflow that has not been updated. The
    // knobs are absent, so `jobDeadlineMs` is null and this path must be
    // indistinguishable from the one that existed before the bound did.
    const harness = makeHarness({ jobDeadlineMs: null })
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]
    // Well past any plausible deadline, which must mean nothing without one.
    harness.io.nowMs = RUN_NOW_MS + 10 * 60 * MINUTE

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
  })

  test('the parked issue carries the amber marker, not the failure one', async () => {
    const harness = withClock(MINUTE)
    seedState(harness, { phase: 'DESIGN_SPEC' })

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.labels).toContain('agent:incomplete')
    expect(harness.io.labels).toContain('agent:needs-you')
    expect(harness.io.labels).not.toContain('agent:failed')
    expect(harness.io.labels).not.toContain('agent:working')
  })
})

/**
 * The finding itself: the clock runs out **inside** the implementation turn.
 *
 * Everything above is the stop in front of a phase, which loses nothing because the
 * phase never starts. This is the run that produced the finding — thirty minutes of
 * steady progress, 355 tool calls, discarded and reported as "the model did not
 * answer" — and the assertion throughout is the **persisted state** plus what the
 * branch carries, never a returned status.
 */
describe('a turn stopped part-way through', () => {
  /** What the adapter rejects with when a turn is cut off mid-`bash`. */
  const outOfTime = (): Error =>
    turnDeadlineError(1_800_000, { lastAction: 'ran bash', toolCalls: 355, tokens: 112_084, cost: 0 })

  /**
   * An issue with an approved plan, whose implementation turn runs out of time.
   *
   * The wrap-up is the second prompt in the same session, so it is the reply queue's
   * first entry: `failNextPrompt` accounts for the turn that never answered.
   */
  const stoppedMidTurn = async (overrides: Partial<PipelineConfig> = {}): Promise<Harness> => {
    const harness = makeHarness({ wrapUpMs: 30_000, ...overrides })
    await toPlanReview(harness)
    harness.io.prompts.length = 0
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]
    await runPipeline({ event: comment('/approve'), deps: harness.deps })
    return harness
  }

  const HANDOFF = [
    '**Done** — the retry wrapper and its tests.',
    '**Remaining** — wire it into the client.',
    '**Tried and rejected** — a decorator, which broke the generic typing.',
  ].join('\n')

  test('parks in INCOMPLETE with the phase it was interrupted in, and nothing broke', async () => {
    const harness = await stoppedMidTurn()

    expect(harness.io.posted.at(-1)).toContain('### ⛔ Out of time part-way through the work')

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('INCOMPLETE')
    expect(state?.resumeFrom).toBe('REVIEW_AND_MUTATE')
    // Not a failure: no error recorded, no attempt spent, so the `/continue` the
    // notice invites can never be refused by the retry gate.
    expect(state?.lastError).toBeNull()
    expect(state?.attempts).toBe(0)
  })

  test('reports waiting rather than failed, and says the issue was told', async () => {
    // The turn was cut off mid-`bash` and its work is on the branch. A red Actions
    // page for that is the ❌-for-a-ceiling category error the whole item is about.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(result.reported).toBe(true)
  })

  test('aborts twice — once to ask, once regardless of the answer', async () => {
    // The soft stop is what makes the wrap-up possible; the hard stop is what makes
    // the run independent of the model cooperating. Neither is `close()`, which the
    // measurement showed orphans the tool child rather than stopping it.
    const harness = await stoppedMidTurn()

    expect(harness.io.aborts).toBe(2)
    expect(harness.io.agentClosed).toBe(false)
  })

  test('asks the same session for a handoff, and posts what it said', async () => {
    const harness = await stoppedMidTurn()

    const wrapUp = harness.io.prompts.at(-1)
    expect(wrapUp?.prompt).toContain('Start nothing new')
    expect(wrapUp?.prompt).toContain('Tried and rejected')
    // The reply reaches the issue where a human decides whether to continue at all.
    expect(harness.io.posted.at(-1)).toContain('a decorator, which broke the generic typing')
  })

  test('the wrap-up reuses the interrupted turn’s system prompt, envelope id and all', async () => {
    // A second `mintEnvelope` would tell the model to trust an id that appears in no
    // delimiter, which makes every real one in the session look forged.
    const harness = await stoppedMidTurn()

    const [implement, wrapUp] = harness.io.prompts
    expect(harness.io.prompts).toHaveLength(2)
    expect(wrapUp?.system).toBe(implement?.system)
  })

  test('commits with the hooks bypassed and pushes the same way', async () => {
    // `prepare` installs a pre-commit hook that runs lint, typecheck and format over
    // the staged files, so a tree interrupted mid-edit cannot be committed at all
    // without this — `git commit` exits non-zero and the salvage loses everything.
    const harness = await stoppedMidTurn()

    expect(harness.io.gitCalls).toContain(`salvage:chore(agent): salvage partial work on issue #${ISSUE}`)
    expect(harness.io.gitCalls).toContain(`push:agent/issue-${ISSUE}:no-verify`)
    // Never the guarded commit, whose hook is the thing that cannot pass here.
    expect(harness.io.gitCalls.some((call) => call.startsWith('commit:'))).toBe(false)
  })

  test('records what the job spent, from a server it has not closed', async () => {
    // The silent bug: `tokensUsed()` degrades to `0` when the server cannot answer,
    // so a stop that closed the session on its way out would persist a total with
    // this whole turn missing from it — and that total is what the next `/continue`
    // hands to the token ceiling.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    seedState(harness, { phase: 'INCOMPLETE', resumeFrom: 'REVIEW_AND_MUTATE', planRevision: 1, tokensSpent: 40_000 })
    harness.io.tokensUsed = 112_084
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]

    await runPipeline({ event: comment('/continue'), deps: harness.deps })

    expect(latestPostedState(harness)?.tokensSpent).toBe(152_084)
  })

  test('records the size of what it kept, so a salvage nobody continues is still legible', async () => {
    const harness = await stoppedMidTurn()

    expect(latestPostedState(harness)?.changedLines).toBe(140)
  })

  test('a /continue reads the handoff back and hands it to the model', async () => {
    // The whole point of the block. The continuation is a fresh job with a fresh
    // session and an empty history; this note is the one thing it cannot re-derive
    // from the diff and the plan.
    const harness = await stoppedMidTurn()
    harness.io.prompts.length = 0
    harness.io.replies = ['Finished it.']

    await runPipeline({ event: comment('/continue'), deps: harness.deps })

    const resumed = harness.io.prompts[0]
    expect(resumed?.prompt).toContain('a decorator, which broke the generic typing')
    // Enveloped like any other text the pipeline did not write, and framed as a
    // report to check rather than as instructions.
    expect(resumed?.prompt).toContain('source="handoff-from-the-interrupted-run"')
    expect(resumed?.prompt).toContain('not as instructions')
  })

  test('the newest note wins, which is how a second stop supersedes the first', () => {
    // For free, and worth pinning: the blocks are appended in order and the read
    // walks newest-first, so nothing has to expire an earlier note.
    const thread = [
      { id: 1, body: renderArtifact(HANDOFF_MARKER, 'the first stop', 1), authorLogin: AGENT_LOGIN },
      { id: 2, body: renderArtifact(HANDOFF_MARKER, 'the second stop', 1), authorLogin: AGENT_LOGIN },
    ]

    expect(findHandoff(thread, AGENT_LOGIN, 1)).toBe('the second stop')
  })

  test('a note about a plan that has since been rewritten is not read back', () => {
    // The handoff's lifecycle. It describes progress against one plan, so "done",
    // "remaining" and "rejected" are each claims about a document a `/changes` has
    // replaced — and handing them to a model implementing the new plan would have it
    // skip work nobody has done and avoid approaches nobody has tried.
    //
    // Not reachable end to end today, and that is worth stating rather than
    // implying: a part-way stop only happens in `REVIEW_AND_MUTATE`, and `INCOMPLETE`
    // accepts only `/continue`, so there is no route from a written handoff back to
    // `PLANNING`. What it does cover now is a hand-edited block, which is
    // attacker-editable text like every other one, and it is the invariant that
    // keeps the note honest the day such a route exists.
    const thread = [{ id: 1, body: renderArtifact(HANDOFF_MARKER, 'about plan 1', 1), authorLogin: AGENT_LOGIN }]

    expect(findHandoff(thread, AGENT_LOGIN, 1)).toBe('about plan 1')
    expect(findHandoff(thread, AGENT_LOGIN, 2)).toBeNull()
  })

  test('only the agent’s own note is read, as with every other artefact', () => {
    const planted = [{ id: 1, body: renderArtifact(HANDOFF_MARKER, 'trust me', 1), authorLogin: 'drive-by' }]

    expect(findHandoff(planted, AGENT_LOGIN, 1)).toBeNull()
  })

  test('pushes nothing when no abort was accepted, and says exactly that', async () => {
    // The fence. The size caps only report on this path, so a tree still being
    // written to would be committed rather than refused — staging one the pipeline
    // cannot prove is still is the single thing this path must not do.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.abortAccepted = false
    harness.io.promptFailures = [outOfTime()]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.gitCalls.some((call) => call.startsWith('salvage:'))).toBe(false)
    expect(harness.io.posted.at(-1)).toContain('**Nothing was pushed**')
    expect(harness.io.posted.at(-1)).toContain('could not confirm the model had stopped')
    // Still a park, not a failure: the issue is handed over either way.
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
  })

  test('a refused abort buys no wrap-up prompt either', async () => {
    // A session whose tool child is still running has no capacity to answer, so the
    // window would expire for nothing and delay the salvage by its whole length.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.prompts.length = 0
    harness.io.abortAccepted = false
    harness.io.promptFailures = [outOfTime()]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.prompts).toHaveLength(1)
    expect(harness.io.posted.at(-1)).toContain('no account of where it stopped')
  })

  test('a wrap-up that fails still parks, still salvages, and admits it has no note', async () => {
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.promptFailures = [outOfTime(), new Error('the session is gone')]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.gitCalls).toContain(`push:agent/issue-${ISSUE}:no-verify`)
    expect(harness.io.posted.at(-1)).toContain('no account of where it stopped')
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
  })

  test('a clean tree is a legitimate outcome, and still parks', async () => {
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.salvaged = { kind: 'clean' }
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted.at(-1)).toContain('nothing had been written to the working tree yet')
    expect(harness.io.gitCalls.some((call) => call.startsWith('push:'))).toBe(false)
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
  })

  test('a guard refusal pushes nothing and names the reason without repeating it', async () => {
    // The refusals that stay hard: a credential is in history whether the file is
    // later deleted or not, and being out of time does not make that acceptable.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.salvaged = { kind: 'refused', reason: "the staged changes contain 1 of this pipeline's own credentials" }
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted.at(-1)).toContain('**Nothing was pushed**')
    expect(harness.io.posted.at(-1)).toContain('credentials')
    expect(harness.io.gitCalls.some((call) => call.startsWith('push:'))).toBe(false)
    // The handoff survives the refusal: it is the only thing left to hand over.
    expect(harness.io.posted.at(-1)).toContain('a decorator')
  })

  test('a commit over the size caps is reported rather than thrown away', async () => {
    // Discarding a real 3,000-line increment because the cap says 2,000 recreates
    // the exact loss this whole finding is about.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.salvaged = {
      kind: 'committed',
      totals: { files: 40, lines: 3_000 },
      overCap: '3000 lines changed, over the limit of 2000',
    }
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted.at(-1)).toContain('3,000 lines')
    expect(harness.io.posted.at(-1)).toContain('over the limit of 2000')
    expect(harness.io.gitCalls).toContain(`push:agent/issue-${ISSUE}:no-verify`)
  })

  test('a salvage that breaks degrades to “nothing pushed”, never to a second failure', async () => {
    // The run being rescued is already out of time and cannot afford a second thing
    // to go wrong — so a git that rejects must not turn a park into a ❌.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.io.salvageError = new Error('git failed (128): index.lock exists')
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(harness.io.posted.at(-1)).toContain('**Nothing was pushed**')
    expect(harness.io.posted.at(-1)).toContain('index.lock')
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
  })

  test('a push that cannot reach the remote is “nothing pushed”, which is the truth', async () => {
    // A commit that exists only in a working tree the job is about to destroy is not
    // something a maintainer can act on.
    const harness = makeHarness({ wrapUpMs: 30_000 })
    await toPlanReview(harness)
    harness.deps.git.push = (): Promise<void> => Promise.reject(new Error('failed to push some refs'))
    harness.io.promptFailures = [outOfTime()]
    harness.io.replies = [HANDOFF]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.posted.at(-1)).toContain('**Nothing was pushed**')
    expect(latestPostedState(harness)?.phase).toBe('INCOMPLETE')
  })

  test('every other way a turn can fail is still a failure', async () => {
    // The regression this stage could most easily introduce. A rate limit, a dead
    // provider or a bad reply is the work breaking: ❌, an attempt spent, and
    // `/retry` — and none of them may quietly start salvaging a half-written tree.
    const harness = makeHarness()
    await toPlanReview(harness)
    harness.io.promptFailures = [new Error('429 rate limited')]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(harness.io.posted.at(-1)).toContain('### ❌ Run failed in REVIEW_AND_MUTATE')
    expect(harness.io.gitCalls.some((call) => call.startsWith('salvage:'))).toBe(false)

    const state = latestPostedState(harness)
    expect(state?.phase).toBe('FAILED')
    expect(state?.resumeFrom).toBe('REVIEW_AND_MUTATE')
    expect(state?.attempts).toBe(1)
  })

  test('the parked issue carries the amber marker, exactly as the stop in front of a phase does', async () => {
    const harness = await stoppedMidTurn()

    expect(harness.io.labels).toContain('agent:incomplete')
    expect(harness.io.labels).not.toContain('agent:failed')
  })
})

/** Just the contents, in order — the target is asserted where it is the point. */
const reactionsOf = (harness: Harness): ReactionContent[] => harness.io.reactions.map((entry) => entry.content)

/** A run that goes all the way from an approved plan to an open pull request. */
const driveDelivery = async (harness: Harness): Promise<RunResult> => {
  await toPlanReview(harness)
  harness.io.replies = ['Implemented.']
  return runPipeline({ event: comment('/approve'), deps: harness.deps })
}

/** An issue parked in COMPLETE, where no command and no comment is actionable. */
const toComplete = async (harness: Harness): Promise<void> => {
  await toDesignSpec(harness)
  await runPipeline({ event: comment('/cancel'), deps: harness.deps })
  harness.io.posted.length = 0
  harness.io.reactions.length = 0
  harness.io.reactionRemovals.length = 0
  harness.io.reactionLog.length = 0
  harness.io.edits.length = 0
}

describe('reactions — acknowledging a trigger', () => {
  test('👀 on the comment that asked for the work, before any of it happens', async () => {
    // The gap this closes: a maintainer types `/approve` and the next thing on
    // the issue is the finished artefact, up to `AGENT_TIMEOUT_MS` later. For
    // that whole window the issue looks exactly like one where the workflow
    // never fired — which is also a real outcome, since a guardrail can drop
    // the event.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.reactions[0]).toEqual({ target: { kind: 'comment', id: COMMENT_ID }, content: 'eyes' })
  })

  test('👀 lands on the issue when no comment raised the run', async () => {
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(harness.io.reactions[0]).toEqual({ target: { kind: 'issue', number: ISSUE }, content: 'eyes' })
  })

  test('👀 arrives before the pipeline even reads the thread', async () => {
    // Ordering is the whole value of this reaction. One placed after the phase
    // handler would land at the same moment as the comment it is meant to
    // precede, and buy nothing at all.
    const harness = makeHarness()
    const order: string[] = []
    harness.deps.github.listIssueComments = (): Promise<IssueComment[]> => {
      order.push('read-thread')
      return Promise.resolve([...harness.io.thread])
    }
    harness.deps.github.addReaction = (): Promise<ReactionRef> => {
      order.push('react')
      return Promise.resolve({ id: 1 })
    }
    harness.io.replies = [SPEC_REPLY]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(order[0]).toBe('react')
  })

  test('🚀 once a run has actually delivered a pull request', async () => {
    const harness = makeHarness()

    const result = await driveDelivery(harness)

    expect(result.status).toBe('completed')
    expect(reactionsOf(harness)).toEqual(['eyes', 'rocket'])
  })

  test('🚀 for a refreshed pull request too — the work is still delivered', async () => {
    const harness = makeHarness()
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'open' }

    await driveDelivery(harness)

    expect(reactionsOf(harness)).toEqual(['eyes', 'rocket'])
  })

  test('no 🚀 when delivery stands down instead of delivering', async () => {
    // The settled branch reports the same `PR_OPENED` signal and reaches the
    // same `COMPLETE`, having opened and refreshed nothing. A rocket there would
    // announce a delivery that did not happen.
    const harness = makeHarness()
    harness.io.existingPr = { number: 3, url: 'https://example.test/pull/3', state: 'merged' }

    const result = await driveDelivery(harness)

    expect(result.status).toBe('completed')
    expect(reactionsOf(harness)).toEqual(['eyes'])
  })
})

/**
 * Just the removals' contents, resolved back through what was placed.
 *
 * Through the id rather than by assuming order: the point of asserting a removal
 * is that it names the reaction the run created, and a helper that reported the
 * content by position would pass on a delete aimed at the wrong one.
 */
const removedContentsOf = (harness: Harness): (ReactionContent | 'unplaced')[] =>
  harness.io.reactionRemovals.map((removal) => harness.io.reactions[removal.id - 1]?.content ?? 'unplaced')

describe('reactions — the acknowledgement does not outlive the run', () => {
  test('👀 comes back off the comment when the run ends', async () => {
    // The bug this is for: 👀 says "this arrived and something is running", and
    // a run is one CI job, so a job that ends without clearing it leaves that
    // claim on a comment nobody will touch again. Every issue the agent had
    // ever finished still read as one it was thinking about.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.reactionRemovals).toEqual([{ target: { kind: 'comment', id: COMMENT_ID }, id: 1 }])
    expect(removedContentsOf(harness)).toEqual(['eyes'])
  })

  test('the removal names the reaction that was placed, not a fresh lookup', async () => {
    // GitHub has no "remove my 👀 from this" call — a delete is addressed by
    // reaction id and nothing else — so the id has to survive from the top of
    // the run to the bottom. Asserting the id is what proves it was carried
    // rather than re-derived, which is how a run deletes somebody else's mark.
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(harness.io.reactions[0]).toEqual({ target: { kind: 'issue', number: ISSUE }, content: 'eyes' })
    expect(harness.io.reactionRemovals).toEqual([{ target: { kind: 'issue', number: ISSUE }, id: 1 }])
  })

  test('👍 replaces it when the run hands the issue back', async () => {
    // The commonest ending by far: the agent posts an artefact and stops. There
    // is nothing to celebrate and nothing went wrong — the comment was acted on
    // and it is the maintainer's turn.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(reactionsOf(harness)).toEqual(['eyes', '+1'])
    expect(removedContentsOf(harness)).toEqual(['eyes'])
  })

  test('😕 replaces it when the run breaks', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = ['not json at all']

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(reactionsOf(harness)).toEqual(['eyes', 'confused'])
    expect(removedContentsOf(harness)).toEqual(['eyes'])
  })

  test('the outcome goes on before the 👀 comes off', async () => {
    // Both writes are best-effort, so the order decides which way the failure
    // modes fall. Removing first would leave the comment bare for the width of
    // an API call — and, if the add then failed, bare for good, which is worse
    // than the 👀 this exists to clear.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.reactionLog).toEqual(['add:eyes', 'add:+1', 'remove'])
  })

  test('a delivery keeps its 🚀 and is not marked a second time', async () => {
    // 🚀 is the one mark in this pipeline that means a pull request came out of
    // the work, and `handleDeliver` is the only place that knows the difference
    // between a delivery and a stand-down. A run-level 👍 beside it would be a
    // second reaction saying less.
    const harness = makeHarness()

    const result = await driveDelivery(harness)

    expect(result.status).toBe('completed')
    expect(reactionsOf(harness)).toEqual(['eyes', 'rocket'])
    expect(removedContentsOf(harness)).toEqual(['eyes'])
  })

  test('a cancelled run is left with nothing rather than a 🚀', async () => {
    // `/cancel` reaches the same COMPLETE a delivery does, so a table keyed on
    // the run status alone would celebrate it. Nothing was delivered; the
    // comment saying so is the account, and the reaction is not.
    const harness = makeHarness()
    await toDesignSpec(harness)

    const result = await runPipeline({ event: comment('/cancel'), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(reactionsOf(harness)).toEqual(['eyes'])
    expect(removedContentsOf(harness)).toEqual(['eyes'])
  })

  test('a refused command keeps its 😕 and loses the 👀', async () => {
    // The skip that is a *reply* to somebody: `triggers.ts` has already said
    // 😕, so the run-level table stays out of its way — but the 👀 is this
    // run's and comes off like any other.
    const harness = makeHarness()
    await toComplete(harness)

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(reactionsOf(harness)).toEqual(['eyes', 'confused'])
    expect(removedContentsOf(harness)).toEqual(['eyes'])
  })

  test('a run whose reactions are all refused ends exactly as it would have', async () => {
    // The rule the whole channel rests on, now with a second write behind it:
    // a token without `issues: write` must change nothing about the run, and a
    // removal that rejects is not evidence of anything the pipeline can act on.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]
    harness.io.reactionError = new Error('Resource not accessible by integration')

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('waiting')
    expect(latestPostedState(harness)?.phase).toBe('PLAN_REVIEW')
    // Asked, refused, and never retried as a delete against an id it never got.
    expect(reactionsOf(harness)).toEqual(['eyes', '+1'])
    expect(harness.io.reactionRemovals).toEqual([])
  })

  test('a CI run has nothing to acknowledge and nothing to clear', async () => {
    const harness = makeHarness()
    await driveDelivery(harness)
    harness.io.reactions.length = 0
    harness.io.reactionRemovals.length = 0
    harness.io.reactionLog.length = 0
    harness.io.reactionLog.length = 0

    await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(harness.io.reactions).toEqual([])
    expect(harness.io.reactionRemovals).toEqual([])
  })
})

describe('reactions — the silences that stay silent', () => {
  const onPullRequest = issueEvent({
    eventName: 'issue_comment',
    action: 'created',
    commentBody: '/approve',
    commentId: COMMENT_ID,
    isPullRequest: true,
  })

  test.each([
    ['a bot sender', issueEvent({ senderType: 'Bot' })],
    ['the agent talking to itself', issueEvent({ senderLogin: AGENT_LOGIN })],
    ['a comment on a pull request', onPullRequest],
    ['an event this pipeline does not handle', issueEvent({ eventName: 'push' })],
    ['an action this pipeline does not handle', issueEvent({ action: 'edited' })],
  ])('says nothing to %s', async (_label, event) => {
    // Machine noise with nobody waiting on it. The existing log line is the
    // right amount of record, and a reaction is a write to somebody else's
    // timeline for no reader's benefit.
    const harness = makeHarness()

    const result = await runPipeline({ event, deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.reactions).toEqual([])
  })

  test('a whole CI-fix run reacts to nothing', async () => {
    // A `workflow_run` payload names no comment and nobody typed it, so there
    // is no timeline a reaction would reach and no person it would reach.
    const harness = makeHarness()
    await driveDelivery(harness)
    harness.io.reactions.length = 0
    harness.io.reactionRemovals.length = 0
    harness.io.reactionLog.length = 0
    harness.io.reactionLog.length = 0
    harness.io.reactionRemovals.length = 0
    harness.io.reactionLog.length = 0

    const result = await runPipeline({ event: ciEvent(), deps: harness.deps })

    expect(result.status).toBe('completed')
    expect(harness.io.reactions).toEqual([])
  })
})

describe('reactions — breaking the remaining silences', () => {
  test('😕 to a sender without maintainer rights', async () => {
    // A write triggered by an account without write access, and the judgement
    // call is deliberate: one reaction, no content, no notification storm —
    // against an outsider's comment vanishing into a log they cannot read.
    const harness = makeHarness()
    const outsider = issueEvent({
      eventName: 'issue_comment',
      action: 'created',
      commentBody: 'please fix this',
      commentId: 901,
      authorAssociation: 'CONTRIBUTOR',
    })

    const result = await runPipeline({ event: outsider, deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.reactions).toEqual([{ target: { kind: 'comment', id: 901 }, content: 'confused' }])
    // A reaction is not a report: the issue still carries nothing about this
    // run, so the workflow's fallback comment must stay in scope for it.
    expect(result.reported).toBe(false)
    expect(harness.io.posted).toEqual([])
  })

  test('😕 to a command the current phase cannot take', async () => {
    // Both `refuseCommand` call sites — an unknown command and one the phase
    // refuses — react through the same function, so this covers the pair.
    const harness = makeHarness()
    await toComplete(harness)

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(reactionsOf(harness)).toEqual(['eyes', 'confused'])
    // The comment is still the better answer; the reaction only beats it there.
    expect(harness.io.posted[0]).toContain('does not apply right now')
  })

  test('👍 to a plain comment on a phase that is not waiting for one', async () => {
    const harness = makeHarness()
    await toComplete(harness)

    const result = await runPipeline({ event: comment('ok, can we revisit this?'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(reactionsOf(harness)).toEqual(['eyes', '+1'])
    // 👍 rather than a comment: "I have decided to do nothing", said out loud to
    // every aside, is the noise this channel exists to avoid.
    expect(harness.io.posted).toEqual([])
  })

  test('👍 to a comment the classifier read as chatter', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    const result = await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(reactionsOf(harness)).toEqual(['eyes', '+1'])
    expect(harness.io.posted).toEqual([])
  })

  test('👍 to chatter while the agent is waiting on its own clarifying questions', async () => {
    // The third instance of one silence, and the one most likely to be reached:
    // `INIT_OR_CLARIFY` is where the agent parks waiting for a maintainer to
    // answer, so it is where a maintainer is most likely to be typing. Reacting
    // on two of the three call sites would be this workspace's recurring defect
    // exactly — the fix that closes the instance and leaves the class open.
    const harness = makeHarness()
    harness.io.replies = [JSON.stringify({ status: 'clarify', questions: ['Which client?'] })]
    await runPipeline({ event: issueEvent(), deps: harness.deps })

    const parked = latestPostedState(harness)
    expect(parked?.phase).toBe('INIT_OR_CLARIFY')
    harness.io.posted.length = 0
    harness.io.reactions.length = 0
    harness.io.reactionRemovals.length = 0
    harness.io.reactionLog.length = 0
    harness.io.reactionLog.length = 0
    harness.io.reactionRemovals.length = 0
    harness.io.reactionLog.length = 0

    harness.io.replies = [JSON.stringify({ intent: 'none' })]
    const result = await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(reactionsOf(harness)).toEqual(['eyes', '+1'])
    expect(harness.io.posted).toEqual([])
    // The persisted state, not just the status. Nothing was posted, so the block
    // the next job restores from must still be the one the clarification left —
    // read back the way that job would read it, off the thread.
    expect(findLatestState(harness.io.thread, AGENT_LOGIN, ISSUE)).toEqual(parked)
    expect(result.reported).toBe(false)
  })

  test('👍 to an empty comment', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)

    const result = await runPipeline({ event: comment('   '), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(reactionsOf(harness)).toEqual(['eyes', '+1'])
  })
})

describe('reactions — feedback never fails a run', () => {
  test('a GitHub that refuses every reaction changes nothing about the run', async () => {
    // The most important property in this stage. A token without
    // `issues: write`, a fork run and an org policy all present exactly this,
    // and every one of them is real — so the run has to reach the same result,
    // and leave the same block on the issue, as one where the channel worked.
    const healthy = makeHarness()
    const broken = makeHarness()
    broken.io.reactionError = new Error('Resource not accessible by integration')

    const expected = await driveDelivery(healthy)
    const actual = await driveDelivery(broken)

    expect(actual).toEqual(expected)
    // The persisted state, not just the returned status: a state that is never
    // posted never happened, and that is the half a status cannot show.
    expect(latestPostedState(broken)).toEqual(latestPostedState(healthy))
    expect(broken.io.posted).toEqual(healthy.io.posted)
    // And it really did try, rather than passing by never asking.
    expect(reactionsOf(broken)).toEqual(['eyes', 'rocket'])
  })

  test('a refused reaction leaves a guardrail denial exactly as it was', async () => {
    const harness = makeHarness()
    harness.io.reactionError = new Error('403 Resource not accessible by integration')

    const result = await runPipeline({ event: issueEvent({ authorAssociation: 'CONTRIBUTOR' }), deps: harness.deps })

    expect(result).toEqual({
      status: 'skipped',
      reason: 'Author association CONTRIBUTOR lacks maintainer rights',
      state: null,
      reported: false,
    })
  })

  test('a refused reaction still lets a refused command answer on the issue', async () => {
    const harness = makeHarness()
    await toComplete(harness)
    harness.io.reactionError = new Error('403')

    const result = await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reported).toBe(true)
    expect(harness.io.posted[0]).toContain('does not apply right now')
  })
})

describe('the run link', () => {
  const RUN_URL = 'https://github.test/acme/widgets/actions/runs/1482/attempts/2'

  test('the failure comment says which job failed', async () => {
    // `/retry` used to be the only lead a maintainer had from this comment. The
    // job that produced the error above carries the rest of the story.
    const harness = makeHarness({ runUrl: RUN_URL })
    harness.io.replies = ['not json at all']

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(reportsOf(harness)[0]).toContain(`The job that failed: ${RUN_URL}`)
  })

  test('a local run says nothing rather than linking nowhere', async () => {
    // Driving this CLI from an `--event-path` file is an ordinary thing to do,
    // and an empty label is worse than a missing line.
    const harness = makeHarness()
    harness.io.replies = ['not json at all']

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(harness.io.posted[0]).not.toContain('The job that failed')
    expect(harness.io.posted[0]).toContain('### ❌ Run failed in')
  })

  test('the CI-fix comment tells the red run from the run repairing it', async () => {
    // Both were "run" in this comment, and only the red one was ever printed.
    const harness = makeHarness({ runUrl: RUN_URL })
    await driveDelivery(harness)
    harness.io.posted.length = 0
    const red = 'https://github.test/acme/widgets/actions/runs/77'

    await runPipeline({ event: ciEvent({ runUrl: red }), deps: harness.deps })

    const report = String(reportsOf(harness)[0])
    expect(report).toContain(`- Red run I am repairing: ${red}`)
    expect(report).toContain(`- This repair ran in: ${RUN_URL}`)
  })
})

describe('labels — the state at a glance', () => {
  test('a run marks the issue as worked on, then hands it back', async () => {
    // The two orthogonal markers, over one run: `agent:working` goes on when
    // work starts and comes off when it ends, and `agent:needs-you` takes its
    // place because the plan is now parked in front of a human.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.labels.sort()).toEqual(['agent:needs-you', 'agent:plan-review'])
    expect(harness.io.labelWrites).toContain('+agent:planning,agent:working')
    expect(harness.io.labelWrites).toContain('-agent:working')
  })

  test('the two markers never sit on the issue together', async () => {
    // A run in flight is not waiting on anybody, and an issue that is both
    // "happening now" and "blocked on me" answers neither question.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    expect(harness.io.labels).not.toContain('agent:working')
  })

  test('a delivered issue is labelled done, a cancelled one stopped', async () => {
    const delivered = makeHarness()
    await driveDelivery(delivered)

    const cancelled = makeHarness()
    await toComplete(cancelled)

    expect(delivered.io.labels).toEqual(['agent:done'])
    expect(cancelled.io.labels).toEqual(['agent:stopped'])
  })

  test('a failure asks for a human', async () => {
    const harness = makeHarness()
    harness.io.replies = ['not json at all']

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(harness.io.labels.sort()).toEqual(['agent:failed', 'agent:needs-you'])
  })

  test('a labelled issue whose state has not moved is written to not at all', async () => {
    // The diff, from the pipeline's side. Most runs move nothing, and a
    // clear-and-reapply would leave two timeline entries on every one of them.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.labelWrites.length = 0
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(harness.io.labelWrites).toEqual([])
    expect(harness.io.labels.sort()).toEqual(['agent:needs-you', 'agent:spec-review'])
  })

  test('a state move with no handler behind it is not "working" either', async () => {
    // `/cancel` moves the state and runs nothing. Marking it working would add
    // the marker and take it off in the same second — the same two timeline
    // entries a skipped run avoids, on a run that did move the issue.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.labelWrites.length = 0

    await runPipeline({ event: comment('/cancel'), deps: harness.deps })

    // Nothing mentions the marker in either direction: it was never put on, so
    // there is nothing to take off.
    expect(harness.io.labelWrites.filter((write) => write.includes('agent:working'))).toEqual([])
    expect(harness.io.labels).toEqual(['agent:stopped'])
  })

  test('answering a question is work, even though it moves nothing', async () => {
    // The other half of "will anything run": `/ask` leaves the phase exactly
    // where it was, so the handler table says nothing about it — but it is a
    // model turn, often the slowest thing the pipeline does, and an issue that
    // shows no sign of it is the silence this whole plan is about.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.labelWrites.length = 0
    harness.io.replies = ['Because the retry helper already exists there.']

    await runPipeline({ event: comment('/ask why that file?'), deps: harness.deps })

    expect(harness.io.labelWrites).toContain('+agent:working')
    expect(harness.io.labels.sort()).toEqual(['agent:needs-you', 'agent:spec-review'])
  })

  test('a skipped run does not flash the working marker on and off', async () => {
    // Marking a run that is about to skip would add the marker and remove it
    // within the second — two timeline entries for an issue where nothing
    // happened, which is the noise this channel is sized to avoid.
    const harness = makeHarness()
    await toComplete(harness)
    harness.io.labelWrites.length = 0

    await runPipeline({ event: comment('any plans to revisit?'), deps: harness.deps })

    expect(harness.io.labelWrites).toEqual([])
  })

  test('a marker stranded by a killed runner is repaired on the next event', async () => {
    // The failure mode `agent:working` has: a runner killed mid-flight leaves
    // it on. The reconcile computes the desired set from the restored state,
    // so any `agent:*` label that state does not imply comes off — no
    // bookkeeping, and it repairs a hand-edited issue by the same rule.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.labels.push('agent:working', 'agent:implementing')
    harness.io.labelWrites.length = 0
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(harness.io.labelWrites.sort()).toEqual(['-agent:implementing', '-agent:working'])
    expect(harness.io.labels.sort()).toEqual(['agent:needs-you', 'agent:spec-review'])
  })

  test('the repository’s own labels are never touched', async () => {
    // The worst thing this channel could do, and the one that would be found
    // by somebody else losing their triage.
    const harness = makeHarness()
    harness.io.labels.push('bug', 'good first issue')
    harness.io.replies = [SPEC_REPLY]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(harness.io.labels).toContain('bug')
    expect(harness.io.labels).toContain('good first issue')
    expect(harness.io.labelWrites).not.toContain('-bug')
    expect(harness.io.labelWrites).not.toContain('-good first issue')
  })

  test('labels are created with the palette before they are applied', async () => {
    const harness = makeHarness()
    harness.io.replies = [SPEC_REPLY]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(harness.io.labelsCreated).toContainEqual({ name: 'agent:spec-review', color: 'd4a72c' })
    expect(harness.io.labelsCreated).toContainEqual({ name: 'agent:needs-you', color: 'd4a72c' })
  })

  test('a custom prefix reaches every label the run writes', async () => {
    const harness = makeHarness({ labelPrefix: 'bot/' })
    harness.io.replies = [SPEC_REPLY]

    await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(harness.io.labels.sort()).toEqual(['bot/needs-you', 'bot/spec-review'])
  })

  test('`none` runs the whole pipeline without one label call', async () => {
    // A repository that wants none of this must get none of it — not a
    // different set of names.
    const harness = makeHarness({ labelPrefix: null })
    harness.io.labels.push('agent:working')

    const result = await driveDelivery(harness)

    expect(result.status).toBe('completed')
    expect(harness.io.labelWrites).toEqual([])
    expect(harness.io.labels).toEqual(['agent:working'])
  })
})

describe('labels — feedback never fails a run', () => {
  test('a GitHub that refuses every label call changes nothing about the run', async () => {
    // The rule-1 test for this stage. A token without `issues: write`, a
    // repository that restricts label creation, and a fork run all present
    // exactly this, and none of them may change what the run concludes or what
    // it leaves on the issue.
    const healthy = makeHarness()
    const broken = makeHarness()
    broken.io.labelError = new Error('Resource not accessible by integration')

    const expected = await driveDelivery(healthy)
    const actual = await driveDelivery(broken)

    expect(actual).toEqual(expected)
    // The persisted state, not just the returned status: a state that is never
    // posted never happened, and that is the half a status cannot show.
    expect(findLatestState(broken.io.thread, AGENT_LOGIN, ISSUE)).toEqual(
      findLatestState(healthy.io.thread, AGENT_LOGIN, ISSUE),
    )
    expect(broken.io.posted).toEqual(healthy.io.posted)
    // And it really did try, rather than passing by never asking. A 403 on this
    // token refuses the read as well, which is why the ask is counted rather
    // than looked for among the writes.
    expect(broken.io.labelReads).toBeGreaterThan(0)
    expect(broken.io.labelWrites).toEqual([])
  })

  test('a refused label still lets a failure report itself', async () => {
    // The path where feedback failing on top of a failure would be worst: the
    // comment explaining what broke is the only thing the maintainer gets.
    const harness = makeHarness()
    harness.io.labelError = new Error('403')
    harness.io.replies = ['not json at all']

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reported).toBe(true)
    expect(harness.io.posted[0]).toContain('### ❌ Run failed in')
  })

  test('a label is not a report, so it never suppresses the fallback comment', async () => {
    // `RunResult.reported` gates the workflow's "Agent job did not finish"
    // comment. A
    // run that only ever labelled has said nothing on the issue.
    const harness = makeHarness()
    await toComplete(harness)

    const result = await runPipeline({ event: comment('any plans to revisit?'), deps: harness.deps })

    expect(result.reported).toBe(false)
  })
})

/** A harness whose run has a job to link to, so the status channel is live. */
const JOB_URL = 'https://github.test/acme/widgets/actions/runs/1482'

const withStatus = (overrides: Partial<PipelineConfig> = {}): Harness => makeHarness({ runUrl: JOB_URL, ...overrides })

/** Bodies the run created that carry no state block — the status comment, and nothing else. */
const statusPosts = (harness: Harness): string[] => harness.io.posted.filter((body) => !body.includes(STATE_MARKER))

describe('the live status comment', () => {
  test('one comment per run, opened when the work starts and edited as it moves', async () => {
    // The whole comment budget this plan allows itself. A run that added a
    // comment per phase would be the noise the budget exists to prevent.
    const harness = withStatus()

    await driveDelivery(harness)

    expect(statusPosts(harness)).toHaveLength(1)
    expect(harness.io.edits.length).toBeGreaterThan(0)
    expect(new Set(harness.io.edits.map((edit) => edit.id)).size).toBe(1)
  })

  test('it says which job is doing the work, and what phase it is on', async () => {
    const harness = withStatus()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    const opened = String(statusPosts(harness)[0])
    expect(opened).toContain(`[this run](${JOB_URL})`)
    expect(opened.split('\n')[0]).toBe('### 🗺️ Breaking the spec into steps — run in progress')
  })

  test('it is finalised where the run stopped', async () => {
    const harness = withStatus()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]

    await runPipeline({ event: comment('/approve'), deps: harness.deps })

    const last = harness.io.edits.at(-1)
    expect(last?.body.split('\n')[0]).toBe('### 🧭 Plan is waiting for you')
    expect(last?.body).not.toContain('run in progress')
  })

  test('a run that does nothing opens no comment at all', async () => {
    // Same gate as the working label, for the same reason: opening a status
    // comment for a run that is about to skip spends the whole budget on
    // nothing.
    const harness = withStatus()
    await toComplete(harness)
    harness.io.edits.length = 0

    await runPipeline({ event: comment('any plans to revisit?'), deps: harness.deps })

    expect(harness.io.posted).toEqual([])
    expect(harness.io.edits).toEqual([])
  })

  test('a guardrail denial opens no comment either', async () => {
    const harness = withStatus()

    await runPipeline({ event: issueEvent({ authorAssociation: 'CONTRIBUTOR' }), deps: harness.deps })

    expect(harness.io.posted).toEqual([])
  })
})

describe('the status comment — rule 7, it is not a report', () => {
  test('a run that only ever wrote status has still said nothing about itself', async () => {
    // `RunResult.reported` means the issue carries this run's account of what
    // happened, and the workflow's fallback comment is gated on it. A status
    // comment is not an account of anything, so a run whose only writes were on
    // that channel leaves the flag exactly where a run without the channel
    // would.
    const harness = withStatus()
    await toDesignSpec(harness)
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    const result = await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(result.reported).toBe(false)
  })

  test('a run killed mid-phase leaves the status mid-flight and yields no result to mark', async () => {
    // The case rule 7 is really about. The report comment never lands, so the
    // run dies with "run in progress" on the issue and hands back no
    // `RunResult` at all — which is exactly why the flag must never be set from
    // the status comment's existence: there would be nothing left to explain
    // the silence.
    const harness = withStatus()
    await toDesignSpec(harness)
    harness.io.replies = [PLAN_REPLY]
    harness.io.postError = new Error('502 from GitHub')

    await expect(runPipeline({ event: comment('/approve'), deps: harness.deps })).rejects.toThrow('502')

    expect(harness.io.thread.at(-1)?.body).toContain('run in progress')
    // `step-output.ts` writes the marker only on a returning path, and nothing
    // returned; the state block on the issue is still the one from before.
    expect(harness.io.thread.filter((entry) => entry.body.includes(STATE_MARKER))).toHaveLength(1)
  })

  test('finalising it on a returning path does not set the flag either', async () => {
    // Two writers of one flag is how it drifts. The paths that report already
    // do; this one has nothing to add.
    const harness = withStatus()
    harness.io.replies = [JSON.stringify({ intent: 'none' })]
    seedState(harness, { phase: 'DESIGN_SPEC' })

    const result = await runPipeline({ event: comment('nice work'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(result.reported).toBe(false)
    expect(statusPosts(harness)).toEqual([])
  })
})

describe('the status comment — rule 4, the state channel is untouched', () => {
  test('state restored from a thread with status comments equals the same thread without them', async () => {
    // The invariant, stated as one. `findLatestState` restores from the newest
    // agent comment carrying a valid block, so a status comment that ever grew
    // one would become a second, competing source of truth — and it is written
    // by the channel least likely to be looked at.
    const quiet = makeHarness()
    const loud = withStatus()

    await driveDelivery(quiet)
    await driveDelivery(loud)

    expect(findLatestState(loud.io.thread, AGENT_LOGIN, ISSUE)).toEqual(
      findLatestState(quiet.io.thread, AGENT_LOGIN, ISSUE),
    )
    // And it really did interleave them, rather than passing by never writing.
    expect(loud.io.thread.length).toBeGreaterThan(quiet.io.thread.length)
    expect(statusPosts(loud)).toHaveLength(1)
    expect(statusPosts(loud)[0]).not.toContain(STATE_MARKER)
    // And the comment that really went out carries the marker the prompt layer
    // filters on — a renderer that grew one is worth nothing if the pipeline
    // posts something else.
    expect(readBlock(String(statusPosts(loud)[0]), STATUS_MARKER)).toEqual({ run: JOB_URL })
  })

  test('the comment a later job restores from is a report, never the status', async () => {
    const harness = withStatus()
    await driveDelivery(harness)

    const restored = harness.io.thread.filter((entry) => extractState(entry.body) !== null)

    expect(restored.length).toBeGreaterThan(0)
    expect(restored.every((entry) => !entry.body.includes('run in progress'))).toBe(true)
  })
})

describe('the status comment — rule 1, feedback never fails a run', () => {
  test('a GitHub that refuses every status write changes nothing about the run', async () => {
    // Measured against a run with no status channel at all, which is the exact
    // degradation the rule allows: a failed create leaves the pipeline where it
    // was before this stage, and a failed edit is a warning.
    const silent = makeHarness()
    const broken = withStatus()
    broken.io.statusError = new Error('Resource not accessible by integration')

    const expected = await driveDelivery(silent)
    const actual = await driveDelivery(broken)

    expect(actual).toEqual(expected)
    // The persisted state, not just the returned status: a state that is never
    // posted never happened, and that is the half a status cannot show.
    expect(findLatestState(broken.io.thread, AGENT_LOGIN, ISSUE)).toEqual(
      findLatestState(silent.io.thread, AGENT_LOGIN, ISSUE),
    )
    expect(broken.io.posted).toEqual(silent.io.posted)
  })

  test('a refused status write still lets a failure report itself', async () => {
    const harness = withStatus()
    harness.io.statusError = new Error('403')
    harness.io.replies = ['not json at all']

    const result = await runPipeline({ event: issueEvent(), deps: harness.deps })

    expect(result.status).toBe('failed')
    expect(result.reported).toBe(true)
    expect(reportsOf(harness)[0]).toContain('### ❌ Run failed in')
  })
})

describe('recording what a skipped classification cost', () => {
  test('a comment the classifier reads as chatter records its spend without posting', async () => {
    // The one model turn in this pipeline that posts nothing, and so the one
    // whose spend used to vanish with the runner. An issue could buy one per
    // comment for as long as anybody kept commenting.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.tokensUsed = 40_000
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    const result = await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(harness.io.posted).toEqual([])
    expect(spentIn(result)).toBe(40_000)
    expect(findLatestState(harness.io.thread, AGENT_LOGIN, ISSUE)?.tokensSpent).toBe(40_000)
  })

  test('the rewrite lands on the comment the next job will restore from', async () => {
    const harness = makeHarness()
    await toDesignSpec(harness)
    const restoredFrom = harness.io.thread.at(-1)?.id
    harness.io.tokensUsed = 12_000
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(harness.io.edits).toHaveLength(1)
    expect(harness.io.edits[0]?.id).toBe(restoredFrom)
    // The phase is untouched: this records spend, it does not move anything.
    expect(findLatestState(harness.io.thread, AGENT_LOGIN, ISSUE)?.phase).toBe('DESIGN_SPEC')
  })

  test('a skip that spent nothing writes nothing', async () => {
    // Most skips never open a session. A rewrite that only ever restated the
    // figure already on the issue would be a request per "thanks!".
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(harness.io.edits).toEqual([])
  })

  test('a refused rewrite reports the figure the issue actually carries', async () => {
    // Best-effort, like every other write this stage adds: a `RunResult`
    // claiming a total no reader will ever find would be worse than the leak.
    const harness = makeHarness()
    await toDesignSpec(harness)
    harness.io.statusError = new Error('403')
    harness.io.tokensUsed = 40_000
    harness.io.replies = [JSON.stringify({ intent: 'none' })]

    const result = await runPipeline({ event: comment('thanks!'), deps: harness.deps })

    expect(result.status).toBe('skipped')
    expect(spentIn(result)).toBe(0)
    expect(findLatestState(harness.io.thread, AGENT_LOGIN, ISSUE)?.tokensSpent).toBe(0)
  })
})
