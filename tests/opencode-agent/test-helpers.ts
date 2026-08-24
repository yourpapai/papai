// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import type { IssueComment } from '../../opencode-agent/src/blocks.js'
import type { CheckRunner, CheckSpec } from '../../opencode-agent/src/check-loop.js'
import type { CiGroups } from '../../opencode-agent/src/ci-groups.js'
import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { CommitOutcome } from '../../opencode-agent/src/git-commit.js'
import type { Salvage } from '../../opencode-agent/src/git-commit.js'
import type { Git, PushOptions } from '../../opencode-agent/src/git.js'
import type { MergeOutcome } from '../../opencode-agent/src/git.js'
import type { RefCheckRun, RunJob } from '../../opencode-agent/src/github-actions.js'
import type { LabelApi } from '../../opencode-agent/src/github-labels.js'
import type {
  PullRequestApi,
  PullRequestHead,
  PullRequestInput,
  PullRequestPresentation,
  PullRequestRef,
  PullRequestStatus,
} from '../../opencode-agent/src/github-pulls.js'
import type {
  ReactionApi,
  ReactionContent,
  ReactionRef,
  ReactionTarget,
} from '../../opencode-agent/src/github-reactions.js'
import type { GitHubApi, OctokitLog, PostedComment } from '../../opencode-agent/src/github.js'
import type { Logger } from '../../opencode-agent/src/logger.js'
import type { SkillDocument } from '../../opencode-agent/src/obra-skills.js'
import type { OpenCodeAgent, AgentPromptRequest } from '../../opencode-agent/src/opencode-adapter.js'
import type {
  InstructionsResult,
  OpenSpecDriver,
  StatusResult,
  ValidateResult,
} from '../../opencode-agent/src/openspec-driver.js'
import type { IssueContext } from '../../opencode-agent/src/phase-context.js'
import type { PhaseDeps, RunReview } from '../../opencode-agent/src/phase-context.js'
import type { ReplyBuffer } from '../../opencode-agent/src/reply-buffer.js'
import { noopReplyBuffer } from '../../opencode-agent/src/reply-buffer.js'
import type { ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'
import type { ModelsDevDb } from '../../sdd-runner/src/pricing.js'

/**
 * An Octokit logger that discards every level.
 *
 * `@octokit/plugin-request-log` narrates every request, and a rejected one
 * lands on `error`, which Octokit defaults to `console.error` — past the
 * console suppression in `tests/setup.ts`, which deliberately leaves that
 * channel alone. A suite that drives a refusal on purpose passes this so its
 * expected 403 does not read as a real diagnostic in the test log.
 */
export const silentOctokitLog = (): OctokitLog => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})

/** A silent pino-shaped logger for focused phase tests. */
export const silentLogger = (): Logger => ({
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
})

/**
 * A complete `PipelineConfig` literal — the same shape the orchestrator harness
 * builds, centralised here so the focused phase/trigger tests do without `as`
 * casts (the workspace lints forbid narrowing assertions).
 */
