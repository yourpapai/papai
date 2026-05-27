// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { isAllowedDynamicConfigKey } from '../types/config.js'
import type { EditorButton } from './types.js'

const MAX_CALLBACK_DATA_BYTES = 64

const encodeContextId = (id: string): string => Buffer.from(id).toString('base64url')
const decodeContextId = (encoded: string): string => Buffer.from(encoded, 'base64url').toString('utf8')

const callbackTokens = new Map<string, string>()
const callbacksByToken = new Map<string, ReturnType<typeof parseRawCallbackData>>()
let nextCallbackToken = 0

function compactCallbackData(raw: string): string {
  if (Buffer.byteLength(raw, 'utf8') <= MAX_CALLBACK_DATA_BYTES) return raw

  const existing = callbackTokens.get(raw)
  if (existing !== undefined) return existing

  const token = `cfg:t:${nextCallbackToken.toString(36)}`
  nextCallbackToken++
  callbackTokens.set(raw, token)
  callbacksByToken.set(token, parseRawCallbackData(raw))
  return token
}

function appendContext(base: string, targetContextId: string | undefined): string {
  return targetContextId === undefined ? base : `${base}@${encodeContextId(targetContextId)}`
}

export function serializeCallbackData(button: Pick<EditorButton, 'action' | 'key'>, targetContextId?: string): string {
  switch (button.action) {
    case 'edit':
      return compactCallbackData(
        appendContext(button.key === undefined ? 'cfg:back' : `cfg:edit:${button.key}`, targetContextId),
      )
    case 'save':
      return compactCallbackData(
        appendContext(button.key === undefined ? 'cfg:back' : `cfg:save:${button.key}`, targetContextId),
      )
    case 'cancel':
      return appendContext('cfg:cancel', targetContextId)
    case 'back':
      return appendContext('cfg:back', targetContextId)
    case 'setup':
      return appendContext('cfg:setup', targetContextId)
    default:
      return appendContext('cfg:back', targetContextId)
  }
}

function parseRawCallbackData(data: string): {
  action: 'edit' | 'save' | 'cancel' | 'back' | 'setup' | null
  key: string | null
  targetContextId?: string
} {
  let targetContextId: string | undefined
  let core = data
  const atIdx = data.indexOf('@')
  if (atIdx !== -1) {
    try {
      targetContextId = decodeContextId(data.slice(atIdx + 1))
    } catch {
      /* invalid encoding - treat as legacy */
    }
    core = data.slice(0, atIdx)
  }

  if (core === 'cfg:cancel') return { action: 'cancel', key: null, targetContextId }
  if (core === 'cfg:back') return { action: 'back', key: null, targetContextId }
  if (core === 'cfg:setup') return { action: 'setup', key: null, targetContextId }

  if (core.startsWith('cfg:edit:')) {
    const key = core.replace('cfg:edit:', '')
    return isAllowedDynamicConfigKey(key) ? { action: 'edit', key, targetContextId } : { action: null, key: null }
  }

  if (core.startsWith('cfg:save:')) {
    const key = core.replace('cfg:save:', '')
    return isAllowedDynamicConfigKey(key) ? { action: 'save', key, targetContextId } : { action: null, key: null }
  }

  return { action: null, key: null }
}

export function parseCallbackData(data: string): ReturnType<typeof parseRawCallbackData> {
  return callbacksByToken.get(data) ?? parseRawCallbackData(data)
}
