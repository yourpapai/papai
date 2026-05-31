// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProvider } from '../../src/providers/types.js'

type KaneoConfig = {
  apiKey: string
  baseUrl: string
} & Partial<{
  sessionCookie: string
}>

type KaneoClientModule = typeof import('./client.js')
type KaneoProviderModule = typeof import('./provider.js')

const requireModule = import.meta.require

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isKaneoClientModule(value: unknown): value is KaneoClientModule {
  return isRecord(value) && typeof value['isKaneoSessionCookie'] === 'function'
}

function isKaneoProviderModule(value: unknown): value is KaneoProviderModule {
  return isRecord(value) && typeof value['KaneoProvider'] === 'function'
}

function getKaneoClientModule(): KaneoClientModule {
  const moduleValue: unknown = requireModule('./client.js')
  if (!isKaneoClientModule(moduleValue)) {
    throw new Error('Invalid Kaneo client module contract')
  }
  return moduleValue
}

function getKaneoProviderModule(): KaneoProviderModule {
  const moduleValue: unknown = requireModule('./provider.js')
  if (!isKaneoProviderModule(moduleValue)) {
    throw new Error('Invalid Kaneo provider module contract')
  }
  return moduleValue
}

export function createKaneoProvider(config: Record<string, string>): TaskProvider {
  const { isKaneoSessionCookie } = getKaneoClientModule()
  const { KaneoProvider } = getKaneoProviderModule()

  const baseUrl = config['baseUrl'] ?? ''
  const credential = config['credential'] ?? ''
  const kaneoConfig: KaneoConfig = isKaneoSessionCookie(credential)
    ? { apiKey: '', baseUrl, sessionCookie: credential }
    : { apiKey: credential, baseUrl }

  return new KaneoProvider(kaneoConfig, config['workspaceId'] ?? '')
}
