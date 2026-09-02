// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ProgressReporter, UsageDelta } from '../../review-loop/src/progress-log.js'
import type { EventInput } from './events.js'

const ARROW = '\u25B6'
const MIDDLE_DOT = '\u00B7'

/**
 * Parse a review-loop slot line (`<label> ▶ <tool> <arg?> · <dur> · <n> tools`)
 * into a tool name and argument. Tolerant: anything without the arrow marker
 * degrades to `(unknown)` with the full line preserved as the argument so the
 * event still carries the raw activity for debugging.
 */
function parseSlotLine(line: string): { tool: string; arg: string | undefined } {
  const arrowIndex = line.indexOf(ARROW)
  if (arrowIndex < 0) return { tool: '(unknown)', arg: line }
  const afterArrow = line.slice(arrowIndex + ARROW.length).trim()
  const dotIndex = afterArrow.indexOf(` ${MIDDLE_DOT} `)
  const head = dotIndex >= 0 ? afterArrow.slice(0, dotIndex) : afterArrow
  const parts = head.split(/\s+/u).filter((part) => part.length > 0)
  const tool = parts[0]
  if (tool === undefined || tool === '') return { tool: '(unknown)', arg: line }
  const arg = parts.slice(1).join(' ')
  return { tool, arg: arg === '' ? undefined : arg }
}

function buildToolUseEvent(label: string, line: string): EventInput {
  const { tool, arg } = parseSlotLine(line)
  return arg === undefined
    ? { altitude: 'L0', type: 'tool_use', agent: label, tool }
    : { altitude: 'L0', type: 'tool_use', agent: label, tool, arg }
}

function buildStepFinishEvent(label: string, delta: UsageDelta): EventInput {
  return {
    altitude: 'L0',
    type: 'step_finish',
    agent: label,
    tokens: {
      input: delta.input,
      output: delta.output,
      reasoning: delta.reasoning,
      cacheRead: delta.cacheRead ?? 0,
      cacheWrite: delta.cacheWrite ?? 0,
    },
    costUsd: delta.cost,
  }
}

/**
 * Shared body for the imperative reporter hooks sdd-runner does not use. The
 * renderer drives its own dynamic block from the event bus, so `event`/`log`/
 * `live`/`clearLive`/`issue`/`diff` are intentionally inert.
 */
const noop = (): void => {
  // sdd-runner surfaces equivalent state through its own event bus
}

/**
 * Adapter that translates review-loop `ProgressReporter` calls into sdd-runner
 * event-bus emissions (design D1). Only `slot` and `usage` carry data; the
 * imperative display methods are no-ops because sdd-runner's renderer drives
 * its own dynamic block from the event bus.
 */
export function createAgentReporter(label: string, emit: (event: EventInput) => void): ProgressReporter {
  return {
    get dynamic(): boolean {
      return false
    },
    event: noop,
    log: noop,
    live: noop,
    clearLive: noop,
    slot: (_key: string, line: string | null): void => {
      if (line !== null) emit(buildToolUseEvent(label, line))
    },
    usage: (delta: UsageDelta): void => {
      emit(buildStepFinishEvent(label, delta))
    },
    issue: noop,
    statusSuffix(): string {
      return ''
    },
    diff: noop,
  }
}
