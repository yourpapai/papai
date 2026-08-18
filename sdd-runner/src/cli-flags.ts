// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AutonomyOverrides } from './cli.js'
import type { AutonomyLevel } from './config.js'

const AUTONOMY_VALUES: Record<string, AutonomyLevel> = { observe: 'observe', assist: 'assist', auto: 'auto' }

interface ParsedAutonomyFlags {
  readonly autonomy?: AutonomyLevel
  readonly autoDeadlineMinutes?: number
}

function parseAutonomyFlag(val: string): AutonomyLevel {
  const level = AUTONOMY_VALUES[val]
  if (level === undefined) throw new Error(`invalid --autonomy: ${val}`)
  return level
}

function parseAutoDeadlineFlag(val: string): number {
  const minutes = Number(val)
  if (!Number.isFinite(minutes) || minutes <= 0 || String(minutes) !== val.trim()) {
    throw new Error(`invalid --auto-deadline: ${val}`)
  }
  return minutes
}

export function parseAutonomyFlags(args: readonly string[], start: number): ParsedAutonomyFlags {
  let autonomy: AutonomyLevel | undefined
  let autoDeadlineMinutes: number | undefined
  let i = start
  while (i < args.length) {
    const arg = args[i]
    if (arg === '--autonomy') {
      const val = args[i + 1] ?? ''
      autonomy = parseAutonomyFlag(val)
      i += 2
    } else if (arg === '--auto-deadline') {
      const val = args[i + 1] ?? ''
      autoDeadlineMinutes = parseAutoDeadlineFlag(val)
      i += 2
    } else {
      throw new Error(`unknown flag: ${arg}`)
    }
  }
  if (autonomy === undefined && autoDeadlineMinutes === undefined) return {}
  return {
    ...(autonomy === undefined ? {} : { autonomy }),
    ...(autoDeadlineMinutes === undefined ? {} : { autoDeadlineMinutes }),
  }
}

export function autonomyOverridesOf(
  autonomy: AutonomyLevel | undefined,
  deadline: number | undefined,
): AutonomyOverrides {
  if (autonomy === undefined && deadline === undefined) return {}
  return {
    ...(autonomy === undefined ? {} : { level: autonomy }),
    ...(deadline === undefined ? {} : { deadlineMinutes: deadline }),
  }
}
