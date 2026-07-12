// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { kvGet, kvSet } from '../plugins/store.js'
import { readRecord, writeRecord, type SessionRecord } from './session-record.js'

const CURRENT_STORAGE_NAMESPACE = 'acp'

function legacyStore(configContextId: string): {
  get(key: string): string | undefined
  set(key: string, value: string): void
} {
  return {
    get: (key) => kvGet(CURRENT_STORAGE_NAMESPACE, configContextId, key),
    set: (key, value) => {
      kvSet(CURRENT_STORAGE_NAMESPACE, configContextId, key, value)
    },
  }
}

export function getCodingSessionRecord(configContextId: string, sessionId: string): SessionRecord | null {
  return readRecord(legacyStore(configContextId), sessionId)
}

export function setCodingSessionRecord(configContextId: string, sessionId: string, record: SessionRecord): void {
  writeRecord(legacyStore(configContextId), sessionId, record)
}

export type { SessionRecord } from './session-record.js'
