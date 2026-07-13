// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../..')

test('default Bun discovery excludes the entire hermetic story tree', () => {
  const bunfig = readFileSync(path.join(ROOT, 'bunfig.toml'), 'utf8')

  expect(bunfig).toContain('"tests/stories/**"')
  expect(bunfig).not.toContain('"tests/stories/**/*.story.test.ts"')
})

test('package scripts retain an explicit harness contract command', () => {
  const packageJson = readFileSync(path.join(ROOT, 'package.json'), 'utf8')

  expect(packageJson).toContain('"test:stories:contracts": "bun scripts/test-stories.ts --contracts"')
})

test('Knip declares the coding-session compatibility seams as narrow public entries', () => {
  const knip = readFileSync(path.join(ROOT, 'knip.jsonc'), 'utf8')

  expect(knip).toContain('"src/coding-sessions/configure.ts!"')
  expect(knip).toContain('"src/coding-sessions/session-record.ts!"')
  expect(knip).toContain('"src/coding-sessions/store.ts!"')
})
