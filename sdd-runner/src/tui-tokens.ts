// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Semantic color tokens (fancy-ui D2): one shared map from semantic values
 * — finding severity, pipeline stage status, cost state, retry badge — to
 * Ink `<Text>` color props. Color is decoration only: every distinction
 * keeps its existing non-color marker (`2b 1m 0n` counts, `✓ ▶ · —` stage
 * icons, `metered`/`estimated`/`unknown` wording, `$`/`cost ?` labels,
 * `[retry n]` badge text). chalk is never imported — ink renders the props.
 * A monochrome mode maps every token to an empty props object, so `NO_COLOR`
 * output is structurally identical to colored output minus the escapes.
 */

/** The subset of Ink `<Text>` style props a token may set. */
export interface InkColorProps {
  readonly color?: string
  readonly bold?: boolean
  readonly dimColor?: boolean
}

export type ColorMode = 'color' | 'monochrome'

export type Severity = 'blocker' | 'material' | 'nitpick'
export type StageStatus = 'pending' | 'active' | 'done' | 'skipped'
export type CostState = 'known' | 'estimated' | 'unknown'

/** Terminal facts the mode is decided from: the raw `NO_COLOR` value and the color depth. */
export interface ColorEnv {
  readonly noColor: string | undefined
  readonly colorDepth: number
}

const SEVERITY: Readonly<Record<Severity, InkColorProps>> = {
  blocker: { color: 'red', bold: true },
  material: { color: 'yellow' },
  nitpick: { dimColor: true },
}

const STAGE: Readonly<Record<StageStatus, InkColorProps>> = {
  pending: { dimColor: true },
  active: { color: 'green', bold: true },
  done: { color: 'green' },
  skipped: { color: 'gray' },
}

const COST: Readonly<Record<CostState, InkColorProps>> = {
  known: { color: 'cyan' },
  estimated: { color: 'yellow' },
  unknown: { dimColor: true },
}

const RETRY: InkColorProps = { color: 'magenta', bold: true }

/**
 * `NO_COLOR` set to any non-empty value (the spec's rule) or a terminal
 * below 2-bit color disables color; everything else renders color.
 */
export function colorModeFor(env: ColorEnv): ColorMode {
  if (env.noColor !== undefined && env.noColor !== '') return 'monochrome'
  if (env.colorDepth < 2) return 'monochrome'
  return 'color'
}

export function severityToken(mode: ColorMode, severity: Severity): InkColorProps {
  return mode === 'color' ? SEVERITY[severity] : {}
}

export function stageToken(mode: ColorMode, status: StageStatus): InkColorProps {
  return mode === 'color' ? STAGE[status] : {}
}

export function costToken(mode: ColorMode, state: CostState): InkColorProps {
  return mode === 'color' ? COST[state] : {}
}

export function retryToken(mode: ColorMode): InkColorProps {
  return mode === 'color' ? RETRY : {}
}
