// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type PlatformScopedContext = Readonly<{
  platformInstanceId: string
  nativeContextId: string
}>

export type PlatformScopedThreadContext = PlatformScopedContext &
  Readonly<{
    threadId: string | undefined
  }>

const encodeComponent = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')
const decodeComponent = (value: string): string | null => {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8')
    return encodeComponent(decoded) === value ? decoded : null
  } catch {
    return null
  }
}
const SCOPED_THREAD_MARKER = ':thread:'
const SCOPED_CONTEXT_PATTERN = /^pi:([A-Za-z0-9_-]+):ctx:([A-Za-z0-9_-]+)(?::thread:([A-Za-z0-9_-]+))?$/u

export const toScopedContextId = (input: PlatformScopedContext): string =>
  `pi:${encodeComponent(input.platformInstanceId)}:ctx:${encodeComponent(input.nativeContextId)}`

export const toScopedThreadContextId = (input: PlatformScopedThreadContext): string => {
  const scoped = toScopedContextId(input)
  if (input.threadId === undefined) return scoped
  return `${scoped}:thread:${encodeComponent(input.threadId)}`
}

export const parseScopedContextId = (contextId: string): PlatformScopedThreadContext | null => {
  const match = SCOPED_CONTEXT_PATTERN.exec(contextId)
  if (match === null) return null
  const platformComponent = match[1]
  const contextComponent = match[2]
  if (platformComponent === undefined || contextComponent === undefined) return null
  const platformInstanceId = decodeComponent(platformComponent)
  const nativeContextId = decodeComponent(contextComponent)
  const encodedThreadId = match[3]
  const threadId = encodedThreadId === undefined ? undefined : decodeComponent(encodedThreadId)
  if (platformInstanceId === null || nativeContextId === null || threadId === null) return null
  if (platformInstanceId.length === 0 || nativeContextId.length === 0) return null
  if (threadId !== undefined && threadId.length === 0) return null
  return { platformInstanceId, nativeContextId, threadId }
}

export const isScopedContextId = (contextId: string): boolean => parseScopedContextId(contextId) !== null

export const toStorageContextId = (platformInstanceId: string, nativeOrScopedContextId: string): string => {
  if (isScopedContextId(nativeOrScopedContextId)) return nativeOrScopedContextId
  return toScopedContextId({ platformInstanceId, nativeContextId: nativeOrScopedContextId })
}

export const getNativeContextId = (scopedOrNativeContextId: string): string => {
  const parsed = parseScopedContextId(scopedOrNativeContextId)
  if (parsed === null) return scopedOrNativeContextId
  return parsed.nativeContextId
}

export const isScopedThreadContextId = (contextId: string): boolean =>
  isScopedContextId(contextId) && contextId.includes(SCOPED_THREAD_MARKER)

export const hasThreadContextId = (contextId: string): boolean => {
  if (isScopedContextId(contextId)) return isScopedThreadContextId(contextId)
  return contextId.includes(':')
}

export const getMainContextIdFromThreadContextId = (contextId: string): string => {
  if (isScopedThreadContextId(contextId)) {
    const threadMarkerIndex = contextId.indexOf(SCOPED_THREAD_MARKER)
    if (threadMarkerIndex === -1) return contextId
    return contextId.slice(0, threadMarkerIndex)
  }

  if (isScopedContextId(contextId)) return contextId
  if (!contextId.includes(':')) return contextId
  const mainContextId = contextId.split(':')[0]
  if (mainContextId === undefined) return contextId
  return mainContextId
}
