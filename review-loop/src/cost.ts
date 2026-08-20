// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const PriceEntrySchema = z.object({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative().optional(),
  cacheWrite: z.number().nonnegative().optional(),
})
export const PricingTableSchema = z.record(z.string(), PriceEntrySchema)
export type PriceEntry = z.infer<typeof PriceEntrySchema>
export type PricingTable = z.infer<typeof PricingTableSchema>

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\\\*/gu, '.*')
  return new RegExp(`^${escaped}$`, 'u')
}

export function matchPrice(pricing: PricingTable, model: string): PriceEntry | undefined {
  const exact = pricing[model]
  if (exact !== undefined) return exact
  for (const [pattern, entry] of Object.entries(pricing)) {
    if (pattern.includes('*') && globToRegExp(pattern).test(model)) return entry
  }
  return undefined
}

export interface CacheTokenUsage {
  cachedRead: number
  cachedWrite: number
}

export function estimateCostUsd(
  price: PriceEntry,
  input: number,
  output: number,
  cache: CacheTokenUsage = { cachedRead: 0, cachedWrite: 0 },
): number {
  const cacheReadCost = (cache.cachedRead / 1_000_000) * (price.cacheRead ?? 0)
  const cacheWriteCost = (cache.cachedWrite / 1_000_000) * (price.cacheWrite ?? 0)
  return (input / 1_000_000) * price.input + (output / 1_000_000) * price.output + cacheReadCost + cacheWriteCost
}
