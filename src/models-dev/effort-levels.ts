// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMetadata } from './resolve.js'

export const FALLBACK_EFFORT_LEVELS: readonly string[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export const effortLevelsFor = (metadata: ModelMetadata): readonly string[] => {
  const levels = metadata.effortLevels
  if (levels !== undefined && levels !== null && levels.length > 0) return levels
  if (metadata.reasoning === false) return []
  return FALLBACK_EFFORT_LEVELS
}

export const isEffortLevel = (metadata: ModelMetadata, value: string): boolean =>
  effortLevelsFor(metadata).includes(value)
