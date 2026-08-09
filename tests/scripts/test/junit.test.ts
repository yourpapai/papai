// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { decodeClassname, parseJUnit } from '../../../scripts/test/junit.js'
import type { JUnitCase } from '../../../scripts/test/junit.js'

const FIXTURE_DIR = join(import.meta.dir, 'fixtures')

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), 'utf8')
}

/** The fixtures were recorded from real Bun 1.3.11 runs; `cwd` is the repo root at record time. */
const CWD = '/home/user/papai'

const NESTED_FILE = 'reports/fixture-gen/nested.test.ts'
const GREEN_FILE = 'reports/fixture-gen/green.test.ts'

/** Throwing accessors keep branching out of the test bodies. */
function casesFor(xml: string, file: string, cwd: string = CWD): JUnitCase[] {
  const cases = parseJUnit(xml, cwd).byFile.get(file)
  if (cases === undefined) throw new Error(`no cases parsed for ${file}`)
  return cases
}

function caseAt(cases: JUnitCase[], index: number): JUnitCase {
  const found = cases[index]
  if (found === undefined) throw new Error(`no case at index ${index}`)
  return found
}

describe('decodeClassname', () => {
  test('decodes the double-escaped separator and reverses the describe chain', () => {
    // Recorded verbatim from junit-nested.xml; the console printed `outer > inner > deep fails`.
    expect(decodeClassname('inner &amp;gt; outer')).toEqual(['outer', 'inner'])
  })

  test('returns one segment for a single describe', () => {
    expect(decodeClassname('A')).toEqual(['A'])
  })

  test('returns an empty chain for an empty classname', () => {
    expect(decodeClassname('')).toEqual([])
  })

  test('decodes exactly twice, so a chain of three reverses whole', () => {
    expect(decodeClassname('deep &amp;gt; inner &amp;gt; outer')).toEqual(['outer', 'inner', 'deep'])
  })

  test('decodes other entities in describe names', () => {
    expect(decodeClassname('a &amp;amp; b')).toEqual(['a & b'])
  })
})

