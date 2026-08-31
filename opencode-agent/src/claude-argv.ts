// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { PipelineError } from './errors.js'
import type { Logger } from './logger.js'
import { parseModelRef } from './sdk-contract.js'

/**
 * The argv half of the claude CLI contract — what one turn asks the CLI to
 * run. Split from `claude-contract.ts` when that file reached `max-lines`,
 * along the seam its own header had already drawn: the schemas are what the
 * CLI *says*, this is what it is *asked*. They change for the same reasons
 * their OpenCode twins do.
 */

/**
 * The Linux single-argument cap (`MAX_ARG_STRLEN`), which the user prompt
 * dodges by riding stdin but the appended system prompt cannot — so the builder
 * refuses to compose an invocation that would die in `spawn` with an `E2BIG`
 * the failure classifier would misread as a dead backend.
 */
export const MAX_ARG_STRLEN = 131_072

/**
 * The profile → allowlist mapping, pinned by the spec. No wildcard exists here.
 *
 * Exported additively so the review-loop workspace's duplicated doctrine can
 * be pinned equal to this one by `tests/opencode-agent/claude-doctrine.test.ts`
 * — a test-time import across the subprocess boundary, the same seam
 * `minimality-rule.test.ts` already uses.
 */
export const ALLOWLISTS = {
  plan: 'Read,Glob,Grep',
  propose: 'Read,Edit,Write,Glob,Grep',
  build: 'Read,Edit,Write,Bash,Glob,Grep',
} as const

/**
 * Which CLI invocation shape a turn runs — selected by the credential
 * spelling, not a knob (design D1 of the native-OAuth change): the API key
 * keeps `bare` (today's route, byte-identical), the OAuth token runs
 * `native` (no `--bare`, plus the neutralization flags). The builder takes
 * it as a parameter so it stays about composition and testable without a
 * credential value.
 */
export type ClaudeInvocationProfile = 'bare' | 'native'

/**
 * The credential spelling each profile re-adds — one rule, spelled twice
 * (design D3 of the native-OAuth change): bare carries the API key, native
 * the OAuth token. A credential whose spelling does not match the profile
 * injects nothing at all, so a mismatched pair can never smuggle the other
 * spelling through.
 *
 * Lives beside the profile type rather than beside its only consumer in
 * `claude-connect.ts`: it is a property of the profile, the same shape as
 * `ALLOWLISTS` above.
 */
export const PROFILE_CREDENTIAL: Readonly<
  Record<ClaudeInvocationProfile, 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'>
> = {
  bare: 'ANTHROPIC_API_KEY',
  native: 'CLAUDE_CODE_OAUTH_TOKEN',
}

export interface ClaudeTurnRequest {
  prompt: string
  system?: string
  /** The profile the invoking phase named (`plan`, `propose`, `build`). */
  agent?: string
  /** The memoized CLI session id; `null` or absent spawns a fresh session. */
  resumeSessionId?: string | null
  /** The invocation profile; absent is `bare`, the pre-split default. */
  profile?: ClaudeInvocationProfile
  /**
   * The empty-MCP JSON document's path — the `native` profile's
   * `--mcp-config` value, written beside the session files at boot. Required
   * on `native`; ignored on `bare`.
   */
  mcpConfigPath?: string
}

/**
 * The model knobs that cross to this backend as plain values — never the
 * `OpenAiSettings` object, whose gateway half must not reach a claude path.
 */
export interface ClaudeModelKnobs {
  /** The main model id, as `LLM_MODEL` spelled it (a `provider/` prefix is stripped). */
  model: string
  /** `LLM_MODEL_LIGHT`, reaching `plan`-profile turns only. */
  lightModel: string | null
  /** `AGENT_EFFORT_PLAN`, passed through when set. */
  planEffort: string | null
  /** `AGENT_EFFORT_BUILD`, passed through when set. */
  buildEffort: string | null
}

export interface ClaudeInvocation {
  argv: readonly string[]
  /** The prompt, delivered on stdin rather than argv. */
  stdinPrompt: string
}

/** The composed system prompt would not fit one argv entry; said in a way a maintainer can act on. */
export const claudeArgLimitError = (bytes: number, cap: number): PipelineError =>
  new PipelineError(
    'CLAUDE_ARG_LIMIT',
    `The composed system prompt is ${bytes.toLocaleString('en-US')} bytes and the operating system caps one ` +
      `command-line argument at ${cap.toLocaleString('en-US')} bytes (MAX_ARG_STRLEN), so the \`claude\` process ` +
      'could not even start. Shrink the inlined skill set this run loads — the system prompt is the one prompt ' +
      'component no budget caps, and it is what grew.',
  )

