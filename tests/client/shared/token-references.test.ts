// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

import { Glob } from 'bun'

const CLIENT_DIR = fileURLToPath(new URL('../../../client/', import.meta.url))

// A custom-property declaration: `--name:`. The colon must follow the name directly (modulo
// whitespace), which is what keeps `style:color={dim ? 'var(--fg4)' : 'var(--fg3)'}` from
// reading as a declaration — there, the colon is separated from the name by `)` and a quote.
const DECLARATION = /(--[a-z0-9-]+)\s*:/giu

// A reference. Only the plain `var(--name)` form occurs in this codebase — there are no
// `var(--name, fallback)` uses — and including the closing paren is what makes the match exact
// rather than a prefix match.
const REFERENCE = /var\((--[a-z0-9-]+)\)/giu

const scanClient = async (): Promise<{ declared: Set<string>; referenced: { name: string; file: string }[] }> => {
  const declared = new Set<string>()
  const referenced: { name: string; file: string }[] = []

  for await (const relativePath of new Glob('**/*.{css,svelte,ts}').scan({ cwd: CLIENT_DIR })) {
    const text = await Bun.file(`${CLIENT_DIR}${relativePath}`).text()
    for (const match of text.matchAll(DECLARATION)) declared.add(match[1]!)
    for (const match of text.matchAll(REFERENCE)) {
      referenced.push({ name: match[1]!, file: relativePath })
    }
  }

  return { declared, referenced }
}

describe('token references', () => {
  test('every var(--x) in client/ resolves to a declaration in client/', async () => {
    const { declared, referenced } = await scanClient()

    const undeclared = referenced
      .filter((reference) => !declared.has(reference.name))
      .map((reference) => `${reference.name} <- client/${reference.file}`)

    expect(undeclared).toEqual([])
  })

  test('the scan actually found references, so an empty result cannot pass vacuously', async () => {
    const { declared, referenced } = await scanClient()

    expect(declared.size).toBeGreaterThan(50)
    expect(referenced.length).toBeGreaterThan(500)
  })
})
