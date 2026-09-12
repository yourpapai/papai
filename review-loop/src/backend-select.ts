// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentBackend, ReviewLoopConfig } from './config.js'

/**
 * The credential guard and profile resolver for the claude backend (design D4).
 *
 * Pure over an injected `env` — never reads ambient `process.env` — and called
 * once in `runCli` after config load, before any worktree or spend. The
 * opencode route never calls it.
 */

/** The machine-readable failure codes the guard distinguishes by (design D4). */
export type BackendSelectionCode = 'CLAUDE_CREDENTIALS' | 'LLM_CREDENTIALS'

/**
 * Raised when the claude backend's credential environment cannot serve a run.
 *
 * The code is prefixed into the message because `runCli`'s top-level catch
 * prints only `error.message` — a bare sentence could be misread as a
 * config-parse or plan-path startup failure, and the remedy differs: unset one
 * variable versus fix a workflow forwarding gate.
 */
export class BackendSelectionError extends Error {
  readonly code: BackendSelectionCode

  constructor(code: BackendSelectionCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'BackendSelectionError'
    this.code = code
  }
}

export type ClaudeCredentialName = 'ANTHROPIC_API_KEY' | 'CLAUDE_CODE_OAUTH_TOKEN'

/** Which CLI invocation shape a credential spelling buys: API key → bare, OAuth token → native. */
export type ClaudeInvocationProfile = 'bare' | 'native'

export interface ResolvedAgentBackend {
  profile: ClaudeInvocationProfile
  credentialName: ClaudeCredentialName
  credentialValue: string
}

const PROFILE_OF: Readonly<Record<ClaudeCredentialName, ClaudeInvocationProfile>> = {
  ANTHROPIC_API_KEY: 'bare',
  CLAUDE_CODE_OAUTH_TOKEN: 'native',
}

/** "Set" means non-empty after trim: CI forwards unset secrets as `''`, which reads as absence. */
function readCredential(env: Record<string, string | undefined>, name: string): string | null {
  const value = env[name]
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * A value short enough that it could plausibly collide with an unrelated
 * setting — mirrored verbatim from the parent route's `secrets.ts` floor, so a
 * pathologically short credential cannot mangle enqueued lines or captures.
 */
export const MIN_SECRET_LENGTH = 12

/** Stand-in for a scrubbed credential. Conspicuous on purpose. */
const REDACTION = '[redacted]'

/**
 * Replaces every occurrence of the selected credential's value in loop-authored
 * text. Matched by **value**: a token inside tool output or captured stderr
 * has no field name, so nothing keyed on names can reach it (design D5).
 */
export function scrubCredentialValue(text: string, value: string | null): string {
  if (value === null || value.length < MIN_SECRET_LENGTH) return text
  return text.replaceAll(value, REDACTION)
}

/**
 * Resolves the claude route's invocation profile and its one credential.
 *
 * Requires exactly one of `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` —
 * both set or neither set refuse with `CLAUDE_CREDENTIALS`; a set
 * `LLM_API_KEY` refuses with `LLM_CREDENTIALS`. The surviving spelling maps to
 * the profile (API key → bare, OAuth token → native).
 */
export function resolveAgentBackend(
  backend: AgentBackend,
  env: Record<string, string | undefined>,
): ResolvedAgentBackend {
  if (backend !== 'claude') {
    return { profile: 'bare', credentialName: 'ANTHROPIC_API_KEY', credentialValue: '' }
  }

  const apiKey = readCredential(env, 'ANTHROPIC_API_KEY')
  const oauth = readCredential(env, 'CLAUDE_CODE_OAUTH_TOKEN')
  const llmKey = readCredential(env, 'LLM_API_KEY')

  if (llmKey !== null) {
    throw new BackendSelectionError(
      'LLM_CREDENTIALS',
      'LLM_API_KEY is set, which belongs to the opencode gateway route and must not ride a claude-route run. ' +
        'Unset it (or switch the config back to backend "opencode") before starting the loop.',
    )
  }

  if (apiKey !== null && oauth !== null) {
    throw new BackendSelectionError(
      'CLAUDE_CREDENTIALS',
      'both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set; exactly one must be — ' +
        'unset the other (the spelling selects the invocation profile).',
    )
  }
  if (apiKey === null && oauth === null) {
    throw new BackendSelectionError(
      'CLAUDE_CREDENTIALS',
      'neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set; exactly one must be — ' +
        'export the credential this run should use (a present-but-empty value reads as unset).',
    )
  }

  const credentialName: ClaudeCredentialName = apiKey === null ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'
  const credentialValue = apiKey ?? oauth ?? ''
  return { profile: PROFILE_OF[credentialName], credentialName, credentialValue }
}

/**
 * Opens the claude route's run-scoped config-dir parent and assembles the
 * run-wide `claude` context onto the config (D4/D8), as one function so the
 * teardown pairing with the `finally`'s removal is a seam, not a coincidence:
 *
 * - the parent is `mkdtemp` under the OS tmp root, never inside a worktree or
 *   the checkout, so session files and CLI state never cross runs and no
 *   commit the loop's fixer makes can stage them;
 * - `envSource` is `process.env` read at this one point — after
 *   `applyCommitIdentity` stamped the commit identity, so it rides into every
 *   claude child env — and never again.
 *
 * Returns the created parent, which the caller's `finally` removes best-effort.
 */
/**
 * The claude route's run-wide context (design D2): the resolver's answer
 * joined with D8's run-scoped config-dir root and the parent env, read once at
 * `runCli`'s assembly point. Additively-optional beside `backend` so callers
 * that pass neither (mutation-improve's bare `runAgent` calls) stay on the
 * opencode default.
 */
export interface ClaudeRunContext {
  profile: ClaudeInvocationProfile
  credentialName: ClaudeCredentialName
  credentialValue: string
  /** The run-scoped config-dir parent under the OS tmp root; the per-spawn child is derived per attempt. */
  configDirRoot: string
  /** The parent env the claude child env composes over; never read ambient inside the runners. */
  envSource: Record<string, string | undefined>
}

export async function openClaudeContext(config: ReviewLoopConfig, resolved: ResolvedAgentBackend): Promise<string> {
  const claudeParent = await mkdtemp(path.join(tmpdir(), 'review-loop-claude-'))
  config.claude = {
    profile: resolved.profile,
    credentialName: resolved.credentialName,
    credentialValue: resolved.credentialValue,
    configDirRoot: claudeParent,
    envSource: { ...process.env },
  }
  return claudeParent
}
