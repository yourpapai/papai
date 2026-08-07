// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('run-semgrep script', () => {
  test('disables git-aware filtering so Docker scans worktree files', async () => {
    const source = await Bun.file('scripts/run-semgrep.ts').text()

    expect(source).toContain("'--no-git-ignore'")
  })

  test('excludes generated dashboard output from security scans', async () => {
    const source = await Bun.file('scripts/run-semgrep.ts').text()

    expect(source).toContain("'public'")
  })

  test('excludes generated mutation sandboxes from security scans', async () => {
    const source = await Bun.file('scripts/run-semgrep.ts').text()

    expect(source).toContain("'.stryker-tmp'")
  })
})

/**
 * A scan that fails with **no finding to point at** is the worst kind to
 * inherit, and this one shape produces exactly that.
 *
 * Semgrep's TypeScript parser reads `<!--` as the Annex B HTML-like comment
 * opener even inside a regex literal, skips the rest of the line, and `--strict`
 * escalates the partial parse to exit code 3 — reported as "could not fully
 * parse a file", with the file named only under `--verbose`. It hid behind a
 * real finding for as long as there was one.
 *
 * A string or template containing `<!--` is fine; only the regex literal breaks.
 * So the guard looks for the two characters that start one.
 */
const ROOTS = ['src', 'opencode-agent/src', 'review-loop/src', 'mutation-improve/src', 'scripts', 'client']

/** The two characters that start a regex literal with an HTML comment in it. */
const OPENER = '/<!--'

/**
 * Prose is exempt, and that is not laziness — it was checked. A comment holding
 * the sequence parses fine; only a regex literal breaks. Without this the guard
 * would flag the very paragraph in `blocks.ts` explaining itself, and a check
 * that fires on its own documentation is a check somebody deletes.
 */
const isProse = (line: string): boolean => {
  const trimmed = line.trimStart()
  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')
}

const offendingLines = (path: string, text: string): string[] =>
  text
    .split('\n')
    .map((line, index) => ({ line, at: `${path}:${index + 1}` }))
    .filter(({ line }) => line.includes(OPENER) && !isProse(line))
    .map(({ at }) => at)

const scannedFiles = (): string[] =>
  ROOTS.flatMap((root) => Array.from(new Bun.Glob('**/*.ts').scanSync(root), (file) => `${root}/${file}`))

describe('source that Semgrep can parse', () => {
  test('no regex literal opens with an HTML comment', async () => {
    const found = await Promise.all(
      scannedFiles().map(async (path) => offendingLines(path, await Bun.file(path).text())),
    )

    // Write `[<]!--` instead: the same character class of one, and it parses.
    expect(found.flat()).toEqual([])
  })
})
