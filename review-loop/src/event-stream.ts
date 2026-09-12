// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ToolStatus = 'running' | 'completed' | 'error'

export type OpencodeEvent =
  | { type: 'step_start'; timestamp: number }
  | { type: 'tool_use'; tool: string; callId: string; status: ToolStatus; input: unknown }
  | { type: 'text'; text: string }
  | {
      type: 'step_finish'
      reason: string
      tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }
      cost: number
    }

interface RawPart {
  type?: unknown
  tool?: unknown
  callID?: unknown
  state?: { status?: unknown; input?: unknown }
  text?: unknown
  reason?: unknown
  tokens?: { input?: unknown; output?: unknown; reasoning?: unknown; cache?: { read?: unknown; write?: unknown } }
  cost?: unknown
}

interface RawEvent {
  type?: unknown
  timestamp?: unknown
  part?: RawPart
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizeToolStatus(value: unknown): ToolStatus {
  if (value === 'completed' || value === 'running' || value === 'error') {
    return value
  }
  return 'running'
}

function parseStepStart(rawEvent: RawEvent): OpencodeEvent {
  return { type: 'step_start', timestamp: asNumber(rawEvent.timestamp) }
}

function parseToolUse(rawPart: RawPart): OpencodeEvent | null {
  if (typeof rawPart.tool !== 'string' || typeof rawPart.callID !== 'string') {
    return null
  }
  const state = isObject(rawPart.state) ? rawPart.state : {}
  return {
    type: 'tool_use',
    tool: rawPart.tool,
    callId: rawPart.callID,
    status: normalizeToolStatus(state.status),
    input: state.input ?? {},
  }
}

function parseText(rawPart: RawPart): OpencodeEvent | null {
  if (typeof rawPart.text !== 'string') {
    return null
  }
  return { type: 'text', text: rawPart.text }
}

function parseStepFinish(rawPart: RawPart): OpencodeEvent | null {
  if (typeof rawPart.reason !== 'string') {
    return null
  }
  const tokens = isObject(rawPart.tokens) ? rawPart.tokens : {}
  const cache = isObject(tokens.cache) ? tokens.cache : {}
  return {
    type: 'step_finish',
    reason: rawPart.reason,
    tokens: {
      input: asNumber(tokens.input),
      output: asNumber(tokens.output),
      reasoning: asNumber(tokens.reasoning),
      cacheRead: asNumber(cache.read),
      cacheWrite: asNumber(cache.write),
    },
    cost: asNumber(rawPart.cost),
  }
}

export function parseEventLine(line: string): OpencodeEvent | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(raw)) {
    return null
  }
  const part = (raw as RawEvent).part
  if (!isObject(part)) {
    return null
  }
  const rawEvent = raw as RawEvent
  const rawPart = part as RawPart

  switch (rawEvent.type) {
    case 'step_start':
      return parseStepStart(rawEvent)
    case 'tool_use':
      return parseToolUse(rawPart)
    case 'text':
      return parseText(rawPart)
    case 'step_finish':
      return parseStepFinish(rawPart)
    default:
      return null
  }
}

/**
 * Lift the opencode session id from a raw event line (top-level `sessionID`).
 * Every line of a stream carries it once the session exists; null until then
 * and for any non-object/non-JSON line — the caller records the id the moment
 * a session-bearing line arrives.
 */
export function sessionIdOfLine(line: string): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isObject(raw)) return null
  const id = (raw as { sessionID?: unknown }).sessionID
  return typeof id === 'string' && id.length > 0 ? id : null
}
