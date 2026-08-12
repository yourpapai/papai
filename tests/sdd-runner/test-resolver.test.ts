// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { findTestFile, isGateableImplFile, resolveImplPath, suggestTestPath } from '../../.hooks/tdd/test-resolver.mjs'

const tmpRoots: string[] = []

function makeTmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-resolver-'))
  tmpRoots.push(root)
  return root
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop()
    if (root !== undefined) fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('test-resolver sdd-runner mapping', () => {
  it('treats sdd-runner/src files as gateable implementation files', () => {
    const root = makeTmpRoot()
    expect(isGateableImplFile('sdd-runner/src/events.ts', root)).toBe(true)
    expect(isGateableImplFile('sdd-runner/src/stages/intake.ts', root)).toBe(true)
  })

  it('does not treat sdd-runner test files or non-src files as gateable', () => {
    const root = makeTmpRoot()
    expect(isGateableImplFile('sdd-runner/src/events.test.ts', root)).toBe(false)
    expect(isGateableImplFile('sdd-runner/package.json', root)).toBe(false)
    expect(isGateableImplFile('sdd-runner/README.md', root)).toBe(false)
  })

  it('suggests tests/sdd-runner paths for sdd-runner/src files', () => {
    expect(suggestTestPath('sdd-runner/src/events.ts')).toBe(path.join('tests', 'sdd-runner', 'events.test.ts'))
    expect(suggestTestPath('sdd-runner/src/stages/intake.ts')).toBe(
      path.join('tests', 'sdd-runner', 'stages', 'intake.test.ts'),
    )
  })

  it('resolves tests/sdd-runner test files back to sdd-runner/src implementation paths', () => {
    expect(resolveImplPath('tests/sdd-runner/events.test.ts')).toBe(path.join('sdd-runner', 'src', 'events.ts'))
    expect(resolveImplPath('tests/sdd-runner/stages/intake.test.ts')).toBe(
      path.join('sdd-runner', 'src', 'stages', 'intake.ts'),
    )
  })

  it('finds the mapped test file for an sdd-runner implementation file', () => {
    const root = makeTmpRoot()
    const implAbs = path.join(root, 'sdd-runner', 'src', 'events.ts')
    const testAbs = path.join(root, 'tests', 'sdd-runner', 'events.test.ts')
    fs.mkdirSync(path.dirname(implAbs), { recursive: true })
    fs.mkdirSync(path.dirname(testAbs), { recursive: true })
    fs.writeFileSync(implAbs, 'export {}\n')
    fs.writeFileSync(testAbs, "import {} from '../../sdd-runner/src/events.js'\n")
    expect(findTestFile(implAbs, root)).toBe(testAbs)
  })
})
