// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import type { ModuleCommand, ModulePromptFragment } from '../../../ports/module-contributions.js'
import type { ModuleEligibilityPredicate } from '../../../ports/module-eligibility.js'
import type { ModuleTool, ModuleToolRuntimeContext } from '../../../ports/module-tools.js'
import type { SettingsSection } from '../../../ports/settings-sections.js'
import { configContextOf } from '../credentials/resolve-agent-secrets.js'
import { listRepos } from '../repos/store.js'
import { continueSessionTool } from './continue-tool.js'
import { magiHttpFetch } from './http-fetch.js'
import { buildRuntimeContext } from './runtime-context.js'
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  listSessionsTool,
  sessionStatusTool,
  startSessionTool,
} from './session-tools.js'
import { getTool, listProjectsTool } from './tools.js'
import type { Tool } from './tools.js'

/** Wrap an acp `Tool` (RuntimeContext-based) into a `ModuleTool` (identity-based), building the
 * RuntimeContext per call from the acting `(storageContextId, chatUserId)`. */
function toModuleTool(t: Tool): ModuleTool {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.gate === undefined ? {} : { gate: t.gate }),
    execute: (input: unknown, rt: ModuleToolRuntimeContext, options: ToolExecutionOptions): Promise<unknown> =>
      t.execute(input, buildRuntimeContext(rt.storageContextId, rt.chatUserId), options),
  }
}

export const codingAcpTools: readonly ModuleTool[] = [
  listProjectsTool(),
  getTool('list_agents', 'List coding agents available in magi.', '/agents', magiHttpFetch),
  startSessionTool(magiHttpFetch),
  listSessionsTool(magiHttpFetch),
  sessionStatusTool(magiHttpFetch),
  finishSessionTool(magiHttpFetch),
  cancelSessionTool(magiHttpFetch),
  answerPermissionTool(magiHttpFetch),
  continueSessionTool(magiHttpFetch),
].map(toModuleTool)

export const ACP_PROMPT_FRAGMENT =
  'Coding sessions: use start_session(project, prompt) to run a sandboxed AI coding agent on a ' +
  'configured project, list_sessions/session_status to check progress, answer_permission(sessionId, ' +
  'decision) when the agent needs approval, finish_session(sessionId, action) to commit/push or open a ' +
  'PR, cancel_session to stop one. ' +
  "Use continue_session(sessionId or prNumber, prompt) to keep working on a prior session's " +
  'branch/PR — it updates the existing PR. ' +
  'Use list_projects/list_agents to discover what is configured. The user is notified when a session ' +
  'finishes or needs input. ' +
  'When start_session/continue_session returns a transcriptUrl, include that link in your reply ' +
  'so the user can watch the session live in the browser and share it.'

export const ACP_COMMAND_TEXT =
  'ACP coding sessions are available. Ask me in natural language, e.g. "start a session on demo to add a ' +
  'health check", "what sessions are running?", "review PR 42 on demo", or "continue PR 42 on demo and fix ' +
  'the failing tests".'

export const codingAcpPromptFragment: ModulePromptFragment = { name: 'acp-hint', content: ACP_PROMPT_FRAGMENT }

export const codingAcpCommand: ModuleCommand = {
  name: 'acp',
  description: 'About ACP coding sessions',
  execute: (_message, reply): Promise<void> => reply.text(ACP_COMMAND_TEXT),
}

/** Operator-configured magi endpoint. Stored under the legacy `plg:acp:*` namespace (see
 * runtime-context.ts) so the transcript viewer and existing config rows keep working. */
export const codingAcpSettingsSection: SettingsSection = {
  id: 'acp',
  label: 'Coding sessions (magi)',
  fields: [
    { key: 'magi_base_url', label: 'Magi base URL', required: true },
    { key: 'magi_token', label: 'Magi token', required: true, sensitive: true },
  ],
}

/** Per-context eligibility: coding contributions surface only where the group's repo catalogue is
 * non-empty (the same "is anything configured to run against" signal `list_projects` returns). */
export const isCodingContextEligible: ModuleEligibilityPredicate = (storageContextId: string): boolean =>
  listRepos(configContextOf(storageContextId)).length > 0
