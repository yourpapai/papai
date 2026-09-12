// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type KonturTalkConstructorConfig = Partial<{
  jwtToken: string
  platformInstanceId: string
  apiBaseUrl: string
}>

export type ResolvedKonturTalkConfig = {
  jwtToken: string
  platformInstanceId: string
  apiBaseUrl: string
}

const DEFAULT_API_BASE_URL = 'https://chat.ktalk.ru/_matrix/client/strangler/api/v1'

const resolvePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined || platformInstanceId.trim() === '') {
    throw new Error('platformInstanceId is required')
  }
  return platformInstanceId
}

const resolveApiBaseUrl = (apiBaseUrl: string | undefined): string => {
  if (apiBaseUrl === undefined) return DEFAULT_API_BASE_URL
  if (apiBaseUrl.trim() === '') throw new Error('apiBaseUrl must not be empty')
  return apiBaseUrl.replace(/\/$/u, '')
}

export const resolveKonturTalkConfig = (config: KonturTalkConstructorConfig): ResolvedKonturTalkConfig => {
  const jwtToken = config.jwtToken
  if (jwtToken === undefined || jwtToken.trim() === '') {
    throw new Error('KONTUR_TALK_JWT_TOKEN environment variable is required')
  }
  return {
    jwtToken,
    platformInstanceId: resolvePlatformInstanceId(config.platformInstanceId),
    apiBaseUrl: resolveApiBaseUrl(config.apiBaseUrl),
  }
}
