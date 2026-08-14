// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  computeSourceFingerprint,
  computeToolchainFingerprint,
  createDefaultFingerprintDeps,
  SCORE_FINGERPRINT_VERSION,
  TOOLCHAIN_FINGERPRINT_FILES,
} from '../../../scripts/mutation/score-fingerprint.js'

/**
 * A miniature project on disk: a source file, a companion test, a same-package
 * neighbour test, an unrelated test, and the toolchain files the fingerprint reads.
 * Everything below drives the real `createDefaultFingerprintDeps`, because the whole
 * point of this module is what it reads off the filesystem — a fully mocked dep set
 * would prove nothing about that.
 */
const makeProject = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'score-fingerprint-'))
  fs.mkdirSync(path.join(root, 'src/widgets'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tests/widgets'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tests/other'), { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts/mutation'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/widgets/dial.ts'), 'export const dial = (n: number): number => n + 1\n')
  fs.writeFileSync(
    path.join(root, 'tests/widgets/dial.test.ts'),
    "import { dial } from '../../src/widgets/dial.js'\ntest('dial', () => dial(1))\n",
  )
  fs.writeFileSync(path.join(root, 'tests/widgets/knob.test.ts'), "test('knob', () => {})\n")
  fs.writeFileSync(path.join(root, 'tests/other/unrelated.test.ts'), "test('unrelated', () => {})\n")
  fs.writeFileSync(path.join(root, 'stryker.config.json'), '{"mutate":[]}\n')
  fs.writeFileSync(path.join(root, 'scripts/mutation/overrides.json'), '{}\n')
  fs.writeFileSync(path.join(root, 'bun.lock'), 'lockfile-v1\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"devDependencies":{"@stryker-mutator/core":"^9.6.0"}}\n')
  fs.writeFileSync(path.join(root, 'scripts/mutation/paired-run.ts'), 'export const x = 1\n')
  return root
}

const fingerprint = (root: string, srcFile = 'src/widgets/dial.ts'): string => {
  const deps = createDefaultFingerprintDeps(root)
  return computeSourceFingerprint({ srcFile, toolchain: computeToolchainFingerprint(deps), deps })
}

describe('computeSourceFingerprint', () => {
  test('is stable across two independently-constructed dep sets over the same content', () => {
    const root = makeProject()
    expect(fingerprint(root)).toBe(fingerprint(root))
  })

  /**
   * The property that makes the cache work at all in CI. Every job checks the repo out
   * fresh, so every file's mtime is new; `scripts/test/fingerprint.ts` hashes size+mtime
   * and would miss on every entry. Copying the project to a new path with new mtimes and
   * getting the same fingerprint is the direct proof that this module hashes contents.
   */
  test('survives a fresh checkout: new paths, new mtimes, same bytes', () => {
    const root = makeProject()
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'score-fingerprint-copy-'))
    fs.cpSync(root, copy, { recursive: true })
    const future = new Date(Date.now() + 60_000)
    for (const rel of ['src/widgets/dial.ts', 'tests/widgets/dial.test.ts', 'bun.lock']) {
      fs.utimesSync(path.join(copy, rel), future, future)
    }
    expect(fingerprint(copy)).toBe(fingerprint(root))
  })

  test('changes when the source content changes', () => {
    const root = makeProject()
    const before = fingerprint(root)
    fs.writeFileSync(path.join(root, 'src/widgets/dial.ts'), 'export const dial = (n: number): number => n + 2\n')
    expect(fingerprint(root)).not.toBe(before)
  })

  test('changes when a covering test is edited', () => {
    const root = makeProject()
    const before = fingerprint(root)
    fs.appendFileSync(path.join(root, 'tests/widgets/dial.test.ts'), "test('more', () => dial(2))\n")
    expect(fingerprint(root)).not.toBe(before)
  })

  // Same-package tests are in the candidate universe even without an import, because a
  // barrel test can exercise the source transitively. Editing one must re-measure.
  test('changes when a same-package neighbour test is edited', () => {
    const root = makeProject()
    const before = fingerprint(root)
    fs.appendFileSync(path.join(root, 'tests/widgets/knob.test.ts'), "test('knob2', () => {})\n")
    expect(fingerprint(root)).not.toBe(before)
  })

  test('changes when a brand-new test importing the source appears', () => {
    const root = makeProject()
    const before = fingerprint(root)
    fs.writeFileSync(
      path.join(root, 'tests/other/late.test.ts'),
      "import { dial } from '../../src/widgets/dial.js'\ntest('late', () => dial(3))\n",
    )
    expect(fingerprint(root)).not.toBe(before)
  })

  test('changes when a covering test is deleted', () => {
    const root = makeProject()
    const before = fingerprint(root)
    fs.rmSync(path.join(root, 'tests/widgets/dial.test.ts'))
    expect(fingerprint(root)).not.toBe(before)
  })

  test('does not change when an unrelated test is edited', () => {
    const root = makeProject()
    const before = fingerprint(root)
    fs.appendFileSync(path.join(root, 'tests/other/unrelated.test.ts'), "test('still unrelated', () => {})\n")
    expect(fingerprint(root)).toBe(before)
  })

  // An override may point at a cross-cutting suite that neither imports the source nor
  // lives in its package directory. If it were left out of the universe, weakening that
  // suite would silently keep a stale score alive.
  test('covers override targets outside the candidate universe', () => {
    const root = makeProject()
    fs.writeFileSync(
      path.join(root, 'scripts/mutation/overrides.json'),
      JSON.stringify({ 'src/widgets/dial.ts': ['tests/other/unrelated.test.ts'] }),
    )
    const before = fingerprint(root)
    fs.appendFileSync(path.join(root, 'tests/other/unrelated.test.ts'), "test('now relevant', () => {})\n")
    expect(fingerprint(root)).not.toBe(before)
  })

  test('hashes an absent source deterministically instead of throwing', () => {
    const root = makeProject()
    expect(fingerprint(root, 'src/widgets/gone.ts')).toBe(fingerprint(root, 'src/widgets/gone.ts'))
  })

  test('distinguishes two files with identical content', () => {
    const root = makeProject()
    fs.writeFileSync(path.join(root, 'src/widgets/twin.ts'), fs.readFileSync(path.join(root, 'src/widgets/dial.ts')))
    expect(fingerprint(root, 'src/widgets/twin.ts')).not.toBe(fingerprint(root))
  })

  test('changes when the toolchain fingerprint changes', () => {
    const root = makeProject()
    const deps = createDefaultFingerprintDeps(root)
    const srcFile = 'src/widgets/dial.ts'
    const a = computeSourceFingerprint({ srcFile, toolchain: 'toolchain-a', deps })
    const b = computeSourceFingerprint({ srcFile, toolchain: 'toolchain-b', deps })
    expect(a).not.toBe(b)
  })
})

