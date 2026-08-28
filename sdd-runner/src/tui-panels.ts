// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import cliTruncate from 'cli-truncate'
import { Box, Text } from 'ink'
import { createElement } from 'react'
import type { ReactElement } from 'react'
import stringWidth from 'string-width'

import type { InkColorProps } from './tui-tokens.js'

/**
 * tui-panels (fancy-ui D3/D4): the single width authority for the TUI's
 * intra-line string columns — `string-width` measures (CJK, emoji,
 * combining marks, ZWJ sequences) and `cli-truncate` truncates by the same
 * measure, so one row is never padded by one width authority and truncated
 * by another. Also owns one shared panel frame style and the
 * `joinOrStack` reflow primitive generalizing `renderPipelineMap`'s 60-col
 * join rule — `renderer.ts` (frozen non-TTY output) keeps its own inline
 * 60; the test suite pins the two together so drift on either side fails.
 */

export const JOIN_THRESHOLD = 60

export type PanelLayout = 'join' | 'stack'

/** Measure visible display width (the authority for intra-line columns). */
export function displayWidth(text: string): number {
  return stringWidth(text)
}

/** Pad the right side to the requested display width (never truncates). */
export function padDisplay(text: string, width: number): string {
  const fill = Math.max(0, width - displayWidth(text))
  return `${text}${' '.repeat(fill)}`
}

/** Truncate by visible width; a too-narrow result keeps a single ellipsis marker. */
export function truncateDisplay(text: string, width: number): string {
  if (width < 1) return ''
  return cliTruncate(text, width)
}

function repeatChar(char: string, count: number): string {
  return char.repeat(Math.max(0, count))
}

/** Top frame line: `╭─ Title ─╮` (or an untitled bar), padded to `width` columns. */
export function frameTop(width: number, title = ''): string {
  const titleText = title === '' ? '' : ` ${title} `
  return `╭─${titleText}${repeatChar('─', width - 3 - displayWidth(titleText))}╮`
}

/** Bottom frame line: `╰──╯`, padded to `width` columns. */
export function frameBottom(width: number): string {
  return `╰${repeatChar('─', width - 2)}╯`
}

/** One framed body line: content padded and truncated by display width. */
export function frameBodyLine(text: string, width: number): string {
  const contentWidth = Math.max(1, width - 4)
  return `│ ${padDisplay(truncateDisplay(text, contentWidth), contentWidth)} │`
}

/**
 * One shared frame style: `╭─ Title ─╮ … ╰──╯` with content padded and
 * truncated by display width so every framed line is exactly `width`
 * columns (or fewer when width is degenerately small).
 */
export function frameLines(lines: readonly string[], width: number, title = ''): string[] {
  return [frameTop(width, title), ...lines.map((line) => frameBodyLine(line, width)), frameBottom(width)]
}

/** One styled span of a framed row; the tone decorates the span, never the frame. */
export interface PanelPart {
  readonly text: string
  readonly tone?: InkColorProps
}

export interface PanelRow {
  readonly key: string
  readonly parts: readonly PanelPart[]
}

/** A single-part row helper (plain or toned). */
export function panelRow(key: string, text: string, tone: InkColorProps = {}): PanelRow {
  return { key, parts: [{ text, tone }] }
}

/** The shared framed-panel component: one style, per-part tones, width-exact lines. */
export function FramedPanel(props: {
  readonly title: string
  readonly rows: readonly PanelRow[]
  readonly width: number
}): ReactElement {
  const contentWidth = Math.max(1, props.width - 4)
  const bodyRow = (row: PanelRow): ReactElement => {
    const single = row.parts.length === 1 ? row.parts[0] : undefined
    if (single !== undefined && (single.tone === undefined || Object.keys(single.tone).length === 0)) {
      return createElement(Text, { key: row.key }, frameBodyLine(single.text, props.width))
    }
    const parts =
      single === undefined
        ? row.parts
        : [{ text: padDisplay(truncateDisplay(single.text, contentWidth), contentWidth), tone: single.tone }]
    return createElement(
      Text,
      { key: row.key },
      '│ ',
      ...parts.map((part, partIndex) =>
        createElement(Text, { key: `${row.key}-${String(partIndex)}`, ...part.tone }, part.text),
      ),
      ' │',
    )
  }
  return createElement(
    Box,
    { flexDirection: 'column' },
    createElement(Text, { key: 'top' }, frameTop(props.width, props.title)),
    ...props.rows.map(bodyRow),
    createElement(Text, { key: 'bottom' }, frameBottom(props.width)),
  )
}

/**
 * Reflow primitive: side-by-side at or above the threshold, stacked below
 * it — a pure function of width. The default threshold is defined exactly
 * once, here, and pinned to `renderPipelineMap`'s boundary by test.
 */
export function joinOrStack(width: number, threshold: number = JOIN_THRESHOLD): PanelLayout {
  return width >= threshold ? 'join' : 'stack'
}
