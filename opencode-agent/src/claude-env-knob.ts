// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { ConfigError } from './config-values.js'

/**
 * `AGENT_CLAUDE_ENV` — the claude route's custom child-environment knob, the
 * third non-scalar reading: a JSON object mapping environment-variable names
 * to string values, parsed and refused at job start (design D1 of
 * `claude-route-custom-env`).
 *
 * Its own module rather than a section of `config-values.ts`, which stays
 * scalar-only by its own stated seam; the arrangement copies
 * `mcp-servers.ts`, the one that already does this job. `safeJson` names the
 * syntax error, the rule pass names the route-ownership rule, and the schema
 * names the shape error, because "AGENT_CLAUDE_ENV is invalid" sends an
 * operator looking in the wrong half.
 *
 * Parsing is route-independent — a malformed document fails startup on the
 * opencode backend too, where the knob does nothing (design D1: an operator
 * flipping `AGENT_BACKEND` later must not inherit a document that was never
 * validated) — while the parsed entries are *applied* only on the claude
 * route. Empty-string values are accepted: `VAR=` is a legitimate spelling
 * for "explicitly empty", unlike the MCP `command` rule where a blank word is
 * a command that can never run.
 */

/**
 * The names the claude route owns — the union of `STRIPPED_NAMES` in
 * `claude-connect.ts` (what the child env is scrubbed of) and the names the
 * route injects itself (`CLAUDE_CONFIG_DIR`, `DISABLE_AUTOUPDATER`, and the
 * invocation profile's credential spelling, which is one of the two Anthropic
 * spellings already stripped).
 *
 * Declared here rather than single-sourced from `claude-connect.ts` on
 * purpose (design D3): config loading must not import the spawn layer for one
 * array. The pin in `tests/opencode-agent/claude-env-knob.test.ts` — set
 * membership plus a per-member behaviour refusal — is what keeps the two
 * lists honest: drift in either fails there the day it happens.
 */
export const REFUSED_NAMES: readonly string[] = [
  // The five the child env is name-stripped of, in `STRIPPED_NAMES` order.
  'LLM_BASE_URL',
  'AGENT_MCP_SERVERS',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'AGENT_CLAUDE_ENV',
  // The two the route writes into the child env after the merge.
  'CLAUDE_CONFIG_DIR',
  'DISABLE_AUTOUPDATER',
]

const documentSchema = z.record(z.string(), z.string())

/** The whole knob: variable name → value, or `undefined` when unset. */
export type ClaudeEnv = Record<string, string>

/**
 * Parses `AGENT_CLAUDE_ENV`.
 *
 * `undefined` — unset or blank — is the ordinary case and means no custom
 * environment, which is what keeps an unset knob byte-identical to a run
 * before the knob existed. Everything else that cannot work is refused here,
 * before any model turn is spent and before any process is spawned, whichever
 * backend the job selected.
 */
export const parseClaudeEnv = (raw: string | undefined): ClaudeEnv | undefined => {
  if (raw === undefined || raw.trim().length === 0) return undefined

  const document = safeJson(raw)
  refuseRouteOwned(document)

  const parsed = documentSchema.safeParse(document)
  if (!parsed.success)
    throw new ConfigError(`AGENT_CLAUDE_ENV is not a valid environment-variable map: ${parsed.error.message}`)
  return parsed.data
}

/**
 * The refusal that names a **rule** rather than a schema path, checked before
 * the schema so the message can say what the operator did wrong rather than
 * what Zod found: a name this route strips from or injects into the child
 * environment is not operator-settable — the entry could never take effect,
 * and a silently ignored one reads as accepted.
 *
 * A non-object document is left to the schema: its own refusal is the clearer
 * one, and there is no name to judge.
 */
const refuseRouteOwned = (document: unknown): void => {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return

  for (const name of Object.keys(document)) {
    if (REFUSED_NAMES.includes(name)) {
      throw new ConfigError(
        `AGENT_CLAUDE_ENV refuses ${JSON.stringify(name)}: the claude route strips or injects this name itself, and route-owned names are not operator-settable`,
      )
    }
  }
}

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new ConfigError('AGENT_CLAUDE_ENV must be valid JSON')
  }
}
