// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StatusTone = 'accent' | 'warn' | 'danger' | 'info' | 'neutral' | 'mute'

const TONE_MAP: Record<string, StatusTone> = {
  active: 'accent',
  running: 'accent',
  ok: 'accent',
  connected: 'accent',
  configured: 'accent',
  enabled: 'accent',
  auto: 'info',
  scheduled: 'info',
  pending: 'warn',
  paused: 'warn',
  queued: 'warn',
  error: 'danger',
  failed: 'danger',
  stopped: 'danger',
  unmatched: 'mute',
  idle: 'mute',
  unknown: 'mute',
  disabled: 'mute',
  '—': 'mute',
  trace: 'mute',
  debug: 'mute',
  warn: 'warn',
  info: 'info',
  fatal: 'danger',
  retriable: 'info',
  'non-retriable': 'mute',
}

export function statusTone(status: string): StatusTone {
  return TONE_MAP[status.toLowerCase()] ?? 'neutral'
}
