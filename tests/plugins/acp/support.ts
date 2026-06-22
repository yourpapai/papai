// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import factory from '../../../plugins/acp/index.js'
import type { PluginContext } from '../../../src/plugins/context.js'
import type { PluginTool, PluginToolRuntimeContext } from '../../../src/plugins/types.js'

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function activate(httpFetch: HttpFetch): Map<string, PluginTool> {
  const tools = new Map<string, PluginTool>()
  const ctx = {
    pluginId: 'acp',
    contextId: '__system__',
    permissions: new Set(['http', 'storage', 'commands']),
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registration: {
      registerTool: (t: PluginTool) => {
        tools.set(t.name, t)
      },
      registerPromptFragment: () => {},
      registerCommand: () => {},
      registerScheduledJob: () => {},
      registerAttachmentTransformer: () => {},
      registerTaskProviderType: () => {},
    },
    providerRuntime: {
      httpFetch,
      allowedHosts: new Set<string>(),
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    },
    adminConfig: { get: () => undefined },
  } as PluginContext
  factory().activate(ctx)
  return tools
}

export function runtimeCtx(adminGet?: (k: string) => string | undefined): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))
  return {
    pluginId: 'acp',
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    adminConfig: {
      get:
        adminGet ??
        ((k: string) => (k === 'magi_base_url' ? 'http://magi:8787' : k === 'magi_token' ? 'tok' : undefined)),
    },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: { read: () => notImplemented() },
  } as PluginToolRuntimeContext
}

export function runtimeCtxWithKv(
  store: Map<string, string>,
  adminGet?: (k: string) => string | undefined,
): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))
  return {
    pluginId: 'acp',
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    kv: {
      get: (key: string) => store.get(key),
      set: (key: string, value: string) => {
        store.set(key, value)
      },
      delete: (key: string) => {
        store.delete(key)
      },
      list: (prefix?: string) =>
        prefix === undefined
          ? Array.from(store.entries()).map(([key, value]) => ({ key, value }))
          : Array.from(store.entries())
              .filter(([key]) => key.startsWith(prefix))
              .map(([key, value]) => ({ key, value })),
    },
    adminConfig: {
      get:
        adminGet ??
        ((k: string) => (k === 'magi_base_url' ? 'http://magi:8787' : k === 'magi_token' ? 'tok' : undefined)),
    },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: { read: () => notImplemented() },
  } as PluginToolRuntimeContext
}

export function options(): ToolExecutionOptions {
  return { toolCallId: 'c1', messages: [] }
}
