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
    threadId?: string
  }>

const encodeComponent = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

export const toScopedContextId = (input: PlatformScopedContext): string =>
  `pi:${encodeComponent(input.platformInstanceId)}:ctx:${encodeComponent(input.nativeContextId)}`

export const toScopedThreadContextId = (input: PlatformScopedThreadContext): string => {
  const scoped = toScopedContextId(input)
  if (input.threadId === undefined) return scoped
  return `${scoped}:thread:${encodeComponent(input.threadId)}`
}
