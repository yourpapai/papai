// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentPromptRequest, AgentPromptResult, AgentSession } from './agent-session.js'
import { collectChild, createClaudeConfigDir, killGroup, spawnClaude, teardownClaude } from './claude-connect.js'
import type { ClaudeChild, GroupKillSeams, SpawnClaude, TeardownSeams } from './claude-connect.js'
import { buildClaudeArgv, decodeClaudeLine, parseNdjsonStream } from './claude-contract.js'
import type { ClaudeModelKnobs, ClaudeStreamLine } from './claude-contract.js'
import { writeClaudeCredentialFiles } from './claude-credential.js'
import { claudeTracker } from './claude-progress.js'
import { classifyTurn } from './claude-turn-classify.js'
import type { TurnOutcome } from './claude-turn-classify.js'
import type { ClaudeCredential } from './config-values.js'
import { claudeResultError } from './errors.js'
import type { Logger } from './logger.js'
import type { ProgressTracker, TranscriptSink } from './progress.js'
import { redactSecrets } from './secrets.js'
import { runTurn } from './turn-run.js'
import type { TurnBounds, TurnConnection } from './turn-run.js'

/**
 * The claude session the pipeline holds — the `opencode-adapter.ts` role behind
 * the same seam: one `prompt()` per turn spawning a `claude -p` process (design
 * D1), the init id memoized into the next turn's `--resume`, token totals read
 * from `result` lines before any teardown, and the stop killing the whole
 * process group. What the CLI *says* is `claude-contract.ts`; how it is
 * *started* is `claude-connect.ts`; what the run *says* is `claude-progress.ts`.
 */

export interface ClaudeAgentOptions extends TurnBounds {
  /** The checkout the CLI works in. */
  directory: string
  /** The model knobs as plain values — never the `OpenAiSettings` object (design D5). */
  knobs: ClaudeModelKnobs
  /**
   * The chosen Anthropic credential, when this session holds one. The API-key
   * spelling is env-injected per spawn; the OAuth spelling is materialized as
   * the CLI's `apiKeyHelper` files into the job-scoped config dir once, at
   * boot, before any spawn (design D1/D3). Absent is legitimate only for the
   * recorder's un-credentialed auth-error leg.
   */
  credential?: ClaudeCredential
  /** The post-scrub `process.env` the child inherits. */
  env: Record<string, string | undefined>
  log: Logger
  /** The encrypted debug transcript, when the run has one. */
  transcript?: TranscriptSink
  /** Injection seam for tests: the spawn that starts each turn's CLI process. */
  spawn?: SpawnClaude
  /** Injection seams for the abort-path group kill. */
  killSignal?: GroupKillSeams['signal']
  killSleep?: GroupKillSeams['sleep']
  /** Injection seams for the teardown-path group kill and config-dir removal. */
  teardownSignal?: TeardownSeams['signal']
  teardownSleep?: TeardownSeams['sleep']
  teardownRemove?: TeardownSeams['removeDir']
}

/** Everything one claude session accumulates, mutated only by the functions below. */
interface SessionState {
  /** The memoized init id (design D1): chained into the next turn's `--resume`. */
  cliSessionId: string | null
  /** Token totals captured from `result` lines as they arrive (design D8). */
  tokensTotal: number
  sawUsage: boolean
  /** The most recent spawned child: the abort target and the teardown subject. */
  active: ClaudeChild | null
  /** The last turn's outcome, handed from `sendPrompt` to `prompt`. */
  outcome: TurnOutcome | null
  /** Whether the spawn itself failed — the one death the alive probe relabels. */
  spawnFailed: boolean
  /** The prompt the current turn is running, set by `prompt` before `runTurn`. */
  request: AgentPromptRequest | null
}

/** A session's fixed collaborators, so the turn functions live at module level. */
interface SessionContext {
  readonly options: ClaudeAgentOptions
  readonly configDir: string
  readonly bootSessionId: string
  readonly credentialValues: readonly string[]
  readonly tracker: ProgressTracker
  readonly state: SessionState
}

/**
 * Folds one decoded line into the session: memoizing the init id, capturing
 * usage as it arrives, reporting progress, and handing the raw line to the
 * encrypted transcript — redacted by credential value first, per the spec's
 * redaction scenario.
 */
const foldLine = (context: SessionContext, line: ClaudeStreamLine, raw: unknown): void => {
  if (line.kind === 'init') context.state.cliSessionId = line.sessionId
  if (line.kind === 'result') {
    // Captured as it arrives — before any teardown can race it (design D8).
    context.state.tokensTotal += line.usage.total
    context.state.sawUsage = true
  }
  context.tracker.observe(line)
  if (context.options.transcript !== undefined) {
    context.options.transcript.write({
      time: new Date().toISOString(),
      tool: 'claude',
      status: 'line',
      detail: redactSecrets(JSON.stringify(raw), context.credentialValues),
      durationMs: null,
    })
  }
}

/** Spawns one turn's CLI process, remembering it as the kill target. */
const spawnTurn = (context: SessionContext, invocation: ReturnType<typeof buildClaudeArgv>): ClaudeChild => {
  try {
    const child = spawnClaude(
      {
        argv: invocation.argv,
        stdinPrompt: invocation.stdinPrompt,
        credential: context.options.credential,
        workspace: context.options.directory,
        configDir: context.configDir,
        env: context.options.env,
      },
      context.options.spawn === undefined ? {} : { spawn: context.options.spawn },
    )
    context.state.active = child
    return child
  } catch (error) {
    // The transport itself never came up (ENOENT — the binary the workflow
    // forgot to install): exactly the death the alive probe exists to relabel.
    context.state.spawnFailed = true
    throw error
  }
}

