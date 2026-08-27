// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { useWindowSize } from 'ink'

/**
 * tui-width (fancy-ui D5): reactive terminal width inside the React tree.
 * `useTerminalWidth()` is a thin wrapper over ink's stock `useWindowSize`
 * (which reads `useStdout()`, subscribes `resize`, and re-renders on
 * change) — no hand-rolled resize subscription. Components stay pure
 * functions of a `width` prop; the hook only replaces the mount-time
 * capture (`process.stdout.columns ?? 100`) so a rerender refreshes it.
 * `WidthFeed` mirrors `KeyFeed`: the scripted-seam way tests drive resizes
 * by updating columns/rows on an injected stdout and emitting `resize`
 * there — composable with the stock hook through an injectable mount.
 */

export function useTerminalWidth(fallbackWidth = 100): number {
  const { columns } = useWindowSize()
  return columns > 0 ? columns : fallbackWidth
}

/** A stdout-shaped target whose reported size can be changed and announced. */
export interface ResizeTarget {
  columns?: number | undefined
  rows?: number | undefined
  emit(eventName: 'resize'): boolean
}

export interface WidthFeed {
  readonly resize: (columns: number, rows: number) => void
}

export function createWidthFeed(target: ResizeTarget): WidthFeed {
  return {
    resize: (columns: number, rows: number): void => {
      target.columns = columns
      target.rows = rows
      target.emit('resize')
    },
  }
}