/**
 * A native invocation with no MCP document to name — a composition bug, not an
 * operator condition: the adapter writes the empty document at boot, so the
 * only way here is a caller that forgot it. Refused before anything spawns,
 * the same doctrine as the MAX_ARG_STRLEN refusal.
 */
export const claudeProfileError = (): PipelineError =>
  new PipelineError(
    'CLAUDE_PROFILE',
    'The native claude invocation profile needs the empty-MCP document path for --mcp-config, and none was ' +
      'given. That document is written into the job-scoped config dir at boot; a missing one is a composition bug ' +
      'in the caller, not a condition an operator can set.',
  )

/**
 * Only the model id crosses: one `LLM_MODEL` knob serves either backend, and a
 * value spelled `provider/model` (the OpenCode form) keeps its model id here.
 *
 * Exported as the one definition of *the id the CLI was invoked with*, which
 * `claude-spend.ts` prices the run under. Two functions agreeing would be a
 * reference that can drift from the invocation; one function is a reference
 * that cannot.
 */
export const modelIdForCli = (raw: string): string => (raw.includes('/') ? parseModelRef(raw).modelID : raw)

/** Which allowlist, model and effort a profile's turn runs with. */
const profileSelection = (
  agent: string | undefined,
  knobs: ClaudeModelKnobs,
  log: Logger,
): { allowlist: string; model: string; effort: string | null } => {
  if (agent === 'plan') {
    return { allowlist: ALLOWLISTS.plan, model: knobs.lightModel ?? knobs.model, effort: knobs.planEffort }
  }
  if (agent === 'propose') return { allowlist: ALLOWLISTS.propose, model: knobs.model, effort: null }
  if (agent === 'build') return { allowlist: ALLOWLISTS.build, model: knobs.model, effort: knobs.buildEffort }

  // The weaker profile is the default, so an agent this pipeline does not name
  // inherits the restricted set rather than a free pass.
  const named = agent ?? '(no profile named)'
  log.warn({ agent: named }, `Agent profile "${named}" is not one this backend pins; the plan allowlist applies`)
  return { allowlist: ALLOWLISTS.plan, model: knobs.lightModel ?? knobs.model, effort: knobs.planEffort }
}

/**
 * The argv block that carries the invocation profile: `--bare` on the bare
 * profile; the three neutralization flags on the native one (design D2) —
 * `--setting-sources ''` kills repo-skill discovery and settings-file loads,
 * and `--strict-mcp-config --mcp-config <empty>` kills `.mcp.json`
 * auto-connect. Belt and braces because either flag alone leaves one surface
 * open (recorded census: strict alone still loaded repo skills).
 */
const profileBlock = (profile: ClaudeInvocationProfile, mcpConfigPath: string | null): readonly string[] => {
  if (profile === 'native') {
    if (mcpConfigPath === null) throw claudeProfileError()
    return ['--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcpConfigPath]
  }
  return ['--bare']
}

/**
 * Composes one CLI invocation. Refuses — loudly, and before anything spawns —
 * an appended system prompt that cannot ride one argv entry.
 *
 * Prompt on **stdin** (a single Linux argument is capped at 128 KiB and `ps`
 * would carry the prompt otherwise), system prompt through
 * `--append-system-prompt` (the CLI's built-in prompt defines its tools'
 * contracts; this pipeline's prompts are additions), and the profile's
 * allowlist through `--allowedTools` with `--permission-mode default` —
 * composition semantics recorded in the fixture corpus's adversarial case: the
 * allowlist auto-approves its members and enables nothing, so an unlisted tool
 * has no grantor under headless `-p` and is refused rather than run.
 */
export const buildClaudeArgv = (request: ClaudeTurnRequest, knobs: ClaudeModelKnobs, log: Logger): ClaudeInvocation => {
  const system = request.system
  if (system !== undefined) {
    const bytes = Buffer.byteLength(system, 'utf8')
    if (bytes > MAX_ARG_STRLEN) throw claudeArgLimitError(bytes, MAX_ARG_STRLEN)
  }

  const selection = profileSelection(request.agent, knobs, log)
  const resume = request.resumeSessionId ?? null

  return {
    argv: [
      ...profileBlock(request.profile ?? 'bare', request.mcpConfigPath ?? null),
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--allowedTools',
      selection.allowlist,
      '--model',
      modelIdForCli(selection.model),
      ...(selection.effort === null ? [] : ['--effort', selection.effort]),
      ...(system === undefined ? [] : ['--append-system-prompt', system]),
      ...(resume === null ? [] : ['--resume', resume]),
    ],
    stdinPrompt: request.prompt,
  }
}
