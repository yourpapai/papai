// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  asObject,
  asPositiveInt,
  asString,
  callMagi,
  NOT_CONFIGURED,
  optionalString,
  readMagiConfig,
} from './client.js'
import type { HttpFetch } from './client.js'
import {
  answerPermissionSchema,
  finishSessionSchema,
  listSessionsSchema,
  sessionIdSchema,
  startSessionSchema,
} from './schemas.js'
import { enrichSession, recordStartedSession } from './session-records.js'
import type { RuntimeContext, Tool } from './tools.js'
import { ACP_CAPABILITIES, buildSessionProjectSpec, canDeriveForge, sessionIdOf } from './tools.js'

const DEFAULT_AGENT = 'claude-code-acp'
const SESSION_FILTERS = ['new', 'active', 'waiting', 'done']
const DEFAULT_FINISH_MESSAGE = 'Apply changes from magi coding session'

type StartSessionAccess =
  | { error: string; message: string }
  | { secrets: Record<string, string>; forgeToken: string | null; resolvedAgent: string }

function resolveStartSessionAccess(
  repo: { repoUrl: string },
  codingSecrets: RuntimeContext['codingSecrets'],
  prNumber: number | null,
): StartSessionAccess {
  const secrets = codingSecrets.resolve()
  if (secrets === null)
    return {
      error: 'not_configured',
      message:
        "You haven't set up your coding credentials. DM me and open settings → Coding sessions to configure your AI provider key (and code host).",
    }
  const forgeToken = codingSecrets.resolveForgeToken()
  const resolvedAgent = codingSecrets.resolveAgent() ?? 'claude'
  if (codingSecrets.resolveForge() === null && !canDeriveForge(repo.repoUrl))
    return {
      error: 'not_configured',
      message:
        'This repository is on a self-hosted code host. Open settings → Coding sessions and set your Code host (kind, instance URL, and token) before starting a session.',
    }
  if (prNumber !== null && forgeToken === null)
    return {
      error: 'not_configured',
      message:
        "You haven't connected your code host. DM me and open settings → Coding sessions to add your code host token before starting a session on a PR.",
    }
  return { secrets, forgeToken, resolvedAgent }
}

export function startSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'start_session',
    capabilityId: ACP_CAPABILITIES.start,
    gate: 'operator',
    description:
      'Start a sandboxed coding-agent session on a configured project. Pass prNumber to start on an ' +
      'existing PR/MR (to review it or work on its branch); the project permission policy decides whether ' +
      'the agent can edit and push back.',
    inputSchema: startSessionSchema,
    execute: async (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return NOT_CONFIGURED
      const args = asObject(input)
      const project = asString(args, 'project')
      const prompt = asString(args, 'prompt')
      const prNumber = asPositiveInt(args, 'prNumber')
      if (project === null || prompt === null)
        return { error: 'invalid_input', message: 'project and prompt are required' }
      const repo = runtimeContext.codingRepos.get(project)
      if (repo === null)
        return {
          error: 'not_found',
          message: `No repository named "${project}". Add it in settings → Repositories.`,
        }
      const agent = optionalString(args, 'agent') ?? DEFAULT_AGENT
      const access = resolveStartSessionAccess(repo, runtimeContext.codingSecrets, prNumber)
      if ('error' in access) return access
      const { secrets, forgeToken, resolvedAgent } = access
      const mcpResult = runtimeContext.codingSecrets.resolveMcpServers()
      if (!mcpResult.ok) {
        return { error: 'mcp_unavailable', message: mcpResult.error }
      }
      const projectSpec = buildSessionProjectSpec(repo, resolvedAgent, runtimeContext.codingSecrets, mcpResult.servers)
      const mcpTokens = runtimeContext.codingSecrets.resolveMcpTokens()
      const result = await callMagi(httpFetch, cfg, 'POST', '/sessions', {
        agent,
        contextId: runtimeContext.storageContextId,
        prompt,
        secrets,
        ...(forgeToken === null ? {} : { forgeToken }),
        ...(prNumber === null ? {} : { prNumber }),
        projectSpec,
        ...(Object.keys(mcpTokens).length === 0 ? {} : { mcpTokens }),
      })
      recordStartedSession(runtimeContext, result, project, prompt, prNumber ?? undefined)
      return result
    },
  }
}

export function listSessionsTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'list_sessions',
    capabilityId: ACP_CAPABILITIES.list,
    description: 'List coding sessions started from this chat (filter: new|active|waiting|done).',
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
      return result
        .filter((s): boolean => {
          const sid = sessionIdOf(s)
          return sid !== null && known.has(sid)
        })
        .map((s): unknown => enrichSession(runtimeContext, s))
    },
  }
}

export function sessionStatusTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'session_status',
    capabilityId: ACP_CAPABILITIES.status,
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

export function finishSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'finish_session',
    capabilityId: ACP_CAPABILITIES.finish,
    gate: 'operator',
    description: 'Finish a session: commit + push the branch, or open a PR.',
    inputSchema: finishSessionSchema,
    execute: (input: unknown, runtimeContext: RuntimeContext): Promise<unknown> => {
      const cfg = readMagiConfig(runtimeContext.adminConfig)
      if (cfg === null || httpFetch === undefined) return Promise.resolve(NOT_CONFIGURED)
      const forgeToken = runtimeContext.codingSecrets.resolveForgeToken()
      if (forgeToken === null)
        return Promise.resolve({
          error: 'not_configured',
          message: 'Connect a code host in settings → Coding sessions before pushing or opening a PR.',
        })
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
      const payload = {
        ...Object.fromEntries(Object.entries(bodyFields).filter(([, v]) => v !== undefined)),
        forgeToken,
      }
      return callMagi(httpFetch, cfg, 'POST', `/sessions/${encodeURIComponent(sessionId)}/finish`, payload)
    },
  }
}

export function cancelSessionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'cancel_session',
    capabilityId: ACP_CAPABILITIES.cancel,
    gate: 'operator',
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

export function answerPermissionTool(httpFetch: HttpFetch | undefined): Tool {
  return {
    name: 'answer_permission',
    capabilityId: ACP_CAPABILITIES.answerPermission,
    gate: 'operator',
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
