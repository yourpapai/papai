// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getLatestCachedToolsForContext } from '../cache.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getContextSettings } from '../instances/context-store.js'
import { getPlatformInstance } from '../instances/platform-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { resolveLlmConfig } from '../llm-providers/resolver.js'
import { logger } from '../logger.js'
import { mcpPool } from '../mcp/client-pool.js'
import { registry } from '../message-queue/index.js'
import type { MakeToolsOptions } from './types.js'

const log = logger.child({ scope: 'tool:run-diagnostics' })

export type DiagnosticsLlmConfigStatus = 'central' | 'byok' | 'unconfigured'

export type DiagnosticsTaskInstanceSummary =
  | Readonly<{ status: 'not_configured' }>
  | Readonly<{ status: 'configured'; id: string; type: string }>

/** Per-field marker when a probe fails; the tool itself never throws. */
export const PROBE_ERROR = 'probe_error' as const

export type DiagnosticsDeps = Partial<
  Readonly<{
    platformInstanceActive: (platformInstanceId: string) => boolean
    taskInstance: () => { id: string; type: string } | null
    llmConfig: () => DiagnosticsLlmConfigStatus
    mcpPool: () => { serverCount: number; healthyCount: number }
    queueCount: () => number
    descriptorCachePresent: () => boolean
    uptimeSeconds: () => number
  }>
>

const defaultTaskInstance = (configContextId: string): { id: string; type: string } | null => {
  const settings = getContextSettings(configContextId)
  const instance = getTaskInstance(settings?.taskInstanceId ?? null)
  return instance === null ? null : { id: instance.id, type: instance.type }
}

const defaultLlmConfig = (configContextId: string): DiagnosticsLlmConfigStatus => {
  const resolved = resolveLlmConfig(configContextId)
  if (!resolved.ok) return 'unconfigured'
  return resolved.main.source === 'global' ? 'central' : 'byok'
}

const defaultMcpPool = (): { serverCount: number; healthyCount: number } => {
  const infos = mcpPool.getServerInfos()
  return { serverCount: infos.length, healthyCount: infos.filter((i) => i.status === 'connected').length }
}

const defaultQueueCount = (): number => registry.getAllQueues().size

const defaultUptimeSeconds = (): number => Math.floor(process.uptime())

const defaultDescriptorCachePresent = (storageContextId: string): boolean =>
  storageContextId !== '' && getLatestCachedToolsForContext(storageContextId) !== undefined

const resolveDeps = (
  deps: DiagnosticsDeps,
  configContextId: string,
  storageContextId: string,
): Required<DiagnosticsDeps> => ({
  platformInstanceActive:
    deps.platformInstanceActive ??
    ((platformInstanceId) => getPlatformInstance(platformInstanceId)?.status === 'active'),
  taskInstance: deps.taskInstance ?? (() => defaultTaskInstance(configContextId)),
  llmConfig: deps.llmConfig ?? (() => defaultLlmConfig(configContextId)),
  mcpPool: deps.mcpPool ?? defaultMcpPool,
  queueCount: deps.queueCount ?? defaultQueueCount,
  descriptorCachePresent: deps.descriptorCachePresent ?? (() => defaultDescriptorCachePresent(storageContextId)),
  uptimeSeconds: deps.uptimeSeconds ?? defaultUptimeSeconds,
})

/** Runs one probe; a throwing probe degrades to the per-field error marker. */
function runProbe<T>(probe: () => T): T | typeof PROBE_ERROR {
  try {
    return probe()
  } catch {
    log.warn({ tool: 'run_diagnostics' }, 'Diagnostics probe failed')
    return PROBE_ERROR
  }
}

const summarizeTaskInstance = (
  probe: () => { id: string; type: string } | null,
): DiagnosticsTaskInstanceSummary | typeof PROBE_ERROR => {
  const resolved = runProbe(probe)
  if (resolved === PROBE_ERROR) return PROBE_ERROR
  if (resolved === null) return { status: 'not_configured' }
  return { status: 'configured', id: resolved.id, type: resolved.type }
}

/**
 * Read-only runtime health snapshot for bot admins. Returns only whitelisted
 * count/boolean/enum/duration fields — never tokens, config bodies, or
 * credential-bearing values, neither in the result nor in log output.
 */
export function makeRunDiagnosticsTool(
  platformInstanceId: string,
  deps: DiagnosticsDeps = {},
  configContextId = '',
  storageContextId = '',
): Tool {
  const resolved = resolveDeps(deps, configContextId, storageContextId)
  return tool({
    description:
      'Run a read-only bot health diagnostics snapshot: platform instance state, task instance configuration, LLM config resolution, MCP pool health, message queue depth, tool descriptor cache presence, and uptime. Admin-only; returns no secrets.',
    inputSchema: z.object({}),
    execute: () => {
      const taskInstance = summarizeTaskInstance(resolved.taskInstance)
      const result = {
        platform_instance_active: runProbe(() => resolved.platformInstanceActive(platformInstanceId)),
        task_instance: taskInstance,
        llm_config: runProbe(resolved.llmConfig),
        mcp_pool: runProbe(resolved.mcpPool),
        queue_count: runProbe(resolved.queueCount),
        descriptor_cache_present: runProbe(resolved.descriptorCachePresent),
        uptime_seconds: runProbe(resolved.uptimeSeconds),
      }
      log.info({ tool: 'run_diagnostics', platformInstanceId }, 'Diagnostics snapshot collected')
      return Promise.resolve(result)
    },
  })
}

/**
 * Adds diagnostics tools to a descriptor set. Fails closed: the tool is only
 * assembled for a bot admin in a DM, in normal mode.
 */
export function maybeAddDiagnosticsTools(tools: Record<string, Tool>, options: MakeToolsOptions): void {
  // `mode` is optional and defaults to 'normal' (MakeToolsOptions); the
  // orchestrator descriptor-cache path omits it, so normalize before gating.
  const mode = options.mode ?? 'normal'
  if (options.isBotAdmin !== true || options.contextType !== 'dm' || mode !== 'normal') return
  const configContextId =
    options.storageContextId === undefined ? '' : getConfigContextIdFromStorageContextId(options.storageContextId)
  tools['run_diagnostics'] = makeRunDiagnosticsTool(
    options.platformInstanceId ?? '',
    {},
    configContextId,
    options.storageContextId ?? '',
  )
}
