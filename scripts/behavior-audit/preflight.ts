// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

interface PreflightConfig {
  readonly baseUrl: string
  readonly model: string
  readonly apiKey: string
}

const ModelsPayloadSchema = z.object({
  data: z.array(z.object({ id: z.string() })).optional(),
})

function readPreflightConfig(): PreflightConfig | undefined {
  const baseUrl = process.env['BEHAVIOR_AUDIT_BASE_URL']
  const model = process.env['BEHAVIOR_AUDIT_MODEL']
  const apiKey = process.env['OPENAI_API_KEY']
  if (baseUrl === undefined || baseUrl === '') {
    console.error('Error: BEHAVIOR_AUDIT_BASE_URL is not set')
    return undefined
  }
  if (model === undefined || model === '') {
    console.error('Error: BEHAVIOR_AUDIT_MODEL is not set')
    return undefined
  }
  if (apiKey === undefined || apiKey === '') {
    console.error('Error: OPENAI_API_KEY is not set')
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
  return parsed.data.data?.map((entry) => entry.id) ?? []
}

export async function runPreflight(): Promise<number> {
  const config = readPreflightConfig()
  if (config === undefined) {
    return 1
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    })
  } catch (err) {
    console.error(`Error: gateway unreachable: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }

  if (!response.ok) {
    console.error(classifyHttpFailure(response.status))
    return 1
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    console.error('Error: gateway returned malformed JSON')
    return 1
  }

  const ids = pickOfferedModelIds(payload)
  if (!ids.includes(config.model)) {
    console.error(`Error: model "${config.model}" not offered by gateway (available: ${ids.join(', ') || 'none'})`)
    return 1
  }

  console.log(`Preflight OK: gateway ${config.baseUrl} offers model ${config.model}`)
  return 0
}

if (import.meta.main) {
  const exitCode = await runPreflight()
  process.exit(exitCode)
}
