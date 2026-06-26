// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { callMagi, NOT_CONFIGURED, readMagiConfig } from './client.js'
import type { HttpFetch } from './client.js'
import { emptySchema } from './schemas.js'

type AdminConfigReader = { get(key: string): string | undefined }
type KvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}
export type RuntimeContext = {
  storageContextId: string
  adminConfig: AdminConfigReader
  kv: KvStore
  codingSecrets: { resolve(): Record<string, string> | null; resolveForgeToken(): string | null }
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null
  }
}
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
export type Tool = { name: string; description: string; inputSchema: unknown; execute: ToolExecute }

export type RepoEntry = { name: string; repoUrl: string; baseBranch: string; permissionPreset: string }

export function sessionIdOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const map: Map<string, unknown> = new Map(Object.entries(result))
  const id = map.get('id')
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function buildProjectSpec(repo: RepoEntry): {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
} {
  return {
    name: repo.name,
    repoUrl: repo.repoUrl,
    baseBranch: repo.baseBranch,
    permissionPreset: repo.permissionPreset,
  }
}

export function getTool(name: string, description: string, path: string, httpFetch: HttpFetch | undefined): Tool {
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

export function listProjectsTool(): Tool {
  return {
    name: 'list_projects',
    description: 'List coding projects configured in your repository catalogue.',
    inputSchema: emptySchema,
    execute: (_input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      return Promise.resolve(runtimeContext.codingRepos.list())
    },
  }
}
