// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type HttpFetch = (url: string, init: RequestInit | undefined) => Promise<Response>

export type PluginToolRuntimeContextLike = {
  chatUserId: string
  storageContextId: string
  adminConfig: {
    get(key: string): string | undefined
  }
  contextConfig: {
    get(key: string): string | undefined
  }
  rateLimit: {
    check(actorId: string): { allowed: boolean; retryAfterSec?: number }
  }
}

type RegisteredToolLike = {
  name: string
  description: string
  execute: (
    input: unknown,
    runtimeContext: PluginToolRuntimeContextLike,
    options: { abortSignal: AbortSignal | undefined },
  ) => Promise<unknown>
  [key: string]: unknown
}

export type PluginContextLike = {
  log: {
    info(data: Record<string, unknown>, message: string): void
  }
  registration: {
    registerTool(tool: RegisteredToolLike): void
    registerPromptFragment(fragment: { name: string; content: string | (() => string) }): void
  }
} & Partial<{ providerRuntime: { httpFetch: HttpFetch | undefined } }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (isRecord(value)) return value
  throw new Error(message)
}

function isHttpFetch(value: unknown): value is HttpFetch {
  return typeof value === 'function'
}

function isInfoLogger(value: unknown): value is PluginContextLike['log']['info'] {
  return typeof value === 'function'
}

function isRegisterTool(value: unknown): value is PluginContextLike['registration']['registerTool'] {
  return typeof value === 'function'
}

function isRegisterPromptFragment(
  value: unknown,
): value is PluginContextLike['registration']['registerPromptFragment'] {
  return typeof value === 'function'
}

export function requirePluginContext(ctx: unknown): PluginContextLike {
  const context = requireRecord(ctx, 'plugin context must be an object')
  const log = requireRecord(context['log'], 'plugin context log must be an object')
  const registration = requireRecord(context['registration'], 'plugin context registration must be an object')
  const providerRuntime = context['providerRuntime']

  if (!isInfoLogger(log['info'])) {
    throw new Error('plugin context logger.info must be a function')
  }
  if (!isRegisterTool(registration['registerTool'])) {
    throw new Error('plugin context registerTool must be a function')
  }
  if (!isRegisterPromptFragment(registration['registerPromptFragment'])) {
    throw new Error('plugin context registerPromptFragment must be a function')
  }

  return {
    log: {
      info: log['info'],
    },
    registration: {
      registerTool: registration['registerTool'],
      registerPromptFragment: registration['registerPromptFragment'],
    },
    ...(isRecord(providerRuntime)
      ? {
          providerRuntime: {
            httpFetch: isHttpFetch(providerRuntime['httpFetch']) ? providerRuntime['httpFetch'] : undefined,
          },
        }
      : {}),
  }
}
