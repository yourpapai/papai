import { getSessionSnapshots } from '../cache-snapshots.js'
import { getPollerSnapshot } from '../deferred-prompts/poller.js'
import { getMessageCacheSnapshot } from '../message-cache/cache.js'
import { getSchedulerSnapshot } from '../scheduler.js'
import { getWizardSnapshots } from '../wizard/state.js'
import { subscribe, unsubscribe, type DebugEvent, type Scope } from './event-bus.js'
import { str, num, bool, tokenUsage, parseStepsDetail } from './state-collector-utils.js'
import { recentTurns, recentNotifications, recentToolFailures, handleTurnAssembly } from './turn-assembly.js'

export { recentTurns, recentNotifications, recentToolFailures } from './turn-assembly.js'
export { inFlightTurns, resetTurnBuffers, findTurnById } from './turn-assembly.js'
export { getRecentTurns, getRecentNotifications, getRecentToolFailures, getInFlightTurns } from './turn-assembly.js'

let adminUserId: string | null = null
let adminVisibility: AdminVisibility = { adminUserId: '', groupIds: new Set() }

const clients = new Set<ReadableStreamDefaultController>()
const encoder = new TextEncoder()

export const stats = {
  startedAt: Date.now(),
  totalMessages: 0,
  totalLlmCalls: 0,
  totalToolCalls: 0,
}

const LLM_TRACE_CAPACITY = 65535
type LlmTraceToolCall = {
  toolName: string
  durationMs: number
  success: boolean
  toolCallId: string | undefined
  args: unknown
  result: unknown
  error: string | undefined
}

type LlmTrace = {
  timestamp: number
  userId: string
  model: string
  steps: number
  totalTokens: { inputTokens: number; outputTokens: number }
  duration: number
  toolCalls: Array<LlmTraceToolCall>
  error: string | undefined
  responseId: string | undefined
  actualModel: string | undefined
  finishReason: string | undefined
  messageCount: number | undefined
  toolCount: number | undefined
  exposedToolCount: number | undefined
  fullToolCount: number | undefined
  toolSchemaBytes: number | undefined
  routingIntent: string | undefined
  routingConfidence: number | undefined
  routingReason: string | undefined
  generatedText: string | undefined
  stepsDetail: ReturnType<typeof parseStepsDetail>
}

export const recentLlm: LlmTrace[] = []

type PendingLlmTrace = {
  startTimestamp: number
  userId: string
  model: string
  toolCalls: Array<LlmTraceToolCall>
}

export const pendingTraces = new Map<string, PendingLlmTrace>()

export function init(adminId: string): void {
  adminUserId = adminId
  adminVisibility = { adminUserId: adminId, groupIds: new Set() }
}

export type AdminVisibility = {
  adminUserId: string
  groupIds: ReadonlySet<string>
}

export function isVisibleToAdmin(scope: Scope, vis: AdminVisibility): boolean {
  if (scope === null || scope === undefined || typeof scope.kind !== 'string') return false
  if (scope.kind === 'global') return true
  if (scope.kind === 'user') return scope.userId === vis.adminUserId
  if (scope.kind === 'group') return vis.groupIds.has(scope.groupId)
  return false
}

export function applyVisibility<T>(entries: T[], getScope: (entry: T) => Scope, vis: AdminVisibility): T[] {
  return entries.filter((entry) => isVisibleToAdmin(getScope(entry), vis))
}

export function addClient(controller: ReadableStreamDefaultController): void {
  clients.add(controller)

  const initData: Record<string, unknown> = {
    sessions: adminUserId === null ? [] : getSessionSnapshots(adminUserId),
    wizards: adminUserId === null ? [] : getWizardSnapshots(adminUserId),
    scheduler: getSchedulerSnapshot(),
    pollers: getPollerSnapshot(),
    messageCache: getMessageCacheSnapshot(),
    stats,
    recentLlm,
    recentTurns,
    recentNotifications,
    recentToolFailures,
  }

  sendTo(controller, { type: 'state:init', timestamp: Date.now(), data: initData, __scope: { kind: 'global' } })

  if (clients.size === 1) {
    subscribe(onEvent)
  }
}

export function removeClient(controller: ReadableStreamDefaultController): void {
  clients.delete(controller)

  if (clients.size === 0) {
    unsubscribe(onEvent)
  }
}

let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleStatsBroadcast(): void {
  if (statsDebounceTimer !== null) return
  statsDebounceTimer = setTimeout(() => {
    statsDebounceTimer = null
    broadcast({ type: 'state:stats', timestamp: Date.now(), data: { ...stats }, __scope: { kind: 'global' } })
  }, 500)
}

function pushTrace(trace: LlmTrace): void {
  if (recentLlm.length >= LLM_TRACE_CAPACITY) recentLlm.shift()
  recentLlm.push(trace)
}

function broadcastTrace(trace: LlmTrace, timestamp: number): void {
  broadcast({ type: 'llm:full', timestamp, data: { ...trace }, __scope: { kind: 'global' } })
}

