// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { McpServers } from './mcp-servers.js'

/**
 * What each agent profile may do: the capability maps, deny-by-default, plus
 * the generated MCP grant keys that widen them.
 *
 * Split from `openai-config.ts` when the MCP emission pushed that file past
 * `max-lines`, along the seam it already had: that file is the single config
 * *builder* both execution paths read, this one is the policy its `permission`
 * keys encode — what a profile is allowed to do changes for different reasons
 * than where the model endpoint lives.
 */

/**
 * Capabilities granted by name, on top of a wildcard denial.
 *
 * Deny-by-default rather than a list of things to forbid. A forbid-list has to
 * name every dangerous tool, so a tool added by a later OpenCode release arrives
 * enabled — the same enumeration trap that made the untrusted-input envelope
 * escapable. `"*"` is a real permission key: `opencode agent list` shows the
 * built-in profile carrying `{"permission": "*", "action": "allow"}`, and a
 * config block is resolved *after* the built-ins, so this narrows them.
 *
 * `"ask"` is never used: the job is unattended and a prompt would deadlock it.
 */
const READ_TOOLS = ['read', 'grep', 'glob', 'list', 'todowrite'] as const

/** Tools the phases that write code additionally need. */
const WRITE_TOOLS = [
  'edit',
  'bash',
  // OpenCode spills large tool output to paths outside the workspace; the
  // built-ins allow exactly those, and a bare wildcard denial would revoke them
  // in the one profile that actually runs commands.
  'external_directory',
] as const

/**
 * Design D8 — the one tool an artifact-writing (planner/spec) turn needs beyond
 * reading. The drafter composes proposal/spec/design/tasks content and writes it
 * into `openspec/changes/<name>/`; the diff guard's `outsidePrefix` confines
 * what survives staging to that folder, so a write anywhere else is refused even
 * though the tool itself is granted. No `bash`: composing artefacts is not
 * running commands, and the two execution profiles (`build`) keep that.
 */
const PROPOSE_TOOLS = ['edit'] as const

const grant = (tools: readonly string[]): Record<string, 'allow' | 'deny'> => ({
  '*': 'deny',
  ...Object.fromEntries(tools.map((tool) => [tool, 'allow'])),
})

/**
 * Generated `"<name>_*": "allow"` keys, one per declared MCP server.
 *
 * Generated, never hand-keyed, because a bare server name is a silent no-op as
 * a permission key — the wildcard form is the one verified to admit the
 * server's whole toolset. `allow` only: `ask` would deadlock an unattended
 * job on the very prompt it asked.
 */
export const mcpGrants = (servers: McpServers | undefined): Record<string, 'allow'> =>
  Object.fromEntries(Object.keys(servers ?? {}).map((name) => [`${name}_*`, 'allow']))

/**
 * A permission map plus the generated MCP keys, appended **after** the named
 * allows. The resolved rules list is an ordered concatenation and the later
 * rule wins, which is why the allows already sit after `"*": "deny"` — and why
 * these must sit after both. An empty grant list returns the base map itself,
 * so a run with no servers emits the identical object it always did.
 */
export const withMcp = (
  base: Record<string, 'allow' | 'deny'>,
  grants: Record<string, 'allow'>,
): Record<string, 'allow' | 'deny'> => (Object.keys(grants).length === 0 ? base : { ...base, ...grants })

/** Reading and searching only: no file writes, no shell, no network, no subagents. */
export const READ_ONLY_PERMISSION = grant(READ_TOOLS)

/** Everything above plus editing and running commands. */
export const WRITE_PERMISSION = grant([...READ_TOOLS, ...WRITE_TOOLS])

/** Reading plus editing, scoped by the diff guard to the change folder (D8). */
export const PROPOSE_PERMISSION = grant([...READ_TOOLS, ...PROPOSE_TOOLS])
