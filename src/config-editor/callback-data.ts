// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigFieldsForContext } from '../config-keys.js'
import { isAllowedDynamicConfigKey } from '../types/config.js'
import type { EditorButton } from './types.js'

const MAX_CALLBACK_DATA_BYTES = 64

const encodeContextId = (id: string): string => Buffer.from(id).toString('base64url')
const decodeContextId = (encoded: string): string => Buffer.from(encoded, 'base64url').toString('utf8')

const INVALID_CALLBACK_DATA = 'cfg:invalid'

function compactCallbackData(
  raw: string,
  button: Pick<EditorButton, 'action' | 'key'>,
  targetContextId: string | undefined,
): string {
  if (Buffer.byteLength(raw, 'utf8') <= MAX_CALLBACK_DATA_BYTES) return raw

  if (
    (button.action === 'edit' || button.action === 'save') &&
    button.key !== undefined &&
    targetContextId !== undefined
  ) {
    const fieldIndex = getConfigFieldsForContext(targetContextId).findIndex((field) => field.storageKey === button.key)
    if (fieldIndex !== -1) return `cfg:${button.action === 'edit' ? 'e' : 's'}:${fieldIndex.toString(36)}`
  }

  const fallback = button.action === 'setup' ? 'cfg:setup' : button.action === 'cancel' ? 'cfg:cancel' : 'cfg:back'
  return Buffer.byteLength(fallback, 'utf8') <= MAX_CALLBACK_DATA_BYTES ? fallback : INVALID_CALLBACK_DATA
}

function appendContext(base: string, targetContextId: string | undefined): string {
  return targetContextId === undefined ? base : `${base}@${encodeContextId(targetContextId)}`
}

export function serializeCallbackData(button: Pick<EditorButton, 'action' | 'key'>, targetContextId?: string): string {
  switch (button.action) {
    case 'edit':
      return compactCallbackData(
        appendContext(button.key === undefined ? 'cfg:back' : `cfg:edit:${button.key}`, targetContextId),
        button,
        targetContextId,
      )
    case 'save':
      return compactCallbackData(
        appendContext(button.key === undefined ? 'cfg:back' : `cfg:save:${button.key}`, targetContextId),
        button,
        targetContextId,
      )
    case 'cancel':
      return compactCallbackData(appendContext('cfg:cancel', targetContextId), button, targetContextId)
    case 'back':
      return compactCallbackData(appendContext('cfg:back', targetContextId), button, targetContextId)
    case 'setup':
      return compactCallbackData(appendContext('cfg:setup', targetContextId), button, targetContextId)
    default:
      return compactCallbackData(appendContext('cfg:back', targetContextId), { action: 'back' }, targetContextId)
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

  if (core.startsWith('cfg:e:')) {
    const index = core.replace('cfg:e:', '')
    return /^[0-9a-z]+$/u.test(index)
      ? { action: 'edit', key: `#${index}`, targetContextId }
      : { action: null, key: null }
  }

  if (core.startsWith('cfg:s:')) {
    const index = core.replace('cfg:s:', '')
    return /^[0-9a-z]+$/u.test(index)
      ? { action: 'save', key: `#${index}`, targetContextId }
      : { action: null, key: null }
  }

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
  return parseRawCallbackData(data)
}

export function resolveCallbackKey(key: string | null, targetContextId: string): string | null {
  if (key === null) return null
  if (!key.startsWith('#')) return key
  const index = Number.parseInt(key.slice(1), 36)
  if (!Number.isSafeInteger(index)) return null
  return getConfigFieldsForContext(targetContextId)[index]?.storageKey ?? null
}