/**
 * Spawns one turn, collects it, classifies it. Failures reject with their own
 * `PipelineError` so `runTurn`'s catch sees the family code.
 */
const runClaudeTurn = async (context: SessionContext): Promise<TurnOutcome> => {
  const current = context.state.request
  if (current === null) throw claudeResultError('no prompt was handed to the turn')

  const invocation = buildClaudeArgv(
    {
      prompt: current.prompt,
      ...(current.system === undefined ? {} : { system: current.system }),
      ...(current.agent === undefined ? {} : { agent: current.agent }),
      resumeSessionId: context.state.cliSessionId,
    },
    context.options.knobs,
    context.options.log,
  )
  const child = spawnTurn(context, invocation)
  const [stdout, stderr, exitCode] = await collectChild(child.process)

  let result: Extract<ClaudeStreamLine, { kind: 'result' }> | null = null
  let initSeen = false
  for (const raw of parseNdjsonStream(stdout)) {
    const line = decodeClaudeLine(raw)
    if (line === null) continue
    if (line.kind === 'init') initSeen = true
    if (line.kind === 'result') result = line
    foldLine(context, line, raw)
  }

  return classifyTurn(
    { result, initSeen, stderr, exitCode },
    { cliSessionId: context.state.cliSessionId, credentialValues: context.credentialValues },
  )
}

/** The `runTurn` slice of the session: the spawn-and-collect promise and the transport probe. */
const claudeConnection = (context: SessionContext): TurnConnection => ({
  sendPrompt: async (_sessionId: string, _body: unknown): Promise<unknown> => {
    const outcome = await runClaudeTurn(context)
    context.state.outcome = outcome
    return outcome
  },
  // "The transport stopped answering" on this route means the spawn itself
  // failed — every classified turn failure has its own code and never asks.
  alive: (_sessionId: string): Promise<boolean> => Promise.resolve(!context.state.spawnFailed),
})

/** The abort-path kill seams, as the options injected them. */
const killSeams = (options: ClaudeAgentOptions): GroupKillSeams => ({
  ...(options.killSignal === undefined ? {} : { signal: options.killSignal }),
  ...(options.killSleep === undefined ? {} : { sleep: options.killSleep }),
})

/** The teardown-path seams, as the options injected them. */
const teardownSeamsOf = (options: ClaudeAgentOptions): TeardownSeams => ({
  ...(options.teardownSignal === undefined ? {} : { signal: options.teardownSignal }),
  ...(options.teardownSleep === undefined ? {} : { sleep: options.teardownSleep }),
  ...(options.teardownRemove === undefined ? {} : { removeDir: options.teardownRemove }),
})

/** The session object the pipeline holds, over the connection `runTurn` drives. */
const claudeSession = (context: SessionContext, connection: TurnConnection): AgentSession => {
  // The claude shim ignores both arguments; the body exists to satisfy the
  // interface `runTurn` knows.
  const stubBody = { model: { providerID: 'claude', modelID: context.options.knobs.model }, parts: [] }
  const { options, state } = context

  return {
    sessionId: context.bootSessionId,
    prompt: (current: AgentPromptRequest): Promise<AgentPromptResult> => {
      state.request = current
      state.outcome = null
      return runTurn(connection, context.bootSessionId, stubBody, options, context.tracker).then(() => {
        const outcome = state.outcome
        if (outcome === null) throw claudeResultError('the turn resolved without a captured outcome')
        return { text: outcome.text, sessionId: outcome.sessionId }
      })
    },
    tokensUsed: (): Promise<number> => {
      if (!state.sawUsage) {
        options.log.warn(
          { sessionId: context.bootSessionId },
          'No recognizable claude usage was seen; the token budget cannot see this run',
        )
        return Promise.resolve(0)
      }
      return Promise.resolve(state.tokensTotal)
    },
    abort: (): Promise<boolean> => {
      if (state.active === null) return Promise.resolve(false)
      return killGroup(state.active.process.pid, killSeams(options))
    },
    close: (): Promise<void> => {
      if (state.active === null) return Promise.resolve()
      return teardownClaude(state.active, teardownSeamsOf(options))
    },
  }
}

/**
 * Boots the claude session: one job-scoped config dir, the OAuth spelling's
 * helper files materialized into it before anything spawns, one synthetic
 * job-local id until the first init line lands, and one process per turn.
 */
export const createClaudeAgent = (options: ClaudeAgentOptions): Promise<AgentSession> => {
  const configDir = createClaudeConfigDir()
  writeClaudeCredentialFiles(configDir, options.credential)
  const context: SessionContext = {
    options,
    configDir,
    bootSessionId: `claude-job-${crypto.randomUUID()}`,
    credentialValues: options.credential === undefined ? [] : [options.credential.value],
    tracker: claudeTracker(options.log),
    state: {
      cliSessionId: null,
      tokensTotal: 0,
      sawUsage: false,
      active: null,
      outcome: null,
      spawnFailed: false,
      request: null,
    },
  }
  return Promise.resolve(claudeSession(context, claudeConnection(context)))
}
