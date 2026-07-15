// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type MattermostCatchupConfig = {
  perChannelCap: number
  stalenessMs: number
  concurrency: number
}

const DEFAULT_PER_CHANNEL_CAP = 20
const DEFAULT_STALENESS_MS = 21_600_000
const DEFAULT_CONCURRENCY = 3

function readPositiveIntEnv(name: string, fallback: number): number {
  const env = process.env[name]
  if (env !== undefined && env !== '') {
    const parsed = Number.parseInt(env, 10)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return fallback
}

export function getCatchupConfig(): MattermostCatchupConfig {
  return {
    perChannelCap: readPositiveIntEnv('MATTERMOST_CATCHUP_PER_CHANNEL_CAP', DEFAULT_PER_CHANNEL_CAP),
    stalenessMs: readPositiveIntEnv('MATTERMOST_CATCHUP_STALENESS_MS', DEFAULT_STALENESS_MS),
    concurrency: readPositiveIntEnv('MATTERMOST_CATCHUP_CONCURRENCY', DEFAULT_CONCURRENCY),
  }
}
