// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Config } from '@opencode-ai/sdk'
import { z } from 'zod'

import { ConfigError } from './config-values.js'

/**
 * `AGENT_MCP_SERVERS`, the one non-scalar reading — a JSON document mapping
 * server names to declarations, parsed and refused at job start:
 * `safeJson` names the syntax error, the schema names the shape error,
 * because "AGENT_MCP_SERVERS is invalid" sends an operator looking in the
 * wrong half.
 *
 * Its own module rather than a section of `config-values.ts`, which stays
 * scalar-only by its own stated seam.
 *
 * The schema is deliberately minimal (design Non-goals): `command` /
 * `environment` for a local entry, `url` / `headers` for a remote one, unknown
 * fields refused rather than passed through. `cwd`, `timeout` and `enabled`
 * exist in the SDK types but nothing in this pipeline needs them — an operator
 * who wants a server off removes it from the knob.
 */

/**
 * Server names must be safe to embed in a tool-name prefix: OpenCode surfaces a
 * server's tools as `<name>_<tool>`, and the pipeline generates `"<name>_*"`
 * permission keys from the same name.
 */
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/u

const localSchema = z.strictObject({
  type: z.literal('local'),
  // A word is trimmed-nonblank, the same rule every scalar knob here reads by:
  // a whitespace-only word is a command that can never run.
  command: z.array(z.string().refine((word) => word.trim().length > 0)).min(1),
  environment: z.record(z.string(), z.string()).optional(),
})

const remoteSchema = z.strictObject({
  type: z.literal('remote'),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
})

const documentSchema = z.record(z.string(), z.union([localSchema, remoteSchema]))

/** What one entry of the knob declares, after parsing. */
export type McpServerEntry = z.infer<typeof localSchema> | z.infer<typeof remoteSchema>

/** The whole knob: server name → declaration, or `undefined` when unset. */
export type McpServers = Record<string, McpServerEntry>

/**
 * Parses `AGENT_MCP_SERVERS`.
 *
 * `undefined` — unset or blank — is the ordinary case and means no servers,
 * which is what keeps an unset knob byte-identical to a run before the knob
 * existed. Everything else that cannot work is refused here, before any model
 * turn is spent.
 */
export const parseMcpServers = (raw: string | undefined): McpServers | undefined => {
  if (raw === undefined || raw.trim().length === 0) return undefined

  const document = safeJson(raw)
  refuseUnintendable(document)

  const parsed = documentSchema.safeParse(document)
  if (!parsed.success) throw new ConfigError(`AGENT_MCP_SERVERS is not a valid MCP server map: ${parsed.error.message}`)
  return parsed.data
}

/**
 * The two refusals that name a **rule** rather than a schema path, checked
 * before the schema so the message can say what the operator did wrong rather
 * than what Zod found.
 *
 * A non-object document is left to the schema: its own refusal is the clearer
 * one, and there is no name or `oauth` to judge.
 */
const refuseUnintendable = (document: unknown): void => {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return

  for (const [name, entry] of Object.entries(document) as [string, unknown][]) {
    if (!NAME_PATTERN.test(name)) {
      throw new ConfigError(
        `AGENT_MCP_SERVERS server names must match [A-Za-z0-9_-]+ — tools arrive as <name>_<tool> and grants are keyed <name>_*: got ${JSON.stringify(name)}`,
      )
    }
    if (typeof entry === 'object' && entry !== null && Object.hasOwn(entry, 'oauth')) {
      // Refused in every spelling, not just the object one: an `oauth` value of
      // any kind can only ever express an intent this runner cannot honour, and
      // a silently ignored key reads as accepted. The emission half of the same
      // rule forces `oauth: false` on every remote the config does carry.
      throw new ConfigError(
        `AGENT_MCP_SERVERS refuses the oauth field on ${JSON.stringify(name)}: OAuth remotes park at needs_auth, and an unattended job can complete no browser flow`,
      )
    }
  }
}

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new ConfigError('AGENT_MCP_SERVERS must be valid JSON')
  }
}

/**
 * The `mcp` block for the emitted config: each declared server under its name,
 * every remote forced `oauth: false`.
 *
 * Lives here rather than in `openai-config.ts` because it is MCP domain logic —
 * the emission half of the same rule the parse half enforces. The forcing is
 * design D2: the parse refuses an `oauth` key outright, and this is the same
 * rule on the way out. Forcing beats requiring because a maintainer who omitted
 * the field still gets the clean `failed`-with-HTTP-error degradation instead
 * of a job silently parked at `needs_auth`, which no unattended run can leave.
 */
export const mcpBlock = (servers: McpServers | undefined): Config['mcp'] | undefined => {
  if (servers === undefined) return undefined
  const names = Object.keys(servers)
  if (names.length === 0) return undefined

  const block: NonNullable<Config['mcp']> = {}
  for (const name of names) {
    const server = servers[name]
    if (server === undefined) continue
    block[name] = server.type === 'remote' ? { ...server, oauth: false as const } : server
  }
  return block
}
