// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

/**
 * Where a refusal is reported.
 *
 * Defaults to `console.error`, which is what an operator running the script
 * sees. It is a parameter because `console.error` is the one channel the test
 * setup deliberately leaves unsuppressed, so a suite driving all seven refusals
 * on purpose would print seven lines that read as real diagnostics.
 */
export type PreflightReporter = (message: string) => void

const consoleReporter: PreflightReporter = (message) => {
  console.error(message)
}

interface PreflightConfig {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
}

const ModelsPayloadSchema = z.object({
  data: z.array(z.object({ id: z.unknown() })).optional(),
})

function readPreflightConfig(report: PreflightReporter): PreflightConfig | undefined {
  const baseUrl = (process.env['BEHAVIOR_AUDIT_BASE_URL'] ?? '').replace(/\/+$/u, '')
  const model = process.env['BEHAVIOR_AUDIT_MODEL']
  const apiKey = process.env['OPENAI_API_KEY']
  if (baseUrl === '') {
    report('Error: BEHAVIOR_AUDIT_BASE_URL is not set')
    return undefined
  }
  if (model === undefined || model === '') {
    report('Error: BEHAVIOR_AUDIT_MODEL is not set')
    return undefined
  }
  if (apiKey === undefined || apiKey === '') {
    report('Error: OPENAI_API_KEY is not set')
    return undefined
  }
  return { baseUrl, model, apiKey }
}

function classifyHttpFailure(status: number): string {
  if (status === 401 || status === 403) {
    return `Error: auth rejected (HTTP ${status})`
  }
  return `Error: gateway returned HTTP ${status}`
}

function pickOfferedModelIds(payload: unknown): readonly string[] {
  const parsed = ModelsPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return []
  }
  return (parsed.data.data ?? []).map((entry) => entry.id).filter((id): id is string => typeof id === 'string')
}

export async function runPreflight(report: PreflightReporter = consoleReporter): Promise<number> {
  const config = readPreflightConfig(report)
  if (config === undefined) {
    return 1
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })
  } catch (err) {
    report(`Error: gateway unreachable: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (!response.ok) {
    report(classifyHttpFailure(response.status))
    return 1
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    report('Error: gateway returned malformed JSON')
    return 1
  }

  const ids = pickOfferedModelIds(payload)
  if (!ids.includes(config.model)) {
    report(`Error: model "${config.model}" not offered by gateway (available: ${ids.join(', ') || 'none'})`)
    return 1
  }

  console.log(`Preflight OK: gateway ${config.baseUrl} offers model ${config.model}`)
  return 0
}

if (import.meta.main) {
  const exitCode = await runPreflight()
  process.exit(exitCode)
}
