// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { OpencodeEvent, ToolStatus } from './event-stream.js'

/**
 * The claude CLI's NDJSON output decoded into the existing `OpencodeEvent`
 * union (design D6), so `LiveCtx`, `run-stats`, the live renderer and
 * `metrics.json` stay untouched. Line shapes are the ones recorded in the
 * fixture corpus at `tests/opencode-agent/fixtures/claude-cli/` — never guessed.
 *
 * The decoder is **created per attempt** beside `handler.ctx.sessionId`: the
 * tool-pairing map and the result outcome are attempt state, and a retry after
 * a stalled first attempt must not read the stalled attempt's result line.
 */

export interface ClaudeResultOutcome {
  seen: boolean
  isError: boolean
}

export interface ClaudeStreamDecoder {
  /** One line → zero or more events: claude messages carry content *arrays*. */
  parseLine(line: string): OpencodeEvent[]
  /** The session id off any session-bearing line; `null` until one arrives. */
  sessionIdOf(line: string): string | null
  /** Whether this attempt's stream carried a `result` line, and whether it signalled an error. */
  resultOutcome(): ClaudeResultOutcome
}

interface RawContentBlock {
  type?: unknown
  id?: unknown
  name?: unknown
  input?: unknown
  tool_use_id?: unknown
  is_error?: unknown
}

interface RawMessage {
  content?: unknown
  stop_reason?: unknown
}

interface RawUsage {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
  output_tokens_details?: { thinking_tokens?: unknown }
}

interface RawLine {
  type?: unknown
  subtype?: unknown
  message?: RawMessage
  session_id?: unknown
  is_error?: unknown
  stop_reason?: unknown
  total_cost_usd?: unknown
  usage?: RawUsage
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parseRaw(line: string): RawLine | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  return isObject(raw) ? (raw as RawLine) : null
}

function contentBlocks(message: RawMessage | undefined): RawContentBlock[] {
  if (message === undefined || !Array.isArray(message.content)) return []
  return message.content.filter(isObject) as RawContentBlock[]
}

/** The per-attempt decode state the per-block parsers share. */
interface DecodeState {
  /** callId → the assistant block's tool name and input, so a tool_result can carry them. */
  pairedCalls: Map<string, { tool: string; input: unknown }>
  resultSeen: boolean
  resultIsError: boolean
}

function decodeAssistant(raw: RawLine, state: DecodeState): OpencodeEvent[] {
  const events: OpencodeEvent[] = []
  for (const block of contentBlocks(raw.message)) {
    // text blocks are deliberately dropped (D6): nothing consumes the union's
    // text member, and the corpus mixes both block kinds in one array.
    if (block.type !== 'tool_use') continue
    if (typeof block.id !== 'string' || typeof block.name !== 'string') continue
    state.pairedCalls.set(block.id, { tool: block.name, input: block.input ?? {} })
    events.push({ type: 'tool_use', tool: block.name, callId: block.id, status: 'running', input: block.input ?? {} })
  }
  return events
}

function decodeUser(raw: RawLine, state: DecodeState): OpencodeEvent[] {
  const events: OpencodeEvent[] = []
  for (const block of contentBlocks(raw.message)) {
    if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
    const paired = state.pairedCalls.get(block.tool_use_id)
    // Unpaired: no callId this attempt owns, so there is nothing to report.
    if (paired === undefined) continue
    const status: ToolStatus = block.is_error === true ? 'error' : 'completed'
    events.push({ type: 'tool_use', tool: paired.tool, callId: block.tool_use_id, status, input: paired.input })
  }
  return events
}

function decodeResult(raw: RawLine, state: DecodeState): OpencodeEvent[] {
  state.resultSeen = true
  state.resultIsError = raw.is_error === true
  const usage = raw.usage ?? {}
  return [
    {
      type: 'step_finish',
      reason: typeof raw.stop_reason === 'string' ? raw.stop_reason : '',
      tokens: {
        input: asNumber(usage.input_tokens),
        output: asNumber(usage.output_tokens),
        reasoning: asNumber(usage.output_tokens_details?.thinking_tokens),
        cacheRead: asNumber(usage.cache_read_input_tokens),
        cacheWrite: asNumber(usage.cache_creation_input_tokens),
      },
      cost: asNumber(raw.total_cost_usd),
    },
  ]
}

export function createClaudeStreamDecoder(): ClaudeStreamDecoder {
  const state: DecodeState = { pairedCalls: new Map(), resultSeen: false, resultIsError: false }
  return {
    parseLine(line: string): OpencodeEvent[] {
      const raw = parseRaw(line)
      if (raw === null) return []
      switch (raw.type) {
        case 'system':
          // The init line starts the clock/live slot; no consumer reads the
          // union's timestamp (the line carries none), so decode time fills it.
          return raw.subtype === 'init' ? [{ type: 'step_start', timestamp: Date.now() }] : []
        case 'assistant':
          return decodeAssistant(raw, state)
        case 'user':
          return decodeUser(raw, state)
        case 'result':
          return decodeResult(raw, state)
        default:
          return []
      }
    },
    sessionIdOf(line: string): string | null {
      const raw = parseRaw(line)
      const id = raw?.session_id
      return typeof id === 'string' && id.length > 0 ? id : null
    },
    resultOutcome(): ClaudeResultOutcome {
      return { seen: state.resultSeen, isError: state.resultIsError }
    },
  }
}
