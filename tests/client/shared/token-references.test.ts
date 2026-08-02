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
// The name itself must start at a real declaration boundary — start of line, `{`, or `;` — before
// optional whitespace, which is what keeps a BEM modifier class glued to a pseudo-class (e.g.
// `.ui-btn--primary:hover:not(:disabled)`) from reading as a declaration of `--primary`.
const DECLARATION = /(?:^|[{;])\s*(--[a-z0-9-]+)\s*:/gimu

// A reference. Both `var(--name)` and `var(--name, fallback)` occur in this codebase, so the name
// is followed by optional whitespace and then either `,` or the closing paren.
const REFERENCE = /var\((--[a-z0-9-]+)\s*[,)]/giu

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
