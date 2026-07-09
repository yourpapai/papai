// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import type { RuntimeContext } from '../../../../src/modules/coding/acp/tools.js'

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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
            repoUrl: 'https://github.com/acme/demo.git',
            baseBranch: 'main',
            permissionPreset: 'cautious',
          }
        : null,
  }
}

export function runtimeCtx(
  adminGet?: (k: string) => string | undefined,
  codingRepos?: FakeCodingRepos,
): RuntimeContext {
  return {
    storageContextId: 'ctx-1',
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    adminConfig: {
      get:
        adminGet ??
        ((k: string) => (k === 'magi_base_url' ? 'http://magi:8787' : k === 'magi_token' ? 'tok' : undefined)),
    },
    codingSecrets: {
      resolve: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
      resolveForgeToken: () => 'ghp-test',
      resolveAgent: () => null,
      resolveForge: () => null,
      resolveProviderHost: () => null,
      resolveModel: () => null,
      resolveMcp: () => null,
      resolveMcpToken: () => undefined,
    },
    codingRepos: codingRepos ?? defaultCodingRepos(),
  }
}

export function runtimeCtxWithKv(
  store: Map<string, string>,
  adminGet?: (k: string) => string | undefined,
  codingRepos?: FakeCodingRepos,
): RuntimeContext {
  return {
    storageContextId: 'ctx-1',
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
    codingSecrets: {
      resolve: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
      resolveForgeToken: () => 'ghp-test',
      resolveAgent: () => null,
      resolveForge: () => null,
      resolveProviderHost: () => null,
      resolveModel: () => null,
      resolveMcp: () => null,
      resolveMcpToken: () => undefined,
    },
    codingRepos: codingRepos ?? defaultCodingRepos(),
  }
}

export function options(): ToolExecutionOptions {
  return { toolCallId: 'c1', messages: [] }
}
