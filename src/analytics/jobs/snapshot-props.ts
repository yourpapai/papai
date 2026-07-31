// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PropKind = 'text' | 'integer' | 'real' | 'json'

export type PropExtraction = Readonly<{ propKey: string; column: string; kind: PropKind }>

const textProp = (propKey: string, column?: string): PropExtraction => ({
  propKey,
  column: column ?? `prop_${propKey}`,
  kind: 'text',
})
const integerProp = (propKey: string): PropExtraction => ({ propKey, column: `prop_${propKey}`, kind: 'integer' })
const realProp = (propKey: string): PropExtraction => ({ propKey, column: `prop_${propKey}`, kind: 'real' })

/**
 * The closed allowlist of canonical prop keys curated into typed snapshot
 * columns. Anything else in props_json (free text, native IDs, secrets) never
 * reaches the publish database.
 */
export const PROP_EXTRACTIONS: readonly PropExtraction[] = [
  textProp('outcome'),
  textProp('result'),
  textProp('entry'),
  textProp('change'),
  textProp('to_provider'),
  textProp('domain'),
  textProp('risk'),
  textProp('execution_outcome'),
  integerProp('recovered_same_turn'),
  textProp('tool_slug'),
  textProp('primary', 'prop_primary_intent'),
  textProp('strategy'),
  textProp('confidence'),
  { propKey: 'goals', column: 'prop_goals_json', kind: 'json' },
  integerProp('abstained'),
  textProp('feature'),
  integerProp('available'),
  textProp('reason'),
  realProp('duration_ms'),
  realProp('queue_wait_ms'),
  realProp('latency_ms'),
  textProp('kind'),
  integerProp('capability_supported'),
  integerProp('setting_enabled'),
  realProp('time_to_first_token_ms'),
  textProp('model_role'),
  textProp('error_class'),
  textProp('delivery'),
  textProp('decision'),
  realProp('decision_latency_ms'),
  textProp('provider'),
  textProp('status_class'),
  textProp('stage'),
  realProp('latency_from_turn_start_ms'),
  integerProp('eligible'),
  integerProp('clarification'),
  textProp('window'),
  textProp('phase'),
]

export const CURATED_EVENT_PROP_COLUMNS: readonly string[] = PROP_EXTRACTIONS.map((entry) => entry.column)

const extractValue = (entry: PropExtraction, value: unknown): string | number | undefined => {
  if (entry.kind === 'text') return typeof value === 'string' ? value : undefined
  if (entry.kind === 'json') return Array.isArray(value) ? JSON.stringify(value) : undefined
  if (entry.kind === 'integer') {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
    if (typeof value === 'boolean') return value ? 1 : 0
    return undefined
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Maps raw canonical props onto the typed allowlisted columns; everything else is dropped. */
export const extractTypedProps = (
  props: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | number>> => {
  const extracted: Record<string, string | number> = {}
  for (const entry of PROP_EXTRACTIONS) {
    const value = extractValue(entry, props[entry.propKey])
    if (value !== undefined) extracted[entry.column] = value
  }
  return extracted
}
