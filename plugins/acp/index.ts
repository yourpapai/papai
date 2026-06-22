// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { callMagi, NOT_CONFIGURED, readMagiConfig } from './client.js'
import type { HttpFetch } from './client.js'
import { emptySchema } from './schemas.js'

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
    ctx.logInfo({}, 'acp plugin activated')
  },
})

export default factory