function handleLlmStart(event: DebugEvent, userId: string): void {
  pendingTraces.set(userId, {
    startTimestamp: event.timestamp,
    userId,
    model: str(event.data['model']),
    toolCalls: [],
  })
}

function buildTraceToolCall(event: DebugEvent): LlmTraceToolCall {
  return {
    toolName: str(event.data['toolName']),
    durationMs: num(event.data['durationMs']),
    success: bool(event.data['success']),
    toolCallId: str(event.data['toolCallId']),
    args: event.data['args'],
    result: event.data['result'],
    error: str(event.data['error']),
  }
}

function handleLlmToolResult(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  if (pending !== undefined) {
    pending.toolCalls.push(buildTraceToolCall(event))
  }
  stats.totalToolCalls++
  scheduleStatsBroadcast()
}

function getPendingModel(pending: PendingLlmTrace | undefined, event: DebugEvent): string {
  if (pending === undefined) {
    return str(event.data['model'])
  }
  return pending.model
}

function getPendingToolCalls(pending: PendingLlmTrace | undefined): Array<LlmTraceToolCall> {
  if (pending === undefined) {
    return []
  }
  return pending.toolCalls
}

function handleLlmEnd(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  pendingTraces.delete(userId)

  const trace: LlmTrace = {
    timestamp: event.timestamp,
    userId,
    model: getPendingModel(pending, event),
    steps: num(event.data['steps']),
    totalTokens: tokenUsage(event.data['tokenUsage']),
    duration: num(event.data['totalDuration']),
    toolCalls: getPendingToolCalls(pending),
    error: undefined,
    responseId: str(event.data['responseId']),
    actualModel: str(event.data['actualModel']),
    finishReason: str(event.data['finishReason']),
    messageCount: num(event.data['messageCount']),
    toolCount: num(event.data['toolCount']),
    exposedToolCount: num(event.data['exposedToolCount']),
    fullToolCount: num(event.data['fullToolCount']),
    toolSchemaBytes: num(event.data['toolSchemaBytes']),
    routingIntent: str(event.data['routingIntent']),
    routingConfidence: num(event.data['routingConfidence']),
    routingReason: str(event.data['routingReason']),
    generatedText: str(event.data['generatedText']),
    stepsDetail: parseStepsDetail(event.data['stepsDetail']),
  }

  pushTrace(trace)
  stats.totalLlmCalls++
  scheduleStatsBroadcast()
  broadcastTrace(trace, event.timestamp)
}

function handleLlmError(event: DebugEvent, userId: string): void {
  const pending = pendingTraces.get(userId)
  pendingTraces.delete(userId)
  const duration = pending === undefined ? 0 : event.timestamp - pending.startTimestamp
  const trace: LlmTrace = {
    timestamp: event.timestamp,
    userId,
    model: getPendingModel(pending, event),
    steps: 0,
    totalTokens: { inputTokens: 0, outputTokens: 0 },
    duration,
    toolCalls: getPendingToolCalls(pending),
    error: str(event.data['error']),
    responseId: undefined,
    actualModel: undefined,
    finishReason: undefined,
    messageCount: undefined,
    toolCount: undefined,
    exposedToolCount: undefined,
    fullToolCount: undefined,
    toolSchemaBytes: undefined,
    routingIntent: undefined,
    routingConfidence: undefined,
    routingReason: undefined,
    generatedText: undefined,
    stepsDetail: undefined,
  }
  pushTrace(trace)
  broadcastTrace(trace, event.timestamp)
}

function handleLlmTraceAccumulation(event: DebugEvent): void {
  const userId = str(event.data['userId'])

  if (event.type === 'llm:start') handleLlmStart(event, userId)
  else if (event.type === 'llm:tool_result') handleLlmToolResult(event, userId)
  else if (event.type === 'llm:end') handleLlmEnd(event, userId)
  else if (event.type === 'llm:error') handleLlmError(event, userId)
}

function handleStatsUpdate(event: DebugEvent): void {
  if (event.type === 'message:received') {
    stats.totalMessages++
    scheduleStatsBroadcast()
  }
}

function onEvent(event: DebugEvent): void {
  if (!isVisibleToAdmin(event.__scope, adminVisibility)) return
  handleLlmTraceAccumulation(event)
  handleStatsUpdate(event)
  handleTurnAssembly(event, broadcast)
  broadcast(event)
}

function broadcast(event: DebugEvent): void {
  const payload = formatSse(event)
  for (const client of clients) {
    try {
      client.enqueue(payload)
    } catch {
      clients.delete(client)
    }
  }
}

function sendTo(controller: ReadableStreamDefaultController, event: DebugEvent): void {
  try {
    controller.enqueue(formatSse(event))
  } catch {
    clients.delete(controller)
  }
}

function formatSse(event: DebugEvent): Uint8Array {
  return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}