describe('computeToolchainFingerprint', () => {
  test('is stable over unchanged toolchain files', () => {
    const root = makeProject()
    expect(computeToolchainFingerprint(createDefaultFingerprintDeps(root))).toBe(
      computeToolchainFingerprint(createDefaultFingerprintDeps(root)),
    )
  })

  test.each([...TOOLCHAIN_FINGERPRINT_FILES])('changes when %s changes', (relPath: string) => {
    const root = makeProject()
    const before = computeToolchainFingerprint(createDefaultFingerprintDeps(root))
    fs.mkdirSync(path.join(root, path.dirname(relPath)), { recursive: true })
    fs.writeFileSync(path.join(root, relPath), '{"changed":true}\n')
    expect(computeToolchainFingerprint(createDefaultFingerprintDeps(root))).not.toBe(before)
  })

  // The mutation runner's own code decides how mutants are generated and scored, so a
  // change to it invalidates every recorded score just as surely as a config change.
  test('changes when any mutation script changes', () => {
    const root = makeProject()
    const before = computeToolchainFingerprint(createDefaultFingerprintDeps(root))
    fs.writeFileSync(path.join(root, 'scripts/mutation/paired-run.ts'), 'export const x = 2\n')
    expect(computeToolchainFingerprint(createDefaultFingerprintDeps(root))).not.toBe(before)
  })

  test('changes when a new mutation script appears', () => {
    const root = makeProject()
    const before = computeToolchainFingerprint(createDefaultFingerprintDeps(root))
    fs.writeFileSync(path.join(root, 'scripts/mutation/brand-new.ts'), 'export const y = 1\n')
    expect(computeToolchainFingerprint(createDefaultFingerprintDeps(root))).not.toBe(before)
  })
})

describe('SCORE_FINGERPRINT_VERSION', () => {
  // The in-repo way to force a full re-measure without touching CI keys.
  test('participates in the fingerprint', () => {
    const root = makeProject()
    const deps = createDefaultFingerprintDeps(root)
    const fp = computeSourceFingerprint({ srcFile: 'src/widgets/dial.ts', toolchain: 'tc', deps })
    expect(fp).toContain(SCORE_FINGERPRINT_VERSION)
  })
})
