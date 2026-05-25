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
const SCOPED_CONTEXT_PREFIX = 'pi:'
const SCOPED_CONTEXT_MARKER = ':ctx:'
const SCOPED_THREAD_MARKER = ':thread:'

export const toScopedContextId = (input: PlatformScopedContext): string =>
  `pi:${encodeComponent(input.platformInstanceId)}:ctx:${encodeComponent(input.nativeContextId)}`

export const toScopedThreadContextId = (input: PlatformScopedThreadContext): string => {
  const scoped = toScopedContextId(input)
  if (input.threadId === undefined) return scoped
  return `${scoped}:thread:${encodeComponent(input.threadId)}`
}

export const isScopedContextId = (contextId: string): boolean =>
  contextId.startsWith(SCOPED_CONTEXT_PREFIX) && contextId.includes(SCOPED_CONTEXT_MARKER)

export const toStorageContextId = (platformInstanceId: string, nativeOrScopedContextId: string): string => {
  if (isScopedContextId(nativeOrScopedContextId)) return nativeOrScopedContextId
  return toScopedContextId({ platformInstanceId, nativeContextId: nativeOrScopedContextId })
}

export const getNativeContextId = (scopedOrNativeContextId: string): string => {
  if (!isScopedContextId(scopedOrNativeContextId)) return scopedOrNativeContextId
  const scopedBody = scopedOrNativeContextId.slice(SCOPED_CONTEXT_PREFIX.length)
  const contextMarkerIndex = scopedBody.indexOf(SCOPED_CONTEXT_MARKER)
  if (contextMarkerIndex === -1) return scopedOrNativeContextId
  const contextStart = contextMarkerIndex + SCOPED_CONTEXT_MARKER.length
  const threadMarkerIndex = scopedBody.indexOf(SCOPED_THREAD_MARKER, contextStart)
  const encodedContext =
    threadMarkerIndex === -1 ? scopedBody.slice(contextStart) : scopedBody.slice(contextStart, threadMarkerIndex)
  const nativeContextId = decodeComponent(encodedContext)
  if (nativeContextId === null) return scopedOrNativeContextId
  return nativeContextId
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
