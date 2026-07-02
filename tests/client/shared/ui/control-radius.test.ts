// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('control primitives share --radius-control', () => {
  for (const file of ['Btn.svelte', 'Input.svelte', 'IconButton.svelte']) {
    test(`${file} uses var(--radius-control)`, () => {
      const css = read(`../../../../client/shared/ui/${file}`)
      expect(css).toContain('border-radius: var(--radius-control)')
    })
  }
})
