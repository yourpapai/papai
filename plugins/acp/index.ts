// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch } from './client.js'
import { continueSessionTool } from './continue-tool.js'
import {
  answerPermissionTool,
  cancelSessionTool,
  finishSessionTool,
  listSessionsTool,
  reviewPrTool,
  sessionStatusTool,
  startSessionTool,
} from './session-tools.js'
import { getTool, listProjectsTool } from './tools.js'
import type { Tool } from './tools.js'

// Local structural plugin-context types: plugins cannot static-import src/ or zod
// (discovery rejects bare-module imports), so we use structural types throughout.
type RegisterTool = (tool: Tool) => void
type RegisterFragment = (f: { name: string; content: string }) => void
type RegisterCommand = (c: {
  name: string
  description: string
  execute: (message: unknown, reply: { text(s: string): Promise<void> | void }, auth: unknown) => Promise<void> | void
}) => void
type LogInfo = (meta: Record<string, unknown>, msg: string) => void

type ActivationContext = {
  registerTool: RegisterTool
  registerFragment: RegisterFragment
  registerCommand: RegisterCommand
  logInfo: LogInfo
  httpFetch: HttpFetch | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (isRecord(value)) return value
  throw new Error(message)
}

function isRegisterTool(value: unknown): value is RegisterTool {
  return typeof value === 'function'
}

function isRegisterFragment(value: unknown): value is RegisterFragment {
  return typeof value === 'function'
}

function isRegisterCommand(value: unknown): value is RegisterCommand {
  return typeof value === 'function'
}

function isLogInfo(value: unknown): value is LogInfo {
  return typeof value === 'function'
}

function isHttpFetch(value: unknown): value is HttpFetch {
  return typeof value === 'function'
}

function extractActivationContext(ctx: unknown): ActivationContext {
  const context = requireRecord(ctx, 'acp: plugin context must be an object')
  const log = requireRecord(context['log'], 'acp: plugin context log must be an object')
  const registration = requireRecord(context['registration'], 'acp: plugin context registration must be an object')
  const providerRuntime = context['providerRuntime']

  if (!isLogInfo(log['info'])) throw new Error('acp: logger.info must be a function')
  if (!isRegisterTool(registration['registerTool'])) throw new Error('acp: registerTool must be a function')
  if (!isRegisterFragment(registration['registerPromptFragment']))
    throw new Error('acp: registerPromptFragment must be a function')
  if (!isRegisterCommand(registration['registerCommand'])) throw new Error('acp: registerCommand must be a function')

  const logInfo = log['info']
  const registerTool = registration['registerTool']
  const registerFragment = registration['registerPromptFragment']
  const registerCommand = registration['registerCommand']

  let httpFetch: HttpFetch | undefined
  if (isRecord(providerRuntime) && isHttpFetch(providerRuntime['httpFetch'])) {
    httpFetch = providerRuntime['httpFetch']
  }

  return { registerTool, registerFragment, registerCommand, logInfo, httpFetch }
}

const ACP_PROMPT_FRAGMENT =
  'Coding sessions: use start_session(project, prompt) to run a sandboxed AI coding agent on a ' +
  'configured project, list_sessions/session_status to check progress, answer_permission(sessionId, ' +
  'decision) when the agent needs approval, finish_session(sessionId, action) to commit/push or open a ' +
  'PR, cancel_session to stop one, and review_pr(project, prNumber) to review an open PR. ' +
  "Use continue_session(sessionId or prNumber, prompt) to keep working on a prior session's " +
  'branch/PR — it updates the existing PR. ' +
  'Use list_projects/list_agents to discover what is configured. The user is notified when a session ' +
  'finishes or needs input. ' +
  'When start_session/continue_session/review_pr returns a transcriptUrl, include that link in your reply ' +
  'so the user can watch the session live in the browser and share it.'

const ACP_COMMAND_TEXT =
  'ACP coding sessions are available. Ask me in natural language, e.g. "start a session on demo to add a ' +
  'health check", "what sessions are running?", "review PR 42 on demo", or "continue PR 42 on demo and fix ' +
  'the failing tests".'

const factory = (): { activate(ctx: unknown): void } => ({
  activate(rawCtx: unknown): void {
    const ctx = extractActivationContext(rawCtx)
    ctx.registerTool(listProjectsTool())
    ctx.registerTool(getTool('list_agents', 'List coding agents available in magi.', '/agents', ctx.httpFetch))
    ctx.registerTool(startSessionTool(ctx.httpFetch))
    ctx.registerTool(listSessionsTool(ctx.httpFetch))
    ctx.registerTool(sessionStatusTool(ctx.httpFetch))
    ctx.registerTool(finishSessionTool(ctx.httpFetch))
    ctx.registerTool(cancelSessionTool(ctx.httpFetch))
    ctx.registerTool(answerPermissionTool(ctx.httpFetch))
    ctx.registerTool(reviewPrTool(ctx.httpFetch))
    ctx.registerTool(continueSessionTool(ctx.httpFetch))
    ctx.registerFragment({ name: 'acp-hint', content: ACP_PROMPT_FRAGMENT })
    ctx.registerCommand({
      name: 'acp',
      description: 'About ACP coding sessions',
      execute: (_message: unknown, reply: { text(s: string): Promise<void> | void }): Promise<void> | void =>
        reply.text(ACP_COMMAND_TEXT),
    })
    ctx.logInfo({}, 'acp plugin activated')
  },
})

export default factory
