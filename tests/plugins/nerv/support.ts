// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import factory from '../../../plugins/nerv/index.js'
import type { PluginContext } from '../../../src/plugins/context.js'
import type {
  PluginCommand,
  PluginPromptFragment,
  PluginTool,
  PluginToolRuntimeContext,
} from '../../../src/plugins/types.js'

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

export type ActivateResult = {
  tools: Map<string, PluginTool>
  command: PluginCommand | undefined
  fragment: PluginPromptFragment | undefined
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export function activate(httpFetch: HttpFetch, adminConfig?: { get(key: string): string | undefined }): ActivateResult {
  const tools = new Map<string, PluginTool>()
  let command: PluginCommand | undefined
  let fragment: PluginPromptFragment | undefined
  const ctx = {
    pluginId: 'nerv',
    contextId: '__system__',
    permissions: new Set(['http', 'storage', 'commands', 'coding.secrets']),
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    registration: {
      registerTool: (t: PluginTool) => {
        tools.set(t.name, t)
      },
      registerPromptFragment: (f: PluginPromptFragment) => {
        fragment = f
      },
      registerCommand: (c: PluginCommand) => {
        command = c
      },
      registerScheduledJob: () => {},
      registerAttachmentTransformer: () => {},
      registerTaskProviderType: () => {},
    },
    providerRuntime: {
      httpFetch,
      allowedHosts: new Set<string>(),
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    },
    adminConfig: adminConfig ?? { get: (): undefined => undefined },
  } as PluginContext
  factory().activate(ctx)
  return { tools, command, fragment }
}

export type FakeCodingRepos = {
  list(): { name: string; baseBranch: string }[]
  get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
}

export function defaultCodingRepos(): FakeCodingRepos {
  return {
    list: () => [{ name: 'demo', baseBranch: 'main' }],
    get: (name: string) =>
      name === 'demo'
        ? {
            name: 'demo',
            repoUrl: 'https://gitlab.com/acme/demo.git',
            baseBranch: 'main',
            permissionPreset: 'cautious',
          }
        : name === 'gh'
          ? {
              name: 'gh',
              repoUrl: 'https://github.com/acme/demo.git',
              baseBranch: 'main',
              permissionPreset: 'cautious',
            }
          : null,
  }
}

export function runtimeCtx(store: Map<string, string>, codingRepos?: FakeCodingRepos): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))
  return {
    pluginId: 'nerv',
    storageContextId: 'pi:aW5zdA:ctx:Y2hhbg:thread:dDE',
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
        Array.from(store.entries())
          .filter(([key]) => prefix === undefined || key.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
    },
    adminConfig: {
      get: (k: string) => (k === 'nerv_base_url' ? 'http://nerv:9000' : k === 'nerv_token' ? 'tok' : undefined),
    },
    contextConfig: { get: () => undefined },
    rateLimit: { check: () => ({ allowed: true }) },
    attachments: { read: () => notImplemented() },
    codingSecrets: {
      resolve: () => null,
      resolveForgeToken: () => null,
      resolveAgent: () => null,
      resolveForge: () => null,
      resolveProviderHost: () => null,
      resolveModel: () => null,
      resolveMcpServers: () => ({ ok: true, servers: [] }),
      resolveMcpTokens: () => ({}),
    },
    codingRepos: codingRepos ?? defaultCodingRepos(),
  }
}

export function options(): ToolExecutionOptions {
  return { toolCallId: 'c1', messages: [] }
}
