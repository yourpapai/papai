// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { EventInputSchema } from './events.js'
import type { EventInput } from './events.js'
import { SddEventSchema } from './events.js'
import type { SddEvent } from './events.js'

function nextSeq(logPath: string): number {
  if (!fs.existsSync(logPath)) return 1
  const lines = fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
  return lines.length + 1
}

/** Validate an event input and attach stamp fields without touching disk. */
export function stampEvent(init: EventInput, seq: number, ts: string): SddEvent {
  const parsedInput = EventInputSchema.parse(init)
  return SddEventSchema.parse({ ...parsedInput, seq, ts })
}

export function appendEvent(logPath: string, event: unknown, now: Date = new Date()): SddEvent {
  const parsedInput = EventInputSchema.parse(event)
  const stamped = { ...parsedInput, seq: nextSeq(logPath), ts: now.toISOString() }
  const parsed = SddEventSchema.parse(stamped)
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.appendFileSync(logPath, `${JSON.stringify(parsed)}\n`)
  return parsed
}

export function readEvents(logPath: string): SddEvent[] {
  const lines = fs.readFileSync(logPath, 'utf8').split('\n')
  const events: SddEvent[] = []
  lines.forEach((line, index) => {
    if (line.length === 0) return
    try {
      events.push(SddEventSchema.parse(JSON.parse(line)))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`events.ndjson line ${index + 1}: ${detail}`, { cause: error })
    }
  })
  return events
}
