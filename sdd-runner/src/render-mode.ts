// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Render-mode selection: the Ink TUI only when a live terminal owns both
 * stdio streams and no CI env / dumb TERM overrides it; everything else —
 * pipes, redirects, CI runners — gets the append-only line renderer, with
 * `SDD_DEBUG=1` raising the line altitude instead of switching modes.
 */

export interface Streams {
  readonly stdout: { readonly isTTY?: boolean }
  readonly stdin: { readonly isTTY?: boolean }
}

export type RenderMode = 'tui' | 'line' | 'line-debug'

export function renderModeFor(streams: Streams, env: Readonly<Record<string, string | undefined>>): RenderMode {
  const debug = env['SDD_DEBUG'] === '1'
  const tuiCapable =
    streams.stdout.isTTY === true && streams.stdin.isTTY === true && env['CI'] === undefined && env['TERM'] !== 'dumb'
  if (tuiCapable) return 'tui'
  return debug ? 'line-debug' : 'line'
}
