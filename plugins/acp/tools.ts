// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { asObject, callMagi, NOT_CONFIGURED, optionalString, readMagiConfig } from './client.js'
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
  codingSecrets: {
    resolve(): Record<string, string> | null
    resolveForgeToken(): string | null
    resolveAgent(): string | null
    resolveForge(): { kind: 'github' | 'gitlab'; apiBaseUrl: string } | null
    resolveProviderHost(): string | null
    resolveModel(): string | null
    resolveMcpServers():
      | {
          ok: true
          servers: Array<{
            id: string
            url: string
            host: string
            header: string
            allowedHosts: string[]
            toolPolicy?: { default: 'allow' | 'ask' | 'deny'; tools?: Record<string, 'allow' | 'ask' | 'deny'> }
          }>
        }
      | { ok: false; error: string }
    resolveMcpTokens(): Record<string, string>
  }
  codingRepos: {
    list(): { name: string; baseBranch: string }[]
    get(name: string): {
      name: string
      repoUrl: string
      baseBranch: string
      permissionPreset: string
      additionalEgressDomains?: string[]
    } | null
  }
  transcript: {
    mintUrl(magiSessionId: string): string | null
  }
}
type ToolExecute = (input: unknown, runtimeContext: RuntimeContext, options: unknown) => Promise<unknown>
export type Tool = { name: string; description: string; inputSchema: unknown; execute: ToolExecute }

export type RepoEntry = {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  additionalEgressDomains?: string[]
}

export function sessionIdOf(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const map: Map<string, unknown> = new Map(Object.entries(result))
  const id = map.get('id')
  return typeof id === 'string' && id.length > 0 ? id : null
}

export function shareFieldsOf(result: unknown): { shareToken?: string; transcriptUrl?: string } {
  const row = asObject(result)
  const shareToken = optionalString(row, 'shareToken')
  const transcriptUrl = optionalString(row, 'transcriptUrl')
  return {
    ...(shareToken === undefined ? {} : { shareToken }),
    ...(transcriptUrl === undefined ? {} : { transcriptUrl }),
  }
}

// Mints a papai transcript URL for a freshly-started/continued magi session (via
// runtimeContext.transcript.mintUrl) and merges it into the magi result, so callers get
// transcriptUrl regardless of whether magi's own response already carried one. Returns `result`
// unchanged when there's no session id or mintUrl declines (no public base URL/permission).
export function withMintedTranscriptUrl(runtimeContext: RuntimeContext, result: unknown): unknown {
  const sessionId = sessionIdOf(result)
  const mintedUrl = sessionId === null ? null : runtimeContext.transcript.mintUrl(sessionId)
  return mintedUrl === null ? result : { ...asObject(result), transcriptUrl: mintedUrl }
}

// magi auto-derives a forge for these SaaS hosts; any other host needs an
// explicit Code host config or magi rejects the session at intake.
export function canDeriveForge(repoUrl: string): boolean {
  try {
    const host = new URL(repoUrl).host
    return host === 'github.com' || host === 'gitlab.com'
  } catch {
    return false
  }
}

export function buildProjectSpec(
  repo: RepoEntry,
  agent: string,
): {
  name: string
  repoUrl: string
  baseBranch: string
  permissionPreset: string
  agent: string
  additionalEgressDomains?: string[]
} {
  const extra = repo.additionalEgressDomains ?? []
  return {
    name: repo.name,
    repoUrl: repo.repoUrl,
    baseBranch: repo.baseBranch,
    permissionPreset: repo.permissionPreset,
    agent,
    ...(extra.length > 0 ? { additionalEgressDomains: extra } : {}),
  }
}

export type McpUpstream = {
  id: string
  url: string
  host: string
  header: string
  allowedHosts: string[]
  toolPolicy?: { default: 'allow' | 'ask' | 'deny'; tools?: Record<string, 'allow' | 'ask' | 'deny'> }
}

export function buildSessionProjectSpec(
  repo: RepoEntry,
  agent: string,
  codingSecrets: RuntimeContext['codingSecrets'],
  mcpServers: McpUpstream[],
): Record<string, unknown> {
  const base = buildProjectSpec(repo, agent)
  const forge = codingSecrets.resolveForge()
  const providerHost = codingSecrets.resolveProviderHost()
  const model = codingSecrets.resolveModel()
  return {
    ...base,
    ...(forge === null ? {} : { forge }),
    ...(providerHost === null ? {} : { providerHost }),
    ...(model === null ? {} : { model }),
    ...(mcpServers.length === 0 ? {} : { mcp: mcpServers }),
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
