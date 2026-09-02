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
import { makeReadLlmTracesTool } from './diagnostics-llm-traces.js'
import { makeReadRecentLogsTool } from './diagnostics-logs.js'
import { makeReadRecentToolFailuresTool } from './diagnostics-tool-failures.js'
import { makeReadRecentTurnsTool } from './diagnostics-turns.js'
import { makeRunProofCheckTool } from './proof-check-run.js'
import { makeReadProofResultsTool } from './proof-checks-read.js'
import { toolErrorClass } from './tool-logging.js'
import type { MakeToolsOptions } from './types.js'

const log = logger.child({ scope: 'tool:run-diagnostics' })

export type DiagnosticsLlmConfigStatus = 'central' | 'byok' | 'unconfigured'

export type DiagnosticsTaskInstanceSummary =
  | Readonly<{ status: 'not_configured' }>
  | Readonly<{ status: 'configured'; id: string; type: string }>

/** Per-field marker when a probe fails; the tool itself never throws. */
export const PROBE_ERROR = 'probe_error' as const

/** Buffer-wide volatility stats carried by every diagnostics reader result. */
export type BufferStats = {
  count: number
  capacity: number
  oldest: number | null
  newest: number | null
}

/**
 * Derives the reader family's shared buffer stats structurally from a
 * tail-buffer snapshot: element count, the fixed capacity constant, and the
 * first and last elements' timestamps.
 */
export function tailStats<T>(xs: readonly T[], capacity: number, at: (x: T) => number): BufferStats {
  return {
    count: xs.length,
    capacity,
    oldest: xs.length > 0 ? at(xs[0]!) : null,
    newest: xs.length > 0 ? at(xs[xs.length - 1]!) : null,
  }
}

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

/**
 * Runs one probe; a throwing probe degrades to the per-field error marker.
 * Shared by `run_diagnostics` and the reader family — `tool` labels the
 * calling tool in the warn metadata.
 */
export function runProbe<T>(toolName: string, field: string, probe: () => T): T | typeof PROBE_ERROR {
  try {
    return probe()
  } catch (error) {
    log.warn({ tool: toolName, field, errorClass: toolErrorClass(error) }, 'Diagnostics probe failed')
    return PROBE_ERROR
  }
}

const summarizeTaskInstance = (
  probe: () => { id: string; type: string } | null,
): DiagnosticsTaskInstanceSummary | typeof PROBE_ERROR => {
  const resolved = runProbe('run_diagnostics', 'task_instance', probe)
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
        platform_instance_active: runProbe('run_diagnostics', 'platform_instance_active', () =>
          resolved.platformInstanceActive(platformInstanceId),
        ),
        task_instance: taskInstance,
        llm_config: runProbe('run_diagnostics', 'llm_config', resolved.llmConfig),
        mcp_pool: runProbe('run_diagnostics', 'mcp_pool', resolved.mcpPool),
        queue_count: runProbe('run_diagnostics', 'queue_count', resolved.queueCount),
        descriptor_cache_present: runProbe(
          'run_diagnostics',
          'descriptor_cache_present',
          resolved.descriptorCachePresent,
        ),
        uptime_seconds: runProbe('run_diagnostics', 'uptime_seconds', resolved.uptimeSeconds),
      }
      log.info({ tool: 'run_diagnostics', platformInstanceId }, 'Diagnostics snapshot collected')
      return Promise.resolve(result)
    },
  })
}

/**
 * Adds diagnostics tools to a descriptor set. Fails closed: the tools are only
 * assembled for a bot admin in a DM, in normal mode. The reader family binds
 * `options.chatUserId` as the visibility principal at assembly time — safe
 * because these tools only assemble in the admin's own DM context.
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
  tools['read_recent_logs'] = makeReadRecentLogsTool(options.chatUserId)
  tools['read_llm_traces'] = makeReadLlmTracesTool(options.chatUserId)
  tools['read_recent_turns'] = makeReadRecentTurnsTool(options.chatUserId)
  tools['read_recent_tool_failures'] = makeReadRecentToolFailuresTool(options.chatUserId)
  tools['run_proof_check'] = makeRunProofCheckTool(options.storageContextId ?? '', options.chatUserId ?? '')
  tools['read_proof_results'] = makeReadProofResultsTool()
}
