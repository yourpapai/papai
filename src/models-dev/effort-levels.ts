// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMetadata } from './resolve.js'

export const FALLBACK_EFFORT_LEVELS: readonly string[] = []

export const effortLevelsFor = (metadata: ModelMetadata): readonly string[] => metadata.effortLevels ?? []

export const isEffortLevel = (metadata: ModelMetadata, value: string): boolean =>
  effortLevelsFor(metadata).includes(value)
