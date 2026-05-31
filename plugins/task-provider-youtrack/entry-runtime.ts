// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProvider } from '../../src/providers/types.js'

type YouTrackProviderModule = typeof import('./provider.js')

const requireModule = import.meta.require

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isYouTrackProviderModule(value: unknown): value is YouTrackProviderModule {
  return isRecord(value) && typeof value['YouTrackProvider'] === 'function'
}

function getYouTrackProviderModule(): YouTrackProviderModule {
  const moduleValue: unknown = requireModule('./provider.js')
  if (!isYouTrackProviderModule(moduleValue)) {
    throw new Error('Invalid YouTrack provider module contract')
  }
  return moduleValue
}

export function createYouTrackProvider(config: Record<string, string>): TaskProvider {
  const { YouTrackProvider } = getYouTrackProviderModule()
  return new YouTrackProvider({ baseUrl: config['baseUrl'] ?? '', token: config['token'] ?? '' })
}
