// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * WCAG 2.1 AA SC 1.4.3 (Contrast, Minimum). Applied flat, with no large-text
 * exemption: every `--text-dim` call site in the codebase renders text at
 * 10–12px, so a 3:1 branch would be a loophole no real site could use.
 */
const MIN_RATIO = 4.5

const TOKENS = readFileSync(fileURLToPath(new URL('../../../client/shared/tokens.css', import.meta.url)), 'utf8')

/**
 * These two lists are the contract. CSS carries no semantics saying which
 * custom property is text and which is a background, so the test declares it.
 * Adding a text token means adding it here — that is the point.
 */
const TEXT = ['--text', '--text-muted', '--text-dim']
const SURFACE = ['--bg', '--surface-1', '--surface-2', '--surface-hover', '--inset']

const DECL = /(--[\w-]+):\s*([^;]+);/gu

/** Every `--name: value` pair in the file, values untrimmed of `var()` wrappers. */
function declarations(): Map<string, string> {
  const out = new Map<string, string>()
  for (const [, name, value] of TOKENS.matchAll(DECL)) out.set(name!, value!.trim())
  return out
}

/** Follows `var(--x)` chains until a hex literal is reached. */
function resolve(name: string, decls: Map<string, string>): string {
  let value = decls.get(name)
  for (let hop = 0; hop < 10; hop++) {
    if (value === undefined) throw new Error(`token ${name} is not declared in tokens.css`)
    const alias = /^var\((--[\w-]+)\)$/u.exec(value)
    if (!alias) return value
    value = decls.get(alias[1]!)
  }
  throw new Error(`token ${name} did not resolve to a literal within 10 hops`)
}

/** sRGB channel linearization, per the WCAG relative-luminance definition. */
function channel(byte: number): number {
  const c = byte / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/iu.exec(hex)
  if (!m) throw new Error(`expected a 6-digit hex color, got ${hex}`)
  const digits = m[1]!
  const r = channel(Number.parseInt(digits.slice(0, 2), 16))
  const g = channel(Number.parseInt(digits.slice(2, 4), 16))
  const b = channel(Number.parseInt(digits.slice(4, 6), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('token contrast (WCAG SC 1.4.3)', () => {
  const decls = declarations()

  for (const fg of TEXT) {
    for (const bg of SURFACE) {
      test(`${fg} on ${bg} clears ${MIN_RATIO}:1`, () => {
        expect(ratio(resolve(fg, decls), resolve(bg, decls))).toBeGreaterThanOrEqual(MIN_RATIO)
      })
    }
  }

  test('resolve() reports an undeclared token instead of silently passing', () => {
    expect(() => resolve('--not-a-token', decls)).toThrow('not declared in tokens.css')
  })
})
