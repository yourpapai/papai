// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentPromptRequest, AgentPromptResult, AgentSession, RunSpend } from './agent-session.js'
import { buildClaudeArgv } from './claude-argv.js'
import type { ClaudeInvocationProfile, ClaudeModelKnobs } from './claude-argv.js'
import { createClaudeConfigDir, writeClaudeEmptyMcpConfig } from './claude-config-dir.js'
import { collectChild, spawnClaude } from './claude-connect.js'
import type { ClaudeChild, SpawnClaude } from './claude-connect.js'
import { decodeClaudeLine, parseNdjsonStream } from './claude-contract.js'
import type { ClaudeStreamLine } from './claude-contract.js'
import { killGroup, killSeamsOf, teardownClaude, teardownSeamsOf } from './claude-kill.js'
import type { GroupKillSeams, TeardownSeams } from './claude-kill.js'
import { claudeTracker } from './claude-progress.js'
import { ceilingTokensOf, emptyAccounting, recordLine, spendOf } from './claude-spend.js'
import type { ClaudeAccounting } from './claude-spend.js'
import { classifyTurn } from './claude-turn-classify.js'
import type { TurnOutcome } from './claude-turn-classify.js'
import type { ClaudeCredential } from './config-values.js'
import { claudeResultError } from './errors.js'
import type { Logger } from './logger.js'
import type { OpenAiSettings } from './openai-config.js'
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
   * The model reference the cost catalogue is asked about.
   *
   * The one place this route needs the settings object rather than plain knobs,
   * and it is handed the *contained* settings — the ones carrying the placeholder
   * key — because only `provider` and `model` are read. Design D5's rule is that
   * the credential never crosses this seam, not that the model's name cannot.
   */
  pricing: OpenAiSettings
  /**
   * The chosen Anthropic credential, when this session holds one. Its
   * spelling selects the invocation profile (design D1): the API key runs
   * `bare` — env-injected per spawn, byte-identical to the pre-split route —
   * and the OAuth token runs `native`, with the token env-injected and the
   * empty-MCP document written at boot. An absent credential derives bare
   * and injects nothing — the recorder's census and negative legs.
   */
  credential?: ClaudeCredential
  /** The operator's `AGENT_CLAUDE_ENV` entries, forwarded to every spawn; absent when unset. */
  claudeEnv?: Record<string, string>
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
  /**
   * What the run spent, folded from `result` and `rate_limit_event` lines as
   * they arrive — before any teardown can race them (design D8).
   */
  accounting: ClaudeAccounting
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
  /**
   * The invocation profile, derived once at boot from the credential
   * spelling (design D1) — `native` for the OAuth token, `bare` for anything
   * else, so an absent credential keeps the weaker composition.
   */
  readonly profile: ClaudeInvocationProfile
  /** The empty-MCP document's path, written at boot on the native profile; `null` on bare. */
  readonly mcpConfigPath: string | null
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
  recordLine(context.state.accounting, line)
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
        ...(context.profile === 'bare' ? {} : { profile: context.profile }),
        customEnv: context.options.claudeEnv,
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
      ...(context.profile === 'bare' ? {} : { profile: context.profile }),
      ...(context.mcpConfigPath === null ? {} : { mcpConfigPath: context.mcpConfigPath }),
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
      // Before the turn, not after: a turn that dies mid-flight was still
      // asked for, and its spend is unpriced rather than absent.
      state.accounting.turnsPrompted += 1
      return runTurn(connection, context.bootSessionId, stubBody, options, context.tracker).then(() => {
        const outcome = state.outcome
        if (outcome === null) throw claudeResultError('the turn resolved without a captured outcome')
        return { text: outcome.text, sessionId: outcome.sessionId }
      })
    },
    tokensUsed: (): Promise<number> => {
      // Only a session that ran a turn can have usage to miss. Warning on one
      // that was never prompted — the over-budget stop's own session — reported
      // a blind budget on a run that had simply not spent anything yet.
      if (state.accounting.turnsPrompted > 0 && !state.accounting.sawUsage) {
        options.log.warn(
          { sessionId: context.bootSessionId },
          'No recognizable claude usage was seen; the token budget cannot see this run',
        )
      }
      return Promise.resolve(ceilingTokensOf(state.accounting))
    },
    spend: (): Promise<RunSpend> => spendOf(state.accounting, options.pricing, options.log),
    abort: (): Promise<boolean> => {
      if (state.active === null) return Promise.resolve(false)
      return killGroup(state.active.process.pid, killSeamsOf(options))
    },
    close: (): Promise<void> => {
      if (state.active === null) return Promise.resolve()
      return teardownClaude(state.active, teardownSeamsOf(options))
    },
  }
}

/**
 * Boots the claude session: one job-scoped config dir that stays
 * credential-file-free (the helper carrier is retired — design D2), one
 * synthetic job-local id until the first init line lands, and one process per
 * turn. The credential's spelling picks the profile here (design D1), and a
 * native boot writes the empty-MCP document before any spawn can name it.
 */
export const createClaudeAgent = (options: ClaudeAgentOptions): Promise<AgentSession> => {
  const configDir = createClaudeConfigDir()
  const profile: ClaudeInvocationProfile = options.credential?.name === 'CLAUDE_CODE_OAUTH_TOKEN' ? 'native' : 'bare'
  const context: SessionContext = {
    options,
    configDir,
    profile,
    mcpConfigPath: profile === 'native' ? writeClaudeEmptyMcpConfig(configDir) : null,
    bootSessionId: `claude-job-${crypto.randomUUID()}`,
    // The redaction list for transcript lines and the stderr tail: the chosen
    // credential's value, plus the knob's — the one place a knob value could
    // otherwise survive on this route (design D4 of `claude-route-custom-env`).
    credentialValues: [
      ...(options.credential === undefined ? [] : [options.credential.value]),
      ...Object.values(options.claudeEnv ?? {}),
    ],
    tracker: claudeTracker(options.log),
    state: {
      cliSessionId: null,
      accounting: emptyAccounting(),
      active: null,
      outcome: null,
      spawnFailed: false,
      request: null,
    },
  }
  return Promise.resolve(claudeSession(context, claudeConnection(context)))
}