describe('parseJUnit', () => {
  test('reads totals from the testsuites root and converts seconds to milliseconds', () => {
    const run = parseJUnit(fixture('junit-nested.xml'), CWD)

    expect(run.totals.tests).toBe(5)
    expect(run.totals.failures).toBe(4)
    expect(run.totals.skipped).toBe(0)
    expect(run.totals.assertions).toBe(4)
    expect(run.totals.timeMs).toBeCloseTo(168.711784, 5)
  })

  test('groups cases under their repo-relative file in document order', () => {
    const run = parseJUnit(fixture('junit-nested.xml'), CWD)

    expect([...run.byFile.keys()]).toEqual([NESTED_FILE])
    expect(casesFor(fixture('junit-nested.xml'), NESTED_FILE).map((c) => c.name)).toEqual([
      'deep fails',
      'x',
      'y',
      'x',
      'passes',
    ])
  })

  test('keeps sibling describes that share a leaf name distinguishable by suite path', () => {
    const cases = casesFor(fixture('junit-nested.xml'), NESTED_FILE)

    expect(cases.map((c) => [...c.suitePath, c.name])).toEqual([
      ['outer', 'inner', 'deep fails'],
      ['A', 'x'],
      ['A', 'y'],
      ['B', 'x'],
      ['B', 'passes'],
    ])
  })

  test('carries per-case failed, line and ms', () => {
    const cases = casesFor(fixture('junit-nested.xml'), NESTED_FILE)

    expect(cases.map((c) => c.failed)).toEqual([true, true, true, true, false])
    expect(cases.map((c) => c.line)).toEqual([5, 12, 15, 21, 24])
    expect(caseAt(cases, 0).ms).toBeCloseTo(2.451, 6)
    expect(caseAt(cases, 4).ms).toBeCloseTo(0.023, 6)
  })

  test('does not classify on the failure type, which Bun always writes as AssertionError', () => {
    // `B > x` threw a plain `new Error('B x exploded')`, yet JUnit says type="AssertionError".
    const xml = fixture('junit-nested.xml')
    expect(xml).toContain('type="AssertionError"')

    const thrown = caseAt(casesFor(xml, NESTED_FILE), 3)
    expect(thrown.name).toBe('x')
    expect(thrown.suitePath).toEqual(['B'])
    expect(thrown.failed).toBe(true)
    expect(Object.keys(thrown).sort()).toEqual(['failed', 'file', 'line', 'ms', 'name', 'suitePath'])
  })

  test('treats a testcase with an <error> child as failed', () => {
    const xml = [
      '<testsuites name="bun test" tests="1" assertions="0" failures="1" skipped="0" time="0.01">',
      '  <testsuite name="tests/a.test.ts" file="tests/a.test.ts">',
      '    <testcase name="boom" classname="S" time="0.001" file="tests/a.test.ts" line="3">',
      '      <error type="Error" />',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n')

    expect(caseAt(casesFor(xml, 'tests/a.test.ts'), 0).failed).toBe(true)
  })

  test('normalizes an absolute in-tree file to repo-relative', () => {
    const xml = [
      '<testsuites name="bun test" tests="1" assertions="1" failures="0" skipped="0" time="0.01">',
      '  <testsuite name="a" file="/repo/tests/a.test.ts">',
      '    <testcase name="one" classname="a" time="0.001" file="/repo/tests/a.test.ts" line="4" />',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n')

    expect([...parseJUnit(xml, '/repo').byFile.keys()]).toEqual(['tests/a.test.ts'])
  })

  test('keeps an out-of-tree absolute file addressable relative to the repo root', () => {
    const xml = [
      '<testsuites name="bun test" tests="1" assertions="1" failures="0" skipped="0" time="0.01">',
      '  <testsuite name="a" file="/elsewhere/pkg/a.test.ts">',
      '    <testcase name="one" classname="a" time="0.001" file="/elsewhere/pkg/a.test.ts" line="4" />',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n')

    expect([...parseJUnit(xml, '/repo').byFile.keys()]).toEqual(['../elsewhere/pkg/a.test.ts'])
  })

  test('falls back to the enclosing testsuite file when a testcase omits one, and to null line', () => {
    const xml = [
      '<testsuites name="bun test" tests="1" assertions="1" failures="0" skipped="0" time="0.01">',
      '  <testsuite name="tests/a.test.ts" file="tests/a.test.ts">',
      '    <testcase name="one" classname="a" time="0.001" />',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n')

    const cases = casesFor(xml, 'tests/a.test.ts')
    expect(cases).toHaveLength(1)
    expect(caseAt(cases, 0).file).toBe('tests/a.test.ts')
    expect(caseAt(cases, 0).line).toBeNull()
  })

  test('parses attribute values that contain a literal unescaped ">"', () => {
    // Bun leaves a bare `>` inside classname, so a `<testcase[^>]*>` scan would truncate the tag.
    const xml = [
      '<testsuites name="bun test" tests="1" assertions="1" failures="0" skipped="0" time="0.01">',
      '  <testsuite name="tests/a.test.ts" file="tests/a.test.ts">',
      '    <testcase name="deep" classname="in &amp;gt; out" time="0.5" file="tests/a.test.ts" line="9" />',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n')

    const parsed = caseAt(casesFor(xml, 'tests/a.test.ts'), 0)
    expect(parsed.name).toBe('deep')
    expect(parsed.suitePath).toEqual(['out', 'in'])
    expect(parsed.line).toBe(9)
    expect(parsed.ms).toBeCloseTo(500, 6)
  })

  test('reports a clean run as all passing', () => {
    const run = parseJUnit(fixture('junit-green.xml'), CWD)

    expect(run.totals.tests).toBe(2)
    expect(run.totals.failures).toBe(0)
    expect(casesFor(fixture('junit-green.xml'), GREEN_FILE).map((c) => c.failed)).toEqual([false, false])
  })

  test('reports the mixed run exactly as the document states, omitting the unloadable file', () => {
    // Recorded from a run that exited 1 and printed `2 pass / 1 fail / 1 error`.
    const run = parseJUnit(fixture('junit-mixed.xml'), CWD)

    expect(run.totals.tests).toBe(2)
    expect(run.totals.failures).toBe(0)
    expect([...run.byFile.keys()]).toEqual([GREEN_FILE])
    expect(casesFor(fixture('junit-mixed.xml'), GREEN_FILE).map((c) => c.failed)).toEqual([false, false])
  })

  test('exposes no verdict, so an under-reporting document cannot be read as a green run', () => {
    const run = parseJUnit(fixture('junit-mixed.xml'), CWD)

    expect(Object.keys(run).sort()).toEqual(['byFile', 'totals'])
    expect(Object.keys(run.totals).sort()).toEqual(['assertions', 'failures', 'skipped', 'tests', 'timeMs'])
  })

  test('returns zero totals and no cases for an empty document without throwing', () => {
    const run = parseJUnit('', CWD)

    expect(run.byFile.size).toBe(0)
    expect(run.totals).toEqual({ tests: 0, failures: 0, skipped: 0, assertions: 0, timeMs: 0 })
  })

  test('returns zero totals when the root attributes are missing', () => {
    const run = parseJUnit('<testsuites></testsuites>', CWD)

    expect(run.totals).toEqual({ tests: 0, failures: 0, skipped: 0, assertions: 0, timeMs: 0 })
  })
})