export const stubConfig = (repoRoot = '/repo'): PipelineConfig => ({
  repoRoot,
  owner: 'acme',
  repo: 'widgets',
  githubToken: 'token',
  selfLoginOverride: 'agent-bot',
  selfWorkflowName: 'OpenCode Issue Agent',
  openai: { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', provider: 'openai' },
  commitAuthorName: 'agent',
  commitAuthorEmail: 'agent@example.com',
  checkCommand: 'bun test',
  reviewCommand: ['bun', 'run', 'review-loop/src/cli.ts'],
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
  maxCiAttempts: 2,
  maxAttempts: 3,
  maxReviewAttempts: 2,
  reviewHintLines: 200,
  maxTokens: 5_000_000,
  diffLimits: { maxFiles: 100, maxLines: 20_000 },
  gitRemoteBase: 'https://github.com/',
  runUrl: null,
  labelPrefix: 'agent:',
  logKey: null,
  skillRoots: ['.opencode/skills', '.agents/skills', '.superpowers/skills', '.claude/skills'],
})

/** Recorded calls into a {@link stubPhaseDeps} fake, for assertions. */
export interface StubIo {
  /** OpenSpec CLI driver calls, in order (`method:arg`). */
  openspecCalls: string[]
  /** Agent prompts, in order — the prompts the model was asked. */
  prompts: AgentPromptRequest[]
  /** Reactions placed via the GitHub reaction channel. */
  reactions: { target: ReactionTarget; content: ReactionContent }[]
  /** Issue comments posted via `createComment`. */
  posted: string[]
  /** Comment edits via `updateComment`. */
  edits: { id: number; body: string }[]
  /** The thread the fake GitHub API surfaces to the next read. */
  thread: IssueComment[]
  /** Git operations invoked, in order (`op:arg`). */
  gitCalls: string[]
  /** Pull-request bodies written via `updatePullRequest`, in order. */
  pullRequestUpdates: PullRequestPresentation[]
  /** Artifact writes via `writeFile` (`path::content-preview`). */
  writes: { path: string; content: string }[]
  /** File reads via `readFile`, in order. Tests seed `readContents` to reply. */
  reads: string[]
  /**
   * Content the fake `readFile` returns, keyed by path; absent paths return ''.
   * Set by a test before driving a handler that reads (e.g. tasks.md).
   */
  readContents: Record<string, string>
  /**
   * Change names the fake `listChangeNames` reports — the base branch's
   * `openspec/changes/`. A test seeds it to drive capture down the adopt path.
   */
  existingChanges: string[]
  /**
   * Jobs the fake `listRunJobs` answers with. A test seeds them to drive a
   * CI-fix round at a particular red run; the default empty list is the
   * needs-human "no failed job could be found" shape.
   */
  runJobs: RunJob[]
  /** Log text the fake `jobLog` returns, keyed by job id; absent ids answer ''. */
  jobLogs: Record<number, string>
  /**
   * Check runs the fake `listCheckRunsForRef` answers with, and the refs it was
   * asked for, in order — a command-bought CI-fix round reads these.
   */
  refCheckRuns: RefCheckRun[]
  refReads: string[]
  /** Rows written to the fake encrypted transcript, in order. */
  transcriptRows: TranscriptRow[]
}

export interface StubPhaseDepsOptions {
  /** Model JSON replies, consumed in order by successive prompts. */
  replies?: string[]
  /** Skills returned by `deps.skills` (default: none). */
  skills?: readonly SkillDocument[]
  /** Override the OpenSpec driver (default: a recording no-op fake). */
  openspec?: OpenSpecDriver
  /** Override the agent (default: a reply-consuming fake). */
  agent?: OpenCodeAgent
  /** Pre-existing issue thread the fake `listIssueComments` returns. */
  thread?: readonly IssueComment[]
  /** Self login the fake reports (default `agent-bot`). */
  selfLogin?: string
  /** The repoRoot the fake config reports. */
  repoRoot?: string
  /** Pre-seeded `listRunJobs` answer (default: no jobs). */
  runJobs?: readonly RunJob[]
  /** Pre-seeded `jobLog` answers, keyed by job id. */
  jobLogs?: Record<number, string>
}

const emptyInstructions = (): InstructionsResult => ({
  instruction: '',
  template: undefined,
  rules: [],
  resolvedOutputPath: '/repo/x.md',
  changeDir: undefined,
  existingOutputPaths: [],
  dependencies: [],
})

/**
 * A complete, fully-typed {@link PhaseDeps} fake for the focused phase and
 * trigger tests (per the slice plan: drive handlers through `PhaseDeps`
 * directly, without spinning the orchestrator harness).
 *
 * Every external boundary is a working no-op that records into {@link StubIo};
 * the unused ones return safe defaults so an accidental call does not crash.
 * Fields a test wants to customise — `agent`, `openspec`, `skills` — come in
 * via {@link StubPhaseDepsOptions}. The agent fake consumes `options.replies`
 * in order, so a test sets up model output the way the orchestrator harness
 * does, just smaller.
 */
export const stubPhaseDeps = (options: StubPhaseDepsOptions = {}): { deps: PhaseDeps; io: StubIo } => {
  const io: StubIo = {
    openspecCalls: [],
    prompts: [],
    reactions: [],
    posted: [],
    edits: [],
    thread: [...(options.thread ?? [])],
    gitCalls: [],
    pullRequestUpdates: [],
    writes: [],
    reads: [],
    readContents: {},
    existingChanges: [],
    runJobs: [...(options.runJobs ?? [])],
    jobLogs: { ...(options.jobLogs ?? {}) },
    refCheckRuns: [],
    refReads: [],
    transcriptRows: [],
  }
  const replies = options.replies ?? []
  const login = options.selfLogin ?? 'agent-bot'

  const defaultAgent: OpenCodeAgent = {
    sessionId: 's',
    prompt: (request: AgentPromptRequest): Promise<{ text: string; sessionId: string }> => {
      io.prompts.push(request)
      return Promise.resolve({ text: replies.shift() ?? '', sessionId: 's' })
    },
    tokensUsed: (): Promise<number> => Promise.resolve(0),
    abort: (): Promise<boolean> => Promise.resolve(true),
    close: (): Promise<void> => Promise.resolve(),
  }
  const agent: OpenCodeAgent = options.agent ?? defaultAgent

  const defaultOpenspec: OpenSpecDriver = {
    listChangeNames: (): Promise<readonly string[]> => {
      io.openspecCalls.push('listChangeNames')
      return Promise.resolve([...io.existingChanges])
    },
    newChange: (
      changeName: string,
      schema: string,
      newChangeOptions?: { skipSpecs?: boolean },
    ): Promise<{ changeName: string }> => {
      io.openspecCalls.push(
        `newChange:${changeName}:${schema}${newChangeOptions?.skipSpecs === true ? ':skip-specs' : ''}`,
      )
      return Promise.resolve({ changeName })
    },
    status: (changeName: string): Promise<StatusResult> => {
      io.openspecCalls.push(`status:${changeName}`)
      return Promise.resolve({ schemaName: 'spec-driven', artifacts: {}, isPlanningComplete: false })
    },
    instructions: (artifactId: string, changeName: string): Promise<InstructionsResult> => {
      io.openspecCalls.push(`instructions:${artifactId}:${changeName}`)
      return Promise.resolve(emptyInstructions())
    },
    validateStrict: (changeName: string): Promise<ValidateResult> => {
      io.openspecCalls.push(`validate:${changeName}`)
      return Promise.resolve({ ok: true, output: '' })
    },
    archive: (changeName: string): Promise<void> => {
      io.openspecCalls.push(`archive:${changeName}`)
      return Promise.resolve()
    },
  }
  const openspec: OpenSpecDriver = options.openspec ?? defaultOpenspec

  const reactionApi: ReactionApi = {
    addReaction: (target: ReactionTarget, content: ReactionContent): Promise<ReactionRef> => {
      io.reactions.push({ target, content })
      return Promise.resolve({ id: io.reactions.length })
    },
    removeReaction: (_target: ReactionTarget, _reaction: ReactionRef): Promise<void> => Promise.resolve(),
  }

  const labelApi: LabelApi = {
    listLabels: (_issueNumber: number): Promise<string[]> => Promise.resolve([]),
    addLabels: (_issueNumber: number, _names: readonly string[]): Promise<void> => Promise.resolve(),
    removeLabel: (_issueNumber: number, _name: string): Promise<void> => Promise.resolve(),
    createLabel: (_name: string, _color: string): Promise<void> => Promise.resolve(),
  }

  const pullRequestApi: PullRequestApi = {
    findPullRequest: (_head: string): Promise<PullRequestStatus | null> => Promise.resolve(null),
    getPullRequestHead: (_prNumber: number): Promise<PullRequestHead> =>
      Promise.resolve({ ref: '', repoFullName: '', state: 'open' }),
    createPullRequest: (_input: PullRequestInput): Promise<PullRequestRef> =>
      Promise.resolve({ number: 7, url: 'https://example.test/pull/7' }),
    updatePullRequest: (_number: number, patch: PullRequestPresentation): Promise<void> => {
      io.pullRequestUpdates.push(patch)
      return Promise.resolve()
    },
  }

  const github: GitHubApi = {
    listIssueComments: (_issueNumber: number): Promise<IssueComment[]> => Promise.resolve([...io.thread]),
    createComment: (_issueNumber: number, body: string): Promise<PostedComment> => {
      io.posted.push(body)
      const id = io.thread.length + io.posted.length + 100
      io.thread.push({ id, body, authorLogin: login })
      return Promise.resolve({ id, url: `https://example.test/c/${id}`, authorLogin: login })
    },
    updateComment: (commentId: number, body: string): Promise<void> => {
      io.edits.push({ id: commentId, body })
      return Promise.resolve()
    },
    getIssue: (issueNumber: number): Promise<IssueContext> =>
      Promise.resolve({ number: issueNumber, title: '', body: '' }),
    getAuthenticatedLogin: (): Promise<string> => Promise.resolve(login),
    getUser: (loginArg: string): Promise<{ login: string; id: number }> =>
      Promise.resolve({ login: loginArg, id: 123 }),
    listRunJobs: (_runId: number): Promise<readonly RunJob[]> => Promise.resolve([...io.runJobs]),
    jobLog: (jobId: number): Promise<string> => Promise.resolve(io.jobLogs[jobId] ?? ''),
    listCheckRunsForRef: (ref: string): Promise<readonly RefCheckRun[]> => {
      io.refReads.push(ref)
      return Promise.resolve([...io.refCheckRuns])
    },
    ...reactionApi,
    ...labelApi,
    ...pullRequestApi,
  }

  const git: Git = {
    ensureBranch: (branch: string, base: string): Promise<void> => {
      io.gitCalls.push(`ensureBranch:${branch}:${base}`)
      return Promise.resolve()
    },
    resetBranchToBase: (branch: string, base: string): Promise<void> => {
      io.gitCalls.push(`resetBranchToBase:${branch}:${base}`)
      return Promise.resolve()
    },
    deleteRemoteBranch: (branch: string): Promise<void> => {
      io.gitCalls.push(`deleteRemoteBranch:${branch}`)
      return Promise.resolve()
    },
    commitAll: (message: string): Promise<CommitOutcome> => {
      io.gitCalls.push(`commit:${message.split('\n')[0]}`)
      return Promise.resolve({ kind: 'committed', totals: { files: 1, lines: 1 }, dropped: [] })
    },
    salvageAll: (message: string): Promise<Salvage> => {
      io.gitCalls.push(`salvage:${message.split('\n')[0]}`)
      return Promise.resolve({ kind: 'clean' })
    },
    reconcile: (branch: string): Promise<void> => {
      io.gitCalls.push(`reconcile:${branch}`)
      return Promise.resolve()
    },
    push: (branch: string, _options?: PushOptions): Promise<void> => {
      io.gitCalls.push(`push:${branch}`)
      return Promise.resolve()
    },
    defaultBranch: (): Promise<string | null> => Promise.resolve('main'),
    changedSince: (sha: string): Promise<string[]> => {
      io.gitCalls.push(`changedSince:${sha}`)
      return Promise.resolve([])
    },
    revertPaths: (sha: string, paths: readonly string[]): Promise<void> => {
      io.gitCalls.push(`revertPaths:${sha}:${paths.join(',')}`)
      return Promise.resolve()
    },
    mergeBase: (base: string): Promise<MergeOutcome> => {
      io.gitCalls.push(`mergeBase:${base}`)
      return Promise.resolve({ kind: 'up-to-date' })
    },
    completeMerge: (message: string): Promise<void> => {
      io.gitCalls.push(`completeMerge:${message.split('\n')[0]}`)
      return Promise.resolve()
    },
    abortMerge: (): Promise<void> => {
      io.gitCalls.push('abortMerge')
      return Promise.resolve()
    },
    headSha: (): Promise<string> => {
      io.gitCalls.push('headSha')
      return Promise.resolve('head-sha')
    },
  }

  const runCheck: CheckRunner = (_check: CheckSpec): Promise<CommandResult> =>
    Promise.resolve({ command: '', stdout: '', stderr: '', exitCode: 0 })

  const runReview: RunReview = (_plan: string): Promise<ReviewRunResult> =>
    Promise.resolve({ outcome: 'passed', summary: '', exitCode: 0, failure: null })

  const groups: CiGroups = {
    startGroup: (_headline: string): void => {},
    endGroup: (): void => {},
  }

  const reply: ReplyBuffer = noopReplyBuffer()

  const deps: PhaseDeps = {
    github,
    transcript: {
      write: (row): void => {
        io.transcriptRows.push(row)
      },
    },
    git,
    runCheck,
    runReview,
    agent: (): Promise<OpenCodeAgent> => Promise.resolve(agent),
    tokensUsed: (): Promise<number> => Promise.resolve(0),
    skills: (): Promise<SkillDocument[]> => Promise.resolve([...(options.skills ?? [])]),
    writeFile: (filePath: string, content: string): Promise<void> => {
      io.writes.push({ path: filePath, content })
      io.readContents[filePath] = content
      return Promise.resolve()
    },
    readFile: (filePath: string): Promise<string> => {
      io.reads.push(filePath)
      return Promise.resolve(io.readContents[filePath] ?? '')
    },
    openspec,
    baseBranch: (): Promise<string> => Promise.resolve('main'),
    selfLogin: (): Promise<string> => Promise.resolve(login),
    reply,
    now: (): number => 0,
    groups,
    config: stubConfig(options.repoRoot),
    log: silentLogger(),
  }

  return { deps, io }
}

/**
 * A model catalogue with nothing in it, injected wherever a test drives `runCli`.
 *
 * The boot path reads models.dev to learn its model's context window, and
 * `tests/opencode-agent/` must not touch the network. Empty rather than seeded:
 * these suites assert on the pipeline's behaviour, not on model metadata, and an
 * empty database is the tier that emits nothing — exactly the config this
 * pipeline produced before the lookup existed.
 */
export const emptyCatalogue = (): Promise<ModelsDevDb> => Promise.resolve({})
