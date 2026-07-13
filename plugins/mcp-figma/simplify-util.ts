// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function generateCSSShorthand(p: { top: number; right: number; bottom: number; left: number }): string {
  const { top, right, bottom, left } = p
  if (top === right && right === bottom && bottom === left) return `${top}px`
  if (top === bottom && left === right) return `${top}px ${left}px`
  return `${top}px ${right}px ${bottom}px ${left}px`
}

export function hasFlexLayout(node: Record<string, unknown>): boolean {
  const mode = node['layoutMode']
  return mode === 'HORIZONTAL' || mode === 'VERTICAL'
}

export function isInAutoLayoutFlow(
  node: Record<string, unknown>,
  parent: Record<string, unknown> | undefined,
): boolean {
  if (parent === undefined || !hasFlexLayout(parent)) return false
  return node['layoutPositioning'] !== 'ABSOLUTE'
}
