// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { getConfigFieldsForContext } from '../config-keys.js'
import { isAllowedDynamicConfigKey } from '../types/config.js'
import type { EditorButton } from './types.js'

const MAX_CALLBACK_DATA_BYTES = 64

const encodeContextId = (id: string): string => Buffer.from(id).toString('base64url')
const decodeContextId = (encoded: string): string => Buffer.from(encoded, 'base64url').toString('utf8')

const INVALID_CALLBACK_DATA = 'cfg:invalid'

function targetTag(targetContextId: string): string {
  return createHash('sha256').update(targetContextId).digest('base64url').slice(0, 8)
}

function fieldFingerprint(storageKey: string): string {
  return createHash('sha256').update(storageKey).digest('base64url').slice(0, 6)
}

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
    if (fieldIndex !== -1)
      return `cfg:${button.action === 'edit' ? 'e' : 's'}:${fieldIndex.toString(36)}:${targetTag(targetContextId)}:${fieldFingerprint(button.key)}`
  }

  const fallback = button.action === 'setup' ? 'cfg:setup' : button.action === 'cancel' ? 'cfg:cancel' : 'cfg:back'
  return Buffer.byteLength(fallback, 'utf8') <= MAX_CALLBACK_DATA_BYTES ? fallback : INVALID_CALLBACK_DATA
}

function appendContext(base: string, targetContextId: string | undefined): string {
  return targetContextId === undefined ? base : `${base}@${encodeContextId(targetContextId)}`
}

function splitCallbackContext(data: string): { core: string; targetContextId?: string } {
  const atIdx = data.indexOf('@')
  if (atIdx === -1) return { core: data }

  try {
    return {
      core: data.slice(0, atIdx),
      targetContextId: decodeContextId(data.slice(atIdx + 1)),
    }
  } catch {
    return { core: data.slice(0, atIdx) }
  }
}

function parseCompactCallbackKey(
  prefix: 'cfg:e:' | 'cfg:s:',
  action: 'edit' | 'save',
  core: string,
): {
  action: 'edit' | 'save' | null
  key: string | null
} | null {
  if (!core.startsWith(prefix)) return null

  const [index, tag, fingerprint] = core.slice(prefix.length).split(':')
  const isValid =
    index !== undefined &&
    tag !== undefined &&
    fingerprint !== undefined &&
    /^[0-9a-z]+$/u.test(index) &&
    /^[A-Za-z0-9_-]+$/u.test(tag) &&
    /^[A-Za-z0-9_-]+$/u.test(fingerprint)

  return isValid ? { action, key: `#${index}:${tag}:${fingerprint}` } : { action: null, key: null }
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
  const { core, targetContextId } = splitCallbackContext(data)

  if (core === 'cfg:cancel') return { action: 'cancel', key: null, targetContextId }
  if (core === 'cfg:back') return { action: 'back', key: null, targetContextId }
  if (core === 'cfg:setup') return { action: 'setup', key: null, targetContextId }

  const compactEdit = parseCompactCallbackKey('cfg:e:', 'edit', core)
  if (compactEdit !== null) return { ...compactEdit, targetContextId }

  const compactSave = parseCompactCallbackKey('cfg:s:', 'save', core)
  if (compactSave !== null) return { ...compactSave, targetContextId }

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
  const [indexText, tag, fingerprint] = key.slice(1).split(':')
  if (indexText === undefined || tag === undefined || fingerprint === undefined || tag !== targetTag(targetContextId))
    return null
  const index = Number.parseInt(indexText, 36)
  if (!Number.isSafeInteger(index)) return null
  const storageKey = getConfigFieldsForContext(targetContextId)[index]?.storageKey
  if (storageKey === undefined || fieldFingerprint(storageKey) !== fingerprint) return null
  return storageKey
}
