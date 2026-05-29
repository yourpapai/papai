// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type KonturTalkConstructorConfig = Partial<{
  jwtToken: string
  platformInstanceId: string
}>

export type ResolvedKonturTalkConfig = {
  jwtToken: string
  platformInstanceId: string
}

const resolveConfigValue = (value: string | undefined, fallback: string | undefined): string | undefined => {
  if (value === undefined) return fallback
  return value
}

const resolvePlatformInstanceId = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined) return 'kontur-talk-default'
  return platformInstanceId
}

export const resolveKonturTalkConfig = (config: KonturTalkConstructorConfig): ResolvedKonturTalkConfig => {
  const jwtToken = resolveConfigValue(config.jwtToken, process.env['KONTUR_TALK_JWT_TOKEN'])
  if (jwtToken === undefined || jwtToken.trim() === '') {
    throw new Error('KONTUR_TALK_JWT_TOKEN environment variable is required')
  }
  return {
    jwtToken,
    platformInstanceId: resolvePlatformInstanceId(config.platformInstanceId),
  }
}
