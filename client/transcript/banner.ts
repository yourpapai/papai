// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StatusTone } from '../shared/ui/status-tone.js'
import type { ViewerStatus } from './transcript.svelte.js'

export interface BannerCopy {
  label: string
  tone: StatusTone
  dot: boolean
}

/**
 * Banner copy per viewer status.
 *
 * `error` is deliberately `warn` rather than `danger`: the native EventSource reconnects by
 * itself and `resync()` backfills the gap, so the state is transient and the user needs to do
 * nothing. `invalid-token` keeps `danger` because it is terminal — the viewer cannot mint a new
 * link. Those two rendering identically was the reported defect.
 *
 * Typed as a total Record so adding a ViewerStatus is a compile error rather than a silent
 * fall-through.
 */
const COPY: Record<ViewerStatus, BannerCopy> = {
  connecting: { label: 'Connecting…', tone: 'info', dot: false },
  live: { label: 'Live', tone: 'accent', dot: true },
  finished: { label: 'Session finished', tone: 'neutral', dot: false },
  'recording-disabled': { label: 'Live only — not retained', tone: 'warn', dot: false },
  'invalid-token': { label: 'Link invalid or expired', tone: 'danger', dot: false },
  error: { label: 'Reconnecting…', tone: 'warn', dot: false },
}

export function bannerFor(status: ViewerStatus): BannerCopy {
  return COPY[status]
}
