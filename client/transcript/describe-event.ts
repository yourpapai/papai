// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StatusTone } from '../shared/ui/status-tone.js'
import { statusTone } from '../shared/ui/status-tone.js'
import type { TranscriptEvent } from './fetcher-schemas.js'

export interface PlanEntry {
  content: string
  status: string
  mark: string
}

export type DescribedEvent =
  | { kind: 'prompt'; body: string }
  | { kind: 'message'; body: string }
  | { kind: 'thought'; body: string }
  | { kind: 'tool'; title: string; status: string; tone: StatusTone; glyph: string }
  | { kind: 'plan'; entries: PlanEntry[] }
  | { kind: 'permission'; decided: boolean }
  | { kind: 'result'; stopReason: string }
  | { kind: 'raw'; json: string }

/** statusTone() has no entry for these two, so both would fall through to 'neutral'. */
const TOOL_TONE: Record<string, StatusTone> = { completed: 'accent', in_progress: 'info' }

const TOOL_GLYPH: Record<string, string> = { completed: '✔', failed: '✖', in_progress: '▸' }

const PLAN_MARK: Record<string, string> = { completed: '[x]', in_progress: '[~]' }

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function raw(payload: unknown): DescribedEvent {
  return { kind: 'raw', json: JSON.stringify(payload ?? {}, null, 2) }
}

function describeTool(payload: Record<string, unknown>): DescribedEvent {
  const status = asString(payload['status']) ?? ''
  return {
    kind: 'tool',
    title: asString(payload['title']) ?? asString(payload['toolCallId']) ?? 'tool',
    status,
    tone: TOOL_TONE[status] ?? statusTone(status),
    glyph: TOOL_GLYPH[status] ?? '·',
  }
}

function toPlanEntry(item: unknown): PlanEntry | null {
  if (!isRecord(item)) return null
  const content = asString(item['content'])
  if (content === null) return null
  const status = asString(item['status']) ?? 'pending'
  return { content, status, mark: PLAN_MARK[status] ?? '[ ]' }
}

function describePlan(payload: Record<string, unknown>): DescribedEvent {
  const source = payload['entries']
  if (!Array.isArray(source) || source.length === 0) return raw(payload)
  const entries: PlanEntry[] = []
  for (const item of source) {
    const entry = toPlanEntry(item)
    if (entry === null) return raw(payload)
    entries.push(entry)
  }
  return { kind: 'plan', entries }
}

function describeUpdate(payload: unknown): DescribedEvent {
  const fields = isRecord(payload) ? payload : {}
  const kind = asString(fields['sessionUpdate']) ?? ''
  const body = asString(fields['content']) ?? asString(fields['text'])
  if (kind === 'agent_message_chunk') return body === null ? raw(payload) : { kind: 'message', body }
  if (kind === 'agent_thought_chunk') return body === null ? raw(payload) : { kind: 'thought', body }
  if (kind === 'tool_call' || kind === 'tool_call_update') return describeTool(fields)
  if (kind === 'plan') return describePlan(fields)
  return raw(payload)
}

/**
 * Narrow one transcript event's untyped payload into a shape the timeline can render.
 *
 * The payload originates in the external magi service and arrives as `z.unknown()`, so
 * every field access here is a probe with a fallback. The `raw` kind is the terminal
 * fallback: an unrecognised or malformed shape degrades to pretty-printed JSON rather
 * than throwing or rendering a misleading branch.
 */
export function describeEvent(event: TranscriptEvent): DescribedEvent {
  const fields = isRecord(event.payload) ? event.payload : {}
  if (event.type === 'prompt') {
    const body = asString(fields['prompt']) ?? asString(fields['text']) ?? asString(fields['content'])
    return body === null ? raw(event.payload) : { kind: 'prompt', body }
  }
  if (event.type === 'permission_request') return { kind: 'permission', decided: false }
  if (event.type === 'permission_decision') return { kind: 'permission', decided: true }
  if (event.type === 'result') return { kind: 'result', stopReason: asString(fields['stopReason']) ?? '' }
  return describeUpdate(event.payload)
}
