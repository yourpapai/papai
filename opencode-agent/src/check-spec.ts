// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { CheckSpec } from './check-loop.js'
import { ConfigError } from './config-values.js'

/**
 * `AGENT_CHECKS`, the one non-scalar reading in this half of the config.
 *
 * Its own module rather than another section of `config-values.ts`, which the
 * debug transcript's `AGENT_LOG_KEY` pushed past `max-lines`. The seam is the
 * one already named there: that file reads and range-checks *scalars*, and this
 * is the reading that parses a document — a different kind of refusal, with a
 * schema and two failure messages of its own.
 */

/** One check the CI-fix loop runs, declared as `{ name, argv }` in `AGENT_CHECKS`. */
const checkSpecSchema = z.object({ name: z.string().min(1), argv: z.array(z.string().min(1)).min(1) })

/** Checks the CI-fix loop runs when the repo does not declare its own. */
export const DEFAULT_CHECKS: readonly CheckSpec[] = [
  { name: 'lint', argv: ['bun', 'run', 'lint'] },
  { name: 'typecheck', argv: ['bun', 'run', 'typecheck'] },
  { name: 'test', argv: ['bun', 'test'] },
]

/**
 * Parses `AGENT_CHECKS` — a JSON array of `{ name, argv }`.
 *
 * Here rather than in `config.ts` for the reason that split states: this is *how* a
 * value is read out of the environment and refused when it cannot work, where
 * `config.ts` says *which* values a run needs. The two-stage parse is deliberate —
 * `safeJson` names the syntax error and the schema names the shape error, because
 * "AGENT_CHECKS is invalid" sends an operator looking in the wrong half.
 */
export const parseChecks = (raw: string | undefined): readonly CheckSpec[] => {
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_CHECKS

  const parsed = z.array(checkSpecSchema).min(1).safeParse(safeJson(raw))
  if (!parsed.success) throw new ConfigError(`AGENT_CHECKS is not a valid check list: ${parsed.error.message}`)
  return parsed.data
}

const safeJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new ConfigError('AGENT_CHECKS must be valid JSON')
  }
}
