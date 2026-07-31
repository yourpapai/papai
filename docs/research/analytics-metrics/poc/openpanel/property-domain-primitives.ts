// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { INTENT_V1_LABELS } from '../fixture/fixture-contract.js'
import { INTENT_SPECS } from '../fixture/fixture-taxonomy.js'

export type PropertyValidator = (value: unknown) => boolean

const DAY_MS = 86_400_000
const MAX_COUNT = 1_000_000
const MAX_TOKEN_COUNT = 1_000_000_000
const PSEUDONYM_PATTERN = /^syn_[0-9a-f]{32}$/u
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const INTENT_LABEL_SET: ReadonlySet<string> = new Set(INTENT_V1_LABELS)

export const oneOf =
  (values: readonly string[]): PropertyValidator =>
  (value) =>
    typeof value === 'string' && values.includes(value)

export const booleanValue: PropertyValidator = (value) => typeof value === 'boolean'

export const integerBetween =
  (minimum: number, maximum: number): PropertyValidator =>
  (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum

export const nullable =
  (validator: PropertyValidator): PropertyValidator =>
  (value) =>
    value === null || validator(value)

export const pseudonym: PropertyValidator = (value) => typeof value === 'string' && PSEUDONYM_PATTERN.test(value)

export const count = integerBetween(0, MAX_COUNT)
export const elapsedMs = integerBetween(0, DAY_MS)
export const tokenCount = integerBetween(0, MAX_TOKEN_COUNT)
export const ordinal = integerBetween(1, MAX_COUNT)

const countBuckets = ['0', '1', '2', '3_5', '6_10', '11_20', '21_plus'] as const
const byteBuckets = ['0', '1_256', '257_1024', '1025_8192', '8193_65536', '65537_plus'] as const
const lengthBuckets = ['0', '1_32', '33_128', '129_512', '513_2048', '2049_plus'] as const
const confidenceBuckets = ['lt_050', '050_069', '070_084', '085_094', 'ge_095'] as const
const statusClasses = ['none', '2xx', '3xx', '4xx', '5xx', 'timeout', 'network', 'auth', 'other'] as const
const errorClasses = [
  'configuration',
  'validation',
  'authorization',
  'permission',
  'rate_limit',
  'not_found',
  'conflict',
  'provider_4xx',
  'provider_5xx',
  'timeout',
  'network',
  'mcp_unavailable',
  'llm_provider',
  'cancelled',
  'internal',
  'other',
] as const
const toolSlugs = [
  ...new Set(INTENT_SPECS.flatMap(({ tool }) => (tool === null ? [] : [tool.slug]))),
  'external_other',
] as const

export const countBucket = oneOf(countBuckets)
export const byteBucket = oneOf(byteBuckets)
export const lengthBucket = oneOf(lengthBuckets)
export const confidenceBucket = oneOf(confidenceBuckets)
export const statusClass = oneOf(statusClasses)
export const errorClass = oneOf(errorClasses)
export const toolSlug = oneOf(toolSlugs)
export const toolKey = nullable(pseudonym)
export const modelRole = oneOf(['main', 'small', 'embedding', 'verifier'])
export const toolModelRole = oneOf(['main', 'small'])
export const risk = oneOf(['read', 'write', 'destructive', 'open_world'])

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

export const goals: PropertyValidator = (value) => {
  if (!isStringArray(value) || value.length > 3) return false
  if (!value.every((entry) => INTENT_LABEL_SET.has(entry))) return false
  const sorted = value.toSorted((left, right) => left.localeCompare(right))
  return new Set(value).size === value.length && sorted.every((entry, index) => entry === value[index])
}

export const utcDay: PropertyValidator = (value) => {
  if (typeof value !== 'string' || !UTC_DAY_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
