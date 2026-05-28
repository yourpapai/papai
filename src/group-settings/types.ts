// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type KnownGroupContext = {
  readonly contextId: string
  readonly provider: string
  readonly displayName: string
  readonly parentName: string | null
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly source?: 'observed' | 'authorized-fallback'
}

export type GroupSettingsCommand = 'config' | 'setup'

export type GroupSettingsSessionStage = 'choose_scope' | 'choose_group' | 'active'

export type GroupSettingsSession = {
  userId: string
  platformInstanceId: string | undefined
  command: GroupSettingsCommand
  stage: GroupSettingsSessionStage
  startedAt: Date
  targetContextId: string | undefined
}

type GroupSettingsSelectorResponse =
  | { handled: true; response: string }
  | { handled: true; response: string; buttons: import('../chat/types.js').ChatButton[] }

export type GroupSettingsSelectorResult =
  | { handled: false }
  | GroupSettingsSelectorResponse
  | { handled: true; continueWith: { command: GroupSettingsCommand; targetContextId: string } }
