// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asObject, asString, callMagi, NOT_CONFIGURED, optionalString, readMagiConfig } from './client.js'
import type { HttpFetch } from './client.js'
import {
  answerPermissionSchema,
  emptySchema,
  finishSessionSchema,
  listSessionsSchema,
  sessionIdSchema,
  startSessionSchema,
} from './schemas.js'

// Local structural tool types (mirrors plugins/synthetic-web-search): the real PluginTool.inputSchema
// is z.ZodType, but plugins cannot static-import zod (discovery rejects bare-module imports),
// so we type inputSchema loosely to use raw JSON-Schema objects.
type AdminConfigReader = { get(key: string): string | undefined }
type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}
type RuntimeContext = { storageContextId: string; adminConfig: AdminConfigReader; kv: KvStore }
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
type Tool = { name: string; description: string; inputSchema: unknown; execute: ToolExecute }

type RegisterTool = (tool: Tool) => void
type RegisterFragment = (f: { name: string; content: string }) => void
type LogInfo = (meta: Record<string, unknown>, msg: string) => void

type ActivationContext = {
  registerTool: RegisterTool
  registerFragment: RegisterFragment
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

  const logInfo = log['info']
  const registerTool = registration['registerTool']
  const registerFragment = registration['registerPromptFragment']

  let httpFetch: HttpFetch | undefined
  if (isRecord(providerRuntime) && isHttpFetch(providerRuntime['httpFetch'])) {
    httpFetch = providerRuntime['httpFetch']
  }

  return { registerTool, registerFragment, logInfo, httpFetch }
}

const DEFAULT_AGENT = 'claude-code-acp'
const SESSION_FILTERS = ['new', 'active', 'waiting', 'review', 'done']

function sessionIdOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const map: Map<string, unknown> = new Map(Object.entries(result))
  const id = map.get('id')
  return typeof id === 'string' && id.length > 0 ? id : null
}

function startSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'start_session',
    description: 'Start a sandboxed coding-agent session on a configured project.',
    inputSchema: startSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prompt = asString(args, 'prompt')
      if (project === null || prompt === null)
        return { error: 'invalid_input', message: 'project and prompt are required' }
      const agent = optionalString(args, 'agent') ?? DEFAULT_AGENT
      const result = await callMagi(httpFetch, cfg, 'POST', '/sessions', {
        project,
        agent,
        contextId: runtimeContext.storageContextId,
        prompt,
      })
      const id = sessionIdOf(result)
      if (id !== null) runtimeContext.kv.set(`session:${id}`, '1')
      return result
    },
  }
}

function listSessionsTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'list_sessions',
    description: 'List coding sessions started from this chat (filter: new|active|waiting|review|done).',
    inputSchema: listSessionsSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const filter = optionalString(asObject(input), 'filter') ?? 'active'
      if (!SESSION_FILTERS.includes(filter))
        return { error: 'invalid_input', message: `filter must be one of ${SESSION_FILTERS.join(', ')}` }
      const result = await callMagi(httpFetch, cfg, 'GET', `/sessions?filter=${encodeURIComponent(filter)}`)
      if (!Array.isArray(result)) return result
      const known = new Set(runtimeContext.kv.list('session:').map((row): string => row.key.slice('session:'.length)))
      return result.filter((s): boolean => {
        const id = sessionIdOf(s)
        return id !== null && known.has(id)
      })
    },
  }
}

function sessionStatusTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'session_status',
    description: 'Get the status and metadata of a coding session.',
    inputSchema: sessionIdSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return Promise.resolve({ error: 'invalid_input', message: 'sessionId is required' })
      return callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}`)
    },
  }
}

const DEFAULT_FINISH_MESSAGE = 'Apply changes from magi coding session'

function finishSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'finish_session',
    description: 'Finish a session: commit + push the branch, or open a PR.',
    inputSchema: finishSessionSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const action = asString(args, 'action')
      if (sessionId === null || (action !== 'push' && action !== 'pr'))
        return Promise.resolve({ error: 'invalid_input', message: 'sessionId and action (push|pr) are required' })
      const bodyFields: Record<string, string | undefined> = {
        message: optionalString(args, 'message') ?? DEFAULT_FINISH_MESSAGE,
        action,
        title: optionalString(args, 'title'),
        body: optionalString(args, 'body'),
      }
      const payload = Object.fromEntries(Object.entries(bodyFields).filter(([, v]) => v !== undefined))
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/finish`, payload)
    },
  }
}

function cancelSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'cancel_session',
    description: 'Cancel a running coding session and tear down its sandbox.',
    inputSchema: sessionIdSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const sessionId = asString(asObject(input), 'sessionId')
      if (sessionId === null) return Promise.resolve({ error: 'invalid_input', message: 'sessionId is required' })
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/cancel`)
    },
  }
}

function answerPermissionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'answer_permission',
    description: 'Answer a coding agent pending permission request (allow or deny).',
    inputSchema: answerPermissionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const sessionId = asString(args, 'sessionId')
      const decision = asString(args, 'decision')
      if (sessionId === null || (decision !== 'allow' && decision !== 'deny'))
        return { error: 'invalid_input', message: 'sessionId and decision (allow|deny) are required' }
      const pending = await callMagi(httpFetch, cfg, 'GET', `/sessions/${encodeURIComponent(sessionId)}/permissions`)
      if (!Array.isArray(pending)) return pending
      const toolCallIds = pending
        .map((p): string | null => asString(asObject(p), 'toolCallId'))
        .filter((id): id is string => id !== null)
      if (toolCallIds.length === 0) return { resolved: 0, message: 'no pending permission requests' }
      await Promise.all(
        toolCallIds.map(
          (toolCallId): Promise<unknown> =>
            callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/permission`, {
              toolCallId,
              decision,
            }),
        ),
      )
      return { resolved: toolCallIds.length, decision }
    },
  }
}

function getTool(name: string, description: string, path: string, httpFetch: HttpFetch | undefined): Tool {
  return {
    name,
    description,
    inputSchema: emptySchema,
    execute: (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      return callMagi(httpFetch, cfg, 'GET', path)
    },
  }
}

const factory = (): { activate(ctx: unknown): void } => ({
  activate(rawCtx: unknown): void {
    const ctx = extractActivationContext(rawCtx)
    ctx.registerTool(getTool('list_projects', 'List coding projects configured in magi.', '/projects', ctx.httpFetch))
    ctx.registerTool(getTool('list_agents', 'List coding agents available in magi.', '/agents', ctx.httpFetch))
    ctx.registerTool(startSessionTool(ctx.httpFetch))
    ctx.registerTool(listSessionsTool(ctx.httpFetch))
    ctx.registerTool(sessionStatusTool(ctx.httpFetch))
    ctx.registerTool(finishSessionTool(ctx.httpFetch))
    ctx.registerTool(cancelSessionTool(ctx.httpFetch))
    ctx.registerTool(answerPermissionTool(ctx.httpFetch))
    ctx.logInfo({}, 'acp plugin activated')
  },
})

export default factory
